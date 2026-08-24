import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';
import { versionFacts, versionCoverage, versionCommentFiles, isStale } from '@/lib/ai/facts';
import { summarizeVersion, readVersionBrief } from '@/lib/ai/summarize';
import { isConfigured } from '@/lib/ai/provider';

/**
 * The AI brief for one version.
 *
 * GET never calls the model — it returns the cached row plus the computed facts
 * and how many comments have landed since the brief was built. POST generates.
 *
 * Anyone who can read the brief may refresh it: the people best placed to
 * notice staleness are the ones reading it. Spend is bounded by the design
 * rather than by permissions — a POST on a fresh brief returns the cache
 * without calling the model.
 */

export const maxDuration = 30;

async function gate(versionId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const rows = await sql`
    SELECT v.portal_id AS "portalId",
           p.id AS "projectId",
           p.ai_summaries_enabled AS "enabled"
    FROM versions v
    JOIN portals po ON po.id = v.portal_id
    JOIN projects p ON p.id = po.project_id
    WHERE v.id = ${versionId}
  `;
  if (!rows[0]) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }

  // Keyed on a user id, so anonymous link viewers have no access here at all.
  const access = await getPackageAccess(session.user.id, rows[0].portalId);
  if (!access) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { enabled: Boolean(rows[0].enabled) };
}

async function payload(versionId: string, enabled: boolean) {
  const facts = await versionFacts(versionId);

  if (!enabled) {
    return {
      enabled: false,
      configured: isConfigured(),
      facts,
      brief: null,
      commentFiles: {},
      generatedAt: null,
      newSinceBrief: 0,
    };
  }

  const [{ brief, coveredCount, generatedAt }, coverage] = await Promise.all([
    readVersionBrief(versionId),
    versionCoverage(versionId),
  ]);

  // Citation chips need to know which file each cited comment lives on, so a
  // click can switch the panel to it before jumping to the comment — but
  // there is nothing to resolve when there is no brief to cite from.
  const commentFiles = brief ? await versionCommentFiles(versionId) : {};

  return {
    enabled: true,
    configured: isConfigured(),
    facts,
    brief,
    commentFiles,
    generatedAt,
    newSinceBrief: isStale(coveredCount, coverage.count)
      ? coverage.count - (coveredCount ?? 0)
      : 0,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const gated = await gate(params.id);
  if (gated.error) return gated.error;

  return NextResponse.json(await payload(params.id, gated.enabled!));
}

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const gated = await gate(params.id);
  if (gated.error) return gated.error;

  if (!gated.enabled) {
    return NextResponse.json(
      { error: 'AI summaries are switched off for this project' },
      { status: 403 }
    );
  }

  // A refresh of an already-current brief must not spend anything.
  const [{ coveredCount }, coverage] = await Promise.all([
    readVersionBrief(params.id),
    versionCoverage(params.id),
  ]);
  if (coveredCount !== null && !isStale(coveredCount, coverage.count)) {
    return NextResponse.json(await payload(params.id, true));
  }

  const outcome = await summarizeVersion(params.id);
  if (!outcome.ok) {
    // 503, and the client keeps whatever brief it already had on screen.
    return NextResponse.json({ error: outcome.reason }, { status: 503 });
  }

  return NextResponse.json(await payload(params.id, true));
}
