import type { OptimizeResult } from './optimizeGlb';

/**
 * Browser-side front door to the optimizer. Every failure path resolves `null`, which the
 * caller reads as "upload the original" — optimization is an improvement, never a gate.
 */

/** gltf-transform operates on glTF documents; nothing else in Stiko's format list is one. */
export const OPTIMIZABLE_EXTENSIONS: ReadonlySet<string> = new Set(['glb', 'gltf']);

/**
 * Measured peak memory ran ~24x the input size, so this projects to roughly 2.4 GB — near
 * the ceiling of what a browser tab will hand a worker before the allocation simply fails.
 * Above this the file uploads unoptimized rather than risking a long doomed attempt.
 */
export const MAX_OPTIMIZE_BYTES = 100 * 1024 * 1024;

/** Generous next to the ~6s the 22 MB reference file takes, tight enough to not strand an upload. */
const TIMEOUT_MS = 120_000;

export function shouldOptimize(filename: string, bytes: number): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return false;
  const ext = filename.slice(dot + 1).toLowerCase();
  return OPTIMIZABLE_EXTENSIONS.has(ext) && bytes <= MAX_OPTIMIZE_BYTES;
}

export function runOptimize(file: File): Promise<OptimizeResult | null> {
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
