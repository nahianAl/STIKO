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
 * files.conversion_job_id holds the claim while a drawing converts; a drawing claim is
 * 'drawing:<ISO time>'. The column predates this feature: CloudConvert's STEP->GLB jobs set it
 * to their job id (55c6d3a), and app/api/conversions/webhook still looks files up by it. That
 * trigger is gone (c225360), but older STEP rows may still hold a CloudConvert id. Those are
 * never drawings, and a CloudConvert id never starts with 'drawing:', so the two cannot collide.
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
 * What a converter reply means for the file.
 *
 * 'completed' needs a 200 whose JSON body reports at least one page: a 200 from anything that
 * is not the converter (a login page, a misconfigured URL) must never mark a PDF as ready.
 * Only a verdict on the drawing itself ('failed' is never retried) may set 'failed': 413 too
 * large, 422 unreadable, empty, too slow or too big to convert. Everything else (a 200 without
 * pages, a redirect, 400, 401, 404, 500, 502, any other status, no HTTP response at all) is a
 * configuration or transient problem that a later open may well get past.
 *
 * status null means no HTTP response: a network error, a timeout, or a throw before the call.
 * pages is the `pages` field of the reply's JSON body, or undefined when there is none.
 */
export function converterOutcome(status: number | null, pages: unknown): ConverterOutcome {
  if (status === 200) return typeof pages === 'number' && pages > 0 ? 'completed' : 'retry';
  if (status === 413 || status === 422) return 'failed';
  return 'retry';
}

/**
 * CAD_CONVERTER_URL as a URL, or null when it is unusable. The converter is its own Vercel
 * project and every call carries the converter secret, so the URL must be https; plain http is
 * allowed only for a converter on this machine (localhost or 127.0.0.1).
 */
export function converterEndpoint(value: string | undefined): URL | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
    return url;
  }
  return null;
}
