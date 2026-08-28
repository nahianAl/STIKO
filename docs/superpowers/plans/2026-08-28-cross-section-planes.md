# Cross-section Visible Clip Planes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single slider-driven cross-section plane with up to three planes that are visible in the scene and positioned by dragging them with the Move and Rotate gizmos.

**Architecture:** React state holds only per-slot flags (`visible`, `cutting`, `flipped`) plus the selected slot; each plane's position and rotation live solely on its `Object3D` in the scene and are never read back into React. A per-frame loop rewrites an array of `THREE.Plane`s in place from the widgets' world matrices and hands it to every material under the model. All new scene code lives in `components/viewers/section/`, which also relieves the 719-line `ModelViewerInner.tsx`.

**Tech Stack:** Next.js 14 App Router, React 18, three 0.169, @react-three/fiber 8, @react-three/drei 9, Tailwind, TypeScript strict. Tests are `node --test` over `.mjs` files in `scripts/tests/` importing `.ts` sources directly via Node type-stripping.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-28-cross-section-planes-design.md`. Read it before starting.
- Plane poses are **session-only**. Nothing is persisted, nothing goes to the database, nothing crosses the `<Canvas>` boundary as a number.
- All state resets when the selected file changes, alongside the existing resets in `app/portal/[id]/page.tsx`.
- Maximum three planes. Slots are named 1, 2, 3 in the UI. There is no axis picker and no offset slider.
- Copy rule: the panel label is the word `Planes`. Never "Cross-section planes", never "Sections".
- Terminology: "Package" in user-facing copy, "Portal" in code. Nothing in this feature is user-facing package copy, so this only matters if you touch surrounding text — don't.
- Test runner: `npm test` runs every file. A single file: `node --test scripts/tests/crossSection.test.mjs`.
- Typecheck: `npx tsc --noEmit`. Lint: `npm run lint`. Both must pass before every commit.
- Do NOT create a `.env.local`. Local boot uses inline throwaway env vars — see Task 8.
- Commit after every task, on the current branch. Do not push.

---

### Task 1: Plane model and slot reducer

Everything unit-testable in this feature lives here. `lib/crossSection.ts` is rewritten: the
`axis`/`offset`/`flipped` model and `planeForSection` are gone, replaced by three named slots,
a starting pose per slot, and a plane derived from an `Object3D`'s world matrix.

**Files:**
- Modify (full rewrite): `lib/crossSection.ts`
- Modify (full rewrite): `scripts/tests/crossSection.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PlaneId = 1 | 2 | 3`
  - `const SECTION_PLANE_IDS: readonly PlaneId[]`
  - `const MAX_SECTION_PLANES: number`
  - `interface PlaneSlot { visible: boolean; cutting: boolean; flipped: boolean }`
  - `type SectionSlots = Record<PlaneId, PlaneSlot>`
  - `interface ModelBox { min: [number,number,number]; max: [number,number,number] }` (unchanged shape, still produced by `MeasureModel`)
  - `interface PlanePose { position: [number,number,number]; rotation: [number,number,number] }`
  - `function emptySlots(): SectionSlots`
  - `function defaultPoseFor(id: PlaneId, box: ModelBox): PlanePose`
  - `function togglePlane(slots: SectionSlots, id: PlaneId): SectionSlots`
  - `function setPlaneFlipped(slots: SectionSlots, id: PlaneId, flipped: boolean): SectionSlots`
  - `function cuttingPlaneIds(slots: SectionSlots): PlaneId[]`
  - `function writePlaneFromMatrix(target: THREE.Plane, matrix: THREE.Matrix4, flipped: boolean, normalMatrix?: THREE.Matrix3): THREE.Plane`
  - `function isClipped(planes: readonly THREE.Plane[], point: THREE.Vector3): boolean`

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `scripts/tests/crossSection.test.mjs` with:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  SECTION_PLANE_IDS,
  MAX_SECTION_PLANES,
  emptySlots,
  defaultPoseFor,
  togglePlane,
  setPlaneFlipped,
  cuttingPlaneIds,
  writePlaneFromMatrix,
  isClipped,
} from '../../lib/crossSection.ts';

// A unit cube centred on the origin, so a centred plane sits at 0 and the arithmetic stays
// readable. An off-centre box is used where the distinction actually matters.
const BOX = { min: [-1, -1, -1], max: [1, 1, 1] };

/** The world plane a widget at `pose` would produce, with no parent transform. */
function planeForPose(pose, flipped = false) {
  const object = new THREE.Object3D();
  object.position.set(...pose.position);
  object.rotation.set(...pose.rotation);
  object.updateWorldMatrix(true, false);
  return writePlaneFromMatrix(new THREE.Plane(), object.matrixWorld, flipped);
}

const kept = (plane, p) => plane.distanceToPoint(new THREE.Vector3(...p)) >= 0;

test('there are exactly three slots, named 1 2 3', () => {
  assert.deepEqual([...SECTION_PLANE_IDS], [1, 2, 3]);
  assert.equal(MAX_SECTION_PLANES, 3);
});

test('a fresh slot set cuts nothing and shows nothing', () => {
  const slots = emptySlots();
  for (const id of SECTION_PLANE_IDS) {
    assert.deepEqual(slots[id], { visible: false, cutting: false, flipped: false });
  }
  assert.deepEqual(cuttingPlaneIds(slots), []);
});

test('emptySlots returns independent objects, not three references to one', () => {
  // A shared frozen-by-convention literal would let a careless mutation of slot 1 silently
  // change slots 2 and 3 as well.
  const slots = emptySlots();
  assert.notEqual(slots[1], slots[2]);
  assert.notEqual(slots[2], slots[3]);
  assert.notEqual(emptySlots(), slots);
});

test('the three default poses face three different directions, all centred on the box', () => {
  const centre = [0, 0, 0];
  const normals = [];
  for (const id of SECTION_PLANE_IDS) {
    const pose = defaultPoseFor(id, BOX);
    assert.deepEqual(pose.position, centre, `plane ${id} was not centred`);
    normals.push(planeForPose(pose).normal.clone());
  }
  // Mutually perpendicular: every pair dots to zero.
  for (let a = 0; a < normals.length; a++) {
    for (let b = a + 1; b < normals.length; b++) {
      assert.ok(
        Math.abs(normals[a].dot(normals[b])) < 1e-9,
        `planes ${a + 1} and ${b + 1} start facing the same way`,
      );
    }
  }
});

test('each default pose is perpendicular to its own axis', () => {
  // Plane 1 constrains x, plane 2 constrains y, plane 3 constrains z — a mix-up here looks
  // plausible on a symmetric model, which is exactly why it is asserted rather than eyeballed.
  const axisOf = { 1: 0, 2: 1, 3: 2 };
  for (const id of SECTION_PLANE_IDS) {
    const plane = planeForPose(defaultPoseFor(id, BOX));
    const inside = [0, 0, 0];
    const outside = [0, 0, 0];
    inside[axisOf[id]] = -0.5;
    outside[axisOf[id]] = 0.5;
    assert.equal(kept(plane, inside), true, `plane ${id} hid its own negative side`);
    assert.equal(kept(plane, outside), false, `plane ${id} kept its own positive side`);
    // And it must not care about the other two axes at all.
    const skew = [0.9, 0.9, 0.9];
    skew[axisOf[id]] = -0.5;
    assert.equal(kept(plane, skew), true, `plane ${id} leaked into another axis`);
  }
});

test('the default pose sits at the centre of an off-centre box, not at the world origin', () => {
  // A model 200 units wide and 100 from the origin must still start cut through its middle.
  const big = { min: [100, 0, 0], max: [300, 4, 6] };
  assert.deepEqual(defaultPoseFor(1, big).position, [200, 2, 3]);
});

test('flipping swaps exactly which half survives', () => {
  const pose = defaultPoseFor(1, BOX);
  const plane = planeForPose(pose, false);
  const flipped = planeForPose(pose, true);
  for (const p of [[-0.5, 0, 0], [0.5, 0, 0], [-0.9, 0.3, 0.2], [0.9, -0.3, -0.2]]) {
    assert.notEqual(kept(plane, p), kept(flipped, p), `point ${p} did not swap sides`);
  }
});

test('flipping negates the cut itself, not just the sign of the normal', () => {
  // At the origin the plane constant is 0, and -0 === 0, so a flip that forgot to negate the
  // constant would still pass every centred assertion. Only an off-centre plane catches it.
  const pose = { position: [0.5, 0, 0], rotation: defaultPoseFor(1, BOX).rotation };
  const plane = planeForPose(pose, false);
  assert.equal(kept(plane, [0.4, 0, 0]), true);
  assert.equal(kept(plane, [0.6, 0, 0]), false);

  const flipped = planeForPose(pose, true);
  assert.equal(kept(flipped, [0.4, 0, 0]), false);
  assert.equal(kept(flipped, [0.6, 0, 0]), true);
});

test('a rotated widget cuts at its own angle', () => {
  // The whole point of the redesign: a plane tilted 45 degrees about Y must cut on the
  // diagonal, not snap back to an axis.
  const plane = planeForPose({ position: [0, 0, 0], rotation: [0, Math.PI / 4, 0] });
  assert.ok(Math.abs(plane.normal.y) < 1e-9, 'a Y rotation tilted the plane out of Y');
  assert.ok(Math.abs(Math.abs(plane.normal.x) - Math.abs(plane.normal.z)) < 1e-9);
});

test('the plane follows a parent transform exactly', () => {
  // The property the per-frame world sync rests on: transform the widget and a point by the
  // SAME matrix and the point stays on the same side, at the same distance. If this fails, a
  // model with a saved placement cuts in the wrong place.
  const parent = new THREE.Object3D();
  parent.position.set(17, -4, 9);
  parent.rotation.set(0.3, Math.PI / 3, -0.7);
  const child = new THREE.Object3D();
  child.position.set(0.25, 0, 0);
  child.rotation.set(...defaultPoseFor(1, BOX).rotation);
  parent.add(child);
  parent.updateWorldMatrix(true, true);

  const local = writePlaneFromMatrix(new THREE.Plane(), child.matrix, false);
  const world = writePlaneFromMatrix(new THREE.Plane(), child.matrixWorld, false);

  for (const p of [[-0.5, 0, 0], [0.5, 0, 0], [-0.2, 0.7, -0.3]]) {
    const point = new THREE.Vector3(...p);
    const moved = point.clone().applyMatrix4(parent.matrixWorld);
    assert.equal(
      world.distanceToPoint(moved) >= 0,
      local.distanceToPoint(point) >= 0,
      `point ${p} changed sides under the parent transform`,
    );
    assert.ok(
      Math.abs(world.distanceToPoint(moved) - local.distanceToPoint(point)) < 1e-9,
      `point ${p} changed distance under a rigid transform`,
    );
  }
});

test('writePlaneFromMatrix mutates its target rather than allocating', () => {
  // It runs once per plane per frame. Returning a fresh Plane would allocate 180 objects a
  // second, and the array handed to the materials must keep its instances anyway.
  const target = new THREE.Plane();
  const object = new THREE.Object3D();
  object.position.set(3, 0, 0);
  object.updateWorldMatrix(true, false);
  const returned = writePlaneFromMatrix(target, object.matrixWorld, false);
  assert.equal(returned, target);
});

test('writePlaneFromMatrix gives the same answer with and without a scratch normal matrix', () => {
  // The scratch matrix is a per-frame allocation dodge; it must not change the result.
  const object = new THREE.Object3D();
  object.position.set(1, 2, 3);
  object.rotation.set(0.4, -1.1, 0.9);
  object.updateWorldMatrix(true, false);

  const plain = writePlaneFromMatrix(new THREE.Plane(), object.matrixWorld, true);
  const scratch = new THREE.Matrix3();
  const withScratch = writePlaneFromMatrix(new THREE.Plane(), object.matrixWorld, true, scratch);

  assert.ok(plain.normal.distanceTo(withScratch.normal) < 1e-12);
  assert.ok(Math.abs(plain.constant - withScratch.constant) < 1e-12);
});

test('toggling a slot on makes it visible and starts it cutting', () => {
  const slots = togglePlane(emptySlots(), 2);
  assert.deepEqual(slots[2], { visible: true, cutting: true, flipped: false });
  assert.deepEqual(cuttingPlaneIds(slots), [2]);
});

test('toggling a slot off hides it but leaves the model cut', () => {
  // The behaviour the whole panel is designed around: the numbered buttons control the
  // WIDGET, not the cut. Only the master toggle restores the geometry.
  let slots = togglePlane(emptySlots(), 1);
  slots = togglePlane(slots, 1);
  assert.equal(slots[1].visible, false);
  assert.equal(slots[1].cutting, true);
  assert.deepEqual(cuttingPlaneIds(slots), [1]);
});

test('toggling a hidden-but-cutting slot back on shows it again without duplicating the cut', () => {
  let slots = togglePlane(emptySlots(), 1);
  slots = togglePlane(slots, 1);
  slots = togglePlane(slots, 1);
  assert.deepEqual(slots[1], { visible: true, cutting: true, flipped: false });
  assert.deepEqual(cuttingPlaneIds(slots), [1]);
});

test('toggling one slot never disturbs the other two', () => {
  const before = togglePlane(togglePlane(emptySlots(), 1), 3);
  const after = togglePlane(before, 2);
  assert.deepEqual(after[1], before[1]);
  assert.deepEqual(after[3], before[3]);
  assert.deepEqual(cuttingPlaneIds(after), [1, 2, 3]);
});

test('cuttingPlaneIds is returned in slot order, whatever order they were switched on', () => {
  // ApplyCrossSection rebuilds its Plane array from this. A wobbling order would rebuild the
  // array — and recompile every material's shader — for no reason.
  let slots = togglePlane(emptySlots(), 3);
  slots = togglePlane(slots, 1);
  slots = togglePlane(slots, 2);
  assert.deepEqual(cuttingPlaneIds(slots), [1, 2, 3]);
});

test('flipping a slot changes only that slot', () => {
  const slots = setPlaneFlipped(togglePlane(emptySlots(), 2), 2, true);
  assert.equal(slots[2].flipped, true);
  assert.equal(slots[1].flipped, false);
  assert.equal(slots[3].flipped, false);
  // and does not disturb visibility or cutting
  assert.equal(slots[2].visible, true);
  assert.equal(slots[2].cutting, true);
});

test('the reducers never mutate the slots they are given', () => {
  // They feed React state. An in-place edit would render stale.
  const original = emptySlots();
  const snapshot = JSON.parse(JSON.stringify(original));
  togglePlane(original, 1);
  setPlaneFlipped(original, 1, true);
  assert.deepEqual(original, snapshot);
});

test('isClipped rejects a point behind any one plane', () => {
  // Three planes clip by intersection: surviving geometry must be on the kept side of ALL of
  // them. The raycast guards must agree with the renderer or pins land on invisible geometry.
  const x = planeForPose(defaultPoseFor(1, BOX)); // keeps x <= 0
  const y = planeForPose(defaultPoseFor(2, BOX)); // keeps y <= 0
  const planes = [x, y];

  assert.equal(isClipped(planes, new THREE.Vector3(-0.5, -0.5, 0)), false);
  assert.equal(isClipped(planes, new THREE.Vector3(0.5, -0.5, 0)), true, 'x half not clipped');
  assert.equal(isClipped(planes, new THREE.Vector3(-0.5, 0.5, 0)), true, 'y half not clipped');
  assert.equal(isClipped(planes, new THREE.Vector3(0.5, 0.5, 0)), true);
});

test('isClipped with no planes clips nothing', () => {
  assert.equal(isClipped([], new THREE.Vector3(9, 9, 9)), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/tests/crossSection.test.mjs`
