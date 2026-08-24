# Viewer Scene: Ground Plane & Axis Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the portal 3D viewer's fixed-size grid with a fading ground plane, a soft contact shadow, and three muted axis lines — all sized from the loaded model's bounding sphere so the scene reads correctly at any model scale.

**Architecture:** One measurement, four consumers. A `MeasureModel` component publishes the model's bounding sphere into `ModelViewerInner` state once per loaded model; the camera fit, ground, shadow, and axes all read it. Scene dimensions come from a pure, tested `lib/sceneScale.ts`, so the "everything derives from the bounding sphere" invariant holds by construction rather than by four copies that can drift.

**Tech Stack:** Next.js 14, React 18, `@react-three/fiber` 8.18, `@react-three/drei` 9.122, `three` 0.169, TypeScript 5. Tests run on Node's built-in runner (`node --test scripts/tests/*.mjs`), which strips TypeScript types natively on Node 22.18+ (Node 25.9 here). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-13-viewer-scene-ground-axes-design.md`

## Global Constraints

- No new npm dependencies. `ContactShadows` and `Line` are already in the installed `@react-three/drei`.
- The grid is removed entirely — no cells, no sections.
- Every scene dimension derives from the model's bounding-sphere radius. Starting constants: ground radius `4r`, ground axis half-length `2r`, Y axis length = model height, surface offset `1e-3 · r`, shadow extent `2.5r`. The visual pass may adjust the multipliers, never the proportionality.
- Colours, exact values: ground `#E4E7F0` (tunable only within the stiko neutrals `#EAEDF6`–`#E4E5EC`), X axis `#B5636B`, Y axis `#6E9178`, Z axis `#6B74A8`. Canvas background stays `#f0f0f0`.
- X and Z axes are drawn **through** the origin, spanning `−2r` to `+2r`. The Y axis runs from the origin **upward only**, `0` to model height.
- `<Center top>` puts the model's base at y=0. Consequently `bounds.center.y === height / 2`, **not** 0 — never shift by it a second time.
- Ground, shadow and axes are model-scene content: they SHOULD appear in annotation snapshots and in `renderCleanFrame()` output. Only the view gizmo is excluded.
- Docs under `docs/superpowers/` are deliberately untracked in this repo — edit them, never `git add` them.
- Never `git add -A`, `git add .`, or `git commit -a`. Commit explicit paths only. `design_handoff_portal_view/`, `docs/superpowers/` and `stiko_handoff/` must stay untracked.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `lib/sceneScale.ts` | Create | Pure scale derivation from bounding radius. No React, no three imports, so Node runs it directly. |
| `scripts/tests/sceneScale.test.mjs` | Create | Unit tests for the above. |
| `components/viewers/SceneGround.tsx` | Create | Fading ground plane + contact shadow. Sole owner of the ground colour and the gradient texture. |
| `components/viewers/SceneAxes.tsx` | Create | The three axis lines and their colours. |
| `components/viewers/ModelViewerInner.tsx` | Modify | Drop `Grid`; add `<Center top>`, `MeasureModel`, `SceneGround`, `SceneAxes`; `FitCameraToModel` consumes bounds rather than measuring. |

---

### Task 1: Scene scale derivation

**Files:**
- Create: `lib/sceneScale.ts`
- Test: `scripts/tests/sceneScale.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface SceneScale { groundRadius: number; axisHalfLength: number; surfaceOffset: number; shadowScale: number }` and `sceneScaleForRadius(radius: number): SceneScale`. Tasks 3 and 4 both call it.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/sceneScale.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneScaleForRadius } from '../../lib/sceneScale.ts';

// The viewer sees radii spanning four orders of magnitude; every property must hold across all.
const RADII = [1, 100, 1385.64, 8660.25];

test('every dimension scales linearly with the model radius', () => {
  const a = sceneScaleForRadius(10);
  const b = sceneScaleForRadius(1000);
  for (const key of ['groundRadius', 'axisHalfLength', 'surfaceOffset', 'shadowScale']) {
    assert.ok(
      Math.abs(b[key] / a[key] - 100) < 1e-9,
      `${key} is not proportional: ${a[key]} -> ${b[key]}`,
    );
  }
});

