import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { isProjectMember } from '@/lib/access';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Previously returned any project's name to anyone. Guests are deliberately
  // excluded too: 01 says a package guest cannot see the project, only the
  // package they were invited to.
  if (!(await isProjectMember(session.user.id, params.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const rows = await sql`
    SELECT id, owner_id AS "ownerId", name, description,
           created_at AS "createdAt", ai_summaries_enabled AS "aiSummariesEnabled"
    FROM projects WHERE id = ${params.id}
  `;
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await sql`
    DELETE FROM projects WHERE id = ${params.id} AND owner_id = ${session.user.id}
    RETURNING id
  `;
  if (!result[0]) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}

/**
 * Switch AI summaries on or off for this project.
 *
 * Switching off DELETES the stored summaries rather than hiding them. If an
 * owner turns this off for a client, the honest reading is that the summaries
 * go away — not that they sit in the database awaiting a re-enable.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const owns = await sql`
    SELECT 1 FROM projects WHERE id = ${params.id} AND owner_id = ${session.user.id}
  `;
  if (owns.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  if (typeof body.aiSummariesEnabled !== 'boolean') {
    return NextResponse.json({ error: 'aiSummariesEnabled required' }, { status: 400 });
  }

  await sql`
    UPDATE projects SET ai_summaries_enabled = ${body.aiSummariesEnabled}
    WHERE id = ${params.id}
  `;

  if (!body.aiSummariesEnabled) {
    await sql`DELETE FROM project_summaries WHERE project_id = ${params.id}`;
    await sql`
      DELETE FROM version_summaries
      WHERE version_id IN (
        SELECT v.id FROM versions v
        JOIN portals po ON po.id = v.portal_id
        WHERE po.project_id = ${params.id}
      )
    `;
  }

  return NextResponse.json({ aiSummariesEnabled: body.aiSummariesEnabled });
}
