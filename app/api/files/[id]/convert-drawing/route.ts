import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getFileAccess } from '@/lib/access';
import { getUploadPresignedUrl, getViewerPresignedUrl } from '@/lib/s3';
import { drawingPdfKey } from '@/lib/storageKeys';
import {
  converterOutcome,
  drawingClaimId,
  isDrawingFilename,
  mayClaim,
  type ConversionStatus,
} from '@/lib/drawingConversion';

// Waits for the Python converter, which has its own 60 s budget.
export const maxDuration = 60;
const CONVERTER_TIMEOUT_MS = 55_000;
/** Long enough for the converter's download, conversion and upload together. */
const TARGET_URL_TTL_S = 300;

type Row = {
  filename: string;
  storageKey: string;
  conversionStatus: ConversionStatus;
  convertedStorageKey: string | null;
  conversionJobId: string | null;
};

/**
 * Convert one DWG/DXF to PDF, at most once at a time per file.
 *
 * Called fire-and-forget by the uploader right after an upload, and by the viewer when it
 * opens a drawing that has no PDF yet. /api/files is a public middleware prefix, so this
 * checks the session and the caller's access to the file itself.
 *
 * 'failed' is never retried, so it is reserved for a verdict on the drawing itself. After a
 * claim there are three outcomes (see converterOutcome):
 *  - completed: the converter answered 200; the row becomes 'completed' with the PDF's key.
 *  - failed: the converter answered 413 (too large) or 422 (unreadable or empty); the row
 *    becomes 'failed'.
 *  - retry: anything else (400, 401, 404, 500, 502, other statuses, a network error, a timeout,
 *    a presign failure). These are configuration or transient problems, so the claim is
 *    released (status and job id back to NULL) and the route answers 503; a later open retries.
 * With CAD_CONVERTER_SECRET unset the route answers 503 before claiming anything.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const access = await getFileAccess(session.user.id, params.id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = (await sql`
    SELECT filename, storage_key AS "storageKey", conversion_status AS "conversionStatus",
           converted_storage_key AS "convertedStorageKey", conversion_job_id AS "conversionJobId"
    FROM files WHERE id = ${params.id}
  `) as Row[];
  const file = rows[0];
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!isDrawingFilename(file.filename)) {
    return NextResponse.json({ error: 'Not a DWG or DXF file' }, { status: 400 });
  }

  const current = () =>
    NextResponse.json({
      conversionStatus: file.conversionStatus,
      convertedStorageKey: file.convertedStorageKey,
    });
  if (file.convertedStorageKey) return current();

  // Not configured is not the drawing's fault: refuse before claiming so the row stays as it
  // was (a deploy that precedes setting the variable, or a local dev server, fails no files).
  const converterSecret = process.env.CAD_CONVERTER_SECRET;
  if (!converterSecret) {
    console.error('Drawing conversion is not configured: CAD_CONVERTER_SECRET is unset');
    return NextResponse.json(
      { conversionStatus: file.conversionStatus, convertedStorageKey: null },
      { status: 503 }
    );
  }

  const now = new Date();
  if (!mayClaim(file.conversionStatus, file.conversionJobId, now)) return current();

  // Compare-and-set on the values just read: if another request claimed first, no row
  // updates and this one stands down instead of starting a second conversion.
  const claimId = drawingClaimId(now);
  const claimed = await sql`
    UPDATE files
    SET conversion_status = 'processing', conversion_job_id = ${claimId}
    WHERE id = ${params.id}
      AND converted_storage_key IS NULL
      AND conversion_status IS NOT DISTINCT FROM ${file.conversionStatus}
      AND conversion_job_id IS NOT DISTINCT FROM ${file.conversionJobId}
    RETURNING id
  `;
  if (claimed.length === 0) {
    return NextResponse.json({ conversionStatus: 'processing', convertedStorageKey: null });
  }

  const targetKey = drawingPdfKey(file.storageKey);
  // null = no HTTP response (network error, timeout, or a throw before the call completed).
  let converterStatus: number | null = null;
  let reason = '';
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Converter-Secret': converterSecret,
    };
    // Vercel deployment protection blocks a server-to-server call to a protected preview URL
    // unless this bypass secret is sent; it is set automatically when the feature is enabled.
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
      headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    }
    // The target origin comes from request.url deliberately, so a preview calls its own
    // function; on Vercel the Host must match a project domain. lib/appUrl.ts forbids
    // request-derived origins in general (email links); this is the stated exception.
    const res = await fetch(new URL('/api/convert_drawing', request.url), {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(CONVERTER_TIMEOUT_MS),
      body: JSON.stringify({
        sourceUrl: await getViewerPresignedUrl(file.storageKey),
        targetUrl: await getUploadPresignedUrl(targetKey, 'application/pdf', TARGET_URL_TTL_S),
        filename: file.filename,
      }),
    });
    converterStatus = res.status;
    if (res.status !== 200) {
      const body = await res.text().catch(() => '');
      reason = `converter answered ${res.status}: ${body.slice(0, 300)}`;
    }
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }

  const outcome = converterOutcome(converterStatus);

  if (outcome === 'failed') {
    console.error(`Drawing conversion failed for file ${params.id}: ${reason}`);
    await sql`
      UPDATE files SET conversion_status = 'failed'
      WHERE id = ${params.id} AND conversion_job_id = ${claimId}
    `;
    return NextResponse.json({ conversionStatus: 'failed', convertedStorageKey: null });
  }

  if (outcome === 'retry') {
    console.error(`Drawing conversion not completed for file ${params.id}, will retry: ${reason}`);
    await sql`
      UPDATE files SET conversion_status = NULL, conversion_job_id = NULL
      WHERE id = ${params.id} AND conversion_job_id = ${claimId}
    `;
    return NextResponse.json({ conversionStatus: null, convertedStorageKey: null }, { status: 503 });
  }

  await sql`
    UPDATE files SET conversion_status = 'completed', converted_storage_key = ${targetKey}
    WHERE id = ${params.id} AND conversion_job_id = ${claimId}
  `;

  // Every place that assigns converted_storage_key must clear this file's calibrations (see
  // lib/schema.sql, file_calibrations). Its own statement, tolerant of its own failure, for
  // the reason given beside the same DELETE in app/api/conversions/webhook/route.ts.
  try {
    await sql`DELETE FROM file_calibrations WHERE file_id = ${params.id}`;
  } catch (calibrationErr) {
    console.error(
      `Failed to delete stale file_calibrations for file ${params.id} after drawing conversion:`,
      calibrationErr instanceof Error ? calibrationErr.message : String(calibrationErr)
    );
  }

  return NextResponse.json({ conversionStatus: 'completed', convertedStorageKey: targetKey });
}