test('the ground extends beyond both the axes and the shadow', () => {
  for (const r of RADII) {
    const s = sceneScaleForRadius(r);
    assert.ok(s.groundRadius > s.axisHalfLength, `r=${r}: axes reach past the ground`);
    assert.ok(s.groundRadius > s.shadowScale, `r=${r}: shadow reaches past the ground`);
  }
});

test('the axes extend beyond the model itself', () => {
  for (const r of RADII) {
    assert.ok(sceneScaleForRadius(r).axisHalfLength > r, `r=${r}: axes would be hidden inside the model`);
  }
});

test('the stacking offsets separate ground, shadow and axes at every scale', () => {
  for (const r of RADII) {
    const { surfaceOffset } = sceneScaleForRadius(r);
    const ground = 0;
    const shadow = surfaceOffset;
    const axes = surfaceOffset * 2;
    assert.ok(shadow > ground, `r=${r}: shadow would z-fight the ground`);
    assert.ok(axes > shadow, `r=${r}: axes would z-fight the shadow`);
    // Large enough to survive depth-buffer quantisation, small enough not to look detached.
    assert.ok(surfaceOffset > r * 1e-5, `r=${r}: offset ${surfaceOffset} risks z-fighting`);
    assert.ok(surfaceOffset < r * 1e-2, `r=${r}: offset ${surfaceOffset} would float visibly`);
  }
});

