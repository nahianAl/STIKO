/// <reference lib="webworker" />
import { stepToGlb } from './stepToGlb';

/**
 * Worker entry for STEP tessellation. This module and optimizeWorker.ts are the ONLY places
 * their heavy dependencies may enter the bundle graph — the OCCT WASM alone is 7.6 MB, and a
 * reviewer who never opens a STEP file must not download it.
 *
 * Running here is not only about main-thread responsiveness. ReadStepFile is a synchronous
 * call that can run for minutes on heavy NURBS input and cannot be interrupted; on the main
 * thread that freezes the tab with no way out. In a worker the caller can terminate it.
 */

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const glb = await stepToGlb(new Uint8Array(event.data));

    // Copy out of the WASM heap view into a standalone ArrayBuffer so it can be
    // transferred. glb.buffer may be the whole heap, and may be larger than glb.
    const buffer = glb.slice().buffer;
    self.postMessage({ ok: true, buffer }, [buffer]);
  } catch (error) {
    self.postMessage({ ok: false, error: String(error) });
  }
};
