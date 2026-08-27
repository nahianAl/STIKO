# 3D Viewer Camera Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pan, zoom and orbit feel identical at every scale by anchoring the camera's pivot to the surface under the cursor instead of to the model's fixed centre.

**Architecture:** Replace drei's `OrbitControls` with drei's `CameraControls` (the `camera-controls` library), which exposes `setOrbitPoint()` — "set orbit point without moving the camera". A new `ViewerNavigation` component listens for pointer-down and wheel events in the capture phase, raycasts the model under the cursor, and re-anchors the pivot before the control library acts on the same event. Pure decision arithmetic lives in `lib/viewerNavigation.ts` and is unit-tested under node.

**Tech Stack:** Next.js, React Three Fiber 8.18.0, drei 9.122.0, three 0.169.0, camera-controls 2.10.1, node:test.

**Spec:** `docs/superpowers/specs/2026-08-26-viewer-camera-navigation-design.md`

> ## ⚠️ This plan was executed and is now partly superseded
>
> Read the spec, not this plan, for what the code does. Implementation and review disproved
> two things this plan specified:
>
> - **Task 4's `ViewerNavigation` code is wrong.** Re-anchoring the pivot on the wheel
>   desynchronises a private field in camera-controls and drags the cursor point off the
>   cursor — the inverse of the intended effect. The shipped code does not re-anchor on the
>   wheel. See the spec's "Why the wheel must not re-anchor".
> - **Task 2's `pivotForPointer` signature is wrong.** It shipped as
>   `(hit: Vec3 | null, fallback: Vec3): Vec3` with a non-nullable fallback and a single
>   caller, because the wheel case that needed the nullable form no longer exists. The
>   `pivotForPointer(null, null) === null` test in Step 1 was deleted.
>
> A separate defect found only at the final review — `setOrbitPoint` leaving a focal offset
> that `setLookAt` never clears — is also absent from this plan. The shipped
> `FitCameraToModel` zeroes it. See the spec.
>
> The tasks below are kept as the record of what was attempted, not as instructions.

## Global Constraints

- Tests run with `npm test` → `node --test scripts/tests/*.mjs`. Node 25 strips TypeScript natively, so `.mjs` tests import `.ts` modules directly (e.g. `from '../../lib/cameraFraming.ts'`) — **keep the `.ts` extension in the import specifier**.
- Test files use `node:test` + `node:assert/strict`. No test framework is installed; do not add one.
- Every value that sizes the scene derives from the model's bounding-sphere radius. Never hardcode a world-space constant — models span radius 1 to 10,000.
- `minDistance` is **`radius * 0.01`**. Exact value, from the spec.
- Input mapping must stay: **left rotate, middle dolly, right pan, wheel dolly**. These are already camera-controls' defaults, so configure nothing.
- Path alias `@/` maps to the repo root (`@/lib/...`, `@/components/...`).
- Comments explain *why*, not *what* — match the density and voice of the surrounding files.
- No reset/re-frame affordance. Explicitly declined by the user; do not add one.

---

### Task 1: Give `minDistance` a floor that actually stops the pivot collapsing

**Files:**
- Modify: `lib/cameraFraming.ts:24-58`
- Test: `scripts/tests/cameraFraming.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `framingForRadius(radius, fovDegrees, aspect, margin?)` returns `CameraFraming` with `minDistance = radius * 0.01`. `distance`, `near`, `far`, `maxDistance` are unchanged. Task 3 assigns `minDistance`/`maxDistance` onto the controls.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/tests/cameraFraming.test.mjs`:

