import * as THREE from 'three';

/**
 * Gives Stiko's own CAD conversions a semi-gloss finish, in the viewer.
 *
 * Both converters (lib/model/stepToGlb.ts and cad-worker/usd_to_glb.py) write every part as
 * `roughness 0.6, metallic 0`. Under that matte finish a curved face has no highlight gradient,
 * which is the eye's main cue for curvature, so a cylinder, a fillet and a flat face all read
 * as the same flat tone. Onshape-style semi-gloss puts that cue back.
 *
 * Done here rather than in the converters so files already uploaded get it too, with no
 * re-conversion. The signature is exact: a designer-authored glTF finish almost never sits at
 * precisely 0.6 with no maps, so their work is left as they made it.
 *
 * Runs after repairExporterDefaults (whose repaired materials sit at 0.8 and so never match)
 * and before buildBatches (which reads roughness into its appearance key). Idempotent:
 * useLoader caches the tree, and a second pass finds 0.38, not 0.6.
 *
 * Deliberately no `needsUpdate`: roughness is a uniform.
 */

/** What both converters write. */
export const CONVERTER_ROUGHNESS = 0.6;

/**
 * The finish they get in the viewer. Tuned on screenshots. Lower washes pale parts out into
 * glare, which loses detail instead of adding it.
 */
export const CAD_FINISH_ROUGHNESS = 0.38;

/** glTF stores factors as float32; 0.6 comes back as 0.6000000238. */
const TOLERANCE = 1e-6;

const MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const;

function isConverterDefault(material: THREE.Material): material is THREE.MeshStandardMaterial {
  const standard = material as THREE.MeshStandardMaterial;
  if (standard.isMeshStandardMaterial !== true) return false;
  if (standard.metalness !== 0) return false;
  if (Math.abs(standard.roughness - CONVERTER_ROUGHNESS) > TOLERANCE) return false;
  return MAP_KEYS.every((key) => !standard[key]);
}

export function applyCadFinish<T extends THREE.Object3D>(root: T): T {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (isConverterDefault(material)) material.roughness = CAD_FINISH_ROUGHNESS;
    }
  });
  return root;
}
