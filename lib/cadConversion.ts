import { extensionOf, MODEL_FORMATS } from './fileFormats.ts';

/**
 * SolidWorks parts are shown as GLBs: the CAD worker (cad-worker/, on Modal) converts each one
 * once, and the GLB becomes the file's converted_storage_key. These are the rules around that,
 * kept pure so they can be tested and shared by the routes, the viewer and the portal page.
 * The worker and the claim/callback protocol are in docs/superpowers/specs/2026-10-18-sldprt-conversion-design.md.
 */

export function isSldprtFilename(filename: string): boolean {
  return extensionOf(filename) === 'sldprt';
}

/** A .sldprt with no GLB yet: converting, deferred, failed, or switched off. */
export function isPendingCad(filename: string, convertedStorageKey: string | null): boolean {
  return isSldprtFilename(filename) && !convertedStorageKey;
}

/**
 * Whether the 3D viewer shows this file. A .sldprt only through its GLB, whatever the switch
 * says, so parts converted before a switch-off keep working.
 */
export function opensAsModel(filename: string, convertedStorageKey: string | null): boolean {
  if (isSldprtFilename(filename)) return !!convertedStorageKey;
  return MODEL_FORMATS.includes(extensionOf(filename));
}

/** files.conversion_job_id while a part converts: 'cad:<attempt>:<ISO time>'. */
export const CAD_CLAIM_PREFIX = 'cad:';
/** The worker gives up at 10 minutes; a claim older than this belongs to a job that died. */
export const CAD_CLAIM_STALE_MS = 15 * 60_000;
/** Stale claims are retried, but a file that kills the worker three times is marked failed. */
export const CAD_MAX_ATTEMPTS = 3;

export function cadClaimId(attempt: number, now: Date): string {
  return `${CAD_CLAIM_PREFIX}${attempt}:${now.toISOString()}`;
}

export function parseCadClaim(jobId: string | null): { attempt: number; claimedAt: number } | null {
  const match = /^cad:([1-9]\d*):(.+)$/.exec(jobId ?? '');
  if (!match) return null;
  const claimedAt = Date.parse(match[2]);
  if (Number.isNaN(claimedAt)) return null;
  return { attempt: Number(match[1]), claimedAt };
}

export type ConversionStatus = 'pending' | 'processing' | 'completed' | 'failed' | null;

export type ClaimDecision =
  | { kind: 'claim'; attempt: number }
  | { kind: 'wait' }
  | { kind: 'give-up' }
  | { kind: 'final' };

/** What the start route does with a row: claim it, wait for a live claim, give up, or leave it. */
export function claimDecision(status: ConversionStatus, jobId: string | null, now: Date): ClaimDecision {
  if (status === 'completed' || status === 'failed') return { kind: 'final' };
  if (status !== 'processing') return { kind: 'claim', attempt: 1 };
  const claim = parseCadClaim(jobId);
  if (!claim) return { kind: 'claim', attempt: 1 };
  if (now.getTime() - claim.claimedAt <= CAD_CLAIM_STALE_MS) return { kind: 'wait' };
  if (claim.attempt >= CAD_MAX_ATTEMPTS) return { kind: 'give-up' };
  return { kind: 'claim', attempt: claim.attempt + 1 };
}

/** LIKE pattern for this UTC month's claims. A reclaim overwrites the earlier one, so it can undercount slightly. */
export function capLikePattern(now: Date): string {
  return `${CAD_CLAIM_PREFIX}%:${now.toISOString().slice(0, 7)}-%`;
}

/** The first day of next month (UTC), as YYYY-MM-DD, for "Preview available from …". */
export function firstOfNextMonth(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

export const DEFAULT_MONTHLY_CAP = 300;

/** SLDPRT_MONTHLY_CAP as a whole number of conversions; anything unreadable means the default. */
export function monthlyCap(value: string | undefined): number {
  const trimmed = (value ?? '').trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_MONTHLY_CAP;
  return Number(trimmed);
}

/**
 * The worker's start reply. The start endpoint never reads the file, so no reply is a verdict on
 * it: only a 200 with a call id means a job is running, and everything else is retried.
 */
export function workerStartOutcome(status: number | null, body: unknown): 'started' | 'retry' {
  const callId = (body as { callId?: unknown } | null)?.callId;
  return status === 200 && typeof callId === 'string' && callId.length > 0 ? 'started' : 'retry';
}

export interface CallbackBody {
  fileId: string;
  claimId: string;
  token: string;
  ok: boolean;
  glbBytes?: number;
  reason?: string;
}

export function parseCallbackBody(raw: unknown): CallbackBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  for (const key of ['fileId', 'claimId', 'token'] as const) {
    if (typeof b[key] !== 'string' || (b[key] as string).length === 0) return null;
  }
  if (typeof b.ok !== 'boolean') return null;
  return {
    fileId: b.fileId as string,
    claimId: b.claimId as string,
    token: b.token as string,
    ok: b.ok,
    ...(typeof b.glbBytes === 'number' ? { glbBytes: b.glbBytes } : {}),
    ...(typeof b.reason === 'string' ? { reason: b.reason } : {}),
  };
}

export function callbackOutcome(body: CallbackBody): 'completed' | 'failed' {
  return body.ok && typeof body.glbBytes === 'number' && body.glbBytes > 0 ? 'completed' : 'failed';
}

export const CAD_POLL_INTERVAL_MS = 3000;
export const CAD_POLL_LIMIT_MS = 300_000;

export type CadPollStep = 'done' | 'failed' | 'wait' | 'timeout';

/** What the viewer does after one status check while a part converts. */
export function nextCadPollStep(status: ConversionStatus, convertedStorageKey: string | null, elapsedMs: number): CadPollStep {
  if (status === 'completed' && convertedStorageKey) return 'done';
  if (status === 'failed') return 'failed';
  if (elapsedMs >= CAD_POLL_LIMIT_MS) return 'timeout';
  return 'wait';
}
