import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('fileId');

  const rows = await sql`
    SELECT id, file_id AS "fileId", type, data, style, created_at AS "createdAt"
    FROM markups WHERE file_id = ${fileId}
    ORDER BY created_at ASC
  `;
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const { fileId, type, data, style } = await request.json();
  const id = uuidv4();

  const rows = await sql`
    INSERT INTO markups (id, file_id, type, data, style)
    VALUES (${id}, ${fileId}, ${type}, ${JSON.stringify(data)}, ${JSON.stringify(style)})
    RETURNING id, file_id AS "fileId", type, data, style, created_at AS "createdAt"
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
