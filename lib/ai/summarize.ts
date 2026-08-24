import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { complete } from './provider';
import { composeVersionBrief, composeProjectBrief } from './compose';
import { versionFacts, versionCoverage, versionComments, priorThemes } from './facts';
import type { Provider, VersionBrief, ProjectBrief } from './types';
// `export ... from` does not bind locally, so ComposeOutcome is imported too —
// summarizeVersion's return type needs it in scope.
import type { ComposeOutcome, ProjectLoad, ProjectComposeOutcome } from './compose';

/**
 * The database half of summarisation.
 *
 * `composeVersionBrief` is re-exported so production code has one import
 * surface — but tests must import it from './compose' directly, because this
 * module's `@/lib/db` import throws when DATABASE_URL is unset.
 */
export { composeVersionBrief } from './compose';
export type { VersionLoad, ComposeOutcome } from './compose';
export { composeProjectBrief } from './compose';
export type { ProjectLoad, ProjectComposeOutcome } from './compose';

export async function summarizeVersion(
  versionId: string,
  provider: Provider = complete
): Promise<ComposeOutcome> {
  const meta = await sql`
    SELECT version_number AS "versionNumber" FROM versions WHERE id = ${versionId}
  `;
  if (!meta[0]) return { ok: false, reason: 'Version not found' };

  // Coverage is read alongside the comments so the watermark describes the
  // same snapshot the prompt was built from.
  const [facts, coverage, comments, prior] = await Promise.all([
    versionFacts(versionId),
    versionCoverage(versionId),
    versionComments(versionId),
    priorThemes(versionId),
  ]);

  const outcome = await composeVersionBrief(
    {
      versionNumber: meta[0].versionNumber,
      facts,
      comments,
      priorThemes: prior,
      coverage,
    },
    provider
  );

  if (!outcome.ok) return outcome;

  // Last-most-complete-wins. Two concurrent refreshes both generate; the
  // staler result is discarded and neither request errors.
  await sql`
    INSERT INTO version_summaries
      (id, version_id, headline, themes, covered_count, covered_through, model)
    VALUES (
      ${uuidv4()}, ${versionId}, ${outcome.brief.headline},
      ${JSON.stringify(outcome.brief.themes)}::jsonb,
      ${outcome.coveredCount}, ${outcome.coveredThrough}, ${outcome.model}
    )
    ON CONFLICT (version_id) DO UPDATE SET
      headline = EXCLUDED.headline,
      themes = EXCLUDED.themes,
      covered_count = EXCLUDED.covered_count,
      covered_through = EXCLUDED.covered_through,
      model = EXCLUDED.model,
      generated_at = NOW()
    WHERE EXCLUDED.covered_count >= version_summaries.covered_count
  `;

  return outcome;
}

export async function readVersionBrief(versionId: string): Promise<{
  brief: VersionBrief | null;
  coveredCount: number | null;
  generatedAt: string | null;
}> {
  const rows = await sql`
    SELECT headline, themes, covered_count AS "coveredCount",
           generated_at AS "generatedAt"
    FROM version_summaries WHERE version_id = ${versionId}
  `;
  const row = rows[0];
  if (!row) return { brief: null, coveredCount: null, generatedAt: null };

  return {
    brief: { headline: row.headline, themes: row.themes ?? [] },
    coveredCount: row.coveredCount,
    generatedAt: row.generatedAt,
  };
}

export async function summarizeProject(
  projectId: string,
  provider: Provider = complete
): Promise<ProjectComposeOutcome> {
  const rows = await sql`
    SELECT p.name AS "projectName",
           po.id AS "portalId", po.name AS "packageName",
           v.id AS "versionId", v.version_number AS "versionNumber",
           vs.headline, vs.generated_at AS "generatedAt"
    FROM projects p
    JOIN portals po ON po.project_id = p.id AND po.archived_at IS NULL
    JOIN versions v ON v.portal_id = po.id
    JOIN version_summaries vs ON vs.version_id = v.id
    WHERE p.id = ${projectId}
    ORDER BY po.name ASC, v.version_number ASC
  `;

  if (rows.length === 0) {
    return { ok: false, reason: 'No package summaries to roll up yet' };
  }

  const byPortal = new Map<
    string,
    { portalId: string; name: string; versions: ProjectLoad['packages'][number]['versions'] }
  >();
  let coveredThrough = rows[0].generatedAt as string;

  for (const row of rows) {
    if (row.generatedAt > coveredThrough) coveredThrough = row.generatedAt;
    // Explicit annotation: an unannotated `?? { ..., versions: [] }` gets no
    // contextual type here, so TS infers `versions: never[]` and the push
    // below fails with TS2345. Annotating `existing` fixes the inference.
    const existing: {
      portalId: string;
      name: string;
      versions: ProjectLoad['packages'][number]['versions'];
    } = byPortal.get(row.portalId) ?? {
      portalId: row.portalId,
      name: row.packageName,
      versions: [],
    };
    existing.versions.push({
      versionId: row.versionId,
      versionNumber: row.versionNumber,
      headline: row.headline,
    });
    byPortal.set(row.portalId, existing);
  }

  const outcome = await composeProjectBrief(
    {
      projectName: rows[0].projectName,
      // Array.from, not [...map.values()] — tsconfig.json sets no "target",
      // so it defaults to ES5 and spreading an iterator is a TS2802.
      packages: Array.from(byPortal.values()),
      coveredThrough,
    },
    provider
  );

  if (!outcome.ok) return outcome;

  await sql`
    INSERT INTO project_summaries
      (id, project_id, headline, sections, covered_through, model)
    VALUES (
      ${uuidv4()}, ${projectId}, ${outcome.brief.headline},
      ${JSON.stringify(outcome.brief.sections)}::jsonb,
      ${outcome.coveredThrough}, ${outcome.model}
    )
    ON CONFLICT (project_id) DO UPDATE SET
      headline = EXCLUDED.headline,
      sections = EXCLUDED.sections,
      covered_through = EXCLUDED.covered_through,
      model = EXCLUDED.model,
      generated_at = NOW()
  `;

  return outcome;
}

export async function readProjectBrief(projectId: string): Promise<{
  brief: ProjectBrief | null;
  coveredThrough: string | null;
  generatedAt: string | null;
  stale: boolean;
}> {
  const rows = await sql`
    SELECT ps.headline, ps.sections,
           ps.covered_through AS "coveredThrough",
           ps.generated_at AS "generatedAt",
           -- Must scope to the same packages summarizeProject's roll-up joins
           -- (AND po.archived_at IS NULL) — otherwise an archived package can
           -- hold the newest generated_at while being excluded from the
           -- roll-up's covered_through, making 'stale' permanently true with
           -- no regeneration able to clear it.
           (SELECT MAX(vs.generated_at)
              FROM version_summaries vs
              JOIN versions v ON v.id = vs.version_id
              JOIN portals po ON po.id = v.portal_id AND po.archived_at IS NULL
             WHERE po.project_id = ${projectId}) AS "newestVersionBrief"
    FROM project_summaries ps
    WHERE ps.project_id = ${projectId}
  `;
  const row = rows[0];
  if (!row) {
    return { brief: null, coveredThrough: null, generatedAt: null, stale: false };
  }

  return {
    brief: { headline: row.headline, sections: row.sections ?? [] },
    coveredThrough: row.coveredThrough,
    generatedAt: row.generatedAt,
    // Stale when any constituent version brief is newer than what this consumed.
    stale: Boolean(
      row.newestVersionBrief && row.newestVersionBrief > row.coveredThrough
    ),
  };
}
