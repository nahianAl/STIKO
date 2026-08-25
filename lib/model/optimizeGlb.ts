import { WebIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, prune, weld } from '@gltf-transform/functions';

/**
 * Collapses a fragmented glTF export into as few draw calls as its materials allow.
 *
 * CAD exporters — Rhino in particular — emit one node, one mesh and one primitive per
 * object *and* per material, merging nothing. The reference file that prompted this work
 * carried 7,995 primitives at a median of two triangles each. GPUs are indifferent to the
 * 228k triangles involved; they are not indifferent to 8,000 state changes per frame. That
 * file leaves here with 26 primitives and exactly the same triangles.
 *
 * WebIO rather than NodeIO on purpose: this runs in a Web Worker, and readBinary /
 * writeBinary never touch the filesystem or the network, so the same code path is what the
 * tests exercise under Node.
 */

export interface OptimizeCounts {
  primitives: number;
  triangles: number;
  nodes: number;
  bytes: number;
}

export interface OptimizeStats {
  before: OptimizeCounts;
  after: OptimizeCounts;
}

export interface OptimizeResult {
  buffer: ArrayBuffer;
  stats: OptimizeStats;
}

/** glTF primitive mode 4 is TRIANGLES. Line and point primitives carry no triangles. */
const MODE_TRIANGLES = 4;

function measure(doc: Document, bytes: number): OptimizeCounts {
  let primitives = 0;
  let triangles = 0;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      primitives++;
      if (prim.getMode() !== MODE_TRIANGLES) continue;
      const indices = prim.getIndices();
      const count = indices ? indices.getCount() : prim.getAttribute('POSITION')!.getCount();
      triangles += count / 3;
    }
  }

  return { primitives, triangles: Math.round(triangles), nodes: doc.getRoot().listNodes().length, bytes };
}

export async function optimizeGlb(input: ArrayBuffer): Promise<OptimizeResult> {
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(new Uint8Array(input));

  const before = measure(doc, input.byteLength);

  // Order is load-bearing. weld() must precede join(): run the other way round, join()
  // leaves a KHR_mesh_primitive_restart state that weld() refuses outright.
  await doc.transform(
    dedup(),                        // merge identical accessors / materials / textures
    flatten(),                      // bake node transforms, collapse the hierarchy
    dedup(),                        // flatten exposes duplicates the first pass could not see
    weld(),                         // index and merge co-located vertices
    join({ keepNamed: false }),     // merge primitives by material — the whole point
    prune({ keepLeaves: false })    // drop whatever the above orphaned
  );

  const output = await io.writeBinary(doc);
  // writeBinary hands back a Uint8Array that may be a view into a larger buffer; slice to
  // an exact, transferable ArrayBuffer so postMessage can hand it over without copying.
  const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;

  return { buffer, stats: { before, after: measure(doc, buffer.byteLength) } };
}
