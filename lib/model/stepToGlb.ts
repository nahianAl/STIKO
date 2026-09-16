import { Document, Node, Primitive, WebIO } from '@gltf-transform/core';
import type { OcctImportParams, OcctNode, OcctResult } from 'occt-import-js';
import { PART_MARKER } from './partTree.ts';
import { extractWireframe, type WireframeResult } from './stepWireframe.ts';

/**
 * STEP → GLB, and the only module in the codebase that knows OpenCascade exists.
 *
 * No DOM, no worker API, no React: it takes bytes and returns bytes, so it runs in a Web
 * Worker in the browser and directly under `node --test`.
 */

/**
 * The settings that make heavy CAD viewable.
 *
 * OCCT's own default is a bounding_box_ratio of 0.001 — a 0.33 mm chord error on the
 * reference file — which never returns on a 13.7 MB Rhino export whose 1223 faces are 887
 * NURBS patches. Measured on that file: 0.03 renders within 0.04% of the pixels of a
 * setting seven times finer, in 19.7 s instead of never.
 *
 * angularDeflection stays at OCCT's 0.5. It, not the linear term, is what keeps small
 * curved features smooth — it forces a minimum segment count around a cylinder regardless
 * of the linear setting. At 1.0 the reference file's handle visibly facets; at 0.3 nothing
 * visible is gained for 25% more time.
 */
export const STEP_TESSELLATION: OcctImportParams = {
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.03,
  angularDeflection: 0.5,
};

/** Matches the viewer's own default when a solid carries no colour of its own. */
const DEFAULT_COLOR: [number, number, number] = [0.53, 0.6, 0.67];

type OcctImportJs = Awaited<ReturnType<typeof import('occt-import-js').default>>;

let occtPromise: Promise<OcctImportJs> | null = null;

/**
 * The WASM is 7.6 MB and initialises in ~25 ms, so within a single worker's lifetime it is
 * loaded once and reused. That lifetime is short: runStepConvert terminates the worker after
 * every conversion, success or failure alike, so this module-level cache never actually
 * survives to serve a second call — a batch of ten STEP uploads re-initialises the WASM ten
 * times, once per worker. That's fine (~25 ms against a ~20 s conversion); this comment
 * exists only so the "loaded once" phrasing isn't read as "once per browser session". In the
 * browser it is served from /occt-import-js.wasm, copied there by the postinstall script;
 * tests pass a path into node_modules instead.
 *
 * `locateFile` is only honoured for whichever call first populates `occtPromise`; every
 * later call reuses that already-initialised module regardless of the `locateFile` it
 * passes. This is fine as-is: the browser always uses the default path, and tests use a
 * single path throughout a process. Do not add a cache key or a map of instances to make
 * `locateFile` reconfigurable per call — nothing in this codebase needs it.
 */
function initOcct(locateFile?: (path: string) => string): Promise<OcctImportJs> {
  if (!occtPromise) {
    occtPromise = import('occt-import-js')
      .then((mod) => mod.default({ locateFile: locateFile ?? (() => '/occt-import-js.wasm') }))
      .catch((err) => {
        // A failed init must not be cached: the next call should retry, not replay this
        // rejection forever. The rejection still propagates to this call's own caller
        // via the returned (now-rejected) promise below.
        occtPromise = null;
        throw err;
      });
  }
  return occtPromise;
}

export async function stepToGlb(
  bytes: Uint8Array,
  options: { locateFile?: (path: string) => string } = {}
): Promise<Uint8Array> {
  const occt = await initOcct(options.locateFile);

  const result = occt.ReadStepFile(bytes, STEP_TESSELLATION);
  if (result.success && result.meshes.length) {
    return buildGlbDocument(result);
  }

  // No triangles. OCCT only ever meshes faces (importer-xcaf.cpp walks TopAbs_FACE/SHELL/
  // SOLID and nothing else), so this is the expected result for a curve-only export —
  // Rhino's GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION, which is what a panel
  // layout or a toolpath arrives as. Measured on a 4.4 MB Rhino wireframe: ReadStepFile
  // returns success in 1.7 s with meshes: [], and every curve in the file is discarded.
  //
  // The fallback runs on the `!success` path too, deliberately. OCCT rejects outright some
  // files whose curve data is perfectly readable — a minimal hand-written wireframe among
  // them — and a file it could not parse is one this cannot make worse.
  const wireframe = extractWireframe(decodeStep(bytes));
  if (wireframe.polylines.length) {
    return buildWireframeDocument(wireframe);
  }

  if (!result.success) {
    throw new Error('STEP file could not be read');
  }

  // Parsed, but holding neither solids nor curves: a drawing-only, annotation-only or
  // reference-geometry export. Returning an empty GLB would show an empty viewport with no
  // explanation, so this is an error — and it names what was found so the console says
  // something truer than "too complex".
  throw new Error(`STEP file contained no displayable geometry${describeUnsupported(wireframe)}`);
}

