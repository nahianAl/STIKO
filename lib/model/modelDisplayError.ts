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

/**
 * three's ThreeMFLoader does not support the 3MF Production Extension (multi-file
 * `<component p:path=...>`), which slicer project files from Bambu Studio, OrcaSlicer and
 * PrusaSlicer use. Parsing one throws an unhelpful TypeError, so say what to export instead.
 */
export const UNREADABLE_3MF_MESSAGE =
  "This 3MF couldn't be read. Slicer project files (Bambu Studio, OrcaSlicer, PrusaSlicer) often can't be — export the plate as STL or a plain 3MF, then upload.";

/** True when anything in the tree would put pixels on screen: a mesh, a line or points. */
export function hasDrawableGeometry(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((node) => {
    const n = node as THREE.Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean };
    if (n.isMesh || n.isLine || n.isPoints) found = true;
  });
  return found;
}
