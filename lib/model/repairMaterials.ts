import * as THREE from 'three';

/**
 * Repairs materials whose PBR factors the exporter never wrote.
 *
 * glTF defaults `metallicFactor` and `roughnessFactor` to 1.0 when they are absent, so a
 * Rhino export that carries only a display colour arrives as a *fully metallic* surface.
 * Metals have no diffuse response — they show reflections and nothing else — and
 * SceneLighting deliberately runs the environment at 0.15 because the headlight is meant
 * to do the lighting. The result is geometry that renders pitch black with no way to
 * recover, which is exactly what one third of the reference model did.
 *
 * The signature below is the discriminator. `metalness === 1 && roughness === 1` describes
 * a perfectly rough mirror, which is physically meaningless and never authored on purpose,
 * and Rhino omits the name only on materials it auto-generates from display colours.
 * Authored materials carry a name and explicit factors, so they never match.
 *
 * Mutates in place and returns `root`, matching `makeDoubleSided` in lib/threeMaterials.ts.
 */

/** Below this linear luminance a base colour carries no visible information at all. */
const NEAR_BLACK_LUMINANCE = 0.02;

/** What a black display colour becomes: a neutral grey that shades legibly. */
const FALLBACK_LUMINANCE = 0.55;

/** Matte enough to read as an untextured CAD surface under the headlight. */
const REPAIRED_ROUGHNESS = 0.8;

/** three.js stores material colours in linear working space, so this is a linear luminance. */
function luminanceOf(color: THREE.Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

function isExporterDefault(material: THREE.Material): material is THREE.MeshStandardMaterial {
  // A name means a human authored it. Cheapest check, so it goes first.
  if (material.name !== '') return false;

  const standard = material as THREE.MeshStandardMaterial;
  // Undefined on non-PBR materials, which fails this comparison and skips them safely.
  if (standard.metalness !== 1 || standard.roughness !== 1) return false;

  // Any map means the exporter wrote real PBR data and meant it.
  if (standard.map || standard.metalnessMap || standard.roughnessMap) return false;

  return true;
}

export function repairExporterDefaults<T extends THREE.Object3D>(root: T): T {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!isExporterDefault(material)) continue;

      material.metalness = 0;
      material.roughness = REPAIRED_ROUGHNESS;

      // Only rescue a colour that carries no information. A visible colour is the
      // designer's, even on a material the exporter mangled in other ways.
      if (luminanceOf(material.color) < NEAR_BLACK_LUMINANCE) {
        material.color.setScalar(FALLBACK_LUMINANCE);
      }

      // Deliberately no `needsUpdate`: these are all uniforms, and setting it would
      // force a shader recompile for nothing.
    }
  });
  return root;
}
