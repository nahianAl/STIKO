import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const portalId = searchParams.get('portalId');

  const rows = await sql`
    SELECT id, portal_id AS "portalId", version_number AS "versionNumber", created_at AS "createdAt"
    FROM versions WHERE portal_id = ${portalId}
    ORDER BY version_number DESC
  `;
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const { portalId } = await request.json();

  const existing = await sql`
    SELECT COALESCE(MAX(version_number), 0) AS max FROM versions WHERE portal_id = ${portalId}
  `;
  const nextVersion = (existing[0].max as number) + 1;
  const id = uuidv4();

  const rows = await sql`
    INSERT INTO versions (id, portal_id, version_number)
    VALUES (${id}, ${portalId}, ${nextVersion})
    RETURNING id, portal_id AS "portalId", version_number AS "versionNumber", created_at AS "createdAt"
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
