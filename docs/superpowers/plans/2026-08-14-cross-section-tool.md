# Cross-Section Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cross-section tool for 3D files in the portal viewer — one axis-aligned clipping plane, swept by a slider, with a flip control.

**Architecture:** A pure module builds a `THREE.Plane` in the model's own frame from an axis, a normalised offset and a flip flag. The plane is written onto the model's materials only — never `gl.clippingPlanes`, which would cut the ground, axes and navigation cube too — and is transformed into world space every frame so it tracks the object through a transform drag. State lives in the portal page for the session only: no column, no endpoint, no permission, no migration.

**Tech Stack:** Next.js 14, React 18, `@react-three/fiber` 8.18, `three` 0.169 (`Plane`, `Material.clippingPlanes`, `WebGLRenderer.localClippingEnabled`), TypeScript 5, Tailwind with the `stiko` palette. Tests run on `node --test scripts/tests/*.mjs`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-14-cross-section-tool-design.md`

## Global Constraints

- No new npm dependencies.
- **Clipping is per-material, never global.** Do not set `gl.clippingPlanes`. drei's `Hud` renders the navigation cube through the same renderer, so a global plane would cut the gizmo, the ground disc and the axis lines.
- The plane is built in the model's frame and transformed to world space **every frame**, not on prop change — `TransformControls` mutates the target group directly during a drag without going through React props.
- **Materials are cached and shared by `useLoader`.** Clipping planes must be cleared on unmount and on disable, or reopening the file shows it still cut with no control on screen to explain it.
- `THREE.Raycaster` ignores clipping planes. Comment-pin intersections on the clipped side must be rejected.
- Session only — resets on file switch and reload. Nothing is persisted. No permission check: sectioning changes nothing for anyone else, so viewers and commenters get it too.
- Defaults (axis `x`, offset `0.5`, not flipped) apply **once per file**, not on every enable. Toggling off and on keeps the cut you had.
- 3D files only; hidden while an annotation session is active or an attachment is open in the viewport.
- Docs under `docs/superpowers/` are deliberately untracked — edit them, never `git add` them.
- Never `git add -A`, `git add .`, or `git commit -a`. Commit explicit paths. `design_handoff_portal_view/`, `docs/superpowers/` and `stiko_handoff/` stay untracked.
- Do not run `npm run build`, `npm run dev` or `npm run migrate` during implementation tasks, and never read or create `.env.local`. Task 7 is the exception and is explicitly authorised.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `lib/crossSection.ts` | Create | The `CrossSection` shape, its default, and the model-frame plane maths. Pure. |
| `scripts/tests/crossSection.test.mjs` | Create | Unit tests for the plane maths, including behaviour under a rotation. |
| `lib/threeMaterials.ts` | Modify | Gains `setClippingPlanes`, alongside the existing `makeDoubleSided`. |
| `components/viewers/ModelViewerInner.tsx` | Modify | Publish the AABB on `ModelBounds`; `ApplyCrossSection`; the raycast guard; `localClippingEnabled`. |
| `components/viewers/ViewerContainer.tsx` | Modify | Thread `crossSection` to the model branch. |
| `components/viewers/CrossSectionControl.tsx` | Create | The pill: toggle, axis picker, slider, flip. |
| `components/viewers/FocalLengthControl.tsx` | Modify | Drop its own corner positioning so it can sit in a shared row. |
| `app/portal/[id]/page.tsx` | Modify | Own the state, render both controls in one row, reset on file switch. |

---

### Task 1: The plane maths

**Files:**
- Create: `lib/crossSection.ts`
- Test: `scripts/tests/crossSection.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `SectionAxis` (`'x' | 'y' | 'z'`), `CrossSection` (`{ axis: SectionAxis; offset: number; flipped: boolean }`), `SECTION_AXES: readonly SectionAxis[]`, `DEFAULT_CROSS_SECTION: CrossSection`, `ModelBox` (`{ min: [number, number, number]; max: [number, number, number] }`), `planeForSection(section: CrossSection, box: ModelBox): THREE.Plane`. Tasks 2, 3, 5 and 6 consume these.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/crossSection.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  SECTION_AXES,
  DEFAULT_CROSS_SECTION,
  planeForSection,
} from '../../lib/crossSection.ts';

