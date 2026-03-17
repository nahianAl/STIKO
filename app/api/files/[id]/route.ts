import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const rows = await sql`
    SELECT id, version_id AS "versionId", filename, storage_key AS "storageKey",
           file_size AS "fileSize", file_type AS "fileType", created_at AS "createdAt"
    FROM files WHERE id = ${params.id}
  `;
  if (!rows[0]) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}
