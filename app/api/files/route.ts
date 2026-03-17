import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const versionId = searchParams.get('versionId');

  const rows = await sql`
    SELECT id, version_id AS "versionId", filename, storage_key AS "storageKey",
           file_size AS "fileSize", file_type AS "fileType", created_at AS "createdAt"
    FROM files WHERE version_id = ${versionId}
    ORDER BY created_at ASC
  `;
  return NextResponse.json(rows);
}
