import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await sql`
    SELECT id, owner_id AS "ownerId", name, created_at AS "createdAt"
    FROM projects WHERE owner_id = ${session.user.id}
    ORDER BY created_at DESC
  `;
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name } = await request.json();
  const id = uuidv4();
  const rows = await sql`
    INSERT INTO projects (id, owner_id, name)
    VALUES (${id}, ${session.user.id}, ${name})
    RETURNING id, owner_id AS "ownerId", name, created_at AS "createdAt"
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