```javascript
test('minDistance scales with the model, so close inspection works at any size', () => {
  // The defect: minDistance derived from `near` (far/1e5) worked out to ~0.004 * radius,
  // effectively zero. Dolly steps are a percentage of the pivot distance, so a pivot free
  // to collapse to zero made pan and zoom crawl to a halt near large models.
  for (const radius of [1.73, 100, 1385.64, 8660.25]) {
    const f = framingForRadius(radius, FOV, LANDSCAPE);
    assert.ok(
      Math.abs(f.minDistance / radius - 0.01) < 1e-9,
      `radius ${radius}: minDistance ${f.minDistance} is not 1% of the radius`,
    );
  }
});

test('minDistance leaves room to inspect detail without hitting the far stop', () => {
  for (const radius of [1.73, 100, 1385.64, 8660.25]) {
    const f = framingForRadius(radius, FOV, LANDSCAPE);
    assert.ok(f.minDistance < f.distance, `radius ${radius}: cannot zoom in past the framing distance`);
    assert.ok(f.minDistance < f.maxDistance, `radius ${radius}: dolly range is inverted`);
  }
});

test('a degenerate model still gets a usable minDistance', () => {
  for (const bad of [0, -5, Number.NaN]) {
    const f = framingForRadius(bad, FOV, LANDSCAPE);
    assert.ok(Number.isFinite(f.minDistance) && f.minDistance > 0, `radius ${bad} produced ${f.minDistance}`);
    assert.ok(f.near < f.minDistance, `radius ${bad}: near ${f.near} would clip at min zoom-in`);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test scripts/tests/cameraFraming.test.mjs
```

Expected: FAIL. The first new test reports `minDistance ... is not 1% of the radius` — the current value is `near * 10`, roughly `0.0042 * radius`.

- [ ] **Step 3: Change the implementation**

In `lib/cameraFraming.ts`, add the constant next to `MAX_ZOOM_OUT`:

```typescript
/**
 * Closest the orbit pivot may sit to the camera, as a fraction of the model's radius.
 *
 * Dolly steps are a percentage of the pivot distance in every orbit library, so a pivot free
 * to collapse toward zero takes pan and zoom down with it — the reported "everything goes
 * slow when I get close" defect. This was previously derived from `near`, which worked out to
 * ~0.4% of the radius: technically non-zero, practically a black hole.
 *
 * Under camera-controls' `infinityDolly` this doubles as the distance held in front of the
 * camera while pushing through geometry, so it is also the fly-through step size. At 1% that
 * is 50 units on a 5,000-unit building and 0.01 on a 1-unit part — proportionate at both ends.
 */
const MIN_DISTANCE_FACTOR = 0.01;
```

Then change the return statement:

```typescript
  return { distance, near, far, minDistance: r * MIN_DISTANCE_FACTOR, maxDistance };
```

Note `r`, not `radius` — `r` is the sanitised value, so a zero or NaN radius still yields a usable number.

Update the stale comment above `near` (currently ends "…minDistance then keeps the camera in front of it"), since `minDistance` no longer derives from `near`:

```typescript
  // near is pinned to the depth-buffer ratio rather than to the model, so precision stays
  // constant across scales. minDistance is independent of it (see MIN_DISTANCE_FACTOR) but
  // stays comfortably clear: near lands around 4.2e-4 * radius against minDistance's 1e-2.
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test scripts/tests/cameraFraming.test.mjs
```

Expected: PASS, all tests. The pre-existing `near < minDistance` assertion must still pass — the margin widens from ~10× to ~24×.

- [ ] **Step 5: Commit**

```bash
git add lib/cameraFraming.ts scripts/tests/cameraFraming.test.mjs
git commit -m "fix(viewer): give the dolly pivot a floor proportional to the model

minDistance derived from near worked out to ~0.4% of the bounding radius.
Dolly and pan steps are a percentage of the pivot distance, so a pivot that
free-falls toward zero takes both down with it — the reported slowdown near
large models."
```

---

### Task 2: Pure decision arithmetic for the pivot

> **Partly superseded.** `pivotForPointer` shipped as `(hit: Vec3 | null, fallback: Vec3): Vec3`
> — non-nullable fallback, non-nullable return — and the third test below was deleted. See the
> banner at the top.

