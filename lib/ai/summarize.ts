import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { complete } from './provider';
import { composeVersionBrief } from './compose';
import { versionFacts, versionCoverage, versionComments, priorThemes } from './facts';
import type { Provider, VersionBrief } from './types';
// `export ... from` does not bind locally, so ComposeOutcome is imported too —
// summarizeVersion's return type needs it in scope.
import type { ComposeOutcome } from './compose';

/**
 * The database half of summarisation.
 *
 * `composeVersionBrief` is re-exported so production code has one import
 * surface — but tests must import it from './compose' directly, because this
 * module's `@/lib/db` import throws when DATABASE_URL is unset.
 */
export { composeVersionBrief } from './compose';
export type { VersionLoad, ComposeOutcome } from './compose';

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