Expected: FAIL. Every test errors at import with `SyntaxError: The requested module '../../lib/crossSection.ts' does not provide an export named 'SECTION_PLANE_IDS'`.

- [ ] **Step 3: Rewrite `lib/crossSection.ts`**

Replace the entire contents with:

```typescript
import * as THREE from 'three';

/**
 * Cross-section of a 3D model: up to three planes you can see, move and rotate.
 *
 * Only the FLAGS live here and in React state. A plane's position and rotation live solely on
 * its Object3D in the scene — `TransformControls` mutates that object directly during a drag
 * without going through React, and R3F's prop diffing compares against the previous prop
 * rather than the object's real state, so a React-held pose would need a hand-written re-apply
 * effect per plane (see the one ModelViewerInner already carries for the object transform).
 * Since poses are session-only and never displayed as numbers, React does not need them at
 * all: the frame loop reads world matrices straight off the widgets.
 */

/** The three fixed slots, as shown on the panel. There is no fourth. */
export type PlaneId = 1 | 2 | 3;

export const SECTION_PLANE_IDS: readonly PlaneId[] = [1, 2, 3];

export const MAX_SECTION_PLANES = SECTION_PLANE_IDS.length;

export interface PlaneSlot {
  /** The numbered button: whether the plane and its gizmo are drawn. */
  visible: boolean;
  /**
   * True from the first time this slot is switched on, and cleared only when the whole tool
   * is switched off. A hidden slot that is still cutting is the point of the design: the
   * numbered buttons hide the WIDGET so the cut can be seen unobstructed.
   */
  cutting: boolean;
  /** Which half of the model survives. */
  flipped: boolean;
}

export type SectionSlots = Record<PlaneId, PlaneSlot>;

/** Axis-aligned bounds in the model's own frame, before the placement transform. */
export interface ModelBox {
  min: [number, number, number];
  max: [number, number, number];
}

/** A plane's starting placement, applied once on mount and owned by the scene thereafter. */
export interface PlanePose {
  position: [number, number, number];
  rotation: [number, number, number];
}

/**
 * Three independent idle slots.
 *
 * A function rather than a shared constant on purpose: three references to one frozen-by-
 * convention literal would let a careless mutation of slot 1 silently change 2 and 3 too.
 */
export function emptySlots(): SectionSlots {
  return {
    1: { visible: false, cutting: false, flipped: false },
    2: { visible: false, cutting: false, flipped: false },
    3: { visible: false, cutting: false, flipped: false },
  };
}

/**
 * Where a slot's plane starts: centred on the model, facing X, Y or Z by slot number.
 *
 * Centred and not at an edge for the same reason the old slider defaulted to the middle — a
 * plane placed at the model's extreme clips nothing, so the tool would look broken the first
 * time anyone switched it on.
 *
 * The widget's geometry is a `PlaneGeometry`, which lies in local XY with its normal down
 * local +Z, so these rotations swing +Z onto each world axis in turn. The axis is a starting
 * pose only and carries no lasting identity: rotate the plane and it is still slot 1.
 */
export function defaultPoseFor(id: PlaneId, box: ModelBox): PlanePose {
  const position: [number, number, number] = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];

  // +Z onto +X, +Z onto +Y, +Z left alone.
  const rotation: [number, number, number] =
    id === 1 ? [0, Math.PI / 2, 0] : id === 2 ? [-Math.PI / 2, 0, 0] : [0, 0, 0];

  return { position, rotation };
}

/** Show or hide a slot's plane. Switching one on for the first time starts it cutting. */
export function togglePlane(slots: SectionSlots, id: PlaneId): SectionSlots {
  const slot = slots[id];
  const visible = !slot.visible;
  return { ...slots, [id]: { ...slot, visible, cutting: slot.cutting || visible } };
}

export function setPlaneFlipped(slots: SectionSlots, id: PlaneId, flipped: boolean): SectionSlots {
  return { ...slots, [id]: { ...slots[id], flipped } };
}

/**
 * The slots currently clipping the model, in slot order.
 *
 * Order is fixed rather than insertion-ordered because the caller rebuilds its `THREE.Plane`
 * array from this list, and changing the NUMBER of clipping planes on a material recompiles
 * its shader. A list that reordered itself would churn that for nothing.
 */
export function cuttingPlaneIds(slots: SectionSlots): PlaneId[] {
  return SECTION_PLANE_IDS.filter((id) => slots[id].cutting);
}

/**
 * Rewrites `target` as the world-space clipping plane for a widget's world matrix.
 *
 * three keeps whatever lies on a plane's positive side, so an unflipped plane points its
 * normal down local -Z: keep everything behind the quad's facing direction.
 *
 * Mutates and returns `target` rather than allocating, because this runs once per plane per
 * frame and because the array handed to the materials has to keep its instances — see
 * `setClippingPlanes` on why that array must not be rebuilt.
 *
 * Pass `normalMatrix` to reuse a scratch Matrix3; `Plane.applyMatrix4` allocates one per call
 * otherwise.
 */
export function writePlaneFromMatrix(
  target: THREE.Plane,
  matrix: THREE.Matrix4,
  flipped: boolean,
  normalMatrix?: THREE.Matrix3,
): THREE.Plane {
  target.normal.set(0, 0, flipped ? 1 : -1);
  target.constant = 0;
  if (normalMatrix) {
    normalMatrix.getNormalMatrix(matrix);
    return target.applyMatrix4(matrix, normalMatrix);
  }
  return target.applyMatrix4(matrix);
}

/**
 * Whether `point` is on the hidden side of ANY plane — i.e. whether the renderer clipped it.
 *
 * three's raycaster ignores clipping entirely, so the hidden geometry stays fully hittable.
 * Both raycasts in the viewer (comment-pin drops, orbit-pivot anchoring) reject hits with
 * this, and both must agree with the renderer: several planes clip by intersection, so
 * surviving geometry is on the kept side of all of them.
 */
export function isClipped(planes: readonly THREE.Plane[], point: THREE.Vector3): boolean {
  for (const plane of planes) {
    if (plane.distanceToPoint(point) < 0) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/tests/crossSection.test.mjs`