**Files:**
- Create: `lib/viewerNavigation.ts`
- Test: `scripts/tests/viewerNavigation.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces, all imported by Task 4:
  - `type Vec3 = readonly [number, number, number]`
  - `pivotForPointer(hit: Vec3 | null, fallback: Vec3 | null): Vec3 | null`
  - `clampAnchorDistance(hitDistance: number, minDistance: number, maxDistance: number): number`
  - `isZoomingIn(deltaY: number): boolean`

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/viewerNavigation.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pivotForPointer, clampAnchorDistance, isZoomingIn } from '../../lib/viewerNavigation.ts';

const CENTRE = [10, 20, 30];
const HIT = [1, 2, 3];

test('a hit under the pointer becomes the pivot', () => {
  assert.deepEqual(pivotForPointer(HIT, CENTRE), HIT);
});

test('orbiting from empty background falls back to the model centre', () => {
  // This is what keeps the model in frame: a drag started over background swings the camera
  // around the object rather than around wherever panning happened to leave the pivot.
  assert.deepEqual(pivotForPointer(null, CENTRE), CENTRE);
});

test('dollying over empty background leaves the pivot alone', () => {
  // The wheel passes no fallback. Re-anchoring to the model centre on every background
  // scroll would drag the pivot back off whatever the user had just zoomed toward.
  assert.equal(pivotForPointer(null, null), null);
});

test('an anchor distance inside the dolly range is used as-is', () => {
  assert.equal(clampAnchorDistance(50, 5, 500), 50);
});

test('a grazing hit close to the eye is held at the floor', () => {
  // Without this the pivot lands almost at the camera, every subsequent dolly step (a
  // percentage of that distance) rounds to nothing, and the original defect comes back at
  // a new location.
  assert.equal(clampAnchorDistance(0.0001, 5, 500), 5);
});

test('a distant hit is held at the ceiling', () => {
  assert.equal(clampAnchorDistance(9000, 5, 500), 500);
});

test('a degenerate anchor distance falls back to the floor', () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(clampAnchorDistance(bad, 5, 500), 5, `${bad} did not fall back`);
  }
});

test('wheel-up zooms in', () => {
  // Verified against camera-controls 2.10.1: the wheel handler computes
  // delta = deltaY / (deltaYFactor * 10) with deltaYFactor negative, then calls
  // _dollyInternal(-delta), whose scale is 0.95^(-delta). A negative deltaY therefore
  // shrinks the radius. Pinned by a test because an inverted sign is invisible in review
  // and infuriating in use.
  assert.equal(isZoomingIn(-100), true);
  assert.equal(isZoomingIn(-0.5), true);
});

test('wheel-down zooms out', () => {
  assert.equal(isZoomingIn(100), false);
  assert.equal(isZoomingIn(0), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test scripts/tests/viewerNavigation.test.mjs
```

Expected: FAIL — `Cannot find module .../lib/viewerNavigation.ts`.

- [ ] **Step 3: Write the implementation**

Create `lib/viewerNavigation.ts`:

```typescript
/**
 * Decision arithmetic for the 3D viewer's camera navigation.
 *
 * Kept free of THREE and of the scene graph so it can be tested under node. The component
 * that uses it (components/viewers/ViewerNavigation.tsx) does the raycasting and owns the
 * event listeners; everything here is a pure rule.
 *
 * The rules exist because the viewer's pivot used to be the model's bounding-sphere centre,
 * set once at load. Dolly and pan steps are a percentage of the pivot distance, so inspecting
 * detail meant travelling deep inside the bounding sphere until every gesture moved almost
 * nothing — worse the larger the model, because the geometry you wanted stayed hundreds of
 * units away while the steps shrank. Anchoring the pivot to the surface under the cursor
 * makes both operations scale-free by construction.
 */

export type Vec3 = readonly [number, number, number];

/**
 * Which point the pivot should move to, or null to leave it where it is.
 *
 * The two callers differ only in what they pass as `fallback`, and that difference is the
 * whole of the product behaviour:
 *
 * - **Orbit** passes the model's centre. A rotate drag started over empty background then
 *   swings the camera around the object, which is what keeps the model in the field of view.
 * - **Dolly** passes null. Scrolling over background leaves the pivot untouched, rather than
 *   yanking it back to the centre and undoing the approach the user just made.
 */
export function pivotForPointer(hit: Vec3 | null, fallback: Vec3 | null): Vec3 | null {
  return hit ?? fallback;
}

/**
 * Hold the anchor distance inside the dolly range.
 *
 * A raycast can legitimately report a hit a hair in front of the camera — a grazing angle, or
 * geometry the camera has already pushed into. Anchoring there would put the pivot at the eye
 * and collapse every later dolly step to nothing, which is the exact defect this work removes.
 * Anything unusable falls back to the floor rather than propagating: a NaN reaching
 * setOrbitPoint yields a NaN camera matrix and a blank viewport with no error to explain it.
 */
export function clampAnchorDistance(
  hitDistance: number,
  minDistance: number,
  maxDistance: number,
): number {
  if (!Number.isFinite(hitDistance) || hitDistance <= 0) return minDistance;
  return Math.min(maxDistance, Math.max(minDistance, hitDistance));
}

/**
 * Whether a wheel event dollies in.
 *
 * camera-controls turns the event into `delta = deltaY / (deltaYFactor * 10)` with
 * `deltaYFactor` negative, then dollies by `0.95 ** -delta` — so a negative deltaY (wheel up)
 * shrinks the radius. The caller needs this because `infinityDolly` has to be enabled in one
 * direction only; see ViewerNavigation for why.
 */
export function isZoomingIn(deltaY: number): boolean {
  return deltaY < 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test scripts/tests/viewerNavigation.test.mjs
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/viewerNavigation.ts scripts/tests/viewerNavigation.test.mjs
git commit -m "feat(viewer): add pure pivot-anchoring rules

Hit-or-fallback pivot selection, anchor-distance clamping, and the wheel
direction test. Kept free of THREE so the rules are testable under node."
```

