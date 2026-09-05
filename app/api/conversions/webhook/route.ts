import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyWebhookSignature, CloudConvertTask } from '@/lib/cloudconvert';
import { uploadFromUrl } from '@/lib/s3';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('CloudConvert-Signature');

  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const { event, job } = payload;
  const jobId = job.id;

  const fileRows = await sql`
    SELECT id, storage_key FROM files WHERE conversion_job_id = ${jobId}
  `;

  if (!fileRows[0]) {
    console.warn('Webhook received for unknown job:', jobId);
    return NextResponse.json({ ok: true });
  }

  const fileId = fileRows[0].id;
  const originalStorageKey = fileRows[0].storage_key;

  if (event === 'job.failed') {
    await sql`
      UPDATE files SET conversion_status = 'failed' WHERE id = ${fileId}
    `;
    return NextResponse.json({ ok: true });
  }

  if (event === 'job.finished') {
    try {
      const exportTask = job.tasks.find(
        (t: CloudConvertTask) => t.operation === 'export/url' && t.status === 'finished'
      );
      const outputFile = exportTask?.result?.files?.[0];

      if (!outputFile?.url) {
        throw new Error('No output file URL in CloudConvert response');
      }

      const basePath = originalStorageKey.substring(0, originalStorageKey.lastIndexOf('/'));
      const convertedKey = `${basePath}/converted/${fileId}.glb`;

      await uploadFromUrl(outputFile.url, convertedKey, 'model/gltf-binary');

      // part_colors.part_key is an index path into a specific node hierarchy, stable only
      // because an uploaded file's bytes never change (see the invariant note in
      // lib/migrations/009-part-colors.sql). converted_storage_key is about to start
      // pointing at CloudConvert's own GLB — a node hierarchy that has nothing to do with
      // whatever tree produced this file's saved colours (e.g. the client-side
      // STEPLoader/stepToGlb tree used while conversion was pending or had previously
      // failed). Any part_colors rows already saved for this file describe positions in a
      // tree that is about to stop existing; left in place they would silently reattach to
      // arbitrary parts of the new one. Dropped in the same transaction as the key change,
      // so no reader ever observes the new key with the old file's colours still attached.
      await sql.transaction([
        sql`
          UPDATE files
          SET conversion_status = 'completed', converted_storage_key = ${convertedKey}
          WHERE id = ${fileId}
        `,
        sql`
          DELETE FROM part_colors WHERE file_id = ${fileId}
        `,
      ]);
    } catch (err) {
      console.error('Failed to process conversion result for', fileId, err);
      await sql`
        UPDATE files SET conversion_status = 'failed' WHERE id = ${fileId}
      `;
    }
  }

  return NextResponse.json({ ok: true });
}
