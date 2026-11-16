import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { planLimitResponse, projectLimitRefusal } from '@/lib/planGate';
import { track } from '@/lib/analytics/server';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Owned projects AND ones this user coordinates — 01's two-tier model means
  // a coordinator has the same access as the owner, so filtering on owner_id
  // alone would hide projects they can fully manage.
  const rows = await sql`
    SELECT DISTINCT pr.id, pr.owner_id AS "ownerId", pr.name,
           pr.created_at AS "createdAt"
    FROM projects pr
    LEFT JOIN project_members pm
      ON pm.project_id = pr.id AND pm.user_id = ${session.user.id}
    WHERE pr.deleted_at IS NULL
      AND (pr.owner_id = ${session.user.id} OR pm.user_id IS NOT NULL)
    ORDER BY pr.created_at DESC
  `;
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // The creator is always the owner, so owner and caller are the same person.
  const refusal = await projectLimitRefusal(session.user.id, session.user.id);
  if (refusal) return planLimitResponse(refusal);

  const { name } = await request.json();
  const id = uuidv4();
  const rows = await sql`
    INSERT INTO projects (id, owner_id, name)
    VALUES (${id}, ${session.user.id}, ${name})
    RETURNING id, owner_id AS "ownerId", name, created_at AS "createdAt"
  `;
  await track('project_created', { userId: session.user.id, properties: { project_id: id } });
  return NextResponse.json(rows[0], { status: 201 });
}