---

### Task 3: Swap OrbitControls for CameraControls

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `components/viewers/ModelViewerInner.tsx:4` (import), `:453-484` (`FitCameraToModel`), `:604` (the control element)

**Interfaces:**
- Consumes: `framingForRadius` from Task 1, now returning `minDistance = radius * 0.01`.
- Produces: `useThree().controls` is a `CameraControlsImpl` with `minDistance` and `maxDistance` already assigned from the model's framing. Task 4 reads both off it rather than taking them as props, so there is one source of truth.

**Why this swap is forced:** OrbitControls calls `object.lookAt(this.target)` on every `update()` (`OrbitControls.js:392`), so its pivot is structurally pinned to the centre of the screen. An off-centre orbit pivot is not expressible in it. camera-controls' `setOrbitPoint()` is the missing primitive.

- [ ] **Step 1: Add the dependency explicitly**

`camera-controls@2.10.1` is already present as a transitive dependency of drei, but relying on a hoist is fragile.

```bash
npm install camera-controls@^2.10.1
```

Verify it landed and did not move drei's version:

```bash
node -p "require('./package.json').dependencies['camera-controls']"
node -p "require('./node_modules/camera-controls/package.json').version"
```

Expected: `^2.10.1` and `2.10.1`.

- [ ] **Step 2: Swap the imports**

In `components/viewers/ModelViewerInner.tsx`, change line 4:

```typescript
import { CameraControls, Center } from '@react-three/drei';
```

Add below the other type imports near line 26:

```typescript
import type CameraControlsImpl from 'camera-controls';
```

- [ ] **Step 3: Rework `FitCameraToModel`**

Replace the whole component (currently lines 447-484, docblock included):

```typescript
/**
 * Frames the camera on the measured model and sizes the clipping planes to it.
 *
 * Deliberately does NOT re-run on viewport resize — refitting there would throw away the
 * user's zoom and pan every time a side panel is toggled.
 */
function FitCameraToModel({ bounds }: { bounds: ModelBounds }) {
  const { camera, controls, size } = useThree();

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const framing = framingForRadius(bounds.radius, cam.fov, size.width / size.height);

    cam.near = framing.near;
    cam.far = framing.far;
    cam.updateProjectionMatrix();

    const position = bounds.center.clone().addScaledVector(VIEW_DIRECTION, framing.distance);

    const cc = controls as unknown as CameraControlsImpl | null;
    if (!cc?.setLookAt) {
      // Controls have not mounted yet. Frame the model directly rather than leaving the
      // camera at the placeholder position, which sits inside anything bigger than a few units.
      cam.position.copy(position);
      cam.lookAt(bounds.center);
      return;
    }

    // Assigned before setLookAt: these are the single source of truth for the dolly range,
    // and ViewerNavigation reads them straight off the controls when it clamps an anchor.
    // camera-controls defaults are Number.EPSILON and Infinity, which clamp nothing.
    cc.minDistance = framing.minDistance;
    cc.maxDistance = framing.maxDistance;

    // false: no transition. This is the opening view of a freshly loaded model, so there is
    // nothing to animate from.
    cc.setLookAt(
      position.x, position.y, position.z,
      bounds.center.x, bounds.center.y, bounds.center.z,
      false,
    );
    // One-shot per model: see the note above about resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, camera, controls]);

  return null;
}
```

