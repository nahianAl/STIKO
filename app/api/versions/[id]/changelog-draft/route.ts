import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';
import { buildChangelogPrompt } from '@/lib/ai/prompt';
import { readVersionBrief } from '@/lib/ai/summarize';
import { complete } from '@/lib/ai/provider';

/**
 * Suggested changelog text for a new version, from the previous version's open
 * themes. Returns text and writes nothing — the uploader edits it before it is
 * ever persisted, so this route has no side effects at all.
 */

export const maxDuration = 30;

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await sql`
    SELECT v.portal_id AS "portalId",
           v.version_number AS "versionNumber",
           p.ai_summaries_enabled AS "enabled"
    FROM versions v
    JOIN portals po ON po.id = v.portal_id
    JOIN projects p ON p.id = po.project_id
    WHERE v.id = ${params.id}
  `;
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const access = await getPackageAccess(session.user.id, rows[0].portalId);
  if (!access?.canUpload) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!rows[0].enabled) {
    return NextResponse.json({ error: 'AI summaries are switched off' }, { status: 403 });
  }

  const { brief } = await readVersionBrief(params.id);
  if (!brief || brief.themes.length === 0) {
    return NextResponse.json(
      { error: 'The previous version has no summary to draw from' },
      { status: 409 }
    );
  }

  const { system, user } = buildChangelogPrompt({
    previousVersionNumber: rows[0].versionNumber,
    openThemes: brief.themes.map((t) => ({ title: t.title, body: t.body })),
  });

  const result = await complete({ system, user });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 503 });

  const data = result.data as { changelog?: unknown };
  const text = typeof data?.changelog === 'string' ? data.changelog.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'No draft was produced' }, { status: 503 });
  }

  return NextResponse.json({ changelog: text });
}