Expected: PASS, 22 tests, 0 failures.

Note: `npx tsc --noEmit` will now report errors in `ModelViewerInner.tsx`, `ViewerContainer.tsx`, `CrossSectionControl.tsx` and `app/portal/[id]/page.tsx`, which still import `CrossSection`, `DEFAULT_CROSS_SECTION`, `SECTION_AXES` and `planeForSection`. That is expected and is cleared by Tasks 3, 5 and 6. Do not chase it here.

- [ ] **Step 5: Commit**

```bash
git add lib/crossSection.ts scripts/tests/crossSection.test.mjs
git commit -m "feat(viewer): three-slot cross-section plane model"
```

---

### Task 2: The visible plane widget

One translucent quad per cutting slot, with a border, hover and selected states, and a click
that selects it. It is the object the gizmo grabs and the object the frame loop reads.

**Files:**
- Create: `components/viewers/section/SectionPlaneWidget.tsx`

**Interfaces:**
- Consumes: `PlaneId`, `PlanePose` from `lib/crossSection` (Task 1).
- Produces: default export
  `SectionPlaneWidget({ id, pose, size, visible, selected, objectRef, onSelect }: { id: PlaneId; pose: PlanePose; size: number; visible: boolean; selected: boolean; objectRef: (id: PlaneId, object: THREE.Group | null) => void; onSelect: (id: PlaneId) => void })`

- [ ] **Step 1: Write the component**

Create `components/viewers/section/SectionPlaneWidget.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { PlaneId, PlanePose } from '@/lib/crossSection';

// stiko-primary and stiko-muted, hard-coded because three takes colours as numbers and
// cannot read Tailwind tokens. Keep in step with tailwind.config.ts.
const SELECTED_COLOUR = '#5B60FF';
const IDLE_COLOUR = '#8A90A6';

/**
 * One cross-section plane, as an object in the scene.
 *
 * The pose is applied ONCE, on mount, and the scene owns it from then on: `TransformControls`
 * drags this group directly, and re-applying `position`/`rotation` as R3F props on every
 * render would fight the drag. That is why they are set in an effect with an empty dependency
 * list rather than passed to <group>.
 *
 * Consequently this component must NOT be unmounted when the plane is hidden — hiding sets
 * `visible` on the group instead. Unmounting would throw the pose away, and switching the
 * button back on would silently move the cut back to the centre of the model.
 */
export default function SectionPlaneWidget({
  id,
  pose,
  size,
  visible,
  selected,
  objectRef,
  onSelect,
}: {
  id: PlaneId;
  pose: PlanePose;
  /** Edge length of the quad. Sized to span the model whatever angle it is turned to. */
  size: number;
  visible: boolean;
  selected: boolean;
  /** Registers this widget's group with the parent, which reads its world matrix per frame. */
  objectRef: (id: PlaneId, object: THREE.Group | null) => void;
  onSelect: (id: PlaneId) => void;
}) {
  const group = useRef<THREE.Group>(null);

  useEffect(() => {
    const object = group.current;
    if (!object) return;
    object.position.set(pose.position[0], pose.position[1], pose.position[2]);
    object.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2]);
    objectRef(id, object);
    return () => objectRef(id, null);
    // Mount only. `pose` is a starting placement, not a live binding — see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const colour = selected ? SELECTED_COLOUR : IDLE_COLOUR;

  return (
    <group
      ref={group}
      visible={visible}
      // Interaction furniture, not part of the design being reviewed: renderCleanFrame hides
      // everything carrying this flag before capturing an annotation snapshot. Same marker
      // TransformGizmo sets on its handles.
      userData={{ excludeFromSnapshot: true }}
      onClick={(e) => {
        // Without this, the click continues to the model's own deselect handler underneath
        // and the plane is selected and deselected in the same event.
        e.stopPropagation();
        onSelect(id);
      }}
    >
      <mesh>
        <planeGeometry args={[size, size]} />
        {/* DoubleSide because you will orbit past it; depthWrite off so the translucent
            quad does not punch a hole in the model behind it. */}
        <meshBasicMaterial
          color={colour}
          transparent
          opacity={selected ? 0.16 : 0.09}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* A border, so an edge-on plane is still findable and clickable. */}
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(size, size)]} />
        <lineBasicMaterial color={colour} transparent opacity={selected ? 0.9 : 0.5} />
      </lineSegments>
    </group>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit 2>&1 | grep SectionPlaneWidget`
Expected: no output. (Errors elsewhere from Task 1 are still present and expected.)

- [ ] **Step 3: Commit**

```bash
git add components/viewers/section/SectionPlaneWidget.tsx
git commit -m "feat(viewer): visible cross-section plane widget"
```

---

### Task 3: Multi-plane clipping and the raycast guards

`ApplyCrossSection` moves out of `ModelViewerInner.tsx` into `components/viewers/section/`,
grows from one plane to three, and the single `clipPlaneRef` becomes an array that both
raycast guards consult.

**Files:**
- Create: `components/viewers/section/ApplyCrossSection.tsx`
- Modify: `components/viewers/ModelViewerInner.tsx` — delete the old `ApplyCrossSection` (lines ~404–456), change `clipPlaneRef` to `clipPlanesRef`, mount widgets
- Modify: `components/viewers/ViewerNavigation.tsx` — the guard at ~line 86

**Interfaces:**
- Consumes: `cuttingPlaneIds`, `writePlaneFromMatrix`, `isClipped`, `SectionSlots`, `PlaneId` (Task 1); `SectionPlaneWidget` (Task 2).
- Produces: default export
  `ApplyCrossSection({ slots, modelRef, planeObjects, planesRef }: { slots: SectionSlots; modelRef: React.RefObject<THREE.Object3D>; planeObjects: React.MutableRefObject<Map<PlaneId, THREE.Group>>; planesRef: React.MutableRefObject<THREE.Plane[]> })`

- [ ] **Step 1: Write `ApplyCrossSection`**