- [ ] **Step 4: Swap the control element**

Replace line 604, `<OrbitControls makeDefault />`:

```tsx
        {/* Replaces OrbitControls, which cannot express an off-centre orbit pivot: it calls
            lookAt(target) on every update, pinning the pivot to the centre of the screen.
            ViewerNavigation re-anchors this one to whatever is under the cursor.

            The default input mapping already matches what the viewer has always had —
            left rotate, middle dolly, right pan, wheel dolly — so it is left alone.

            infinityDolly is deliberately NOT set here. ViewerNavigation toggles it per wheel
            event, and a prop would fight that on re-render. */}
        <CameraControls
          makeDefault
          dollyToCursor
          smoothTime={0.15}
          draggingSmoothTime={0.08}
        />
```

- [ ] **Step 5: Typecheck, lint and build**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

Expected: no type errors, no new lint warnings, build succeeds.

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: PASS. No test covers the component, but Task 1's framing tests must not have regressed.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json components/viewers/ModelViewerInner.tsx
git commit -m "feat(viewer): move the 3D viewer to CameraControls

OrbitControls calls lookAt(target) every update, so its pivot is pinned to
the centre of the screen and an off-centre orbit pivot cannot be expressed.
camera-controls provides setOrbitPoint, which moves the pivot without moving
the camera. Input mapping is unchanged; damping is now on.

camera-controls was already installed as a drei dependency; this makes it
a direct one rather than relying on the hoist."
```

---

### Task 4: Anchor the pivot to the surface under the cursor

> **Superseded — do not implement the code below.** The wheel does not re-anchor the pivot in
> the shipped code, so the wheel raycast, the `anchoredThisFrame` throttle and its `useFrame`
> do not exist. `infinityDolly` is additionally cleared on pointer-down and on unmount, and the
> orbit raycast skips cross-section-clipped hits. See the banner at the top.

**Files:**
- Create: `components/viewers/ViewerNavigation.tsx`
- Modify: `components/viewers/ModelViewerInner.tsx` (import, and mount inside `<Suspense>`)

**Interfaces:**
- Consumes: `pivotForPointer`, `clampAnchorDistance`, `isZoomingIn`, `Vec3` from Task 2; `isPointerOverGizmo(x, y, canvasWidth)` from `@/lib/gizmoLayout`; `controls.minDistance` / `controls.maxDistance` set by Task 3.
- Produces: `<ViewerNavigation modelRef={...} center={...} />`, default export, renders null.

- [ ] **Step 1: Write the component**

Create `components/viewers/ViewerNavigation.tsx`:

```tsx
'use client';

import { useThree, useFrame } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import type CameraControlsImpl from 'camera-controls';
import { isPointerOverGizmo } from '@/lib/gizmoLayout';
import { pivotForPointer, clampAnchorDistance, isZoomingIn, type Vec3 } from '@/lib/viewerNavigation';

interface ViewerNavigationProps {
  modelRef: React.RefObject<THREE.Object3D>;
  /** Where a rotate drag pivots when it starts over empty background. */
  center: THREE.Vector3;
}

/**
 * Anchors the camera's orbit pivot to whatever the cursor is over.
 *
 * Dolly and truck steps are a percentage of the pivot distance, so the pivot decides how fast
 * every gesture feels. Pinned to the model's centre — as it was — that percentage is measured
 * against an abstract point the user is not looking at, and collapses to nothing as they move
 * in. Measured against the surface under the cursor instead, it is scale-free: a 1-unit part
 * and a 5,000-unit building behave identically, at every zoom level.
 *
 * Listeners are in the CAPTURE phase because camera-controls listens in the bubble phase. That
 * ordering is the point: the pivot is already re-anchored by the time the library handles the
 * same event, so the very first notch of a scroll uses the new pivot rather than the old one.
 */
