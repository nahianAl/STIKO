import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { isProjectMember } from '@/lib/access';
import { summarizeProject, readProjectBrief } from '@/lib/ai/summarize';
import { isConfigured } from '@/lib/ai/provider';

/** Project roll-up. Members only — a package guest cannot see the project. */

export const maxDuration = 30;

async function gate(projectId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!(await isProjectMember(session.user.id, projectId))) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }

  const rows = await sql`
    SELECT ai_summaries_enabled AS "enabled" FROM projects WHERE id = ${projectId}
  `;
  return { enabled: Boolean(rows[0]?.enabled) };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const gated = await gate(params.id);
  if (gated.error) return gated.error;

  if (!gated.enabled) {
    return NextResponse.json({ enabled: false, configured: isConfigured(), brief: null });
  }

  const read = await readProjectBrief(params.id);
  return NextResponse.json({ enabled: true, configured: isConfigured(), ...read });
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

  const outcome = await summarizeProject(params.id);
  if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 503 });

  const read = await readProjectBrief(params.id);
  return NextResponse.json({ enabled: true, configured: isConfigured(), ...read });
}
