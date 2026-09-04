import { Document, Node, WebIO } from '@gltf-transform/core';
import type { OcctImportParams, OcctNode, OcctResult } from 'occt-import-js';
import { PART_MARKER } from './partTree.ts';

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
  if (!result.success) {
    throw new Error('STEP file could not be read');
  }
  if (!result.meshes.length) {
    // Success with no meshes means the file parsed but held no solid geometry — a
    // drawing-only or reference-geometry export. Returning an empty GLB would show an
    // empty viewport with no explanation, so this is an error.
    throw new Error('STEP file contained no solid geometry');
  }

  return buildGlbDocument(result);
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
   * A node owning several meshes gets them as child nodes rather than as several primitives
   * on one mesh: the panel must be able to show "Rim" as one row, and buildPartTree already
   * treats unmarked children as geometry belonging to their nearest marked ancestor.
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
      for (const index of own) {
        // Unmarked on purpose: these are this part's geometry, not parts of their own.
        node.addChild(nodeForMesh(index).setExtras({}));
      }
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
