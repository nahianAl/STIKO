import type * as THREE from 'three';

/**
 * A model failure with something specific to tell the person looking at it. Thrown from
 * inside the viewer's render; ModelErrorBoundary shows `userMessage` in place of its generic
 * "could not be displayed" text. Anything else thrown keeps the generic text.
 */
export class ModelDisplayError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string) {
    super(userMessage);
    this.name = 'ModelDisplayError';
    this.userMessage = userMessage;
  }
}

/**
 * Rhino stores render meshes beside its NURBS only when the file is saved with them, and
 * rhino3dm cannot mesh a Brep itself. A "Save Small" file therefore loads as an empty tree.
 */
export const EMPTY_RHINO_MESSAGE =
  'This Rhino file has no display meshes. Open it in Rhino, turn off Save Small, and save again.';

/** True when anything in the tree would put pixels on screen: a mesh, a line or points. */
export function hasDrawableGeometry(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((node) => {
    const n = node as THREE.Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean };
    if (n.isMesh || n.isLine || n.isPoints) found = true;
  });
  return found;
}
