import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('fileId');
  const pageNumber = searchParams.get('pageNumber');

  if (pageNumber !== null) {
    const rows = await sql`
      SELECT id, file_id AS "fileId", type, data, style,
             page_number AS "pageNumber", created_at AS "createdAt"
      FROM markups WHERE file_id = ${fileId} AND page_number = ${parseInt(pageNumber)}
      ORDER BY created_at ASC
    `;
    return NextResponse.json(rows);
  }

  const rows = await sql`
    SELECT id, file_id AS "fileId", type, data, style,
           page_number AS "pageNumber", created_at AS "createdAt"
    FROM markups WHERE file_id = ${fileId}
    ORDER BY created_at ASC
  `;
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const { fileId, type, data, style, pageNumber } = await request.json();
  const id = uuidv4();

  const rows = await sql`
    INSERT INTO markups (id, file_id, type, data, style, page_number)
    VALUES (${id}, ${fileId}, ${type}, ${JSON.stringify(data)}, ${JSON.stringify(style)}, ${pageNumber ?? null})
    RETURNING id, file_id AS "fileId", type, data, style,
              page_number AS "pageNumber", created_at AS "createdAt"
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
