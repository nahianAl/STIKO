import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

// Step 2: After the client has uploaded to S3, register the file in the DB
export async function POST(request: NextRequest) {
  const { fileId, versionId, filename, storageKey, fileSize, fileType } = await request.json();

  const rows = await sql`
    INSERT INTO files (id, version_id, filename, storage_key, file_size, file_type)
    VALUES (${fileId}, ${versionId}, ${filename}, ${storageKey}, ${fileSize}, ${fileType})
    RETURNING id, version_id AS "versionId", filename, storage_key AS "storageKey",
              file_size AS "fileSize", file_type AS "fileType", created_at AS "createdAt"
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