Create `components/viewers/section/ApplyCrossSection.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { setClippingPlanes } from '@/lib/threeMaterials';
import { cuttingPlaneIds, writePlaneFromMatrix, type PlaneId, type SectionSlots } from '@/lib/crossSection';

/**
 * Clips the model to every cutting plane.
 *
 * The planes are rewritten from the widgets' world matrices every FRAME rather than on prop
 * change: TransformControls mutates a widget directly while dragging without going through
 * React, so a change-driven sync would leave the cut lagging behind the plane mid-drag. Same
 * reason the single-plane version did it, for the same reason.
 *
 * The array handed to the materials keeps its identity for as long as the SET of cutting
 * planes is unchanged. Changing the number of clipping planes on a material recompiles its
 * shader; changing a plane's values does not. Unlike the single-plane tool the count really
 * does vary here, so the array is rebuilt — but only when a slot starts or stops cutting,
 * never per frame.
 */
export default function ApplyCrossSection({
  slots,
  modelRef,
  planeObjects,
  planesRef,
}: {
  slots: SectionSlots;
  modelRef: React.RefObject<THREE.Object3D>;
  /** Widget groups, registered by SectionPlaneWidget as they mount. */
  planeObjects: React.MutableRefObject<Map<PlaneId, THREE.Group>>;
  /** Written here, read by the two raycast guards. */
  planesRef: React.MutableRefObject<THREE.Plane[]>;
}) {
  const ids = cuttingPlaneIds(slots);
  // A primitive key, so the memo below survives a slots object rebuilt by an unrelated flag
  // change — flipping a plane must not recompile every material's shader.
  const key = ids.join(',');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const planes = useMemo(() => ids.map(() => new THREE.Plane()), [key]);
  const normalMatrix = useRef(new THREE.Matrix3());

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;

    setClippingPlanes(model, planes.length > 0 ? planes : null);
    planesRef.current = planes;

    // useLoader caches loader results, so glTF/OBJ materials are shared and outlive this
    // viewer. STL and PLY are worse: they render with module-level singleton materials shared
    // by every STL/PLY opened in the session and never disposed — so a missed cleanup here
    // does not just linger in this file, it clips every STL/PLY opened afterwards too, with
    // no control on screen to explain it and no way back short of a reload.
    return () => {
      setClippingPlanes(model, null);
      planesRef.current = [];
    };
  }, [planes, modelRef, planesRef]);

  useFrame(() => {
    for (let i = 0; i < ids.length; i++) {
      const object = planeObjects.current.get(ids[i]);
      if (!object) continue;
      writePlaneFromMatrix(planes[i], object.matrixWorld, slots[ids[i]].flipped, normalMatrix.current);
    }
  });

  return null;
}
```

- [ ] **Step 2: Delete the old `ApplyCrossSection` from `ModelViewerInner.tsx`**

Remove the whole function — its doc comment through its closing brace, currently lines ~404
to ~456, beginning `/**\n * Clips the model to a single plane.` and ending with the
`return null;\n}` that follows its `useFrame`. Also remove the now-unused import on line 14
of `setClippingPlanes` (keep `makeDoubleSided`) and the `planeForSection` import on line 20.

Line 20 becomes:

```typescript
import { cuttingPlaneIds, defaultPoseFor, emptySlots, isClipped, type ModelBox, type PlaneId, type SectionSlots } from '@/lib/crossSection';
```

Line 14 becomes:

```typescript
import { makeDoubleSided } from '@/lib/threeMaterials';
```

- [ ] **Step 3: Swap `clipPlaneRef` for `clipPlanesRef` in `ModelViewerInner.tsx`**

In `SceneInteraction`'s props type, replace:

```typescript
  clipPlaneRef: React.MutableRefObject<THREE.Plane | null>;
```

with:

```typescript
  clipPlanesRef: React.MutableRefObject<THREE.Plane[]>;
```

and rename the destructured prop from `clipPlaneRef` to `clipPlanesRef`.

In `handlePointerDown`, replace:

```typescript
        const clip = clipPlaneRef.current;
        if (clip && clip.distanceToPoint(hit.point) < 0) continue;
```

with:

```typescript
        // Several planes clip by intersection, so a hit survives only if it is on the kept
        // side of all of them.
        if (isClipped(clipPlanesRef.current, hit.point)) continue;
```

and change the dependency array's last entry from `clipPlaneRef` to `clipPlanesRef`.

In `ModelViewerInner` itself, replace the declaration:

```typescript
  const clipPlaneRef = useRef<THREE.Plane | null>(null);
```

with:

```typescript
  // Written by ApplyCrossSection, read by the raycast guards in SceneInteraction (pin drops)
  // and ViewerNavigation (orbit anchoring). three's raycaster ignores clipping planes, so both
  // have to reject hits on the hidden halves by hand. Empty when nothing is cutting.
  const clipPlanesRef = useRef<THREE.Plane[]>([]);
  // Widget groups, keyed by slot. ApplyCrossSection reads their world matrices each frame and
  // TransformGizmo targets whichever one is selected.
  const planeObjects = useRef<Map<PlaneId, THREE.Group>>(new Map());
  const registerPlaneObject = useCallback((id: PlaneId, object: THREE.Group | null) => {
    if (object) planeObjects.current.set(id, object);
    else planeObjects.current.delete(id);
  }, []);
```

Update both call sites that pass it — `<ViewerNavigation clipPlaneRef={clipPlaneRef} />` and
`<SceneInteraction clipPlaneRef={clipPlaneRef} />` — to `clipPlanesRef={clipPlanesRef}`.

- [ ] **Step 4: Update `ViewerNavigation.tsx`**

Change the prop type on line 15 from:

```typescript
  clipPlaneRef: React.MutableRefObject<THREE.Plane | null>;
```

to:

```typescript
  /** The live cross-section planes, empty when nothing is cutting. Written by ApplyCrossSection. */
  clipPlanesRef: React.MutableRefObject<THREE.Plane[]>;
```

Rename the destructured parameter on line 47 to `clipPlanesRef`. Replace the guard body:

```typescript
      const clip = clipPlaneRef.current;
      for (const hit of hits) {
        if (!(hit.object instanceof THREE.Mesh || hit.object instanceof THREE.SkinnedMesh)) continue;
        if (clip && clip.distanceToPoint(hit.point) < 0) continue;
```

with:

```typescript
      const clipped = clipPlanesRef.current;
      for (const hit of hits) {
        if (!(hit.object instanceof THREE.Mesh || hit.object instanceof THREE.SkinnedMesh)) continue;

        // three's raycaster ignores clipping planes entirely, so the halves a cross-section
        // hides stay fully hittable. Without this, orbiting into an opened cavity pivots about
        // invisible geometry sitting in front of everything the user can actually see. Several
        // planes clip by intersection — same guard, same reason, as SceneInteraction's
        // pin-drop raycast.
        if (isClipped(clipped, hit.point)) continue;
```

Add the import at the top of the file:

```typescript
import { isClipped } from '@/lib/crossSection';
```

and change the `useCallback` dependency `clipPlaneRef` to `clipPlanesRef`.

- [ ] **Step 5: Mount the widgets and the new `ApplyCrossSection` in `ModelViewerInner.tsx`**

Change the prop on `ModelViewerInnerProps` from:

```typescript
  /** Null when the model is not sectioned. */
  crossSection?: CrossSection | null;
```

to:

```typescript
  /** Per-slot cross-section flags. Every slot idle means the model is not sectioned. */
  sectionSlots?: SectionSlots;
  /** Which plane the Move/Rotate gizmo targets, or null for none. */
  selectedPlane?: PlaneId | null;
  onSelectPlane?: (id: PlaneId | null) => void;
```

and the destructured default from `crossSection = null,` to:

```typescript
  sectionSlots,
  selectedPlane = null,
  onSelectPlane,
```

Immediately after `const safeTransform = ...`, add:

```typescript
  // A stable idle default, so a caller that omits the prop does not hand a fresh object to
  // ApplyCrossSection on every render.
  const idleSlots = useMemo(() => emptySlots(), []);
  const slots = sectionSlots ?? idleSlots;
```

Replace the whole `{bounds && (<ApplyCrossSection … />)}` block with:

```tsx
          {bounds && (
            // A url-derived key, so a model change forces a remount: the cleanup clears
            // clippingPlanes from the materials under modelRef, but nothing in the effect
            // tracks which model modelRef points at, and remounting guarantees the cleanup
            // runs against the model it applied to before modelRef can be pointing at a
            // different one. The `section-` prefix is not decoration — MeasureModel is a
            // sibling in this same children array and keyed off the same url, so a bare
            // `key={url}` gave the two the same key. React then treats them as one slot: it
            // warns, and it was seen once in eight model switches to commit the new model's
            // geometry while leaving minDistance/maxDistance/near/far on the previous model's
            // values, which ViewerNavigation reads live as its clamp and step size.
            <ApplyCrossSection
              key={`section-${url}`}
              slots={slots}
              modelRef={modelRef}
              planeObjects={planeObjects}
              planesRef={clipPlanesRef}
            />
          )}
```

Inside the `<group ref={transformRef}>`, after the closing `</Center>`, add the widgets. They
are children of the transform group and siblings of `<Center>`, which puts them in the same
frame `MeasureModel` measures `bounds.box` in — so a pose at the box centre lands on the
model's centre, and a saved object placement carries the cuts with it.

```tsx
            {bounds &&
              cuttingPlaneIds(slots).map((id) => (
                <SectionPlaneWidget
                  // Keyed by url as well as slot: a new model must get a fresh pose from the
                  // new bounding box, and the pose is applied on mount only.
                  key={`plane-${url}-${id}`}
                  id={id}
                  pose={defaultPoseFor(id, bounds.box)}
                  // Big enough to span the model at any angle, with room to grab past the edge.
                  size={bounds.radius * 2.6}
                  visible={slots[id].visible}
                  selected={selectedPlane === id}
                  objectRef={registerPlaneObject}
                  onSelect={(next) => onSelectPlane?.(next)}
                />
              ))}
```

Add the imports:

```typescript
import ApplyCrossSection from './section/ApplyCrossSection';
import SectionPlaneWidget from './section/SectionPlaneWidget';
```

- [ ] **Step 6: Verify the existing suite still passes and the viewer files typecheck**

Run: `npm test`
Expected: PASS, all files, 0 failures.

Run: `npx tsc --noEmit 2>&1 | grep -E "ModelViewerInner|ViewerNavigation|ApplyCrossSection|SectionPlaneWidget"`
Expected: no output. Errors remaining in `ViewerContainer.tsx`, `CrossSectionControl.tsx` and `app/portal/[id]/page.tsx` are expected until Tasks 5 and 6.

- [ ] **Step 7: Commit**

```bash
git add components/viewers/section/ApplyCrossSection.tsx components/viewers/ModelViewerInner.tsx components/viewers/ViewerNavigation.tsx
git commit -m "feat(viewer): clip the model with up to three plane widgets"
```

---

### Task 4: Gizmo retargeting and disabled transform buttons

`TransformGizmo` currently hard-targets the model's transform group and always commits an
`ObjectTransform`. It gains an arbitrary target and an optional commit, so a plane can be
dragged with nothing persisted. It also reports whether a drag is in progress, which Task 6
needs to stop a gizmo drag from being read as a click on empty space.

**Files:**
- Modify: `components/viewers/TransformGizmo.tsx`
- Modify: `components/viewers/TransformTools.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `TransformGizmo({ target, mode, onCommit, draggingRef }: { target: THREE.Object3D; mode: 'translate' | 'rotate'; onCommit?: (transform: ObjectTransform) => void; draggingRef?: React.MutableRefObject<boolean> })` — note `target` is now the object itself, not a ref.
  - `TransformTools({ mode, onModeChange, disabled, disabledReason }: { mode: TransformMode; onModeChange: (mode: TransformMode) => void; disabled?: boolean; disabledReason?: string })`
  - `ViewportToolButton` gains optional `disabled?: boolean` and `title?: string`.

- [ ] **Step 1: Rewrite `TransformGizmo.tsx`**

Replace the component signature and body below the existing doc comment. The full file:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import type { ObjectTransform } from '@/lib/objectTransform';

/**
 * Move/rotate handles for whatever object is handed in — the loaded model, or one
 * cross-section plane.
 *
 * `onCommit` is optional because the two targets differ in exactly one way: the model's
 * placement is persisted on release, while a plane's pose is session-only and read straight
 * off the scene graph by the frame loop, so there is nothing to write anywhere.
 *
 * Only ever mounted for a role that may transform. That is presentation, not enforcement:
 * the PATCH route is the actual boundary.
 */
export default function TransformGizmo({
  target,
  mode,
  onCommit,
  draggingRef,
}: {
  target: THREE.Object3D;
  mode: 'translate' | 'rotate';
  onCommit?: (transform: ObjectTransform) => void;
  /**
   * Set true for the duration of a drag. drei's TransformControls does not stop pointer-event
   * propagation, so without this a drag on a gizmo handle reaches R3F as a click that hit
   * nothing — and the caller's "clicked empty space" handler deselects the very plane being
   * dragged.
   */
  draggingRef?: React.MutableRefObject<boolean>;
}) {
  const defaultControls = useThree((state) => state.controls);
  const controlsRef = useRef<TransformControlsImpl>(null);

  useEffect(() => {
    return () => {
      // drei disables the orbit controls for the duration of a drag and re-enables them from
      // a 'dragging-changed' listener it removes on unmount — without ever firing a final
      // false. Unmounting mid-drag would otherwise leave orbiting disabled for the session.
      const orbit = defaultControls as unknown as { enabled?: boolean } | null;
      if (orbit && typeof orbit.enabled === 'boolean') orbit.enabled = true;
      // Same hazard for the drag flag: unmount mid-drag and it would stay stuck true, and
      // clicks would stop deselecting for the rest of the session.
      if (draggingRef) draggingRef.current = false;
    };
  }, [defaultControls, draggingRef]);

  useEffect(() => {
    // Marked rather than special-cased by name so renderCleanFrame stays generic: these are
    // interaction handles, not part of the design being reviewed, and must never be baked
    // into an annotation snapshot.
    const controls = controlsRef.current;
    if (controls) controls.userData.excludeFromSnapshot = true;
    return () => {
      // R3F never auto-disposes a <primitive>, and drei only detaches — so without this every
      // toggle of the tool leaks an instance with its own geometries, materials and canvas
      // pointer listeners.
      controls?.dispose?.();
    };
  }, []);

  return (
    <TransformControls
      ref={controlsRef}
      object={target}
      mode={mode}
      onObjectChange={() => {
        if (draggingRef) draggingRef.current = true;
      }}
      // Auto-save on release. drei suspends the default OrbitControls for the duration
      // of a drag, so orbiting and dragging cannot fight each other.
      onMouseUp={() => {
        if (onCommit) {
          // Euler XYZ to match how the columns are read and written.
          const euler = new THREE.Euler().setFromQuaternion(target.quaternion, 'XYZ');
          onCommit({
            position: [target.position.x, target.position.y, target.position.z],
            rotation: [euler.x, euler.y, euler.z],
          });
        }
        // Cleared a tick late, so the click event that follows this pointerup — which is what
        // would otherwise deselect — still sees the drag.
        if (draggingRef) setTimeout(() => { draggingRef.current = false; }, 0);
      }}
    />
  );
}
```

Note the `if (!targetRef.current) return null;` guard is gone: the caller now passes a
resolved `Object3D`, so there is nothing to guard.

- [ ] **Step 2: Update the model's call site in `ModelViewerInner.tsx`**

Replace:

```tsx
        {transformMode && onTransformCommit && bounds && (
          <TransformGizmo
            targetRef={transformRef}
            mode={transformMode}
            onCommit={onTransformCommit}
          />
        )}
```

with:

```tsx
        {/* Two mutually exclusive targets. With a plane selected the gizmo drives that plane
            and commits nothing — a plane's pose is session-only. Otherwise it drives the
            model's placement, which is persisted. The page guarantees a plane can only be
            selected while the cross-section tool is open, which is when object placement is
            deliberately unavailable. */}
        {transformMode && bounds && selectedPlane !== null && planeObjects.current.get(selectedPlane) && (
          <TransformGizmo
            key={`plane-gizmo-${selectedPlane}`}
            target={planeObjects.current.get(selectedPlane)!}
            mode={transformMode}
            draggingRef={gizmoDraggingRef}
          />
        )}
        {transformMode && onTransformCommit && bounds && selectedPlane === null && transformRef.current && (
          <TransformGizmo
            target={transformRef.current}
            mode={transformMode}
            onCommit={onTransformCommit}
            draggingRef={gizmoDraggingRef}
          />
        )}
```

and declare the shared drag flag next to `planeObjects`:

```typescript
  const gizmoDraggingRef = useRef(false);
```

- [ ] **Step 3: Add a disabled state to `ViewportToolButton.tsx`**

Add `disabled` and `title` to the props type and pass them through. The button's `className`
gains a disabled branch, and the hover-lift and hover-tint classes must not apply when
disabled:

```tsx
export default function ViewportToolButton({
  label,
  active,
  onClick,
  disabled = false,
  title,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** Hover text when the button is unavailable, explaining why. */
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative flex">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        aria-disabled={disabled}
        disabled={disabled}
        onClick={onClick}
        className={`relative flex h-[34px] w-[34px] items-center justify-center rounded-[11px] border shadow-stiko-panel transition-all duration-150 ${
          disabled
            ? 'cursor-not-allowed border-stiko-border bg-white text-stiko-ghost'
            : active
              ? 'border-stiko-primary-light bg-stiko-tint text-stiko-primary hover:scale-[1.12] hover:z-10 hover:shadow-[0_5px_12px_-3px_rgba(28,32,48,0.22)]'
              : 'border-stiko-border bg-white text-stiko-secondary hover:scale-[1.12] hover:z-10 hover:shadow-[0_5px_12px_-3px_rgba(28,32,48,0.22)] hover:bg-[#F8EDFC] hover:border-stiko-border-strong'
        }`}
      >
        {children}
      </button>

      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-[9px] -translate-x-1/2 whitespace-nowrap rounded-[7px] bg-stiko-ink px-2 py-[3px] text-[11px] font-medium leading-none tracking-heading text-white opacity-0 shadow-stiko-sheet transition-opacity duration-100 group-hover:opacity-100">
        {disabled && title ? title : label}
      </span>
    </div>
  );
}
```

Keep the rest of the file — the doc comment above the component — unchanged.

- [ ] **Step 4: Add the disabled pass-through to `TransformTools.tsx`**

Change the signature and both buttons:

```tsx
export default function TransformTools({
  mode,
  onModeChange,
  disabled = false,
  disabledReason,
}: {
  mode: TransformMode;
  onModeChange: (mode: TransformMode) => void;
  /** True while the cross-section tool is open with no plane selected — nothing to move. */
  disabled?: boolean;
  disabledReason?: string;
}) {
  // Clicking the active tool turns it off, so neither is a trap with no way back to plain
  // orbiting.
  const toggle = (next: Exclude<TransformMode, null>) =>
    onModeChange(mode === next ? null : next);

  return (
    <>
      <ViewportToolButton
        label="Move"
        active={mode === 'translate'}
        disabled={disabled}
        title={disabledReason}
        onClick={() => toggle('translate')}
      >
        {MoveIcon}
      </ViewportToolButton>

      <ViewportToolButton
        label="Rotate"
        active={mode === 'rotate'}
        disabled={disabled}
        title={disabledReason}
        onClick={() => toggle('rotate')}
      >
        {RotateIcon}
      </ViewportToolButton>
    </>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -E "TransformGizmo|TransformTools|ViewportToolButton"`
