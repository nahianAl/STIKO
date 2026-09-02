import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { runStepConvert, STEP_VIEWER_TIMEOUT_MS } from './model/runStepConvert';

/**
 * Loads a STEP file by tessellating it to GLB in a worker, then parsing that GLB.
 *
 * It used to call occt.ReadStepFile directly, synchronously, on the main thread, with null
 * params. That combination froze the tab for the entire tessellation — which on a heavy
 * Rhino export never finished — while the viewport's CSS loading animation kept running on
 * the compositor thread, so it looked like progress. See
 * docs/superpowers/specs/2026-09-02-step-viewing-design.md.
 *
 * This path is now the FALLBACK. Files uploaded after that change carry a converted GLB and
 * never reach here; this serves files uploaded before it, and any whose conversion failed.
 */
export class STEPLoader extends THREE.Loader {
  load(
    url: string,
    onLoad: (group: THREE.Group) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (event: unknown) => void,
  ): void {
    this.loadAsync(url, onProgress)
      .then(onLoad)
      .catch(onError);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<THREE.Group> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`STEPLoader: Failed to fetch ${url} (${response.status})`);
    }
    const bytes = await response.arrayBuffer();

    const glb = await runStepConvert(bytes, { timeoutMs: STEP_VIEWER_TIMEOUT_MS });
    if (!glb) {
      // Throwing is what surfaces the message. ModelErrorBoundary catches it and releases
      // the viewport indicator; returning an empty Group would show a blank viewport with
      // no explanation, which is the behaviour this change exists to remove.
      throw new Error('STEPLoader: could not tessellate this file in the browser');
    }

    const gltf = await new GLTFLoader().parseAsync(glb, '');
    return gltf.scene;
  }
}
