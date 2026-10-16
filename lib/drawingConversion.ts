import { extensionOf } from './fileFormats.ts';

/**
 * DWG and DXF are shown as PDFs: a server-side function converts each drawing once, and the
 * PDF becomes the file's converted_storage_key. These helpers are the rules around that, kept
 * pure so they can be tested and shared by the route, the viewer and the portal page.
 */

const DRAWING_EXTENSIONS: ReadonlySet<string> = new Set(['dwg', 'dxf']);

export function isDrawingFilename(filename: string): boolean {
  return DRAWING_EXTENSIONS.has(extensionOf(filename));
}

export type ViewerKind = 'pdf' | 'drawing' | 'other';

/**
 * 'pdf' for a real PDF and for a drawing whose PDF exists; 'drawing' for a drawing still
 * waiting for one; 'other' for everything else. Decided by the ORIGINAL filename.
 */
export function viewerKindFor(filename: string, convertedStorageKey: string | null): ViewerKind {
  if (extensionOf(filename) === 'pdf') return 'pdf';
  if (isDrawingFilename(filename)) return convertedStorageKey ? 'pdf' : 'drawing';
  return 'other';
}

/**
 * files.conversion_job_id holds the claim while a drawing converts. The column predates this
 * feature (CloudConvert never set it); a drawing claim is 'drawing:<ISO time>'.
 */
export const DRAWING_CLAIM_PREFIX = 'drawing:';

/** A conversion runs at most ~60 s; a claim this old belongs to a run that died. */
export const DRAWING_CLAIM_STALE_MS = 180_000;

export function drawingClaimId(now: Date): string {
  return `${DRAWING_CLAIM_PREFIX}${now.toISOString()}`;
}

export type ConversionStatus = 'pending' | 'processing' | 'completed' | 'failed' | null;

/**
 * Whether a new conversion may start. Never for a finished or failed file: 'failed' is not
 * retried automatically (a new upload gets a new file id). A 'processing' row may be reclaimed
 * once its claim is stale, or when it carries no readable drawing claim at all.
 */
export function mayClaim(status: ConversionStatus, jobId: string | null, now: Date): boolean {
  if (status === null) return true;
  if (status !== 'processing') return false;
  if (!jobId || !jobId.startsWith(DRAWING_CLAIM_PREFIX)) return true;
  const claimedAt = Date.parse(jobId.slice(DRAWING_CLAIM_PREFIX.length));
  if (Number.isNaN(claimedAt)) return true;
  return now.getTime() - claimedAt > DRAWING_CLAIM_STALE_MS;
}

export const DRAWING_POLL_INTERVAL_MS = 2000;
export const DRAWING_POLL_LIMIT_MS = 90_000;

export type PollStep = 'done' | 'failed' | 'wait';

/** What the viewer does after one status check while a drawing converts. */
export function nextPollStep(
  status: ConversionStatus,
  convertedStorageKey: string | null,
  elapsedMs: number
): PollStep {
  if (status === 'completed' && convertedStorageKey) return 'done';
  if (status === 'failed') return 'failed';
  if (elapsedMs >= DRAWING_POLL_LIMIT_MS) return 'failed';
  return 'wait';
}

export type ConverterOutcome = 'completed' | 'failed' | 'retry';

/**
 * What a converter reply means for the file. Only a verdict on the drawing itself ('failed'
 * is never retried) may set 'failed': 413 too large, 422 unreadable or empty. Everything else
 * (400, 401, 404, 500, 502, any other status, no HTTP response at all) is a configuration or
 * transient problem that a later open may well get past, so the claim is released instead.
 * null means no HTTP response: a network error, a timeout, or a throw before the call.
 */
export function converterOutcome(status: number | null): ConverterOutcome {
  if (status === 200) return 'completed';
  if (status === 413 || status === 422) return 'failed';
  return 'retry';
}
