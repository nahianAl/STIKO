import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { createStepToGlbJob } from '@/lib/cloudconvert';
import { getDownloadPresignedUrl } from '@/lib/s3';

export async function POST(request: NextRequest) {
  const { fileId } = await request.json();

  const rows = await sql`
    SELECT id, storage_key, conversion_status
    FROM files WHERE id = ${fileId}
  `;

  if (!rows[0]) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  if (rows[0].conversion_status !== 'failed') {
    return NextResponse.json({ error: 'File is not in failed state' }, { status: 400 });
  }

  try {
    const downloadUrl = await getDownloadPresignedUrl(rows[0].storage_key, 3600);
    const job = await createStepToGlbJob(downloadUrl);

    await sql`
      UPDATE files
      SET conversion_status = 'processing', conversion_job_id = ${job.id}
      WHERE id = ${fileId}
    `;

    return NextResponse.json({ status: 'processing' });
  } catch (err) {
    console.error('Retry failed:', err);
    return NextResponse.json({ error: 'Retry failed' }, { status: 500 });
  }
}
