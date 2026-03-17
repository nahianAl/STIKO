import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');

  if (projectId) {
    const rows = await sql`
      SELECT id, project_id AS "projectId", name, created_at AS "createdAt"
      FROM portals WHERE project_id = ${projectId}
      ORDER BY created_at DESC
    `;
    return NextResponse.json(rows);
  }

  const rows = await sql`
    SELECT id, project_id AS "projectId", name, created_at AS "createdAt"
    FROM portals ORDER BY created_at DESC
  `;
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, projectId } = await request.json();
  const id = uuidv4();
  const rows = await sql`
    INSERT INTO portals (id, project_id, name)
    VALUES (${id}, ${projectId}, ${name})
    RETURNING id, project_id AS "projectId", name, created_at AS "createdAt"
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
