/// <reference lib="webworker" />
import { optimizeGlb } from './optimizeGlb';

/**
 * Worker entry. This module is the ONLY place @gltf-transform may enter the bundle graph —
 * it is large, and a reviewer who never uploads a model must not download it.
 *
 * Running here is not merely about keeping the main thread responsive. The optimizer peaks
 * at roughly 24x the input file in memory (523 MB on a 22 MB file), and an allocation that
 * large can fail outright. In a worker that failure kills the worker; on the main thread it
 * would kill the tab mid-upload.
 */

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const { buffer, stats } = await optimizeGlb(event.data);
    // Transfer rather than copy — this buffer is megabytes.
    (self as unknown as Worker).postMessage({ ok: true, buffer, stats }, [buffer]);
  } catch (error) {
    self.postMessage({ ok: false, error: String(error) });
  }
};
