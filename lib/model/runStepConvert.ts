/**
 * Browser-side front door to STEP tessellation, modelled on runOptimize.ts. Every failure
 * path resolves `null`, which callers read as "use the original file" — conversion is an
 * improvement, never a gate.
 */

/**
 * Structural worker type rather than the DOM `Worker`. The timeout behaviour below is the
 * regression test for a bug that froze tabs indefinitely, and it can only be asserted
 * against a stub.
 */
export interface ConvertWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

/** Measured 19.7s on the 13.7 MB reference file; ~6x headroom. Matches runOptimize. */
export const STEP_CONVERT_TIMEOUT_MS = 120_000;

/**
 * Deliberately tighter than the upload budget. A reviewer waiting on a file needs an answer
 * sooner than an uploader does, and a file that cannot make 60s here is one that should
 * have been converted at upload.
 */
export const STEP_VIEWER_TIMEOUT_MS = 60_000;

function defaultWorker(): ConvertWorker {
  // new URL(..., import.meta.url) is how webpack 5 — and therefore Next 14 — discovers and
  // bundles a worker as a separate chunk.
  return new Worker(new URL('./stepWorker.ts', import.meta.url)) as unknown as ConvertWorker;
}

export function runStepConvert(
  bytes: ArrayBuffer,
  options: { createWorker?: () => ConvertWorker; timeoutMs?: number } = {}
): Promise<ArrayBuffer | null> {
  const timeoutMs = options.timeoutMs ?? STEP_CONVERT_TIMEOUT_MS;

  return new Promise((resolve) => {
    let worker: ConvertWorker;
    try {
      worker = (options.createWorker ?? defaultWorker)();
    } catch (error) {
      console.warn('STEP conversion unavailable; using the original file.', error);
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (result: ArrayBuffer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };

    // Terminating is the whole point: a synchronous WASM call cannot be interrupted any
    // other way, and letting it run is what froze the tab before this existed.
    const timer = setTimeout(() => {
      console.warn(`STEP conversion exceeded ${timeoutMs}ms; using the original file.`);
      finish(null);
    }, timeoutMs);

    worker.onmessage = (event) => {
      const data = event.data as
        | { ok: true; buffer: ArrayBuffer }
        | { ok: false; error: string };
      if (!data.ok) {
        console.warn('STEP conversion failed; using the original file.', data.error);
        finish(null);
        return;
      }
      finish(data.buffer);
    };

    // Fires when the worker dies outright, which is the out-of-memory case.
    worker.onerror = (event) => {
      console.warn('STEP conversion worker crashed; using the original file.', event.message);
      finish(null);
    };

    try {
      worker.postMessage(bytes, [bytes]);
    } catch (error) {
      console.warn('STEP conversion could not be started.', error);
      finish(null);
    }
  });
}
