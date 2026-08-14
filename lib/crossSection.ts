import * as THREE from 'three';

/**
 * Cross-section of a 3D model: one axis-aligned clipping plane.
 *
 * The plane is built in the MODEL's own frame — the frame the bounding box was measured in,
 * before the user's placement transform. The viewer pushes it into world space with the
 * object's matrix, so a sectioned model keeps the same cut when it is moved or rotated.
 */

export type SectionAxis = 'x' | 'y' | 'z';

/** In index order, so a caller can map an axis onto a coordinate without a lookup table. */
export const SECTION_AXES: readonly SectionAxis[] = ['x', 'y', 'z'];

export interface CrossSection {
  axis: SectionAxis;
  /** Position of the cut along `axis`, 0–1 across the model's extent. */
  offset: number;
  /** Which half survives: false keeps the negative side of the axis, true the positive. */
  flipped: boolean;
}

/** Axis-aligned bounds in the model's own frame, before the placement transform. */
export interface ModelBox {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * A centred cut. Deliberately not an edge cut: an offset at the model's extreme clips
 * nothing, so the tool would look broken the first time anyone switched it on.
 */
export const DEFAULT_CROSS_SECTION: CrossSection = { axis: 'x', offset: 0.5, flipped: false };

/**
 * The clipping plane for a section, in the model's own frame.
 *
 * three keeps whatever lies on the plane's positive side, so an unflipped cut points its
 * normal down the axis: keep everything at or below the cut coordinate.
 *
 * The offset is normalised rather than a world distance so the control's slider has a fixed
 * range whatever the model's size — a 0–1 slider over a 200-unit chair and a 0.2-unit bracket
 * behave identically.
 */
export function planeForSection(section: CrossSection, box: ModelBox): THREE.Plane {
  const index = SECTION_AXES.indexOf(section.axis);
  const min = box.min[index];
  const max = box.max[index];
  const cut = min + (max - min) * section.offset;

  const normal = new THREE.Vector3();
  normal.setComponent(index, section.flipped ? 1 : -1);

  return new THREE.Plane(normal, section.flipped ? -cut : cut);
}
