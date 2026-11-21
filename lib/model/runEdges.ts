import { assembleEdges, EDGE_MAX_TRIANGLES, type EdgeSource, type ModelEdges } from './buildEdges';
import { CREASE_THRESHOLD_DEG } from './creaseEdges';

/**
 * Runs the crease search for a whole model in a worker and assembles the result.
 *
 * Resolves `null`, never rejects, for: an empty model, a model over EDGE_MAX_TRIANGLES, no
 * Worker support, or any worker failure. A model without edges is exactly what the viewer
 * showed before this feature existed, so every failure degrades to that.
 *
 * `cancel()` terminates the worker. The caller must also dispose a result that arrives after it
 * stopped caring; ModelViewerInner's effect does this with a `cancelled` flag.
 */
export function computeModelEdges(sources: EdgeSource[]): {
  promise: Promise<ModelEdges | null>;
  cancel(): void;
} {
  let triangles = 0;
  sources.forEach((s) => (triangles += s.triangles));
  if (sources.length === 0 || triangles > EDGE_MAX_TRIANGLES || typeof Worker === 'undefined') {
    return { promise: Promise.resolve(null), cancel() {} };
  }

  let created: Worker;
  try {
    created = new Worker(new URL('./edgeWorker.ts', import.meta.url));
  } catch {
    return { promise: Promise.resolve(null), cancel() {} };
  }
  // `live` is the non-null handle the handlers use; `worker` is what cancel() clears.
  const live = created;
  let worker: Worker | null = live;

  const promise = new Promise<ModelEdges | null>((resolve) => {
    live.onmessage = (event: MessageEvent<{ ok: boolean; segments?: Float32Array[]; error?: string }>) => {
      live.terminate();
      worker = null;
      if (!event.data.ok || !event.data.segments) {
        console.warn('[edges] worker failed:', event.data.error);
        resolve(null);
        return;
      }
      try {
        resolve(assembleEdges(sources, event.data.segments));
      } catch (error) {
        console.warn('[edges] assemble failed:', error);
        resolve(null);
      }
    };
    live.onerror = (event) => {
      console.warn('[edges] worker error:', event.message);
      live.terminate();
      worker = null;
      resolve(null);
    };
    // The result could not be deserialised on this side. Without this the promise would hang.
    live.onmessageerror = () => {
      console.warn('[edges] worker message error');
      live.terminate();
      worker = null;
      resolve(null);
    };
    // Each source's arrays are already private copies (collectEdgeSources), so transferring
    // them cannot detach the live geometry. They are not read on this side again, because
    // assembleEdges only reads `matrix` and `key`.
    const jobs = sources.map((s) => ({
      positions: s.positions,
      index: s.index,
      sharedIsSmooth: s.sharedIsSmooth,
    }));
    const transfer: Transferable[] = [];
    jobs.forEach((j) => {
      transfer.push(j.positions.buffer);
      if (j.index) transfer.push(j.index.buffer);
    });
    try {
      live.postMessage({ jobs, thresholdDeg: CREASE_THRESHOLD_DEG }, transfer);
    } catch (error) {
      // A DataCloneError or a refused transfer throws synchronously, inside the promise executor.
      console.warn('[edges] postMessage failed:', error);
      live.terminate();
      worker = null;
      resolve(null);
    }
  });

  return {
    promise,
    cancel() {
      worker?.terminate();
      worker = null;
    },
  };
}