// A unit cube centred on the origin: every axis runs -1 … 1, so an offset of 0.5 cuts at 0
// and the arithmetic stays readable.
const BOX = { min: [-1, -1, -1], max: [1, 1, 1] };

const kept = (plane, p) => plane.distanceToPoint(new THREE.Vector3(...p)) >= 0;

test('a centred cut keeps one half and hides the other', () => {
  const plane = planeForSection({ axis: 'x', offset: 0.5, flipped: false }, BOX);
  assert.equal(kept(plane, [-0.5, 0, 0]), true);
  assert.equal(kept(plane, [0.5, 0, 0]), false);
});

test('flipping swaps exactly which half survives', () => {
  const section = { axis: 'x', offset: 0.5, flipped: false };
  const plane = planeForSection(section, BOX);
  const flipped = planeForSection({ ...section, flipped: true }, BOX);
  for (const p of [[-0.5, 0, 0], [0.5, 0, 0], [-0.9, 0.3, 0.2], [0.9, -0.3, -0.2]]) {
    assert.notEqual(kept(plane, p), kept(flipped, p), `point ${p} did not swap sides`);
  }
});

test('the offset extremes keep everything and nothing', () => {
  const all = planeForSection({ axis: 'x', offset: 1, flipped: false }, BOX);
  const none = planeForSection({ axis: 'x', offset: 0, flipped: false }, BOX);
  for (const p of [[-1, 0, 0], [0, 0, 0], [0.999, 0, 0]]) {
    assert.equal(kept(all, p), true, `offset 1 hid ${p}`);
  }
  for (const p of [[-0.999, 0, 0], [0, 0, 0], [1, 0, 0]]) {
    assert.equal(kept(none, p), false, `offset 0 kept ${p}`);
  }
});

test('each axis constrains only itself', () => {
  // A y-cut must not care where a point sits in x or z. An axis mix-up would still look
  // plausible on a symmetric model, which is exactly why this is checked rather than eyeballed.
  const plane = planeForSection({ axis: 'y', offset: 0.5, flipped: false }, BOX);
  assert.equal(kept(plane, [-0.9, -0.5, 0.9]), true);
  assert.equal(kept(plane, [0.9, -0.5, -0.9]), true);
  assert.equal(kept(plane, [-0.9, 0.5, 0.9]), false);
  assert.equal(kept(plane, [0.9, 0.5, -0.9]), false);
});

test('every axis is supported and cuts along itself', () => {
  for (const [i, axis] of SECTION_AXES.entries()) {
    const plane = planeForSection({ axis, offset: 0.5, flipped: false }, BOX);
    const inside = [0, 0, 0];
    const outside = [0, 0, 0];
    inside[i] = -0.5;
    outside[i] = 0.5;
    assert.equal(kept(plane, inside), true, `${axis} hid its own negative side`);
    assert.equal(kept(plane, outside), false, `${axis} kept its own positive side`);
  }
});

test('the offset maps onto the box, not onto fixed world units', () => {
  // A model 200 units wide and offset 100 from the origin must still cut through its middle
  // at 0.5 — otherwise the slider does nothing on anything that is not unit-sized.
  const big = { min: [100, 0, 0], max: [300, 1, 1] };
  const plane = planeForSection({ axis: 'x', offset: 0.5, flipped: false }, big);
  assert.equal(kept(plane, [150, 0.5, 0.5]), true);
  assert.equal(kept(plane, [250, 0.5, 0.5]), false);
});

test('the default is a centred, unflipped cut on a supported axis', () => {
  assert.ok(SECTION_AXES.includes(DEFAULT_CROSS_SECTION.axis));
  assert.equal(DEFAULT_CROSS_SECTION.offset, 0.5);
  assert.equal(DEFAULT_CROSS_SECTION.flipped, false);
});