export default function ViewerNavigation({ modelRef, center }: ViewerNavigationProps) {
  const { camera, gl, controls } = useThree();

  const raycaster = useRef(new THREE.Raycaster());
  const ndc = useRef(new THREE.Vector2());
  const scratch = useRef(new THREE.Vector3());
  // Raycasts are capped at one per rendered frame; cleared below in useFrame. A trackpad
  // emits wheel events far faster than frames, and an unthrottled raycast against a
  // several-hundred-thousand-triangle model would reintroduce the stutter this work removes.
  const anchoredThisFrame = useRef(false);

  const hitUnderPointer = useCallback(
    (clientX: number, clientY: number): Vec3 | null => {
      const model = modelRef.current;
      if (!model) return null;

      const rect = gl.domElement.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      // The view gizmo is a HUD layer, not scene geometry, and its React Three Fiber
      // stopPropagation does not reach these native listeners — so exclude its rect by hand,
      // as SceneInteraction does.
      if (isPointerOverGizmo(x, y, rect.width)) return null;

      ndc.current.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
      raycaster.current.setFromCamera(ndc.current, camera);

      // Scoped to the model alone, not the scene: the ground disc, contact shadow and axis
      // lines are all Mesh-derived and large enough to fill the viewport, so an unscoped
      // raycast would report a hit for empty background and defeat the centre fallback.
      const hits = raycaster.current.intersectObject(model, true);
      for (const hit of hits) {
        if (hit.object instanceof THREE.Mesh || hit.object instanceof THREE.SkinnedMesh) {
          return [hit.point.x, hit.point.y, hit.point.z];
        }
      }
      return null;
    },
    [camera, gl, modelRef],
  );

  const anchorPivot = useCallback(
    (clientX: number, clientY: number, fallback: Vec3 | null) => {
      const cc = controls as unknown as CameraControlsImpl | null;
      if (!cc?.setOrbitPoint) return;

      const pivot = pivotForPointer(hitUnderPointer(clientX, clientY), fallback);
      if (!pivot) return;

      const offset = scratch.current.set(pivot[0], pivot[1], pivot[2]).sub(camera.position);
      const distance = offset.length();
      if (distance === 0) return;

      // Limits live on the controls, assigned by FitCameraToModel from the model's framing.
      const clamped = clampAnchorDistance(distance, cc.minDistance, cc.maxDistance);
      offset.multiplyScalar(clamped / distance).add(camera.position);

      cc.setOrbitPoint(offset.x, offset.y, offset.z);
    },
    [camera, controls, hitUnderPointer],
  );

  useEffect(() => {
    const canvas = gl.domElement;
    const cc = controls as unknown as CameraControlsImpl | null;

    const onPointerDown = (event: PointerEvent) => {
      // Left button only — that is the rotate action in camera-controls' default mapping.
      if (event.button !== 0) return;
      // Background drags fall back to the model's centre, which is what makes a drag started
      // over empty space orbit the whole object and keep it in frame.
      anchorPivot(event.clientX, event.clientY, [center.x, center.y, center.z]);
    };

    const onWheel = (event: WheelEvent) => {
      // infinityDolly holds the distance and pushes the pivot instead of stopping at a limit.
      // That is wanted zooming IN — it is what lets the camera approach a wall and keep going
      // rather than freezing asymptotically. It is NOT wanted zooming out: the same branch
      // fires on maxDistance and would push the pivot away without limit, shrinking the model
      // to nothing and eventually clipping it through the far plane, with no reset control to
      // recover. So it is enabled per event, by direction.
      if (cc) cc.infinityDolly = isZoomingIn(event.deltaY);

      if (anchoredThisFrame.current) return;
      anchoredThisFrame.current = true;
      // No fallback: scrolling over background leaves the pivot where the user put it.
      anchorPivot(event.clientX, event.clientY, null);
    };

    canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
    canvas.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown, { capture: true });
      canvas.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, [gl, controls, anchorPivot, center]);

  useFrame(() => {
    anchoredThisFrame.current = false;
  });

  return null;
}
```

- [ ] **Step 2: Mount it**

In `components/viewers/ModelViewerInner.tsx`, add the import beside the other viewer components (near line 23):

```typescript
import ViewerNavigation from './ViewerNavigation';
```

Then mount it immediately after the `{bounds && <FitCameraToModel bounds={bounds} />}` line:

```tsx
          {bounds && <ViewerNavigation modelRef={modelRef} center={bounds.center} />}