/**
 * STEP is an ISO-10303-21 exchange file: its syntax is pure ASCII, and only string values
 * can carry anything else. latin1 maps every byte to a character and never fails, so a file
 * with a stray high byte in a part name parses instead of throwing — which utf-8 decoding,
 * even non-fatally, would turn into replacement characters mid-token.
 */
function decodeStep(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

/** Names the curve types that were found but not drawn, for an error a human can act on. */
function describeUnsupported(wireframe: WireframeResult): string {
  if (!wireframe.unsupported.size) return '';
  const types = Array.from(wireframe.unsupported.keys()).sort().join(', ');
  return ` (unsupported curve types: ${types})`;
}

/**
 * What a curve is drawn in, filling DEFAULT_COLOR's role for solids — but deliberately much
 * darker than it, because a curve is a hairline rather than a shaded surface and WebGL
 * ignores `linewidth` above 1 on essentially every platform.
 *
 * LINEAR, as every glTF baseColorFactor is: on screen this resolves to about #707887 against
 * the viewport's #f0f0f0. Read as sRGB it looks almost black, so do not "fix" it by eye.
 */
const WIREFRAME_COLOR: [number, number, number] = [0.16, 0.19, 0.24];

/**
 * Builds a GLB of LINE_STRIP primitives — one per curve — from extracted wireframe geometry.
 *
 * Nothing here is stamped with PART_MARKER, unlike buildGlbDocument, and that is the whole
 * design rather than an omission. Line primitives are not `isMesh`, so buildPartTree collects
 * none of them and buildBatches has nothing to batch (BatchedMesh holds triangles only).
 * Marking them would give ModelViewerInner a non-empty `parts` with a null `batches`, i.e. a
 * Parts panel of rows that can never be coloured, hidden or picked. Unmarked, the viewer takes
 * its `<primitive object={root} />` branch and renders the loaded tree directly — the path
 * that already draws every line and point primitive an ordinary GLB carries.
 *
 * three's GLTFLoader turns a LINE_STRIP primitive into a THREE.Line and derives a
 * LineBasicMaterial from the primitive's material, copying its colour across, so the material
 * below is what sets the drawn colour despite lines being unlit.
 */
export async function buildWireframeDocument(wireframe: WireframeResult): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();

  // One material for every curve: a line's appearance carries no per-curve information here,
  // and a material apiece would be as many GL programs as the file has curves.
  const material = doc
    .createMaterial('wireframe_material')
    .setBaseColorFactor([...WIREFRAME_COLOR, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(1);

  wireframe.polylines.forEach((polyline, index) => {
    const name = `curve_${index}`;
    const primitive = doc
      .createPrimitive()
      .setMode(Primitive.Mode.LINE_STRIP)
      .setMaterial(material)
      .setAttribute(
        'POSITION',
        doc.createAccessor().setType('VEC3').setArray(polyline.points).setBuffer(buffer)
      );

    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(primitive)));
  });

  return new WebIO().writeBinary(doc);
}

/**
 * Builds the glTF document for an OCCT result, hierarchy included.
 *
 * Split out of stepToGlb so the tree can be unit-tested against a canned result rather than
 * a 7.6 MB WASM tessellation.
 */