test('the plane survives being pushed into world space by the object matrix', () => {
  // The property the per-frame world sync rests on: build the plane in the model's frame,
  // transform plane and point by the SAME matrix, and the point must stay on the same side
  // at the same distance. If this fails, a rotated object cuts in the wrong place.
  const plane = planeForSection({ axis: 'x', offset: 0.5, flipped: false }, BOX);
  const matrix = new THREE.Matrix4()
    .makeRotationY(Math.PI / 3)
    .multiply(new THREE.Matrix4().makeTranslation(17, -4, 9));
  const world = plane.clone().applyMatrix4(matrix);

  for (const p of [[-0.5, 0, 0], [0.5, 0, 0], [-0.2, 0.7, -0.3]]) {
    const local = new THREE.Vector3(...p);
    const moved = local.clone().applyMatrix4(matrix);
    assert.equal(
      world.distanceToPoint(moved) >= 0,
      plane.distanceToPoint(local) >= 0,
      `point ${p} changed sides under the transform`,
    );
    assert.ok(
      Math.abs(world.distanceToPoint(moved) - plane.distanceToPoint(local)) < 1e-9,
      `point ${p} changed distance under a rigid transform`,
    );
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module` for `lib/crossSection.ts`.

- [ ] **Step 3: Write the implementation**

Create `lib/crossSection.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 8 new tests, `# fail 0`.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx next lint --file lib/crossSection.ts`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`.

- [ ] **Step 6: Commit**

```bash
git add lib/crossSection.ts scripts/tests/crossSection.test.mjs
git commit -m "feat(portal): cross-section plane maths

Built in the model's own frame with a normalised offset, so the slider has
a fixed range whatever the model's size and the cut survives being pushed
into world space by the object's placement matrix."
```

---

### Task 2: Publish the model's bounding box

**Files:**
- Modify: `components/viewers/ModelViewerInner.tsx`

**Interfaces:**
- Consumes: `ModelBox` from `lib/crossSection.ts` (Task 1).
- Produces: `ModelBounds.box: ModelBox`. Tasks 3 and 6 consume it.

- [ ] **Step 1: Add the field to the interface**

In `components/viewers/ModelViewerInner.tsx`, add to `ModelBounds` (near line 40), and import `ModelBox`:

```tsx
import type { ModelBox } from '@/lib/crossSection';
```

```tsx
  /**
   * Axis-aligned bounds in the model's own frame, before the placement transform.
   *
   * The cross-section slider needs this rather than `radius`: driven off the bounding
   * SPHERE, a slider on a wide flat model — a tabletop, a panel — would spend most of its
   * travel outside the geometry doing nothing visible.
   */
  box: ModelBox;
```

- [ ] **Step 2: Publish it from MeasureModel**

`MeasureModel` already computes the box at line 317 and throws it away after taking the
bounding sphere. Extend the `onMeasured` call (near line 326) to:

```tsx
    onMeasured({
      center: sphere.center.clone(),
      radius: sphere.radius,
      height: box.max.y - box.min.y,
      box: {
        min: [box.min.x, box.min.y, box.min.z],
        max: [box.max.x, box.max.y, box.max.z],
      },
    });
```

Plain arrays rather than the `THREE.Box3` itself: `ModelBounds` is React state compared by
identity, and handing out a mutable Box3 invites a consumer mutating shared state. It also
keeps `lib/crossSection.ts` testable without constructing three objects for its inputs.

- [ ] **Step 3: Type-check, lint and test**

Run: `npx tsc --noEmit && npx next lint --file components/viewers/ModelViewerInner.tsx && npm test`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`, `# fail 0`.

- [ ] **Step 4: Commit**

```bash
git add components/viewers/ModelViewerInner.tsx
git commit -m "feat(portal): publish the model's AABB on ModelBounds

The cross-section slider needs per-axis extent; a range derived from the
bounding sphere would do nothing over most of its travel on a flat model."
```

---

### Task 3: Apply the clipping plane

**Files:**
- Modify: `lib/threeMaterials.ts`
- Modify: `components/viewers/ModelViewerInner.tsx`
- Modify: `components/viewers/ViewerContainer.tsx`

**Interfaces:**
- Consumes: `CrossSection`, `planeForSection` from `lib/crossSection.ts` (Task 1); `ModelBounds.box` (Task 2).
- Produces: `setClippingPlanes(root, planes)` in `lib/threeMaterials.ts`; `ModelViewerInnerProps.crossSection?: CrossSection | null` and `ViewerContainerProps.crossSection?: CrossSection | null`; a `clipPlaneRef` shared inside `ModelViewerInner` that Task 4 reads.

- [ ] **Step 1: Add the material helper**

Append to `lib/threeMaterials.ts`:

```ts
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
```

- [ ] **Step 2: Turn on local clipping**

In `components/viewers/ModelViewerInner.tsx`, the `<Canvas>` `gl` prop (line 446) becomes:

```tsx
        // localClippingEnabled is what makes per-material clippingPlanes take effect at all;
        // without it the cross-section silently does nothing.
        gl={{ preserveDrawingBuffer: true, localClippingEnabled: true }}
```

- [ ] **Step 3: Add the applying component**

Add these imports:

```tsx
import { makeDoubleSided, setClippingPlanes } from '@/lib/threeMaterials';
import { planeForSection, type CrossSection, type ModelBox } from '@/lib/crossSection';
```

Both are edits to imports that already exist, not new lines: `makeDoubleSided` is already
imported from `@/lib/threeMaterials`, and Task 2 already added a `ModelBox` type import from
`@/lib/crossSection`. Extend both rather than adding duplicate import statements for the same
modules. `useEffect`, `useFrame`, `useRef` and `THREE` are already imported.

Add this component next to `ApplyFocalLength`:

```tsx
/**
 * Clips the model to a single plane.
 *
 * The plane is built in the model's own frame and pushed into world space every frame, not
 * on prop change: TransformControls mutates the target group directly while dragging without
 * going through React props, so a change-driven sync would leave the cut lagging behind the
 * object mid-drag.
 */
function ApplyCrossSection({
  section,
  box,
  modelRef,
  transformRef,
  planeRef,
}: {
  section: CrossSection | null;
  box: ModelBox;
  modelRef: React.RefObject<THREE.Object3D>;
  transformRef: React.RefObject<THREE.Object3D>;
  planeRef: React.MutableRefObject<THREE.Plane | null>;
}) {
  // One plane instance, mutated in place, in an array whose identity never changes — see
  // setClippingPlanes on why the array must not be rebuilt per frame.
  const planes = useRef<THREE.Plane[]>([new THREE.Plane()]);
  const enabled = section !== null;

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;

    setClippingPlanes(model, enabled ? planes.current : null);
    planeRef.current = enabled ? planes.current[0] : null;

    // useLoader caches loader results, so these materials are shared and outlive this
    // viewer. A plane left behind renders the model clipped the next time the file is
    // opened, with no control on screen to explain it and no way back short of a reload.
    return () => {
      setClippingPlanes(model, null);
      planeRef.current = null;
    };
  }, [enabled, modelRef, planeRef]);

  useFrame(() => {
    const frame = transformRef.current;
    if (!section || !frame) return;
    planes.current[0].copy(planeForSection(section, box)).applyMatrix4(frame.matrixWorld);
  });

  return null;
}
```

- [ ] **Step 4: Accept the prop and render it**

Add to `ModelViewerInnerProps`:

```tsx
  /** Null when the model is not sectioned. */
  crossSection?: CrossSection | null;
```

Destructure `crossSection = null` in the component signature. Next to the existing
`modelRef` / `transformRef` declarations, add:

```tsx
  // Written by ApplyCrossSection, read by SceneInteraction's raycast guard.
  const clipPlaneRef = useRef<THREE.Plane | null>(null);
```

Render it inside `<Suspense>`, immediately after the `{bounds && <FitCameraToModel .../>}`
line — it needs `bounds` for the box, and gating on `bounds` also guarantees the model has
loaded, so `modelRef.current` is populated when the effect runs:

```tsx
          {bounds && (
            <ApplyCrossSection
              section={crossSection}
              box={bounds.box}
              modelRef={modelRef}
              transformRef={transformRef}
              planeRef={clipPlaneRef}
            />
          )}
```

- [ ] **Step 5: Thread it through the container**

In `components/viewers/ViewerContainer.tsx`, `focalLength` was threaded through exactly this
way — follow it at all three sites. Add `crossSection?: CrossSection | null;` to
`ViewerContainerProps` next to `focalLength?: number;` (importing the type from
`@/lib/crossSection`), add `crossSection` to the destructured parameter list next to
`focalLength`, and add `crossSection={crossSection}` next to `focalLength={focalLength}` on the
single-line `<ModelViewer ... />` return in the `MODEL_EXTENSIONS` branch.

`ModelViewer.tsx` needs no change — it takes `ModelViewerInnerProps` and spreads them.

- [ ] **Step 6: Type-check, lint and test**

Run: `npx tsc --noEmit && npx next lint && npm test`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`, `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add lib/threeMaterials.ts components/viewers/ModelViewerInner.tsx components/viewers/ViewerContainer.tsx
git commit -m "feat(portal): clip the model to a cross-section plane

Per-material rather than the renderer's global clippingPlanes, which would
also cut the ground, the axes and the navigation cube. Synced to world space
every frame so the cut tracks the object through a transform drag, and
cleared on unmount because useLoader's materials outlive the viewer."
```

---

### Task 4: Stop pins landing on clipped geometry

**Files:**
- Modify: `components/viewers/ModelViewerInner.tsx`

**Interfaces:**
- Consumes: the `clipPlaneRef` created in Task 3.
- Produces: nothing.

- [ ] **Step 1: Pass the ref into SceneInteraction**

`SceneInteraction` is rendered inside the Canvas and already receives `modelRef` and
`transform`. Add a `clipPlaneRef: React.MutableRefObject<THREE.Plane | null>` prop to its
props type, accept it, and pass `clipPlaneRef={clipPlaneRef}` at its render site.

- [ ] **Step 2: Guard the intersection loop**

In `handlePointerDown` (around line 207), the loop currently accepts the first mesh hit.
Replace the loop body's opening so a hit on the clipped side is skipped:

```tsx
      for (const hit of intersects) {
        if (!(hit.object instanceof THREE.Mesh || hit.object instanceof THREE.SkinnedMesh)) continue;

        // Raycaster ignores clipping planes entirely, so the hidden half stays fully
        // hittable. Without this, clicking into an opened cavity drops the pin on the
        // invisible near half — and it then appears to float in space once the section is
        // cleared. distanceToPoint is negative on the side three clips away.
        const clip = clipPlaneRef.current;
        if (clip && clip.distanceToPoint(hit.point) < 0) continue;

        const point = hit.point;
        const projected = point.clone().project(camera);
        const screenPercent = {
          x: ((projected.x + 1) / 2) * 100,
          y: ((1 - projected.y) / 2) * 100,
        };
        // Stored relative to the model, so the pin travels with it when it is moved.
        const local = worldToModel([point.x, point.y, point.z], transform);
        onSceneClick({ x: local[0], y: local[1], z: local[2] }, screenPercent);
        break;
      }
```

Note the inverted first condition and `continue`: the original `if (isMesh) { … break; }` would
have needed the guard nested inside it, and a `break` in the wrong branch would stop at the
first clipped hit instead of skipping past it.

`clipPlaneRef` holds the WORLD-space plane (Task 3 applies the object matrix to it) and
`hit.point` is world-space, so the two are directly comparable — no transform here.

- [ ] **Step 3: Add clipPlaneRef to the callback dependencies**

`handlePointerDown` is a `useCallback`. Add `clipPlaneRef` to its dependency array. A ref's
identity is stable, so this changes nothing at runtime — it is there to satisfy the lint rule
rather than to trigger re-creation.

- [ ] **Step 4: Type-check, lint and test**

Run: `npx tsc --noEmit && npx next lint --file components/viewers/ModelViewerInner.tsx && npm test`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add components/viewers/ModelViewerInner.tsx
git commit -m "fix(portal): do not place comment pins on clipped geometry

Raycaster ignores clipping planes, so the hidden half of a sectioned model
stays hittable: a click into an opened cavity landed on the invisible near
half and the pin floated in space once the section was cleared."
```

---

### Task 5: The control

**Files:**
- Create: `components/viewers/CrossSectionControl.tsx`
- Modify: `components/viewers/FocalLengthControl.tsx`

**Interfaces:**
- Consumes: `CrossSection`, `SectionAxis`, `SECTION_AXES`, `DEFAULT_CROSS_SECTION` from `lib/crossSection.ts` (Task 1).
- Produces: a default-exported `CrossSectionControl` taking `{ section: CrossSection | null; lastSection: CrossSection; onChange: (section: CrossSection | null) => void }`. Task 6 renders it.

- [ ] **Step 1: Free the focal control from the corner**

`FocalLengthControl`'s root currently owns the corner: `absolute bottom-3 left-3 z-20
select-none`. Two pills cannot both claim that spot, so the positioning moves up to a row in
Task 6 and the root becomes:

```tsx
    <div ref={rootRef} className="relative select-none">
```

Nothing else in the file changes. `relative` stays because the preset menu is positioned
relative to this root; only the corner anchoring goes.

- [ ] **Step 2: Write the control**

Create `components/viewers/CrossSectionControl.tsx`:

```tsx
'use client';

import { SECTION_AXES, type CrossSection, type SectionAxis } from '@/lib/crossSection';

/**
 * Cross-section control: a toggle pill that opens an axis picker, a slider and a flip button.
 *
 * `section` is null when the model is not sectioned. Enabling restores `lastSection` rather
 * than re-defaulting, so a cut you have just positioned survives toggling the tool off and
 * on. The caller owns that memory — this component holds no state of its own.
 */
export default function CrossSectionControl({
  section,
  lastSection,
  onChange,
}: {
  section: CrossSection | null;
  /** Restored when the tool is switched back on, so a positioned cut is not thrown away. */
  lastSection: CrossSection;
  onChange: (section: CrossSection | null) => void;
}) {
  const active = section !== null;

  const axisSlot = (selected: boolean) =>
    `h-6 w-6 rounded-[8px] text-[11px] font-semibold uppercase transition-colors ${
      selected ? 'bg-stiko-tint text-stiko-primary' : 'text-stiko-muted hover:bg-stiko-tint'
    }`;

  return (
    <div className="relative select-none">
      {section && (
        <div className="mb-1.5 flex items-center gap-1 rounded-panel bg-white shadow-stiko-sheet border border-stiko-border h-8 px-1.5">
          {SECTION_AXES.map((axis: SectionAxis) => (
            <button
              key={axis}
              onClick={() => onChange({ ...section, axis })}
              aria-pressed={section.axis === axis}
              className={axisSlot(section.axis === axis)}
            >
              {axis}
            </button>
          ))}

          <input
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={section.offset}
            onChange={(e) => onChange({ ...section, offset: Number(e.target.value) })}
            aria-label="Cross-section position"
            className="w-24 accent-stiko-primary"
          />

          <button
            title="Flip which half is kept"
            aria-label="Flip which half is kept"
            aria-pressed={section.flipped}
            onClick={() => onChange({ ...section, flipped: !section.flipped })}
            className={`flex h-6 w-6 items-center justify-center rounded-[8px] transition-colors ${
              section.flipped ? 'bg-stiko-tint text-stiko-primary' : 'text-stiko-muted hover:bg-stiko-tint'
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex items-center rounded-panel bg-white shadow-stiko-panel border border-stiko-border h-8 px-1">
        <button
          title="Cross-section"
          aria-label="Cross-section"
          aria-pressed={active}
          onClick={() => onChange(active ? null : lastSection)}
          className={`flex h-6 w-6 items-center justify-center rounded-[8px] transition-colors ${
            active ? 'bg-stiko-tint text-stiko-primary' : 'text-stiko-muted hover:bg-stiko-tint'
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8h18" />
            <path d="M5 8V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
            <path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8" strokeDasharray="3 3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
```

The toggle reads `lastSection`, never a default of its own. This component is deliberately
stateless: the page owns both the active section and the remembered one, so the "toggling off
and on keeps your cut" behaviour lives in one place rather than being split between a
component's memory and the page's.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx next lint --file components/viewers/CrossSectionControl.tsx --file components/viewers/FocalLengthControl.tsx`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`.

- [ ] **Step 4: Commit**

```bash
git add components/viewers/CrossSectionControl.tsx components/viewers/FocalLengthControl.tsx
git commit -m "feat(portal): cross-section control

Toggle pill that opens an axis picker, position slider and flip button. The
focal control gives up its corner positioning so the two can share a row."
```

---

### Task 6: Wire it into the page

**Files:**
- Modify: `app/portal/[id]/page.tsx`

**Interfaces:**
- Consumes: `CrossSection`, `DEFAULT_CROSS_SECTION` from `lib/crossSection.ts` (Task 1); `crossSection` on `ViewerContainer` (Task 3); `CrossSectionControl` (Task 5).
- Produces: nothing.

- [ ] **Step 1: Add the imports and state**

```tsx
import CrossSectionControl from '@/components/viewers/CrossSectionControl';
import { DEFAULT_CROSS_SECTION, type CrossSection } from '@/lib/crossSection';
```

Next to the existing `focalLength` state:

```tsx
  // Session only, like the focal length: a cut is a way of looking at the model, not a
  // property of the design. Null means not sectioned; the last cut is remembered in
  // `lastSection` so toggling the tool off and on does not throw away your position.
  const [crossSection, setCrossSection] = useState<CrossSection | null>(null);
  const lastSection = useRef<CrossSection>(DEFAULT_CROSS_SECTION);
```

- [ ] **Step 2: Add the change handler**

Next to the other viewer handlers:

```tsx
  const handleCrossSectionChange = useCallback((next: CrossSection | null) => {
    if (next) lastSection.current = next;
    setCrossSection(next);
  }, []);
```

- [ ] **Step 3: Reset it on file switch**

In the existing effect keyed on `[selectedFileId]` — the one that already calls
`setFocalLength(DEFAULT_FOCAL_LENGTH)` — add:

```tsx
    setCrossSection(null);
    lastSection.current = DEFAULT_CROSS_SECTION;
```

Both lines: the defaults apply once per FILE, so the remembered cut has to be dropped along
with the active one. Resetting only `crossSection` would carry the previous model's cut
position onto the next model.

- [ ] **Step 4: Pass it to the viewer**

At the `<ViewerContainer ... />` render site, next to `focalLength={focalLength}`:

```tsx
            crossSection={crossSection}
```

- [ ] **Step 5: Put both controls in one row**

Replace the existing focal-control block with a single row holding both. `items-end` is
required, not cosmetic: each control grows UPWARD when its panel opens (the focal preset menu,
the section's axis/slider row), and any other alignment would make the pills jump as they open.

```tsx
            {/* Hidden during a markup session: the live viewer is replaced by a frozen
                snapshot then, so these would sit on the drawing surface and drive a viewer
                nobody is looking at. Also hidden while an attachment/snapshot is open in the
                viewport (viewportImage set), where the live viewer is behind it.

                items-end: both controls open their panels upward, so they must be anchored
                by their bottom edge or the pills shift as panels appear. */}
            {selectedFileId && is3DFile && !annotating && !viewportImage && (
              <div className="absolute bottom-3 left-3 z-20 flex items-end gap-2">
                <FocalLengthControl value={focalLength} onChange={setFocalLength} />
                <CrossSectionControl
                  section={crossSection}
                  lastSection={lastSection.current}
                  onChange={handleCrossSectionChange}
                />
              </div>
            )}
```

Reading `lastSection.current` during render is safe here because it only ever changes
alongside a `setCrossSection` call, so a render is already queued whenever it moves.

- [ ] **Step 6: Type-check, lint and test**

Run: `npx tsc --noEmit && npx next lint && npm test`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`, `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add "app/portal/[id]/page.tsx"
git commit -m "feat(portal): cross-section control in the 3D viewport

Session-only state reset on file switch, sharing the bottom-left row with
the focal control. The last cut is remembered so toggling the tool off and
on does not discard a position you just set."
```

---

### Task 7: Verification and cleanup

**Files:**
- Create then delete (never committed): `scripts/make-sample-stl.mjs`, `public/uploads/sample-medium.stl`, `app/portal/dev-gizmo/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: nothing.

This task is explicitly authorised to run the dev server and drive a browser. It must produce
no permanent code changes.

- [ ] **Step 1: Build the harness**

Create `scripts/make-sample-stl.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';
const REPO = process.cwd();
const THREE = await import(path.join(REPO, 'node_modules/three/build/three.module.js'));
const OUT = path.join(REPO, 'public/uploads');
fs.mkdirSync(OUT, { recursive: true });
// A torus: hollow, and obviously wrong if a cut lands on the wrong axis.
const geom = new THREE.TorusGeometry(100, 40, 24, 48).toNonIndexed();
const pos = geom.getAttribute('position');
const n3 = pos.count / 3;
const buf = Buffer.alloc(84 + n3 * 50);
buf.write('sample'.padEnd(80, ' '), 0, 80, 'ascii');
buf.writeUInt32LE(n3, 80);
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3();
let o = 84;
for (let i = 0; i < n3; i++) {
  a.fromBufferAttribute(pos, i * 3); b.fromBufferAttribute(pos, i * 3 + 1); c.fromBufferAttribute(pos, i * 3 + 2);
  nrm.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
  for (const v of [nrm, a, b, c]) { buf.writeFloatLE(v.x, o); buf.writeFloatLE(v.y, o + 4); buf.writeFloatLE(v.z, o + 8); o += 12; }
  buf.writeUInt16LE(0, o); o += 2;
}
fs.writeFileSync(path.join(OUT, 'sample-medium.stl'), buf);
console.log('sample written');
```

Run: `node scripts/make-sample-stl.mjs`

The sample must live under `public/uploads/` specifically: `middleware.ts`'s matcher excludes
`uploads`, so the file is served raw. Anywhere else in `public/` it is redirected to `/login`
and the STL loader parses HTML. `public/uploads/` is also gitignored, so it cannot be
committed by accident.

Create `app/portal/dev-gizmo/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import ModelViewer from '@/components/viewers/ModelViewer';
import CrossSectionControl from '@/components/viewers/CrossSectionControl';
import { DEFAULT_CROSS_SECTION, type CrossSection } from '@/lib/crossSection';

export default function DevGizmoPage() {
  const [section, setSection] = useState<CrossSection | null>(null);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <ModelViewer url="/uploads/sample-medium.stl" crossSection={section} />
      <div className="absolute bottom-3 left-3 z-20 flex items-end gap-2">
        <CrossSectionControl
          section={section}
          lastSection={section ?? DEFAULT_CROSS_SECTION}
          onChange={setSection}
        />
      </div>
    </div>
  );
}
```

`/portal/` is the only middleware-public prefix, which is why the harness route lives there.

- [ ] **Step 2: Run the dev server**

Run: `AUTH_SECRET=dev-only DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' npm run dev`

Both env vars are required even though this page queries nothing: `middleware.ts` imports
`lib/auth` → `lib/db`, which throws at module load without `DATABASE_URL`. Supply them inline
— do **not** create a `.env.local`.

- [ ] **Step 3: Check the cut**

Open `http://localhost:3000/portal/dev-gizmo` and confirm:

1. The section pill sits bottom-left; clicking it opens the axis/slider/flip row upward.
2. Enabling immediately shows a cut through the middle — not an unchanged model.
3. The slider sweeps the cut across the whole model, with visible change at both ends.
4. X, Y and Z each cut along a different axis.
5. Flip swaps which half is visible.
6. **The cut face shows the torus's interior wall, not a black void** — this is what the
   DoubleSide materials buy.
7. Switching the tool off restores the whole model.

- [ ] **Step 4: Check that only the model is clipped**

With a section active, confirm the ground disc, the axis lines and the navigation cube in the
top-right are all **unclipped**. This is the failure that a global `gl.clippingPlanes` would
cause, and it is invisible in code review.

- [ ] **Step 5: Check the material cleanup**

With a section active, navigate away from `/portal/dev-gizmo` and back (a full reload does not
test this — the point is the cached material surviving an unmount). The model must come back
**uncut**. If it is still clipped, the unmount cleanup is not running.

- [ ] **Step 6: Check the pin guard**

This needs the comment tool, which the harness page does not wire up. Verify it instead in the
real app if you have a working login; otherwise record explicitly in the report that the pin
guard was NOT verified in a browser, rather than implying it was. Do not claim a check you did
not run.

- [ ] **Step 7: Delete the harness**

```bash
rm -rf app/portal/dev-gizmo public/uploads scripts/make-sample-stl.mjs .next/types/app/portal/dev-gizmo
```

Deleting the route without clearing its generated types leaves `tsc` failing on a stale
`.next/types` entry.

- [ ] **Step 8: Full verification**

Run: `npm test && npx tsc --noEmit && npx next lint`
Expected: `# fail 0`, no `tsc` output, `✔ No ESLint warnings or errors`.

Then a production build, which needs the env set:

```bash
DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db?sslmode=require' AUTH_SECRET=x NEXTAUTH_URL=http://localhost:3000 \
R2_ACCESS_KEY_ID=x R2_SECRET_ACCESS_KEY=x R2_BUCKET_NAME=x R2_ENDPOINT_URL=https://e.r2.cloudflarestorage.com \
npm run build
```

Expected: `✓ Compiled successfully`. A pre-existing warning about `bcryptjs` in the Edge
Runtime is expected and unrelated.

- [ ] **Step 9: Confirm the tree is clean**

Run: `git status --short`
Expected: no `dev-gizmo`, `sample-medium.stl` or `make-sample-stl.mjs` entries. The
pre-existing untracked `design_handoff_portal_view/`, `docs/superpowers/` and `stiko_handoff/`
are expected and must be left alone.
