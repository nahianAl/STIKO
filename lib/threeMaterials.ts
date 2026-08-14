import * as THREE from 'three';

/**
 * Renders every material under `root` from both sides.
 *
 * Uploaded design geometry is routinely thin-walled or open — mesh seats, perforated
 * shells, lofted surfaces, unclosed CAD solids. glTF materials are single-sided unless
 * the asset opts in, so with the default FrontSide the far inner wall of such a part is
 * culled and anything seen through a hole or opening reads as empty space.
 *
 * Mutates in place (loader results are cached and shared by useLoader) and returns
 * `root` so it can be applied inline.
 */
export function makeDoubleSided<T extends THREE.Object3D>(root: T): T {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material.side = THREE.DoubleSide;
  });
  return root;
}

/**
 * Sets (or clears, with `null`) the clipping planes on every material under `root`.
 *
 * Per-material rather than the renderer's global `clippingPlanes`, which would cut
 * everything drawn — including the ground disc, the axis lines and the navigation cube,
 * which renders through drei's Hud on the same renderer.
 *
 * Mutates in place and returns `root`, matching makeDoubleSided. Pass the SAME array
 * instance across frames and mutate the planes it holds: changing the NUMBER of clipping
 * planes on a material recompiles its shader, while changing a plane's values does not.
 */
export function setClippingPlanes<T extends THREE.Object3D>(
  root: T,
  planes: THREE.Plane[] | null,
): T {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material.clippingPlanes = planes;
  });
  return root;
}
