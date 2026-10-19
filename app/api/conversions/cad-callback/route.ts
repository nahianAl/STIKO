import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { cadGlbKey } from '@/lib/storageKeys';
import { verifyCadCallbackToken } from '@/lib/cadWorkerToken';
import { callbackOutcome, parseCallbackBody } from '@/lib/cadConversion';

/**
 * The CAD worker's result for one claim. Public in middleware (lib/routeAccess.ts): the HMAC token,
 * bound to the file and the claim, is the only authentication. Every write is guarded by
 * conversion_job_id = claimId, so a callback for an earlier attempt changes nothing; it still
 * answers 200, so the worker does not retry it.
 */
export async function POST(request: NextRequest) {
  const body = parseCallbackBody(await request.json().catch(() => null));
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const secret = process.env.CAD_WORKER_SECRET;
  if (!secret) {
    console.error('SolidWorks callback received but CAD_WORKER_SECRET is unset');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }
  if (!verifyCadCallbackToken(secret, body.fileId, body.claimId, body.token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = (await sql`
    SELECT storage_key AS "storageKey" FROM files
    WHERE id = ${body.fileId} AND conversion_job_id = ${body.claimId}
  `) as { storageKey: string }[];
  if (!rows[0]) {
    console.warn(`SolidWorks callback for a claim that is no longer current: file ${body.fileId}, ${body.claimId}`);
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (callbackOutcome(body) === 'failed') {
    console.error(`SolidWorks conversion failed for file ${body.fileId}: ${body.reason ?? 'no reason given'}`);
    await sql`
      UPDATE files SET conversion_status = 'failed'
      WHERE id = ${body.fileId} AND conversion_job_id = ${body.claimId}
    `;
    return NextResponse.json({ ok: true });
  }

  await sql`
    UPDATE files SET conversion_status = 'completed', converted_storage_key = ${cadGlbKey(rows[0].storageKey)}
    WHERE id = ${body.fileId} AND conversion_job_id = ${body.claimId}
  `;
  // Every place that assigns converted_storage_key must clear this file's calibrations (see
  // lib/schema.sql, file_calibrations). Its own statement, tolerant of its own failure, for the
  // reason given beside the same DELETE in app/api/conversions/webhook/route.ts.
  try {
    await sql`DELETE FROM file_calibrations WHERE file_id = ${body.fileId}`;
  } catch (calibrationErr) {
    console.error(
      `Failed to delete stale file_calibrations for file ${body.fileId} after SolidWorks conversion:`,
      calibrationErr instanceof Error ? calibrationErr.message : String(calibrationErr)
    );
  }
  return NextResponse.json({ ok: true });
}