```

Gated on `bounds` for the same reason `FitCameraToModel` is: before the model is measured there is no centre to fall back to.

- [ ] **Step 3: Typecheck, lint and build**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

Expected: no type errors, no new lint warnings, build succeeds.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/viewers/ViewerNavigation.tsx components/viewers/ModelViewerInner.tsx
git commit -m "feat(viewer): anchor the camera pivot to the surface under the cursor

Dolly and truck steps are a percentage of the pivot distance, so the pivot
decides how fast every gesture feels. Anchoring it to what the cursor is over
makes both scale-free, and makes orbit rotate around the thing being looked at
instead of around wherever panning left the target.

Listeners are in the capture phase so the pivot is already re-anchored when
camera-controls handles the same event. Raycasts are capped at one per frame.

infinityDolly is toggled by scroll direction: it removes the stop at
maxDistance as well as the one at minDistance, and left on permanently it
would let a zoom-out push the model past the far plane."
```

---

### Task 5: Browser verification

**Files:** none — this task changes nothing. It exists because the camera behaviour cannot be asserted under node, and the whole point of the work is how it feels.

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: a pass/fail report. Any failure becomes a fix on top of Task 4, not a new task.

- [ ] **Step 1: Start the app**

Follow the project's local visual verification notes for booting without DB/S3 credentials.

```bash
npm run dev
```

- [ ] **Step 2: Verify the zoom and pan fix on a large model**

Open a model with a bounding radius in the hundreds or thousands.

- Scroll toward a wall or a corner. Each notch must move a visible, proportionate amount all the way in — no crawl, no stall.
- Keep scrolling once close. The camera must push through and keep going (`infinityDolly`), not freeze.
- Right-drag to pan while zoomed in close. Pan must move a useful amount, not creep.

- [ ] **Step 3: Verify zoom feels the same on a small model**

Open a model with a radius of a few units and repeat Step 2. The *feel* must be indistinguishable from the large model — that is the scale-free claim.

- [ ] **Step 4: Verify the zoom-out stop still exists**

Scroll out continuously on the large model. The camera must stop at the framing limit. If the model keeps shrinking indefinitely or vanishes, `infinityDolly` is stuck on and the direction toggle in `onWheel` is wrong.

- [ ] **Step 5: Verify orbit**

- Put the cursor on a specific detail and left-drag. That detail must stay roughly in place while the camera swings around it, and the view must not jump when the drag begins.
- Left-drag starting over empty background. The whole model must stay in the field of view.
- Pan far off to one side, then left-drag from empty background. The camera must orbit the model, not empty space — this is the stranded-pivot defect.

- [ ] **Step 6: Verify nothing else broke**

- **View cube:** click each face; the camera snaps. Known pre-existing drei quirk — `GizmoHelper.tweenCamera` measures its radius from the world origin rather than the resolved focus point, so a snap taken from an unusual position can frame oddly. Only report this if it is *worse* than before the change.
- **Transform gizmo:** switch to move/rotate and drag a handle. The camera must not orbit during the drag, and must orbit again afterwards.
- **Comment pins:** place a pin, confirm it lands on the surface clicked and tracks correctly while orbiting.
- **Cross-section:** open a section and confirm the cut still follows the model.
- **Snapshot:** capture one and confirm the transform handles are absent from the image.

- [ ] **Step 7: Report**

Report each step as pass or fail with what was observed. Do not claim the work is complete until every step above has actually been run — the node tests cover the arithmetic only, not the behaviour.

---

## Notes for the implementer

**Do not add `infinityDolly` as a JSX prop.** It is set imperatively per wheel event in `ViewerNavigation`. A prop on `<CameraControls>` would be reapplied by React Three Fiber and fight the toggle.

**Do not add a reset or re-frame control.** It was proposed and explicitly declined.

**`three-mesh-bvh` is out of scope.** It is available as a drei dependency and would speed up these raycasts, but frame-throttling is sufficient and adopting it would also change the comment-pin raycast path.

**If orbit feels like it jumps when a drag begins**, the cause is `setOrbitPoint` being called during an in-flight animation — its docblock warns it must not run then. The fix is to skip the anchor when `controls.active` is true, not to remove the anchoring.
