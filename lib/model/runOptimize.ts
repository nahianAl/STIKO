import type { OptimizeResult } from './optimizeGlb';
import {
  isOptimizableFilename,
  isTessellatableFilename,
  producesViewerVariant,
} from '../storageKeys.ts';
import { runStepConvert } from './runStepConvert.ts';

/**
 * Browser-side front door to the optimizer. Every failure path resolves `null`, which the
 * caller reads as "upload the original" — optimization is an improvement, never a gate.
 */

/**
 * Measured peak memory ran ~24x the input size, so this projects to roughly 2.4 GB — near
 * the ceiling of what a browser tab will hand a worker before the allocation simply fails.
 * Above this the file uploads unoptimized rather than risking a long doomed attempt.
 */
export const MAX_OPTIMIZE_BYTES = 100 * 1024 * 1024;

/** Generous next to the ~6s the 22 MB reference file takes, tight enough to not strand an upload. */
const TIMEOUT_MS = 120_000;

/**
 * Retained deliberately as the GLB-only public API, even though `shouldPrepareVariant` below
 * is the only predicate the app actually calls now (it covers STEP too). Nothing in this
 * codebase references `shouldOptimize` anymore — don't take that as license to edit it
 * expecting an observable effect, and don't read its absence of callers as dead code to prune.
 */
export function shouldOptimize(filename: string, bytes: number): boolean {
  return isOptimizableFilename(filename) && bytes <= MAX_OPTIMIZE_BYTES;
}

/**
 * A cap on absurd inputs only. Unlike MAX_OPTIMIZE_BYTES this is NOT a memory projection:
 * OCCT peaked near 60 MB on a 13.7 MB file. Tessellation cost tracks surface complexity,
 * not byte count, so the timeout in runStepConvert is the real guard.
 */
export const MAX_STEP_BYTES = 50 * 1024 * 1024;

export interface VariantResult {
  buffer: ArrayBuffer;
  /** One line for the console. Its shape differs per source format. */
  summary: string;
}

export function shouldPrepareVariant(filename: string, bytes: number): boolean {
  if (!producesViewerVariant(filename)) return false;
  if (isTessellatableFilename(filename)) return bytes <= MAX_STEP_BYTES;
  return bytes <= MAX_OPTIMIZE_BYTES;
}

/**
 * useUpload.ts runs a 4-wide upload pool (CONCURRENCY in lib/useUpload.ts), so up to four
 * callers can reach runOptimize at the same time. MAX_OPTIMIZE_BYTES above is sized for a
 * SINGLE optimization's ~24x peak memory (~2.4 GB); four of those running concurrently near
 * the limit projects to ~9.6 GB, which a browser tab does not have to give.
 *
 * This module-level promise is a single-slot queue: each call chains onto it, so only one
 * optimization ever runs at a time regardless of how many uploads are in flight. The other
 * callers simply wait their turn — the upload pool itself stays 4-wide, only the optimization
 * step inside it is serialized. Every existing failure path below still resolves `null`; the
 * `.then(..., ...)` here exists only so a rejection (there shouldn't be one) can never wedge
 * the queue for callers still waiting behind it.
 */
let optimizeQueue: Promise<void> = Promise.resolve();

/**
 * Retained deliberately as the GLB-only public API. The app itself no longer calls this
 * directly — `prepareViewerVariant` below is the only path in use, and it reaches the
 * optimizer via `runOptimizeNow`, not this function (see the comment on that call for why).
 * Kept exported and working so don't assume it's dead code to prune.
 */
export function runOptimize(file: File): Promise<OptimizeResult | null> {
  const result = optimizeQueue.then(() => runOptimizeNow(file));
  optimizeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/**
 * Produce the object the viewer should load instead of the original, whatever the source
 * format. Shares runOptimize's single-slot queue, so a multi-file upload never runs two
 * conversions at once regardless of which kind they are.
 */
export function prepareViewerVariant(file: File): Promise<VariantResult | null> {
  const result = optimizeQueue.then(() => prepareViewerVariantNow(file));
  optimizeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function prepareViewerVariantNow(file: File): Promise<VariantResult | null> {
  if (isTessellatableFilename(file.name)) {
    const bytes = await file.arrayBuffer();
    const glb = await runStepConvert(bytes);
    if (!glb) return null;
    return {
      buffer: glb,
      summary:
        `Tessellated ${file.name}: ` +
        `${Math.round(file.size / 1024)}KB STEP → ${Math.round(glb.byteLength / 1024)}KB GLB`,
    };
  }

  if (!isOptimizableFilename(file.name)) return null;

  // Calls runOptimizeNow, not runOptimize: this function is already running inside a turn
  // of optimizeQueue (see prepareViewerVariant above), and runOptimize chains onto that same
  // single-slot queue. Calling it here would enqueue behind a slot this call itself holds,
  // deadlocking the queue permanently rather than running the optimization.
  const optimized = await runOptimizeNow(file);
  if (!optimized) return null;
  const { before, after } = optimized.stats;
  return {
    buffer: optimized.buffer,
    summary:
      `Optimised ${file.name}: ${before.primitives} → ${after.primitives} draw calls, ` +
      `${after.triangles} triangles preserved, ` +
      `${Math.round(before.bytes / 1024)}KB → ${Math.round(after.bytes / 1024)}KB`,
  };
}

function runOptimizeNow(file: File): Promise<OptimizeResult | null> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      // new URL(..., import.meta.url) is how webpack 5 — and therefore Next 14 — discovers
      // and bundles a worker as a separate chunk.
      worker = new Worker(new URL('./optimizeWorker.ts', import.meta.url));
    } catch (error) {
      console.warn('Model optimization unavailable; uploading original.', error);
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (result: OptimizeResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };

    const timer = setTimeout(() => {
      console.warn(`Model optimization exceeded ${TIMEOUT_MS}ms; uploading original.`);
      finish(null);
    }, TIMEOUT_MS);

    worker.onmessage = (event) => {
      const data = event.data as
        | { ok: true; buffer: ArrayBuffer; stats: OptimizeResult['stats'] }
        | { ok: false; error: string };
      if (!data.ok) {
        console.warn('Model optimization failed; uploading original.', data.error);
        finish(null);
        return;
      }
      finish({ buffer: data.buffer, stats: data.stats });
    };

    // Fires when the worker dies outright, which is the out-of-memory case.
    worker.onerror = (event) => {
      console.warn('Model optimization worker crashed; uploading original.', event.message);
      finish(null);
    };

    file
      .arrayBuffer()
      .then((buffer) => worker.postMessage(buffer, [buffer]))
      .catch(() => finish(null));
  });
}
