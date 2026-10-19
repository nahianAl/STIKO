import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getFileAccess } from '@/lib/access';
import { getDownloadPresignedUrl, getUploadPresignedUrl } from '@/lib/s3';
import { cadGlbKey } from '@/lib/storageKeys';
import { converterEndpoint } from '@/lib/drawingConversion';
import { appBaseUrlOrNull } from '@/lib/appUrl';
import { sldprtConversionEnabled } from '@/lib/fileFormats';
import { cadCallbackToken } from '@/lib/cadWorkerToken';
import {
  cadClaimId,
  capLikePattern,
  claimDecision,
  firstOfNextMonth,
  isSldprtFilename,
  monthlyCap,
  workerStartOutcome,
  type ConversionStatus,
} from '@/lib/cadConversion';

export const maxDuration = 30;
/** The start endpoint only spawns a job; it answers in well under a second once warm. */
const WORKER_TIMEOUT_MS = 15_000;
/** Covers a queued job plus the worker's 10-minute limit. */
const URL_TTL_S = 3600;

type Row = {
  filename: string;
  storageKey: string;
  conversionStatus: ConversionStatus;
  convertedStorageKey: string | null;
  conversionJobId: string | null;
};

/**
 * Start converting one SolidWorks part to GLB, at most once at a time per file.
 *
 * Called fire-and-forget by the uploader after an upload, and by CadPreparer whenever a .sldprt
 * with no GLB is opened. /api/files is a public middleware prefix, so this checks the session and
 * the caller's access itself. The worker (cad-worker/ on Modal) gets presigned URLs and a callback
 * token, never credentials, and reports to /api/conversions/cad-callback, which finishes the row.
 *
 * Nothing here marks a file 'failed' except giving up after CAD_MAX_ATTEMPTS stale claims: the
 * start endpoint never reads the file, so its replies are never a verdict on it.
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getFileAccess(session.user.id, params.id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = (await sql`
    SELECT filename, storage_key AS "storageKey", conversion_status AS "conversionStatus",
           converted_storage_key AS "convertedStorageKey", conversion_job_id AS "conversionJobId"
    FROM files WHERE id = ${params.id}
  `) as Row[];
  const file = rows[0];
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!isSldprtFilename(file.filename)) {
    return NextResponse.json({ error: 'Not a SolidWorks part' }, { status: 400 });
  }

  const current = () =>
    NextResponse.json({ conversionStatus: file.conversionStatus, convertedStorageKey: file.convertedStorageKey });
  if (file.convertedStorageKey) return current();

  if (!sldprtConversionEnabled()) {
    return NextResponse.json(
      { conversionStatus: file.conversionStatus, convertedStorageKey: null, reason: 'disabled' },
      { status: 503 }
    );
  }

  // Not configured is not the part's fault: refuse before claiming, so the row stays as it was.
  const secret = process.env.CAD_WORKER_SECRET;
  const workerUrl = converterEndpoint(process.env.CAD_WORKER_URL);
  const base = appBaseUrlOrNull();
  if (!secret || !workerUrl || !base) {
    const problems = [
      !secret && 'CAD_WORKER_SECRET is unset',
      !workerUrl && 'CAD_WORKER_URL is unset or not https',
      !base && 'NEXTAUTH_URL / APP_URL is unset',
    ].filter(Boolean);
    console.error(`SolidWorks conversion is not configured: ${problems.join('; ')}`);
    return NextResponse.json(
      { conversionStatus: file.conversionStatus, convertedStorageKey: null, reason: 'not-configured' },
      { status: 503 }
    );
  }

  const now = new Date();
  const decision = claimDecision(file.conversionStatus, file.conversionJobId, now);
  if (decision.kind === 'final') return current();
  if (decision.kind === 'wait') {
    return NextResponse.json({ conversionStatus: 'processing', convertedStorageKey: null });
  }
  if (decision.kind === 'give-up') {
    console.error(`SolidWorks conversion gave up on file ${params.id} after repeated stale claims`);
    await sql`
      UPDATE files SET conversion_status = 'failed'
      WHERE id = ${params.id} AND conversion_job_id IS NOT DISTINCT FROM ${file.conversionJobId}
    `;
    return NextResponse.json({ conversionStatus: 'failed', convertedStorageKey: null });
  }

  const counted = (await sql`
    SELECT count(*)::int AS n FROM files WHERE conversion_job_id LIKE ${capLikePattern(now)}
  `) as { n: number }[];
  if ((counted[0]?.n ?? 0) >= monthlyCap(process.env.SLDPRT_MONTHLY_CAP)) {
    return NextResponse.json({
      conversionStatus: file.conversionStatus,
      convertedStorageKey: null,
      deferredUntil: firstOfNextMonth(now),
    });
  }

  // Compare-and-set on the values just read: if another request claimed first, no row updates
  // and this one stands down instead of starting a second conversion.
  const claimId = cadClaimId(decision.attempt, now);
  const claimed = await sql`
    UPDATE files SET conversion_status = 'processing', conversion_job_id = ${claimId}
    WHERE id = ${params.id}
      AND converted_storage_key IS NULL
      AND conversion_status IS NOT DISTINCT FROM ${file.conversionStatus}
      AND conversion_job_id IS NOT DISTINCT FROM ${file.conversionJobId}
    RETURNING id
  `;
  if (claimed.length === 0) {
    return NextResponse.json({ conversionStatus: 'processing', convertedStorageKey: null });
  }

  let status: number | null = null;
  let body: unknown = null;
  let reason = '';
  try {
    // redirect 'manual': a redirect would carry the secret elsewhere; it counts as a retry.
    const res = await fetch(workerUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': secret },
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      body: JSON.stringify({
        sourceUrl: await getDownloadPresignedUrl(file.storageKey, URL_TTL_S),
        targetUrl: await getUploadPresignedUrl(cadGlbKey(file.storageKey), 'model/gltf-binary', URL_TTL_S),
        callbackUrl: `${base}/api/conversions/cad-callback`,
        filename: file.filename,
        fileId: params.id,
        claimId,
        token: cadCallbackToken(secret, params.id, claimId),
      }),
    });
    status = res.status;
    const text = await res.text().catch(() => '');
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    reason = `worker answered ${res.status}: ${text.slice(0, 300)}`;
  } catch (err) {
    reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  if (workerStartOutcome(status, body) === 'started') {
    return NextResponse.json({ conversionStatus: 'processing', convertedStorageKey: null });
  }

  console.error(`SolidWorks conversion not started for file ${params.id}, will retry: ${reason}`);
  await sql`
    UPDATE files SET conversion_status = NULL, conversion_job_id = NULL
    WHERE id = ${params.id} AND conversion_job_id = ${claimId}
  `;
  return NextResponse.json(
    { conversionStatus: null, convertedStorageKey: null, reason: 'retry' },
    { status: 503 }
  );
}