test('a degenerate radius still produces a usable scene', () => {
  for (const bad of [0, -5, Number.NaN]) {
    const s = sceneScaleForRadius(bad);
    for (const [key, value] of Object.entries(s)) {
      assert.ok(Number.isFinite(value) && value > 0, `radius ${bad} produced ${key}=${value}`);
    }
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module` for `lib/sceneScale.ts`.

- [ ] **Step 3: Write the implementation**

Create `lib/sceneScale.ts`:

```ts
/**
 * Sizes for the viewer's scene furniture — ground plane, contact shadow, axis lines.
 *
 * The viewer loads geometry with no unit convention, so bounding radii span at least 1 to
 * 10,000. Anything authored at a fixed size is either invisible or overwhelming at most of
 * that range: the grid this replaces was 10 units wide, which vanished on any real model.
 * Every value here is therefore a multiple of the model's bounding radius.
 */

export interface SceneScale {
  /** Radius of the ground disc, including its faded rim. */
  groundRadius: number;
  /** Half-length of the X and Z lines, which span -axisHalfLength to +axisHalfLength. */
  axisHalfLength: number;
  /** Vertical step used to stack coplanar surfaces without z-fighting. */
  surfaceOffset: number;
  /** Half-extent of the contact shadow's footprint. */
  shadowScale: number;
}

const GROUND_RADIUS_FACTOR = 4;
const AXIS_HALF_LENGTH_FACTOR = 2;
const SHADOW_SCALE_FACTOR = 2.5;

// Proportional, not fixed: a constant offset disappears into z-fighting on a 5,000-unit
// model and becomes a visible floating gap on a 1-unit one.
const SURFACE_OFFSET_FACTOR = 1e-3;

export function sceneScaleForRadius(radius: number): SceneScale {
  // An empty or degenerate model still needs a usable scene rather than NaN.
  const r = Number.isFinite(radius) && radius > 0 ? radius : 1;

  return {
    groundRadius: r * GROUND_RADIUS_FACTOR,
    axisHalfLength: r * AXIS_HALF_LENGTH_FACTOR,
    surfaceOffset: r * SURFACE_OFFSET_FACTOR,
    shadowScale: r * SHADOW_SCALE_FACTOR,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 5 new tests, `# fail 0`.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx next lint --file lib/sceneScale.ts`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`.

- [ ] **Step 6: Commit**

```bash
git add lib/sceneScale.ts scripts/tests/sceneScale.test.mjs
git commit -m "feat(portal): derive viewer scene dimensions from model radius

Scene furniture sized for one scale is invisible or overwhelming across
the four orders of magnitude of model size the viewer actually sees."
```

---

### Task 2: Hoist the model measurement

**Files:**
- Modify: `components/viewers/ModelViewerInner.tsx`

**Interfaces:**
- Consumes: `framingForRadius` from `lib/cameraFraming.ts` (already used by `FitCameraToModel`).
- Produces: `export interface ModelBounds { center: THREE.Vector3; radius: number; height: number }`, and `bounds` state inside `ModelViewerInner` that Tasks 3 and 4 read. `FitCameraToModel` changes signature from `{ targetRef }` to `{ bounds: ModelBounds }`.

This task also switches to `<Center top>`, which is what later makes a solid ground plane viable. It leaves the grid in place — Task 3 removes it when the ground replaces it.

- [ ] **Step 1: Add the bounds type and the measuring component**

In `components/viewers/ModelViewerInner.tsx`, add next to the other exported interfaces:

```tsx
export interface ModelBounds {
  /** World-space centre of the model. With <Center top>, its y is height / 2, not 0. */
  center: THREE.Vector3;
  /** Bounding-sphere radius — the single number all scene sizing derives from. */
  radius: number;
  /** Bounding-box Y extent, used for the Y axis length and the shadow's depth range. */
  height: number;
}
```

Then add this component immediately above `FitCameraToModel`:

```tsx
/**
 * Measures the loaded model once and publishes its bounds.
 *
 * Mounted with `key={url}` inside <Suspense>, so it runs exactly once per loaded model:
 * React commits the whole boundary together, meaning the geometry is already in the scene
 * graph when this effect fires. Runs as an effect rather than a layout effect so that
 * <Center>'s own layout effect has already positioned the model.
 */
function MeasureModel({
  targetRef,
  onMeasured,
}: {
  targetRef: React.RefObject<THREE.Object3D>;
  onMeasured: (bounds: ModelBounds) => void;
}) {
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    target.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());

    onMeasured({
      center: sphere.center.clone(),
      radius: sphere.radius,
      height: box.max.y - box.min.y,
    });
    // One-shot per model; the component is remounted by key when the url changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
```

- [ ] **Step 2: Make FitCameraToModel consume the bounds**

Replace the whole `FitCameraToModel` component (its doc comment included) with:

```tsx
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

    cam.position.copy(bounds.center).addScaledVector(VIEW_DIRECTION, framing.distance);
    cam.near = framing.near;
    cam.far = framing.far;
    cam.updateProjectionMatrix();

    // OrbitControls orbits its target, so it has to move to the model's centre too —
    // otherwise a model centred away from the origin swings around empty space.
    const orbit = controls as unknown as {
      target: THREE.Vector3;
      minDistance: number;
      maxDistance: number;
      update: () => void;
    } | null;
    if (orbit?.target) {
      orbit.target.copy(bounds.center);
      orbit.minDistance = framing.minDistance;
      orbit.maxDistance = framing.maxDistance;
      orbit.update();
    }
    // One-shot per model: see the note above about resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, camera, controls]);

  return null;
}
```

- [ ] **Step 3: Wire the state into ModelViewerInner**

Extend the React import at the top of the file to include `useState`:

```tsx
import { Suspense, useRef, useCallback, useEffect, useMemo, useState, useImperativeHandle, type Ref } from 'react';
```

Inside `ModelViewerInner`, replace the single `modelRef` line with:

```tsx
  const modelRef = useRef<THREE.Group>(null);
  const [bounds, setBounds] = useState<ModelBounds | null>(null);

  // Drop stale sizing the moment a different model is selected, so the ground and axes are
  // never drawn at the previous model's scale.
  useEffect(() => setBounds(null), [url]);
```

Then replace the `<Center>` block and the `FitCameraToModel` line with:

```tsx
          {/* bottom: the model's base sits at y=0 so it rests on the ground plane rather
              than being bisected by it. */}
          <Center top>
            <group ref={modelRef}>
              <Model url={url} />
            </group>
          </Center>
          <MeasureModel key={url} targetRef={modelRef} onMeasured={setBounds} />
          {bounds && <FitCameraToModel key={url} bounds={bounds} />}
```

- [ ] **Step 4: Type-check, lint and test**

Run: `npx tsc --noEmit && npx next lint --file components/viewers/ModelViewerInner.tsx && npm test`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add components/viewers/ModelViewerInner.tsx
git commit -m "refactor(portal): measure the model once, share the bounds

The ground, shadow and axes all need the same bounding sphere the camera
fit already computes. Measuring once keeps them from drifting apart.

Also switches to <Center top> so the model rests on y=0 instead of
straddling it, which is what makes a solid ground plane viable."
```

---

### Task 3: Fading ground plane and contact shadow

**Files:**
- Create: `components/viewers/SceneGround.tsx`
- Modify: `components/viewers/ModelViewerInner.tsx`

**Interfaces:**
- Consumes: `sceneScaleForRadius` from `lib/sceneScale.ts` (Task 1); `ModelBounds` state from `ModelViewerInner` (Task 2).
- Produces: default-exported `SceneGround` taking `{ radius: number; height: number }`.

**The one non-obvious detail:** three.js samples `alphaMap` from the texture's **green channel**, not its alpha channel. A white-to-transparent canvas gradient leaves green at 255 everywhere and produces no fade at all. The gradient must run white to **black**.

- [ ] **Step 1: Write the component**

Create `components/viewers/SceneGround.tsx`:

```tsx
'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { ContactShadows } from '@react-three/drei';
import { sceneScaleForRadius } from '@/lib/sceneScale';

// Slightly darker than the #f0f0f0 canvas background, and cool enough to sit under the
// #8899aa model without muddying it.
const GROUND_COLOR = '#E4E7F0';
const SHADOW_COLOR = '#1C2030';

/**
 * A radial white-to-black gradient used as the ground's alphaMap, so the plane fades out
 * instead of ending at a visible edge.
 *
 * White to BLACK, not white to transparent: three samples alphaMap from the green channel,
 * so a gradient that only varies in alpha leaves green at 255 and produces no fade.
 */
function useFadeAlphaMap(): THREE.CanvasTexture {
  return useMemo(() => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      const half = size / 2;
      const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(0.55, '#ffffff'); // opaque under and around the model
      gradient.addColorStop(1, '#000000'); // fully faded at the rim
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }

    return new THREE.CanvasTexture(canvas);
  }, []);
}

export default function SceneGround({ radius, height }: { radius: number; height: number }) {
  const scale = sceneScaleForRadius(radius);
  const alphaMap = useFadeAlphaMap();

  // A perfectly flat model (a plane, a 2D DXF-style export) has zero height, which would
  // give the shadow camera a zero depth range and render nothing. groundRadius / 4 is the
  // guarded radius from sceneScaleForRadius, so this is never zero.
  const shadowFar = Math.max(height, scale.groundRadius / 4) * 1.1;

  return (
    <>
      {/* circleGeometry is authored in the XY plane; rotate it flat. depthWrite is off so
          the transparent rim composites over the background instead of punching a hole. */}
      <mesh position={[0, scale.groundY, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
        <circleGeometry args={[scale.groundRadius, 64]} />
        <meshBasicMaterial
          color={GROUND_COLOR}
          alphaMap={alphaMap}
          transparent
          depthWrite={false}
        />
      </mesh>

      {/* frames={1} renders the shadow map once. The model never moves and the shadow is
          camera independent, so a per-frame depth pass would be pure waste. */}
      <ContactShadows
        position={[0, scale.shadowY, 0]}
        scale={scale.shadowScale * 2}
        far={shadowFar}
        blur={2.5}
        opacity={0.45}
        color={SHADOW_COLOR}
        resolution={1024}
        frames={1}
      />
    </>
  );
}
```

- [ ] **Step 2: Replace the grid with it**

In `components/viewers/ModelViewerInner.tsx`, remove `Grid` from the drei import so the line reads:

```tsx
import { OrbitControls, Environment, Center } from '@react-three/drei';
```

Add the component import next to the other local ones:

```tsx
import SceneGround from './SceneGround';
```

Delete the entire `<Grid ... />` element, and in its place render:

```tsx
          {bounds && <SceneGround radius={bounds.radius} height={bounds.height} />}
```

- [ ] **Step 3: Type-check, lint and test**

Run: `npx tsc --noEmit && npx next lint --file components/viewers/SceneGround.tsx --file components/viewers/ModelViewerInner.tsx && npm test`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`, `# fail 0`.

Note: if `tsc` reports `Grid` is declared but never used, the import was not fully removed.

- [ ] **Step 4: Commit**

```bash
git add components/viewers/SceneGround.tsx components/viewers/ModelViewerInner.tsx
git commit -m "feat(portal): fading ground plane and contact shadow

Replaces the 10-unit grid, which was invisible on any real model. The
ground fades at its rim rather than ending at an edge, and a soft contact
shadow gives the object a readable position in space."
```

---

### Task 4: Axis lines

**Files:**
- Create: `components/viewers/SceneAxes.tsx`
- Modify: `components/viewers/ModelViewerInner.tsx`

**Interfaces:**
- Consumes: `sceneScaleForRadius` from `lib/sceneScale.ts` (Task 1); `ModelBounds` state from `ModelViewerInner` (Task 2).
- Produces: default-exported `SceneAxes` taking `{ radius: number; height: number }`.

drei's `Line` wraps `Line2`/`LineMaterial`, so `lineWidth` is in **screen pixels** and stays legible at any model scale. A plain `THREE.Line` is locked to 1px on most platforms, and a world-space tube would be invisible on a 5,000-unit model.

- [ ] **Step 1: Write the component**

Create `components/viewers/SceneAxes.tsx`:

```tsx
'use client';

import { Line } from '@react-three/drei';
import { sceneScaleForRadius } from '@/lib/sceneScale';

// Muted and brand-tinted: hue-correct so the conventional X/Y/Z reading survives, but
// desaturated so they recede behind the model. Deliberately NOT the view gizmo's saturated
// triad — the gizmo is a foreground control, these are background reference.
const AXIS_X_COLOR = '#B5636B';
const AXIS_Y_COLOR = '#6E9178';
const AXIS_Z_COLOR = '#6B74A8';

// Screen pixels, courtesy of Line2 — scale independent by construction.
const AXIS_LINE_WIDTH = 1.5;

export default function SceneAxes({ radius, height }: { radius: number; height: number }) {
  const scale = sceneScaleForRadius(radius);

  // axesY is two steps up: one clears the ground, the second clears the contact shadow.
  // The stack ordering lives in sceneScale.ts so it is tested, not re-derived here.
  const y = scale.axesY;
  const half = scale.axisHalfLength;

  // A perfectly flat model has zero height, which would make the Y axis a zero-length line.
  // Fall back to a short stub so the vertical direction is still marked.
  const yAxisTop = height > 0 ? height : half / 2;

  return (
    <>
      <Line
        points={[
          [-half, y, 0],
          [half, y, 0],
        ]}
        color={AXIS_X_COLOR}
        lineWidth={AXIS_LINE_WIDTH}
      />
      <Line
        points={[
          [0, y, -half],
          [0, y, half],
        ]}
        color={AXIS_Z_COLOR}
        lineWidth={AXIS_LINE_WIDTH}
      />
      {/* Upward only, and only as tall as the model: a full-length vertical line reads as a
          pole skewering the object. */}
      <Line
        points={[
          [0, y, 0],
          [0, yAxisTop, 0],
        ]}
        color={AXIS_Y_COLOR}
        lineWidth={AXIS_LINE_WIDTH}
      />
    </>
  );
}
```

- [ ] **Step 2: Render it**

In `components/viewers/ModelViewerInner.tsx`, add the import next to `SceneGround`:

```tsx
import SceneAxes from './SceneAxes';
```

And render it immediately after the `SceneGround` line:

```tsx
          {bounds && <SceneAxes radius={bounds.radius} height={bounds.height} />}
```

- [ ] **Step 3: Type-check, lint and test**

Run: `npx tsc --noEmit && npx next lint --file components/viewers/SceneAxes.tsx --file components/viewers/ModelViewerInner.tsx && npm test`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`, `# fail 0`.

- [ ] **Step 4: Commit**

```bash
git add components/viewers/SceneAxes.tsx components/viewers/ModelViewerInner.tsx
git commit -m "feat(portal): muted axis lines on the ground plane

X and Z through the origin, Y up to the model's height, so the object's
position and size in the scene are readable at a glance."
```

---

### Task 5: Visual tuning and verification

**Files:**
- Modify (tuning only): `components/viewers/SceneGround.tsx`, `components/viewers/SceneAxes.tsx`, `lib/sceneScale.ts`
- Create then delete (never committed): `scripts/make-sample-stl.mjs`, `public/uploads/sample-*.stl`, `app/portal/dev-gizmo/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: nothing.

This task is the eye. The numbers from Tasks 1–4 are defensible starting values, not verified ones.

- [ ] **Step 1: Build the dev harness**

Create `scripts/make-sample-stl.mjs`, which writes open-ended tubes at four scales as binary STL:

```js
// Dev-harness only. Open-ended tubes so the samples also exercise double-sided materials.
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.cwd();
const THREE = await import(path.join(REPO, 'node_modules/three/build/three.module.js'));

const OUT_DIR = path.join(REPO, 'public/uploads');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SIZES = { small: 1, medium: 100, large: 800, huge: 5000 };

for (const [name, r] of Object.entries(SIZES)) {
  const geom = new THREE.CylinderGeometry(r, r, r * 2, 48, 1, true).toNonIndexed();
  const pos = geom.getAttribute('position');
  const triCount = pos.count / 3;

  const buf = Buffer.alloc(84 + triCount * 50);
  buf.write(`stiko dev sample ${name}`.padEnd(80, ' '), 0, 80, 'ascii');
  buf.writeUInt32LE(triCount, 80);

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  let o = 84;
  for (let i = 0; i < triCount; i++) {
    a.fromBufferAttribute(pos, i * 3);
    b.fromBufferAttribute(pos, i * 3 + 1);
    c.fromBufferAttribute(pos, i * 3 + 2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    for (const v of [n, a, b, c]) {
      buf.writeFloatLE(v.x, o);
      buf.writeFloatLE(v.y, o + 4);
      buf.writeFloatLE(v.z, o + 8);
      o += 12;
    }
    buf.writeUInt16LE(0, o);
    o += 2;
  }

  fs.writeFileSync(path.join(OUT_DIR, `sample-${name}.stl`), buf);
  console.log(`wrote public/uploads/sample-${name}.stl (radius ${r})`);
}
```

Run: `node scripts/make-sample-stl.mjs`
Expected: four `wrote public/uploads/sample-*.stl` lines.

Samples must live under `public/uploads/` specifically: `middleware.ts`'s matcher excludes `uploads`, so the file is served raw. Anywhere else in `public/` it is redirected to `/login` and the STL loader parses HTML.

Create `app/portal/dev-gizmo/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import ModelViewer from '@/components/viewers/ModelViewer';

// Dev harness. /portal/dev-gizmo?size=small|medium|large|huge
export default function DevGizmoPage() {
  const [size, setSize] = useState('small');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('size');
    if (q) setSize(q);
  }, []);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <ModelViewer key={size} url={`/uploads/sample-${size}.stl`} />
      <div style={{ position: 'absolute', top: 8, left: 8, font: '12px monospace', zIndex: 10 }}>
        size={size}
      </div>
    </div>
  );
}
```

`/portal/*` is the one prefix `middleware.ts` lets through unauthenticated, and a static segment beats the `[id]` dynamic one.

- [ ] **Step 2: Run the dev server**

Run: `AUTH_SECRET=dev-only DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' npm run dev`

Both variables are required even though this page queries nothing: `middleware.ts` imports `lib/auth` → `lib/db`, which throws at module load without `DATABASE_URL`. `neon()` connects lazily, so a fake URL is fine. Supply them inline — do **not** create a `.env.local`, which would shadow real configuration later.

Expected: `✓ Ready`.

- [ ] **Step 3: Inspect all four scales**

Open `http://localhost:3000/portal/dev-gizmo?size=small`, then `medium`, `large`, `huge`, screenshotting each.

Confirm at every scale:
1. The ground fades out with **no visible edge or hard rim**.
2. The model **rests on** the ground — no intersection, no floating gap.
3. The contact shadow sits under the object and reads as soft, not as a hard disc.
4. The three axis lines are legible but do not dominate the model.
5. **No z-fighting** — no shimmering or stripe patterns where ground, shadow and axes meet. Orbit to a low, near-grazing angle, which is where coplanar surfaces fight worst.
6. The ground reads as *slightly* darker than the background, not as a distinct slab.

- [ ] **Step 4: Tune and re-check**

Adjust only these, then re-screenshot the affected scales:
- Ground too subtle or too heavy → `GROUND_COLOR` in `SceneGround.tsx`, staying within `#EAEDF6`–`#E4E5EC`.
- Fade ending too abruptly or too soon → the `0.55` gradient stop in `useFadeAlphaMap`.
- Shadow too dark or too tight → `opacity` / `blur` on `ContactShadows`.
- Axes too loud or too faint → `AXIS_LINE_WIDTH` in `SceneAxes.tsx`.
- Z-fighting at any scale → raise `SURFACE_OFFSET_FACTOR` in `lib/sceneScale.ts`, then re-run `npm test` (the stacking test bounds it to `1e-5·r`–`1e-2·r`).

- [ ] **Step 5: Confirm the annotation snapshot still behaves**

The ground, shadow and axes are scene content and SHOULD appear in snapshots; only the view gizmo is excluded. With the harness running, in the browser console:

```js
const c = document.querySelector('canvas');
const grab = () => {
  const off = document.createElement('canvas');
  off.width = c.width; off.height = c.height;
  const ctx = off.getContext('2d');
  ctx.fillStyle = '#f0f0f0'; ctx.fillRect(0, 0, off.width, off.height);
  ctx.drawImage(c, 0, 0);
  const dpr = c.width / c.getBoundingClientRect().width;
  const s = Math.round(200 * dpr);
  const d = ctx.getImageData(off.width - s, off.height - s, s, s).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] !== 0xf0 || d[i+1] !== 0xf0 || d[i+2] !== 0xf0) n++;
  return n;
};
console.log('gizmo corner:', grab());
```

Expected: a large count, because the gizmo occupies that corner in a normal frame. This confirms Task 3's `renderCleanFrame` path is unaffected by the new scene content.

- [ ] **Step 6: Delete the harness**

```bash
rm -rf app/portal/dev-gizmo public/uploads scripts/make-sample-stl.mjs .next/types/app/portal/dev-gizmo
```

Deleting the route without clearing its generated types leaves `tsc` failing on a stale `.next/types` entry.

- [ ] **Step 7: Full verification**

Run: `npm test && npx tsc --noEmit && npx next lint`
Expected: `# fail 0`, no `tsc` output, `✔ No ESLint warnings or errors`.

- [ ] **Step 8: Confirm the tree is clean**

Run: `git status --short`
Expected: no `dev-gizmo`, `sample-*.stl` or `make-sample-stl.mjs` entries. The pre-existing untracked `design_handoff_portal_view/`, `docs/superpowers/` and `stiko_handoff/` are expected and must be left alone.

- [ ] **Step 9: Commit any tuning**

Only if Step 4 changed values:

```bash
git add components/viewers/SceneGround.tsx components/viewers/SceneAxes.tsx lib/sceneScale.ts
git commit -m "polish(portal): tune ground, shadow and axis values against the viewport"
```
