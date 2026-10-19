import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getFileAccess } from '@/lib/access';
import { getUploadPresignedUrl, getViewerPresignedUrl } from '@/lib/s3';
import { drawingPdfKey } from '@/lib/storageKeys';
import {
  converterEndpoint,
  converterOutcome,
  drawingClaimId,
  isDrawingFilename,
  mayClaim,
  type ConversionStatus,
} from '@/lib/drawingConversion';

// Waits for the Python converter (its own Vercel project), which has its own 60 s budget.
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
 * The converter is a separate Vercel project (converter/ in this repo), so that the function
 * parsing untrusted drawings never sees this project's env vars. It is called at
 * CAD_CONVERTER_URL with CAD_CONVERTER_SECRET; with either unset, or the URL not https (http
 * only on localhost), the route answers 503 before claiming anything.
 *
 * 'failed' is never retried, so it is reserved for a verdict on the drawing itself. After a
 * claim there are three outcomes (see converterOutcome):
 *  - completed: the converter answered 200 with {pages: n > 0}; the row becomes 'completed'
 *    with the PDF's key.
 *  - failed: the converter answered 413 (too large) or 422 (unreadable, empty, or too slow or
 *    too big to convert); the row becomes 'failed'.
 *  - retry: anything else (a 200 without pages, a redirect, 400, 401, 404, 500, 502, other
 *    statuses, a network error, a presign failure). These are configuration or transient
 *    problems, so the claim is released (status and job id back to NULL) and the route answers
 *    503; a later open retries.
 * The one exception is our own timeout: when the converter has not answered in
 * CONVERTER_TIMEOUT_MS the claim is KEPT ('processing'), so retries wait for it to go stale
 * (DRAWING_CLAIM_STALE_MS, 3 minutes) instead of starting another minute-long conversion on
 * every open. The route still answers 503.
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
  // was (a deploy that precedes setting the variables, or a local dev server, fails no files).
  const converterSecret = process.env.CAD_CONVERTER_SECRET;
  const converterUrl = converterEndpoint(process.env.CAD_CONVERTER_URL);
  if (!converterSecret || !converterUrl) {
    const problems = [
      !converterSecret && 'CAD_CONVERTER_SECRET is unset',
      !converterUrl &&
        (process.env.CAD_CONVERTER_URL
          ? 'CAD_CONVERTER_URL is not an https URL (http only on localhost)'
          : 'CAD_CONVERTER_URL is unset'),
    ].filter(Boolean);
    console.error(`Drawing conversion is not configured: ${problems.join('; ')}`);
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
  let pages: unknown;
  let timedOut = false;
  let reason = '';
  try {
    // The converter project's production deployment is public and refuses any request without
    // the secret. redirect 'manual': a redirect is never followed (it would carry the secret
    // elsewhere) and counts as a retry.
    const res = await fetch(converterUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'X-Converter-Secret': converterSecret },
      signal: AbortSignal.timeout(CONVERTER_TIMEOUT_MS),
      body: JSON.stringify({
        sourceUrl: await getViewerPresignedUrl(file.storageKey),
        targetUrl: await getUploadPresignedUrl(targetKey, 'application/pdf', TARGET_URL_TTL_S),
        filename: file.filename,
      }),
    });
    converterStatus = res.status;
    const body = await res.text().catch(() => '');
    if (res.status === 200) {
      try {
        pages = (JSON.parse(body) as { pages?: unknown } | null)?.pages;
      } catch {
        pages = undefined;
      }
      reason = `converter answered 200 without a page count: ${body.slice(0, 300)}`;
    } else {
      reason = `converter answered ${res.status}: ${body.slice(0, 300)}`;
    }
  } catch (err) {
    // AbortSignal.timeout rejects with a 'TimeoutError' DOMException ('AbortError' on some
    // runtimes). Anything else (a presign throw, a refused connection) failed instantly.
    timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  const outcome = converterOutcome(converterStatus, pages);

  if (outcome === 'failed') {
    console.error(`Drawing conversion failed for file ${params.id}: ${reason}`);
    await sql`
      UPDATE files SET conversion_status = 'failed'
      WHERE id = ${params.id} AND conversion_job_id = ${claimId}
    `;
    return NextResponse.json({ conversionStatus: 'failed', convertedStorageKey: null });
  }

  if (outcome === 'retry' && timedOut) {
    // The converter may still be working, and a drawing that takes this long will likely take
    // it again: keep the claim so the next attempt waits for it to go stale.
    console.error(
      `Drawing conversion timed out for file ${params.id} after ${CONVERTER_TIMEOUT_MS} ms; ` +
        `claim kept until stale: ${reason}`
    );
    return NextResponse.json(
      { conversionStatus: 'processing', convertedStorageKey: null },
      { status: 503 }
    );
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