Expected: no output.

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add components/viewers/TransformGizmo.tsx components/viewers/TransformTools.tsx components/viewers/ViewportToolButton.tsx components/viewers/ModelViewerInner.tsx
git commit -m "feat(viewer): retarget the transform gizmo at a cross-section plane"
```

---

### Task 5: The Planes panel

`CrossSectionControl` loses its popover entirely and becomes the master chip alone. A new
sibling renders the inline `Planes 1 2 3` panel that sits immediately to its left in the same
row, at the same height as the tool chips.

**Files:**
- Modify (full rewrite): `components/viewers/CrossSectionControl.tsx`
- Create: `components/viewers/section/PlanesPanel.tsx`

**Interfaces:**
- Consumes: `SECTION_PLANE_IDS`, `PlaneId`, `SectionSlots` (Task 1).
- Produces:
  - `CrossSectionControl({ active, onToggle }: { active: boolean; onToggle: () => void })`
  - `PlanesPanel({ slots, selected, onToggle, onFlip }: { slots: SectionSlots; selected: PlaneId | null; onToggle: (id: PlaneId) => void; onFlip: (id: PlaneId) => void })`

- [ ] **Step 1: Rewrite `CrossSectionControl.tsx`**

Replace the entire contents with:

```tsx
'use client';

import ViewportToolButton from './ViewportToolButton';
import { SliceIcon } from './viewportToolIcons';

/**
 * The cross-section master toggle.
 *
 * On opens the tool and reveals the Planes panel beside it; off discards every plane and
 * every cut and returns the model to its whole shape. It is the ONLY control that removes a
 * cut — the numbered buttons in the panel hide plane widgets, they do not un-cut.
 *
 * Deliberately holds no state and renders no panel of its own: the panel is a sibling in the
 * viewport's tool row, not a popover anchored to this button.
 */
export default function CrossSectionControl({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <ViewportToolButton label="Cross-section" active={active} onClick={onToggle}>
      {SliceIcon}
    </ViewportToolButton>
  );
}
```

- [ ] **Step 2: Write `PlanesPanel.tsx`**

Create `components/viewers/section/PlanesPanel.tsx`:

```tsx
'use client';

import { SECTION_PLANE_IDS, type PlaneId, type SectionSlots } from '@/lib/crossSection';

/**
 * The `Planes 1 2 3` chip, inline in the viewport's tool row immediately left of the
 * cross-section button and at the same height as it.
 *
 * A numbered button toggles its plane's VISIBILITY. Switching one on for the first time
 * starts it cutting, and switching it off again leaves the cut in place — which is the whole
 * point, since it lets the cut be seen without the plane and its gizmo in the way. That
 * produces a state the button has to make legible: unlit, but still cutting. Those carry a
 * small filled dot, so a cut model with a dark button is never a mystery.
 *
 * The flip button appears only while a plane is selected and acts on that plane. Without it
 * the only way to change which half survives is a 180-degree gizmo rotation.
 */
