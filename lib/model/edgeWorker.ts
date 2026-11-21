/// <reference lib="webworker" />
import { extractCreaseEdges } from './creaseEdges';

/**
 * Worker entry for edge lines. Imports only creaseEdges.ts, which imports nothing, so this
 * chunk stays tiny: no three. Runs off the main thread because even the fast extractor takes
 * ~1.25 s on 1.5 M triangles, and a frozen tab while a model opens is the one thing this
 * feature must never cause.
 */

export interface EdgeJobRequest {
  jobs: { positions: Float32Array; index: Uint32Array | null; sharedIsSmooth: boolean }[];
  thresholdDeg: number;
}

self.onmessage = (event: MessageEvent<EdgeJobRequest>) => {
  try {
    const { jobs, thresholdDeg } = event.data;
    const segments = jobs.map((job) =>
      extractCreaseEdges(job.positions, job.index, thresholdDeg, job.sharedIsSmooth),
    );
    (self as unknown as Worker).postMessage(
      { ok: true, segments },
      segments.map((s) => s.buffer),
    );
  } catch (error) {
    self.postMessage({ ok: false, error: String(error) });
  }
};
