import { Document, WebIO } from '@gltf-transform/core';
import type { OcctImportParams } from 'occt-import-js';

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
 * The WASM is 7.6 MB and initialises in ~25 ms, so it is loaded once and reused. In the
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

  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();

  for (let i = 0; i < result.meshes.length; i++) {
    const mesh = result.meshes[i];
    const name = mesh.name || `solid_${i}`;

    const primitive = doc.createPrimitive().setAttribute(
      'POSITION',
      doc
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array(mesh.attributes.position.array))
        .setBuffer(buffer)
    );

    if (mesh.attributes.normal?.array?.length) {
      primitive.setAttribute(
        'NORMAL',
        doc
          .createAccessor()
          .setType('VEC3')
          .setArray(new Float32Array(mesh.attributes.normal.array))
          .setBuffer(buffer)
      );
    }

    if (mesh.index?.array?.length) {
      primitive.setIndices(
        doc
          .createAccessor()
          .setType('SCALAR')
          .setArray(new Uint32Array(mesh.index.array))
          .setBuffer(buffer)
      );
    }

    const [r, g, b] = mesh.color ?? DEFAULT_COLOR;
    primitive.setMaterial(
      doc
        .createMaterial(`${name}_material`)
        .setBaseColorFactor([r, g, b, 1])
        // metallic=0 on purpose. glTF defaults both factors to 1, which is exactly the
        // pitch-black-mesh trap repairMaterials.ts exists to undo; do not emit it here.
        .setMetallicFactor(0)
        .setRoughnessFactor(0.6)
        // CAD parts are frequently thin or perforated, and a single-sided wall disappears
        // when viewed through an opening. Matches makeDoubleSided() in the viewer.
        .setDoubleSided(true)
    );

    // One node per solid keeps parts separately selectable and cross-sectionable.
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(primitive)));
  }

  return new WebIO().writeBinary(doc);
}