export async function buildGlbDocument(result: OcctResult): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();

  /** One glTF node per OCCT mesh, stamped so the viewer can find it again. */
  const nodeForMesh = (index: number): Node => {
    const mesh = result.meshes[index];
    const name = mesh.name || `solid_${index}`;

    const primitive = doc.createPrimitive().setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3')
        .setArray(new Float32Array(mesh.attributes.position.array)).setBuffer(buffer)
    );

    if (mesh.attributes.normal?.array?.length) {
      primitive.setAttribute(
        'NORMAL',
        doc.createAccessor().setType('VEC3')
          .setArray(new Float32Array(mesh.attributes.normal.array)).setBuffer(buffer)
      );
    }

    if (mesh.index?.array?.length) {
      primitive.setIndices(
        doc.createAccessor().setType('SCALAR')
          .setArray(new Uint32Array(mesh.index.array)).setBuffer(buffer)
      );
    }

    const [r, g, b] = mesh.color ?? DEFAULT_COLOR;
    primitive.setMaterial(
      doc.createMaterial(`${name}_material`)
        .setBaseColorFactor([r, g, b, 1])
        // metallic=0 on purpose. glTF defaults both factors to 1, which is exactly the
        // pitch-black-mesh trap repairMaterials.ts exists to undo; do not emit it here.
        .setMetallicFactor(0)
        .setRoughnessFactor(0.6)
        // CAD parts are frequently thin or perforated, and a single-sided wall disappears
        // when viewed through an opening. Matches makeDoubleSided() in the viewer.
        .setDoubleSided(true)
    );

    return doc.createNode(name)
      .setMesh(doc.createMesh(name).addPrimitive(primitive))
      .setExtras({ [PART_MARKER]: true });
  };

  /**
   * An OCCT node becomes one glTF node carrying its own meshes and its children.
   *
   * A node owning exactly one mesh attaches it directly, so the tree has no pass-through row
   * between the part and its geometry. A node owning SEVERAL meshes gives each one its own
   * marked child node instead: occt-import-js's own docs describe a node's `meshes` array as
   * "indices of the meshes in the meshes array for this node", and OCCT emits one mesh per
   * SOLID — each with its own name and its own colour; a solid with several differently
   * coloured faces still comes back as a single mesh, coloured per-face via `brep_faces`. So
   * several meshes on one OCCT node are several distinct solids, not fragments of one object,
   * and each is a part in its own right, nested under the node that owns them (which stays a
   * part itself whether or not it owns any mesh directly).
   *
   * This is deliberately NOT glTF's own multi-primitive convention, where several primitives
   * under one mesh are facets of the SAME object (e.g. a rim split across a steel and a chrome
   * material) — that assumption is what this branch used to encode, unmarking every mesh past
   * the first so buildPartTree would fold them back into one part. It was wrong for OCCT, and
   * measured wrong on a real 13 MB customer STEP file: 11 meshes on `result.root` collapsed
   * into a single "Document" row, making the whole per-part colouring feature useless for that
   * file. Do not restore the old unmarking; see the "several parts" test below.
   */
  const buildNode = (occt: OcctNode, fallbackName: string): Node => {
    const own = occt.meshes ?? [];
    const kids = occt.children ?? [];

    // OCCT wraps even a single unstructured solid in an anonymous, geometry-less node — the
    // real cube.stp fixture comes back as root: { name: "", meshes: [], children: [{ name:
    // "cube", meshes: [0] }] }. That wrapper is a structural artifact of the product
    // structure, not a modelled part; keeping it would turn every single-solid upload into
    // two nested nodes for one solid, breaking "one node per solid" below. A node with a real
    // name is never collapsed, however many children it has — that's a modelled assembly
    // (e.g. "Car" wrapping "Wheel_FL"), not a pass-through.
    //
    // Collapsing a level here shifts the index-path key (partTree.ts's `0/2/1`-style `key`)
    // of every node beneath it. Part keys are the primary key for saved colours, so widening
    // or narrowing this condition later would silently reassign saved colours on any file
    // that gets reprocessed through this pipeline.
    //
    // The same consequence follows from the multi-mesh branch below: marking each of a node's
    // several meshes as its own part (rather than folding them into the parent, as this file
    // used to) changes which key belongs to which solid for any node with more than one mesh.
    // That's fine right now — the per-part-colour feature has never shipped, so no
    // `part_colors` row anywhere is keyed against the old (collapsed) numbering — but it would
    // not be fine once real rows exist. Do not casually reshape buildNode's output after that
    // point without a migration for existing keys.
    if (!occt.name && own.length === 0 && kids.length === 1) {
      return buildNode(kids[0], fallbackName);
    }

    const node = doc.createNode(occt.name || fallbackName).setExtras({ [PART_MARKER]: true });

    if (own.length === 1) {
      // The common case — one solid, one node. Attach the mesh directly so the tree has no
      // pass-through row between the part and its geometry.
      const meshNode = nodeForMesh(own[0]);
      node.setMesh(meshNode.getMesh());
      meshNode.dispose();
    } else {
      own.forEach((index) => {
        // Marked (nodeForMesh already stamps PART_MARKER): each mesh is its own solid, hence
        // its own part. See buildNode's own doc comment above for why several meshes on one
        // OCCT node are several distinct parts, not fragments of a single object the way
        // several primitives under one glTF mesh would be.
        node.addChild(nodeForMesh(index));
      });
    }

    kids.forEach((child, i) => node.addChild(buildNode(child, `node_${i}`)));
    return node;
  };

  if (result.root) {
    scene.addChild(buildNode(result.root, 'root'));
  } else {
    // No product structure — every solid is its own top-level part.
    result.meshes.forEach((_, i) => scene.addChild(nodeForMesh(i)));
  }

  return new WebIO().writeBinary(doc);
}
