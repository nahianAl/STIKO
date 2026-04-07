import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { STEP_EXTENSIONS } from '@/lib/types';
import { createStepToGlbJob } from '@/lib/cloudconvert';
import { getDownloadPresignedUrl } from '@/lib/s3';

// Step 2: After the client has uploaded to S3, register the file in the DB
export async function POST(request: NextRequest) {
  const { fileId, versionId, filename, storageKey, fileSize, fileType, folderPath } = await request.json();

  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
  const needsConversion = STEP_EXTENSIONS.includes(ext);

  const rows = await sql`
    INSERT INTO files (id, version_id, filename, storage_key, file_size, file_type, conversion_status, folder_path)
    VALUES (${fileId}, ${versionId}, ${filename}, ${storageKey}, ${fileSize}, ${fileType},
            ${needsConversion ? 'pending' : null}, ${folderPath || null})
    RETURNING id, version_id AS "versionId", filename, storage_key AS "storageKey",
              file_size AS "fileSize", file_type AS "fileType",
              conversion_status AS "conversionStatus",
              converted_storage_key AS "convertedStorageKey",
              folder_path AS "folderPath",
              created_at AS "createdAt"
  `;

  if (needsConversion) {
    try {
      const downloadUrl = await getDownloadPresignedUrl(storageKey, 3600);
      const job = await createStepToGlbJob(downloadUrl);

      await sql`
        UPDATE files
        SET conversion_status = 'processing', conversion_job_id = ${job.id}
        WHERE id = ${fileId}
      `;

      rows[0].conversionStatus = 'processing';
    } catch (err) {
      console.error('Failed to start conversion for', fileId, err);
      await sql`
        UPDATE files SET conversion_status = 'failed' WHERE id = ${fileId}
      `;
      rows[0].conversionStatus = 'failed';
    }
  }

  return NextResponse.json(rows[0], { status: 201 });
}
