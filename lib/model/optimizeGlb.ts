import { Primitive, WebIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  convertPrimitiveToLines,
  convertPrimitiveToTriangles,
  dedup,
  flatten,
  join,
  prune,
  weld,
} from '@gltf-transform/functions';

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
  /**
   * Indices belonging to LINES / LINE_STRIP / LINE_LOOP primitives (mode 1/2/3). Counted
   * separately from triangles so the lossless guarantee can actually see line geometry —
   * see the note on measure() below.
   */
  lineIndices: number;
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

/**
 * The three line modes. An earlier version of measure() counted only MODE_TRIANGLES, so a
 * transform that mangled LINE_STRIP geometry into garbage indices (see the primitive-restart
 * comment below) still reported a "lossless" pass — the line data simply wasn't part of what
 * was being watched. Counting it here is what let that regression be caught by a test.
 */
const LINE_MODES = new Set([Primitive.Mode.LINES, Primitive.Mode.LINE_STRIP, Primitive.Mode.LINE_LOOP]);

function measure(doc: Document, bytes: number): OptimizeCounts {
  let primitives = 0;
  let triangles = 0;
  let lineIndices = 0;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      primitives++;
      const mode = prim.getMode();
      const indices = prim.getIndices();
      const count = indices ? indices.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0);

      if (mode === MODE_TRIANGLES) {
        triangles += count / 3;
      } else if (LINE_MODES.has(mode)) {
        lineIndices += count;
      }
    }
  }

  return {
    primitives,
    triangles: Math.round(triangles),
    lineIndices,
    nodes: doc.getRoot().listNodes().length,
    bytes,
  };
}

export async function optimizeGlb(input: ArrayBuffer): Promise<OptimizeResult> {
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(new Uint8Array(input));

  // join() merges primitives that share a material using primitive-restart sentinels
  // whenever any of them use a restart-capable mode (LINE_STRIP, LINE_LOOP, TRIANGLE_STRIP,
  // TRIANGLE_FAN), and then marks KHR_mesh_primitive_restart as REQUIRED on the document.
  // three.js r169 does not implement that extension — it only console.warns — so every
  // sentinel index (0xFFFF / 0xFFFFFFFF) is read back as an ordinary vertex index, which is
  // out of range and resolves to (0,0,0). The reference file carries 551 LINE_STRIP
  // primitives (CAD construction/dimension lines); left alone, that turns into hundreds of
  // stray line segments radiating to the model origin in the "optimized" output — silent,
  // because those primitives don't carry triangles and the lossless check below didn't used
  // to look at anything else.
  //
  // Converting to plain LINES / TRIANGLES up front costs nothing (same vertices, no data
  // loss) and keeps every downstream primitive in a mode join() can merge without resorting
  // to restart sentinels at all. This must run before `before` is measured: measure() counts
  // line indices, and LINE_STRIP / LINES report different index counts for the same
  // geometry, so measuring before-and-after normalisation would make the "preserved exactly"
  // assertion compare two different encodings of the same lines instead of the same encoding
  // twice.
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mode = prim.getMode();
      if (mode === Primitive.Mode.LINE_STRIP || mode === Primitive.Mode.LINE_LOOP) {
        convertPrimitiveToLines(prim);
      } else if (mode === Primitive.Mode.TRIANGLE_STRIP || mode === Primitive.Mode.TRIANGLE_FAN) {
        convertPrimitiveToTriangles(prim);
      }
    }
  }

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

  // Belt-and-braces, in case some future primitive shape still tempts join() into a restart
  // merge despite the normalisation above: refuse to hand back a document that requires an
  // extension three.js cannot read, rather than silently store one the viewer would render
  // wrong. optimizeGlb is only ever called from runOptimize, which treats any throw as
  // "upload the original" — so this can only make a file fall back to unoptimized, never
  // corrupt what gets stored.
  const requiredExtensions = doc.getRoot().listExtensionsRequired();
  if (requiredExtensions.length > 0) {
    throw new Error(
      `optimizeGlb produced a document requiring extensions the viewer cannot read: ${requiredExtensions
        .map((ext) => ext.extensionName)
        .join(', ')}`
    );
  }

  const output = await io.writeBinary(doc);
  // writeBinary hands back a Uint8Array that may be a view into a larger buffer; slice to
  // an exact, transferable ArrayBuffer so postMessage can hand it over without copying.
  const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;

  return { buffer, stats: { before, after: measure(doc, buffer.byteLength) } };
}
