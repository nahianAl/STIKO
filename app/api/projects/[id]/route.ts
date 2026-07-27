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
           created_at AS "createdAt"
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
