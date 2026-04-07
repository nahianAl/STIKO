import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const versionId = searchParams.get('versionId');

  const rows = await sql`
    SELECT id, version_id AS "versionId", filename, storage_key AS "storageKey",
           file_size AS "fileSize", file_type AS "fileType",
           conversion_status AS "conversionStatus",
           converted_storage_key AS "convertedStorageKey",
           conversion_job_id AS "conversionJobId",
           folder_path AS "folderPath",
           created_at AS "createdAt"
    FROM files WHERE version_id = ${versionId}
    ORDER BY folder_path ASC NULLS FIRST, created_at ASC
  `;
  return NextResponse.json(rows);
}