export default function PlanesPanel({
  slots,
  selected,
  onToggle,
  onFlip,
}: {
  slots: SectionSlots;
  selected: PlaneId | null;
  onToggle: (id: PlaneId) => void;
  onFlip: (id: PlaneId) => void;
}) {
  const slot = (id: PlaneId) => {
    const { visible, cutting } = slots[id];
    const isSelected = selected === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => onToggle(id)}
        aria-pressed={visible}
        aria-label={`Plane ${id}`}
        title={
          visible ? `Hide plane ${id} (the cut stays)` : cutting ? `Show plane ${id}` : `Add plane ${id}`
        }
        className={`relative h-6 w-6 rounded-[8px] text-[11px] font-semibold transition-colors ${
          visible
            ? 'bg-stiko-tint text-stiko-primary'
            : 'text-stiko-muted hover:bg-stiko-tint'
        } ${isSelected ? 'ring-1 ring-stiko-primary-light' : ''}`}
      >
        {id}
        {/* Hidden, but still cutting. */}
        {!visible && cutting && (
          <span className="pointer-events-none absolute bottom-[3px] left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-stiko-primary" />
        )}
      </button>
    );
  };

  return (
    <div className="flex h-[34px] items-center gap-1 rounded-[11px] border border-stiko-border bg-white pl-2.5 pr-1.5 shadow-stiko-panel">
      <span className="mr-1 text-[11px] font-semibold leading-none tracking-heading text-stiko-ink">
        Planes
      </span>

      {SECTION_PLANE_IDS.map(slot)}

      {selected !== null && (
        <button
          type="button"
          onClick={() => onFlip(selected)}
          aria-pressed={slots[selected].flipped}
          aria-label={`Flip plane ${selected}`}
          title="Flip which half is kept"
          className={`ml-0.5 flex h-6 w-6 items-center justify-center rounded-[8px] transition-colors ${
            slots[selected].flipped
              ? 'bg-stiko-tint text-stiko-primary'
              : 'text-stiko-muted hover:bg-stiko-tint'
          }`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -E "CrossSectionControl|PlanesPanel"`
Expected: no output. `app/portal/[id]/page.tsx` and `ViewerContainer.tsx` still error; Task 6 clears them.

Run: `npm run lint`
Expected: no errors in the two files above.

- [ ] **Step 4: Commit**

```bash
git add components/viewers/CrossSectionControl.tsx components/viewers/section/PlanesPanel.tsx
git commit -m "feat(viewer): inline Planes panel, replacing the cross-section popover"
```

---

### Task 6: Wire it together

State moves into the page, the props cross `ViewerContainer`, and the feature becomes usable.
This is the task that makes the whole thing work end to end; capping is Task 7.

**Files:**
- Modify: `app/portal/[id]/page.tsx` — lines ~223–233 (state), ~337–339 (handler), ~611–635 (effects), ~863–865 (viewer props), ~983–990 (toolbar)
- Modify: `components/viewers/ViewerContainer.tsx` — lines 7, 35–38, 70, 137
- Modify: `components/viewers/ModelViewerInner.tsx` — add the deselect handlers

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: nothing consumed by later tasks except the running feature.

- [ ] **Step 1: Add the deselect handlers in `ModelViewerInner.tsx`**

Clicking the model, or clicking nothing, deselects the plane and disarms the gizmo. Add
`onClick` to the model group so a click on geometry is caught, and `onPointerMissed` on the
`<Canvas>` so a click on background is too.

On `<group ref={modelRef}>`, add:

```tsx
              <group
                ref={modelRef}
                onClick={() => {
                  // A gizmo drag reaches R3F as a click on nothing in particular — drei's
                  // TransformControls does not stop propagation — so a drag that happens to
                  // finish over the model would otherwise deselect the plane being dragged.
                  if (gizmoDraggingRef.current) return;
                  onSelectPlane?.(null);
                }}
              >
```

On `<Canvas>`, add:

```tsx
        onPointerMissed={() => {
          if (gizmoDraggingRef.current) return;
          onSelectPlane?.(null);
        }}
```

- [ ] **Step 2: Update `ViewerContainer.tsx`**

Line 7 becomes:

```typescript
import type { PlaneId, SectionSlots } from '@/lib/crossSection';
```

Replace the `crossSection` prop on line 38 with:

```typescript
  sectionSlots?: SectionSlots;
  selectedPlane?: PlaneId | null;
  onSelectPlane?: (id: PlaneId | null) => void;
```

In the destructure on line 70, replace `crossSection,` with
`sectionSlots, selectedPlane, onSelectPlane,`.

On line 137, replace `crossSection={crossSection}` with
`sectionSlots={sectionSlots} selectedPlane={selectedPlane} onSelectPlane={onSelectPlane}`.

- [ ] **Step 3: Replace the state in `app/portal/[id]/page.tsx`**

Replace lines ~229–233:

```typescript
  // Session only, like the focal length: a cut is a way of looking at the model, not a
  // property of the design. Null means not sectioned; the last cut is remembered in
  // `lastSection` so toggling the tool off and on does not throw away your position.
  const [crossSection, setCrossSection] = useState<CrossSection | null>(null);
  const lastSection = useRef<CrossSection>(DEFAULT_CROSS_SECTION);
```

with:

```typescript
  // Session only, like the focal length: a cut is a way of looking at the model, not a
  // property of the design. Nothing here is persisted, and nothing survives a file change.
  //
  // Only the FLAGS live here. Each plane's position and rotation live on its Object3D inside
  // the canvas and are never read back — see lib/crossSection for why.
  const [sectionActive, setSectionActive] = useState(false);
  const [sectionSlots, setSectionSlots] = useState<SectionSlots>(emptySlots);
  const [selectedPlane, setSelectedPlane] = useState<PlaneId | null>(null);
```

Update the import on line 23 from:

```typescript
import { DEFAULT_CROSS_SECTION, type CrossSection } from '@/lib/crossSection';
```

to:

```typescript
import { emptySlots, setPlaneFlipped, togglePlane, type PlaneId, type SectionSlots } from '@/lib/crossSection';
```

Add the import for the new panel next to the existing `CrossSectionControl` import:

```typescript
import PlanesPanel from '@/components/viewers/section/PlanesPanel';
```

- [ ] **Step 4: Replace the handler at lines ~337–339**

Replace:

```typescript
  const handleCrossSectionChange = useCallback((next: CrossSection | null) => {
    if (next) lastSection.current = next;
    setCrossSection(next);
  }, []);
```

with:

```typescript
  // The master toggle is the only control that removes a cut: switching the tool off clears
  // every slot, so `cutting` goes false everywhere and the model returns to its whole shape.
  const handleSectionToggle = useCallback(() => {
    if (!sectionActive) {
      setSectionActive(true);
      return;
    }
    setSectionActive(false);
    setSectionSlots(emptySlots());
    setSelectedPlane(null);
    setTransformMode(null);
  }, [sectionActive]);

  const handlePlaneToggle = useCallback((id: PlaneId) => {
    setSectionSlots((slots) => togglePlane(slots, id));
    // A hidden plane cannot be dragged, so hiding the selected one has to release it —
    // otherwise the gizmo hangs in mid-air over an invisible target. Read the CURRENT
    // visibility to know which way the toggle is going; deciding this inside the updater
    // would mean calling setState from a function React may invoke twice.
    if (sectionSlots[id].visible && selectedPlane === id) setSelectedPlane(null);
  }, [sectionSlots, selectedPlane]);

  const handlePlaneFlip = useCallback((id: PlaneId) => {
    setSectionSlots((slots) => setPlaneFlipped(slots, id, !slots[id].flipped));
  }, []);

  // Clicking a plane arms Move on it, per the tool's design: selection and the move gizmo are
  // one gesture. Switching to Rotate afterwards keeps the same plane.
  const handleSelectPlane = useCallback((id: PlaneId | null) => {
    setSelectedPlane(id);
    setTransformMode(id === null ? null : 'translate');
  }, []);
```

- [ ] **Step 5: Update the effects at lines ~611–635**

The transform/tool exclusion effect at ~611 stays as it is. Add the file-change resets:
replace `setCrossSection(null);` and `lastSection.current = DEFAULT_CROSS_SECTION;` in the
`[selectedFileId]` effect with:

```typescript
    setSectionActive(false);
    setSectionSlots(emptySlots());
    setSelectedPlane(null);
```

- [ ] **Step 6: Update the viewer props at line ~865**

Replace `crossSection={crossSection}` with:

```tsx
            sectionSlots={sectionSlots}
            selectedPlane={selectedPlane}
            onSelectPlane={handleSelectPlane}
```

- [ ] **Step 7: Replace the toolbar block at lines ~983–990**

```tsx
            {/* Planes panel, cross-section, move, rotate — one row of chips at even spacing,
                the panel inline immediately left of the button that opens it.

                Cross-section is a way of LOOKING at the model so everyone gets it; move and
                rotate change the design itself, so only a role that may transform sees them.
                That is why the permission gate is on the two buttons rather than the row:
                without a permission a viewer still gets the cross-section, alone.

                While the tool is open, Move and Rotate belong to planes and never to the
                object — the object's saved placement is editable only with the tool off. With
                nothing selected there is nothing for them to act on, so they are disabled and
                say why. */}
            {selectedFileId && is3DFile && !annotating && !viewportImage && (
              <div className="absolute bottom-3 right-3 z-20 flex items-end gap-2">
                {sectionActive && (
                  <PlanesPanel
                    slots={sectionSlots}
                    selected={selectedPlane}
                    onToggle={handlePlaneToggle}
                    onFlip={handlePlaneFlip}
                  />
                )}
                <CrossSectionControl active={sectionActive} onToggle={handleSectionToggle} />
                {canTransform && (
                  <TransformTools
                    mode={transformMode}
                    onModeChange={setTransformMode}
                    disabled={sectionActive && selectedPlane === null}
                    disabledReason="Select a plane"
                  />
                )}
              </div>
            )}
```

- [ ] **Step 8: Verify the whole project typechecks and the suite passes**

Run: `npx tsc --noEmit`
Expected: no output at all.

Run: `npm run lint`
Expected: no errors.

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 9: Commit**

```bash
git add app/portal/\[id\]/page.tsx components/viewers/ViewerContainer.tsx components/viewers/ModelViewerInner.tsx
git commit -m "feat(portal): wire up the three-plane cross-section tool"
```

---

### Task 7: Solid cut faces

Fills each cut with a solid face using the standard three.js stencil technique, so a section
reads like a machined cut rather than a hollow shell.

Two things are known and accepted going in, both recorded in the spec. The technique is
correct only on closed manifold geometry, and this viewer renders everything `DoubleSide`
precisely because uploaded models are routinely thin-walled or open — so caps will look right
on solid CAD parts and unreliable on open shells. And it costs two extra stencil draw calls
per mesh per plane. That is why every line of it is confined to this one file behind a single
flag: if it misbehaves on real models, `CAPS_ENABLED` goes false and the clipping path is
untouched.

**Files:**
- Create: `components/viewers/section/SectionCaps.tsx`
- Modify: `components/viewers/ModelViewerInner.tsx` — mount it

**Interfaces:**
- Consumes: `cuttingPlaneIds`, `PlaneId`, `SectionSlots` (Task 1); the `planeObjects` and
  `clipPlanesRef` refs (Task 3).
- Produces: default export
  `SectionCaps({ slots, modelRef, planeObjects, planesRef, size }: { slots: SectionSlots; modelRef: React.RefObject<THREE.Object3D>; planeObjects: React.MutableRefObject<Map<PlaneId, THREE.Group>>; planesRef: React.MutableRefObject<THREE.Plane[]>; size: number })`

- [ ] **Step 1: Write `SectionCaps.tsx`**

Create `components/viewers/section/SectionCaps.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { cuttingPlaneIds, type PlaneId, type SectionSlots } from '@/lib/crossSection';

/**
 * Solid faces where the cross-section planes cut the model.
 *
 * The single switch for the whole feature. Caps are a rendering nicety layered on top of the
 * clipping, never a part of it: set this false and the cuts still work exactly as before.
 *
 * Annotated `boolean` rather than left to infer the literal type `true`, so flipping it is a
 * one-character edit rather than one that makes TypeScript call every guard below unreachable.
 */
const CAPS_ENABLED: boolean = true;

const CAP_COLOUR = '#C6CDE8'; // stiko-dashed — a light neutral that reads as cut material.

/**
 * three's stencil capping, once per cutting plane.
 *
 * For each plane: draw the model's back faces incrementing the stencil buffer and its front
 * faces decrementing it, both clipped by that plane. Wherever the count is nonzero the plane
 * is inside solid material, so a quad drawn there — clipped by the OTHER planes, so it does
 * not spill past their cuts — fills the section. The stencil is cleared after each cap so the
 * three planes cannot contaminate each other.
 *
 * KNOWN LIMITATION, accepted deliberately. The count only balances on closed manifold
 * geometry, and this viewer renders everything DoubleSide because uploaded models are
 * routinely thin-walled or open — mesh seats, perforated shells, lofted surfaces, unclosed
 * CAD solids. Those cap wrong: stray filled regions rather than a clean face. Solid CAD, STEP
 * especially, is where this looks right. If it misbehaves on real models, set CAPS_ENABLED
 * false above and nothing else changes.
 *
 * COST. Two extra draw calls per mesh per plane, so 6N for three planes over N meshes. GLB
 * import already merges draw calls, which keeps N low for the common case.
 */
export default function SectionCaps({
  slots,
  modelRef,
  planeObjects,
  planesRef,
  size,
}: {
  slots: SectionSlots;
  modelRef: React.RefObject<THREE.Object3D>;
  planeObjects: React.MutableRefObject<Map<PlaneId, THREE.Group>>;
  planesRef: React.MutableRefObject<THREE.Plane[]>;
  /** Edge length of the cap quad. Must cover the model's whole cross-section. */
  size: number;
}) {
  const { gl } = useThree();
  const ids = cuttingPlaneIds(slots);
  const key = ids.join(',');

  const group = useRef<THREE.Group>(null);
  const caps = useRef<THREE.Mesh[]>([]);

  // Rebuilt only when the set of cutting planes changes — the stencil groups mirror the
  // model's geometry and are expensive to assemble.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stencilGroups = useMemo(() => ids.map(() => new THREE.Group()), [key]);

  useEffect(() => {
    if (!CAPS_ENABLED) return;
    const model = modelRef.current;
    const root = group.current;
    if (!model || !root) return;

    // One stencil group per plane, each a copy of every mesh in the model rendered with no
    // colour output — front faces and back faces separately, so their stencil ops cancel
    // wherever the plane is outside the solid.
    ids.forEach((id, i) => {
      const stencil = stencilGroups[i];
      const plane = planesRef.current[i];
      if (!plane) return;

      model.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;

        for (const side of [THREE.BackSide, THREE.FrontSide] as const) {
          const material = new THREE.MeshBasicMaterial();
          material.depthWrite = false;
          material.depthTest = false;
          material.colorWrite = false;
          material.stencilWrite = true;
          material.stencilFunc = THREE.AlwaysStencilFunc;
          material.side = side;
          material.clippingPlanes = [plane];
          material.stencilFail = side === THREE.BackSide ? THREE.IncrementWrapStencilOp : THREE.DecrementWrapStencilOp;
          material.stencilZFail = material.stencilFail;
          material.stencilZPass = material.stencilFail;

          const proxy = new THREE.Mesh(mesh.geometry, material);
          proxy.matrixAutoUpdate = false;
          proxy.userData.sourceMesh = mesh;
          proxy.userData.excludeFromSnapshot = false;
          proxy.renderOrder = i * 2 + 1;
          stencil.add(proxy);
        }
      });

      root.add(stencil);
    });

    return () => {
      for (const stencil of stencilGroups) {
        for (const child of [...stencil.children]) {
          const proxy = child as THREE.Mesh;
          // The geometry is the MODEL's and is not ours to dispose; the material is.
          (proxy.material as THREE.Material).dispose();
        }
        stencil.clear();
        stencil.removeFromParent();
      }
    };
    // Keyed on the SET of cutting planes, never on `ids` itself: cuttingPlaneIds returns a
    // fresh array every render, so listing it here would tear down and rebuild every stencil
    // group — a copy of the whole model — on each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stencilGroups, modelRef, planesRef]);

  // The cap quads themselves: drawn only where the stencil count is nonzero, clipped by every
  // OTHER plane so a cap cannot spill past a neighbouring cut.
  const capMaterials = useMemo(
    () =>
      ids.map((_, i) => {
        const material = new THREE.MeshBasicMaterial({ color: CAP_COLOUR, side: THREE.DoubleSide });
        material.stencilWrite = true;
        material.stencilRef = 0;
        material.stencilFunc = THREE.NotEqualStencilFunc;
        material.stencilFail = THREE.ReplaceStencilOp;
        material.stencilZFail = THREE.ReplaceStencilOp;
        material.stencilZPass = THREE.ReplaceStencilOp;
        material.userData.capIndex = i;
        return material;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => () => { for (const m of capMaterials) m.dispose(); }, [capMaterials]);

  useFrame(() => {
    if (!CAPS_ENABLED) return;
    // Keep each stencil proxy on its source mesh, and each cap quad on its plane. Done per
    // frame for the same reason the clipping planes are: a gizmo drag does not go through
    // React.
    for (let i = 0; i < ids.length; i++) {
      const stencil = stencilGroups[i];
      for (const child of stencil.children) {
        const proxy = child as THREE.Mesh;
        const source = proxy.userData.sourceMesh as THREE.Mesh | undefined;
        if (source) proxy.matrix.copy(source.matrixWorld);
      }

      const cap = caps.current[i];
      const object = planeObjects.current.get(ids[i]);
      if (cap && object) {
        cap.position.setFromMatrixPosition(object.matrixWorld);
        cap.quaternion.setFromRotationMatrix(object.matrixWorld);
        // Every plane except this one, so a cap stops at a neighbouring cut.
        (cap.material as THREE.Material).clippingPlanes = planesRef.current.filter((_, j) => j !== i);
      }
    }
  });

  if (!CAPS_ENABLED || ids.length === 0) return null;

  return (
    <group ref={group}>
      {ids.map((id, i) => (
        <mesh
          key={`cap-${id}`}
          ref={(mesh) => { if (mesh) caps.current[i] = mesh; }}
          renderOrder={i * 2 + 2}
          material={capMaterials[i]}
          // The stencil buffer is per-frame shared state: leave it dirty and the next cap
          // draws through this one's mask.
          onAfterRender={() => gl.clearStencil()}
        >
          <planeGeometry args={[size, size]} />
        </mesh>
      ))}
    </group>
  );
}
```

- [ ] **Step 2: Enable the stencil buffer on the renderer**

The `<Canvas>` `gl` prop in `ModelViewerInner.tsx` must ask for a stencil buffer — without it
every cap draws unconditionally and the section fills the whole quad. Change:

```tsx
        gl={{ preserveDrawingBuffer: true, localClippingEnabled: true }}
```

to:

```tsx
        // localClippingEnabled is what makes per-material clippingPlanes take effect at all;
        // without it the cross-section silently does nothing. `stencil` is what makes the cut
        // faces in SectionCaps work — WebGL2 contexts do not allocate a stencil buffer unless
        // asked, and without one every cap quad draws unmasked over the whole model.
        gl={{ preserveDrawingBuffer: true, localClippingEnabled: true, stencil: true }}
```

- [ ] **Step 3: Mount it**

Directly after the `<ApplyCrossSection … />` block in `ModelViewerInner.tsx`, add:

```tsx
          {bounds && (
            <SectionCaps
              key={`caps-${url}`}
              slots={slots}
              modelRef={modelRef}
              planeObjects={planeObjects}
              planesRef={clipPlanesRef}
              size={bounds.radius * 2.6}
            />
          )}
```

It sits OUTSIDE the transform group, at the top level of the scene: the stencil proxies copy
their sources' world matrices directly and the cap quads read the widgets' world matrices, so
a parent transform would be applied twice.

Add the import:

```typescript
import SectionCaps from './section/SectionCaps';
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run lint`
Expected: no errors.

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add components/viewers/section/SectionCaps.tsx components/viewers/ModelViewerInner.tsx
git commit -m "feat(viewer): solid cut faces for cross-section planes"
```

---

### Task 8: Browser verification

None of Tasks 2–7 is unit-testable — it is all three.js rendering and pointer interaction.
This task is the verification, and it is not optional: the last markup feature shipped to
`main` without ever being opened in a browser, and `main` deploys straight to production with
no staging environment.

**Files:** none changed unless a defect is found.

- [ ] **Step 1: Boot the app**

There is no `.env.local` in the checkout and you must not create one — it would shadow real
config later. Supply throwaway vars inline instead. In a terminal at the repo root:

```bash
AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' npm run dev
```

`DATABASE_URL` is required even for pages that never query, because `middleware.ts` imports
`lib/auth` → `lib/db`, which throws at module load if it is unset. `neon()` connects lazily,
so a fake URL is fine.

- [ ] **Step 2: Open a 3D model in the viewer and work through the checklist**

Every line below must be confirmed by eye. Record the result of each.

- [ ] Cross-section off: no Planes panel, Move and Rotate act on the model and are enabled.
- [ ] Cross-section on: the Planes panel appears inline immediately left of the button, same height, `Planes 1 2 3`. Move and Rotate are greyed and hover-read "Select a plane".
- [ ] Press `1`: a translucent plane appears through the middle of the model and the model is cut.
- [ ] Press `2` and `3`: three planes, three simultaneous cuts, the surviving geometry is the intersection of all three.
- [ ] Click plane 1: it highlights, Move arms automatically, the gizmo appears on that plane.
- [ ] Drag the gizmo: the cut follows the plane live, with no lag.
- [ ] Click Rotate: the gizmo switches to rotate rings on the SAME plane. Rotate 45 degrees — the cut is on the diagonal.
- [ ] Click Flip in the panel: the other half of the model survives.
- [ ] Click plane 2: selection moves, plane 1 stops being highlighted, the gizmo moves.
- [ ] Click the model, then empty background: both deselect and the gizmo disappears.
- [ ] Drag a gizmo handle and release over the model: the plane stays selected. (This is the
      `gizmoDraggingRef` guard. A regression here shows as the gizmo vanishing on release.)
- [ ] Toggle `1` off: the plane and its gizmo vanish, the cut remains, and the button shows a
      small dot. Toggle it back on: the plane reappears **in the pose you left it**, not
      re-centred.
- [ ] Turn cross-section off: all planes gone, the model is whole, Move and Rotate are enabled
      on the model again.
- [ ] Cut faces: on a solid model the cut reads as a solid face. Note what it does on a
      thin-walled or open one — odd caps there are the accepted limitation, not a defect, but
      record what you see.
- [ ] Arm the comment tool with a cut open and click into the opened cavity: no pin is dropped
      on the hidden half.
- [ ] Orbit-drag starting over a cut cavity: the pivot does not anchor on invisible geometry.
- [ ] Start a markup session with planes visible: no plane, gizmo or cap appears in the
      captured snapshot.
- [ ] Switch to another file and back: no plane, no cut, nothing carried over.
- [ ] Open an STL, section it, switch to a different STL: the second one is **not** clipped.
      (These render with module-level singleton materials shared across the session — this is
      the cleanup that matters most.)

- [ ] **Step 3: Run the production build**

`main` deploys straight to production, so build before merging. This needs four more vars,
because `lib/s3.ts` throws at import when any is missing:

```bash
AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' \
R2_ACCESS_KEY_ID=dev R2_SECRET_ACCESS_KEY=dev \
R2_ENDPOINT_URL='https://example.invalid' R2_BUCKET_NAME=dev npm run build
```

Expected: the build completes. A bare `npm run build` failing at "Collect page data" is this
missing config, not a code defect — don't chase it.

- [ ] **Step 4: Report**

Report the checklist results verbatim, including anything that failed. Do not describe the
feature as working on the strength of a clean typecheck — state what you actually saw in the
browser, and say plainly which lines you could not confirm and why.

---

## Notes for the implementer

**The three traps this feature can fall into, all documented in the code you are touching:**

1. **Unmounting a hidden plane.** A hidden-but-cutting plane must stay mounted with
   `visible={false}`. Unmount it and its pose is lost, because the pose is applied on mount
   only — switching the button back on would silently re-centre the cut.

2. **Rebuilding the clipping-plane array per frame.** Changing the NUMBER of clipping planes
   on a material recompiles its shader. The array is memoised on the *set* of cutting ids, so
   flipping a plane or selecting one must not rebuild it.

3. **The STL/PLY cleanup.** `ApplyCrossSection`'s unmount cleanup clears `clippingPlanes` from
   materials that, for STL and PLY, are module-level singletons shared by every such file
   opened in the session. Skip it and unrelated models get clipped later with no control on
   screen to explain it.
