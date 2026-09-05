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

      // The UPDATE below is authoritative and must not be rolled back by anything downstream of
      // it: the GLB has already uploaded to S3 by this point, so failing to record that is
      // strictly worse than any cost the colour cleanup after it could impose. It used to run
      // together with the `part_colors` DELETE in one `sql.transaction`, which was wrong in
      // exactly the way this repo's migrations keep going wrong (stiko-migration-deploy-
      // ordering): migrations here are applied manually and have been forgotten twice, and if
      // 009-part-colors.sql had not yet been run, `part_colors` would not exist, the DELETE
      // would throw, the whole transaction would throw with it, and this UPDATE — despite the
      // GLB already sitting safely in S3 — would roll back too. The catch below would then mark
      // conversion_status = 'failed' for a conversion that had, in every way that matters,
      // succeeded: converted_storage_key would never be written, so every STEP upload would
      // silently regress to the slow client-side loader AND show as failed in the UI.
      await sql`
        UPDATE files
        SET conversion_status = 'completed', converted_storage_key = ${convertedKey}
        WHERE id = ${fileId}
      `;

      // part_colors.part_key is an index path into a specific node hierarchy, stable only
      // because an uploaded file's bytes never change (see the invariant note in
      // lib/migrations/009-part-colors.sql). converted_storage_key just started pointing at
      // CloudConvert's own GLB — a node hierarchy that has nothing to do with whatever tree
      // produced this file's saved colours (e.g. the client-side STEPLoader/stepToGlb tree used
      // while conversion was pending or had previously failed). Any part_colors rows already
      // saved for this file describe positions in a tree that just stopped existing; left in
      // place they would silently reattach to arbitrary parts of the new one.
      //
      // Its own statement, its own try/catch, deliberately NOT sharing a transaction with the
      // UPDATE above (see the comment there for why). The trade-off this makes: if the table is
      // genuinely missing, this fails silently-but-logged rather than failing the conversion —
      // the cost is a bounded, recoverable correctness bug (a handful of stale colour rows that
      // may misattach to the wrong part of the new tree, fixable by re-applying colours or by
      // running the migration and re-converting), never an outage. That is the cheaper failure
      // mode of the two: the OLD, intolerant version turned a missing migration into every STEP
      // conversion failing outright, which is a production incident, not a cosmetic one.
      try {
        await sql`
          DELETE FROM part_colors WHERE file_id = ${fileId}
        `;
      } catch (colorErr) {
        console.error(
          `Failed to delete stale part_colors for file ${fileId} after conversion` +
            ' (likely 009-part-colors.sql has not been applied yet):',
          colorErr instanceof Error ? colorErr.message : String(colorErr)
        );
      }
    } catch (err) {
      console.error('Failed to process conversion result for', fileId, err);
      await sql`
        UPDATE files SET conversion_status = 'failed' WHERE id = ${fileId}
      `;
    }
  }

  return NextResponse.json({ ok: true });
}
