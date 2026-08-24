# 3D View Gizmo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CAD-style view-orientation gizmo (labelled navigation cube + axis triad) to the bottom-right of the portal's 3D viewport, themed to the stiko palette, without leaking into annotation snapshots or stealing comment-pin clicks.

**Architecture:** Compose `@react-three/drei`'s `GizmoHelper` + `GizmoViewcube` + `GizmoViewport` inside the existing `<Canvas>` in `ModelViewerInner.tsx`. The gizmo's screen-space geometry lives in a dependency-free module (`lib/gizmoLayout.ts`) so the pin-click guard can be unit-tested. Snapshot exclusion works by exposing an imperative `renderCleanFrame()` handle that re-renders the model scene alone immediately before the snapshot reads pixels.

**Tech Stack:** Next.js 14, React 18, `@react-three/fiber` 8.18, `@react-three/drei` 9.122, `three` 0.169, TypeScript 5. Tests run on Node's built-in runner (`node --test`), which strips TypeScript types natively on Node 22.18+ — verified on the Node 25.9 in this environment. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-26-3d-view-gizmo-design.md`

## Global Constraints

- No new npm dependencies. Everything needed is already installed.
- Palette, copied verbatim from the spec: faces `#FFFFFF`, label ink `#1C2030`, hover `#5B60FF`, stroke `#E4E5EC`. Axes stay conventional X-red / Y-green / Z-blue.
- Gizmo position: bottom-right of the 3D viewport.
- The axis triad is **display-only** (drei's `disabled` prop). Only the cube is interactive.
- The gizmo must **not** appear in annotation snapshots.
- All gizmo screen-space values are **CSS pixels**, never drawing-buffer pixels. `canvas.width` is scaled by `devicePixelRatio`; drei's HUD camera is pixel-matched to React Three Fiber's `state.size`, which is the CSS size.
- Imperative handles cross the `next/dynamic` boundary as a `handleRef` **prop**, never React `ref` — the established pattern in `components/viewers/PDFKonvaViewer.tsx:39`.
- Out of scope: the curved rotation arrows and the small cube dropdown from the reference screenshot.
- The dev harness files created in Task 2 are **never committed**. Task 5 deletes them.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `lib/gizmoLayout.ts` | Create | Gizmo screen-space constants + the pure `isPointerOverGizmo` predicate. No React, no three imports, so Node can run it directly. |
| `scripts/tests/gizmoLayout.test.mjs` | Create | Unit tests for the predicate. |
| `package.json` | Modify | Add the `test` script. |
| `components/viewers/ViewGizmo.tsx` | Create | The composed, themed gizmo. Sole owner of the drei composition and palette. |
| `components/viewers/ModelViewerInner.tsx` | Modify | Render the gizmo; expose `renderCleanFrame()`; guard the pin handler. |
| `components/viewers/ModelViewer.tsx` | Modify | Re-export the handle type through the dynamic wrapper. |
| `components/viewers/ViewerContainer.tsx` | Modify | Thread `modelViewerRef` down to `ModelViewer`. |
| `app/portal/[id]/page.tsx` | Modify | Own the ref; call `renderCleanFrame()` before capturing. |
| `docs/superpowers/specs/2026-07-26-3d-view-gizmo-design.md` | Modify | Record that the predicate lives in `lib/gizmoLayout.ts`, not `ViewGizmo.tsx`. |

**Refinement against the spec (Task 1 records it):** the spec placed `isPointerOverGizmo` and the layout constants in `ViewGizmo.tsx`. They move to `lib/gizmoLayout.ts` because `ViewGizmo.tsx` imports React and drei, which Node's test runner cannot load. Behaviour is unchanged; only the module boundary moves.

---

### Task 1: Gizmo layout math

**Files:**
- Create: `lib/gizmoLayout.ts`
- Test: `scripts/tests/gizmoLayout.test.mjs`
- Modify: `package.json` (add `test` script)
- Modify: `docs/superpowers/specs/2026-07-26-3d-view-gizmo-design.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `GIZMO_MARGIN_PX: number` (80), `GIZMO_HALF_EXTENT_PX: number` (60), and `isPointerOverGizmo(x: number, y: number, canvasWidth: number, canvasHeight: number): boolean`. Task 2 imports the margin constant; Task 4 imports the predicate.

**Why the centre lands where it does** — `GizmoHelper` positions its group at `(size.width / 2 - marginX, -size.height / 2 + marginY)` in a pixel-matched orthographic space whose origin is the canvas centre with +y up (`node_modules/@react-three/drei/core/GizmoHelper.js`, and the frustum defaults at `node_modules/@react-three/drei/core/OrthographicCamera.js:66-69`). Converting to a top-left origin with +y down gives a centre of `(width - margin, height - margin)`.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/gizmoLayout.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GIZMO_MARGIN_PX,
  GIZMO_HALF_EXTENT_PX,
  isPointerOverGizmo,
} from '../../lib/gizmoLayout.ts';

const W = 1000;
const H = 800;
const cx = W - GIZMO_MARGIN_PX; // 920
const cy = H - GIZMO_MARGIN_PX; // 720

test('the centre of the gizmo is a hit', () => {
  assert.equal(isPointerOverGizmo(cx, cy, W, H), true);
});

test('the other three corners are misses', () => {
  assert.equal(isPointerOverGizmo(0, 0, W, H), false);
  assert.equal(isPointerOverGizmo(W, 0, W, H), false);
  assert.equal(isPointerOverGizmo(0, H, W, H), false);
});

test('the middle of the viewport is a miss', () => {
  assert.equal(isPointerOverGizmo(W / 2, H / 2, W, H), false);
});

test('boundaries are inclusive and one pixel beyond is a miss', () => {
  assert.equal(isPointerOverGizmo(cx - GIZMO_HALF_EXTENT_PX, cy, W, H), true);
  assert.equal(isPointerOverGizmo(cx - GIZMO_HALF_EXTENT_PX - 1, cy, W, H), false);
  assert.equal(isPointerOverGizmo(cx + GIZMO_HALF_EXTENT_PX, cy, W, H), true);
  assert.equal(isPointerOverGizmo(cx + GIZMO_HALF_EXTENT_PX + 1, cy, W, H), false);
  assert.equal(isPointerOverGizmo(cx, cy - GIZMO_HALF_EXTENT_PX, W, H), true);
  assert.equal(isPointerOverGizmo(cx, cy - GIZMO_HALF_EXTENT_PX - 1, W, H), false);
  assert.equal(isPointerOverGizmo(cx, cy + GIZMO_HALF_EXTENT_PX, W, H), true);
  assert.equal(isPointerOverGizmo(cx, cy + GIZMO_HALF_EXTENT_PX + 1, W, H), false);
});

test('the rect tracks a different canvas size', () => {
  const w2 = 400;
  const h2 = 300;
  assert.equal(isPointerOverGizmo(w2 - GIZMO_MARGIN_PX, h2 - GIZMO_MARGIN_PX, w2, h2), true);
  assert.equal(isPointerOverGizmo(cx, cy, w2, h2), false);
});
```

- [ ] **Step 2: Add the test script to `package.json`**

In the `"scripts"` block, add the `test` entry (keep the existing entries as they are):

```json
    "lint": "next lint",
    "test": "node --test scripts/tests/",
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module` for `lib/gizmoLayout.ts`, because the module does not exist yet.

- [ ] **Step 4: Write the implementation**

Create `lib/gizmoLayout.ts`:

```ts
/**
 * Screen-space layout of the 3D view gizmo.
 *
 * drei's GizmoHelper renders through a Hud whose OrthographicCamera is pixel-matched
 * (left: -width/2 … right: width/2) and positions the gizmo group at
 * (width/2 - margin, -height/2 + margin), origin at the canvas centre with +y up.
 * In top-left-origin coordinates that puts the gizmo's centre at (width - margin,
 * height - margin).
 *
 * Every value here is CSS pixels — matching React Three Fiber's `state.size` and
 * getBoundingClientRect() — NOT drawing-buffer pixels, which devicePixelRatio scales.
 */

export const GIZMO_MARGIN_PX = 80;

/**
 * Half-width of the square the cube and triad can occupy. The cube is 60px on a side, so a
 * corner-on view reaches 60 * sqrt(3) / 2 ≈ 52px from centre; the triad accounts for the rest.
 */
export const GIZMO_HALF_EXTENT_PX = 60;

/** True when a pointer at (x, y) is over the gizmo and should not reach the scene. */
export function isPointerOverGizmo(
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  const centerX = canvasWidth - GIZMO_MARGIN_PX;
  const centerY = canvasHeight - GIZMO_MARGIN_PX;
  return (
    Math.abs(x - centerX) <= GIZMO_HALF_EXTENT_PX &&
    Math.abs(y - centerY) <= GIZMO_HALF_EXTENT_PX
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 5 tests passing, `# fail 0`.

- [ ] **Step 6: Record the module-boundary refinement in the spec**

In `docs/superpowers/specs/2026-07-26-3d-view-gizmo-design.md`, in the `components/viewers/ViewGizmo.tsx (new)` section, replace the two bullets describing the constants and predicate with:

```markdown
- `GIZMO_MARGIN_PX`, `GIZMO_HALF_EXTENT_PX`, `isPointerOverGizmo(x, y, canvasWidth, canvasHeight)` live in `lib/gizmoLayout.ts`, not here. `ViewGizmo.tsx` imports React and drei, which Node's test runner cannot load, so the pure layout math moves to a dependency-free module and `ViewGizmo` imports the margin constant from it. All four arguments are **CSS pixels, not drawing-buffer pixels**, with the origin at the canvas's top-left: `canvas.width` is scaled by device pixel ratio, whereas drei's HUD camera is pixel-matched to React Three Fiber's `state.size`, which is the CSS size. Callers pass `getBoundingClientRect()` values, which is what `handlePointerDown` already computes.
```

- [ ] **Step 7: Type-check and lint**

Run: `npx tsc --noEmit && npx next lint --file lib/gizmoLayout.ts`
Expected: no output from `tsc`, and `✔ No ESLint warnings or errors`.

- [ ] **Step 8: Commit**

```bash
git add lib/gizmoLayout.ts scripts/tests/gizmoLayout.test.mjs package.json docs/superpowers/specs/2026-07-26-3d-view-gizmo-design.md
git commit -m "feat(portal): gizmo screen-space layout math

Pure module so the pin-click guard can be unit-tested without React or
drei. Adds a node --test runner script; the repo had no test target."
```

---

### Task 2: The gizmo component, rendered in the viewport

**Files:**
- Create: `components/viewers/ViewGizmo.tsx`
- Modify: `components/viewers/ModelViewerInner.tsx`
- Create (never committed): `scripts/make-sample-stl.mjs`, `public/dev-sample.stl`, `app/portal/dev-gizmo/page.tsx`

**Interfaces:**
- Consumes: `GIZMO_MARGIN_PX` from `lib/gizmoLayout.ts` (Task 1).
- Produces: a default-exported `ViewGizmo` React component taking no props.

This task has no unit test — it is rendering. Verification is a screenshot. The harness also exercises the double-sided material fix from commit `caf72e3`, since the sample model is an open-ended tube.

- [ ] **Step 1: Write the gizmo component**

Create `components/viewers/ViewGizmo.tsx`:

```tsx
'use client';

import { GizmoHelper, GizmoViewcube, GizmoViewport } from '@react-three/drei';
import { GIZMO_MARGIN_PX } from '@/lib/gizmoLayout';

// A canvas 2D font shorthand, not CSS: drei bakes face labels into a CanvasTexture.
// next/font hashes Manrope's family name, so it cannot be referenced here — the labels
// are short and uppercase, so a system stack is indistinguishable.
const GIZMO_FONT = '600 20px Inter, system-ui, -apple-system, sans-serif';

// drei's face order is +X, -X, +Y, -Y, +Z, -Z.
const FACES = ['Right', 'Left', 'Top', 'Bottom', 'Front', 'Back'];

export default function ViewGizmo() {
  return (
    <GizmoHelper alignment="bottom-right" margin={[GIZMO_MARGIN_PX, GIZMO_MARGIN_PX]}>
      <GizmoViewcube
        font={GIZMO_FONT}
        faces={FACES}
        color="#FFFFFF"
        hoverColor="#5B60FF"
        textColor="#1C2030"
        strokeColor="#E4E5EC"
      />
      {/* Display-only: the cube's six faces already snap to the six axis views, so
          interactive axis heads would be a second hit target for the same action. */}
      <group position={[-30, -30, 30]} scale={45}>
        <GizmoViewport
          disabled
          hideNegativeAxes
          axisColors={['#E5484D', '#30A46C', '#3E63DD']}
          labelColor="#1C2030"
          font={GIZMO_FONT}
        />
      </group>
    </GizmoHelper>
  );
}
```

- [ ] **Step 2: Render it in the viewport**

In `components/viewers/ModelViewerInner.tsx`, add the import next to the other local imports:

```tsx
import ViewGizmo from './ViewGizmo';
```

Then add the component inside `<Canvas>`, immediately after the `<OrbitControls makeDefault />` line, so it sits outside `<Suspense>` and stays visible while a model loads:

```tsx
        <OrbitControls makeDefault />
        <ViewGizmo />
      </Canvas>
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx next lint --file components/viewers/ViewGizmo.tsx --file components/viewers/ModelViewerInner.tsx`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`.

- [ ] **Step 4: Generate a sample model for the harness**

Create `scripts/make-sample-stl.mjs`:

```js
// Dev-harness only. Writes an open-ended tube as binary STL so the viewer has something
// to load without a database or S3. Open-ended so it also exercises double-sided materials.
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.cwd();
const THREE = await import(path.join(REPO, 'node_modules/three/build/three.module.js'));

const geom = new THREE.CylinderGeometry(1, 1, 2, 48, 1, true).toNonIndexed();
const pos = geom.getAttribute('position');
const triCount = pos.count / 3;

const buf = Buffer.alloc(84 + triCount * 50);
buf.write('stiko dev sample'.padEnd(80, ' '), 0, 80, 'ascii');
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

fs.writeFileSync(path.join(REPO, 'public/dev-sample.stl'), buf);
console.log(`wrote public/dev-sample.stl (${triCount} triangles)`);
```

Run: `node scripts/make-sample-stl.mjs`
Expected: `wrote public/dev-sample.stl (192 triangles)`

- [ ] **Step 5: Create the harness route**

`/portal/*` is the one prefix `middleware.ts:37` lets through unauthenticated, and a static segment wins over `[id]`, so this route needs no auth.

Create `app/portal/dev-gizmo/page.tsx`:

```tsx
'use client';

import ModelViewer from '@/components/viewers/ModelViewer';

export default function DevGizmoPage() {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <ModelViewer url="/dev-sample.stl" />
    </div>
  );
}
```

- [ ] **Step 6: Run the dev server**

Run: `AUTH_SECRET=dev-only npm run dev`

`AUTH_SECRET` is supplied inline because there is no `.env.local` in this checkout and the next-auth middleware needs it. Do **not** create a `.env.local` — it would shadow real configuration later.

Expected: `✓ Ready` on `http://localhost:3000`.

- [ ] **Step 7: Screenshot and check the result**

Open `http://localhost:3000/portal/dev-gizmo` and take a screenshot.

Confirm all four:
1. The cube sits in the **bottom-right**, roughly 80px in from both edges.
2. Face labels read `FRONT` / `TOP` / `RIGHT` etc., dark ink on white, legible.
3. The axis triad is visible with X red, Y green, Z blue.
4. Orbiting the model rotates the cube in step, and clicking a cube face tweens the camera to that view.

If the triad's placement or size reads badly against the reference screenshot, tune the `position` and `scale` on the wrapping `<group>` in `ViewGizmo.tsx` and re-screenshot. Starting values are `position={[-30, -30, 30]}` and `scale={45}`; the cube spans ±30 units. If the corner placement buries the axes inside the cube, put the triad at the cube's origin (`position={[0, 0, 0]}`) with `scale={55}` so the axes emerge through the faces, which is closer to the reference.

If `GIZMO_HALF_EXTENT_PX` no longer covers the tuned footprint, update it in `lib/gizmoLayout.ts` and re-run `npm test`.

- [ ] **Step 8: Commit the component only**

Note the explicit file list — the three harness files are deliberately excluded.

```bash
git add components/viewers/ViewGizmo.tsx components/viewers/ModelViewerInner.tsx
git commit -m "feat(portal): view-orientation gizmo in the 3D viewport

Navigation cube plus a display-only axis triad, bottom-right, themed to
the stiko palette. Cube faces, edges and corners tween the camera."
```

If `GIZMO_HALF_EXTENT_PX` changed during tuning, add `lib/gizmoLayout.ts` to that `git add` too.

---

### Task 3: Keep the gizmo out of annotation snapshots

**Files:**
- Modify: `components/viewers/ModelViewerInner.tsx`
- Modify: `components/viewers/ModelViewer.tsx`
- Modify: `components/viewers/ViewerContainer.tsx`
- Modify: `app/portal/[id]/page.tsx`

**Interfaces:**
- Consumes: `ViewGizmo` rendering inside the Canvas (Task 2).
- Produces: `ModelViewerHandle { renderCleanFrame: () => void }`, exported from `components/viewers/ModelViewerInner.tsx` and re-exported from `ModelViewer.tsx` and `ViewerContainer.tsx`. `ModelViewerInnerProps` gains `handleRef?: Ref<ModelViewerHandle>`; `ViewerContainerProps` gains `modelViewerRef?: Ref<ModelViewerHandle>`.

**The problem:** drei's `Hud` draws the model scene and then the gizmo scene into the same framebuffer (`node_modules/@react-three/drei/core/Hud.js`), so `canvas.toDataURL()` in `captureViewerSnapshot` would capture the gizmo. Unmounting the gizmo on `setAnnotating(true)` cannot work — capture runs synchronously in the same tick, before React commits and before WebGL draws again.

**The mechanism:** re-render the model scene alone immediately before reading pixels. `gl.render(scene, camera)` clears and draws only the model, because `RenderHud` restores `gl.autoClear` to `true` after each frame. The next animation frame restores the gizmo on its own.

- [ ] **Step 1: Add the handle to `ModelViewerInner.tsx`**

Extend the React import at the top of the file:

```tsx
import { Suspense, useRef, useCallback, useEffect, useMemo, useImperativeHandle, type Ref } from 'react';
```

Add the handle type next to the other exported interfaces:

```tsx
export interface ModelViewerHandle {
  /**
   * Re-renders the model scene alone, without the gizmo HUD drei layers on top.
   * Call immediately before reading pixels off the canvas — the next animation frame
   * restores the normal composite.
   */
  renderCleanFrame: () => void;
}
```

Add `handleRef` to the props interface:

```tsx
export interface ModelViewerInnerProps {
  url: string;
  commentToolActive?: boolean;
  onSceneClick?: (worldPoint: { x: number; y: number; z: number }, screenPercent: { x: number; y: number }) => void;
  worldPins?: WorldPin[];
  onPinPositionsUpdate?: (positions: Map<string, PinScreenPosition>) => void;
  handleRef?: Ref<ModelViewerHandle>;
}
```

Add this component just above `export default function ModelViewerInner`. It must live inside `<Canvas>` to reach `useThree`, and outside the `Hud` portal so `camera` resolves to the main perspective camera rather than the gizmo's orthographic one:

```tsx
function CleanFrameRenderer({ handleRef }: { handleRef?: Ref<ModelViewerHandle> }) {
  const { gl, scene, camera } = useThree();
  useImperativeHandle(
    handleRef,
    () => ({
      renderCleanFrame: () => gl.render(scene, camera),
    }),
    [gl, scene, camera],
  );
  return null;
}
```

Accept the prop in the component signature:

```tsx
export default function ModelViewerInner({
  url,
  commentToolActive = false,
  onSceneClick,
  worldPins = [],
  onPinPositionsUpdate,
  handleRef,
}: ModelViewerInnerProps) {
```

And render it inside `<Canvas>`, next to `<ViewGizmo />`:

```tsx
        <OrbitControls makeDefault />
        <ViewGizmo />
        <CleanFrameRenderer handleRef={handleRef} />
      </Canvas>
```

- [ ] **Step 2: Re-export the handle type through the dynamic wrapper**

In `components/viewers/ModelViewer.tsx`, extend the existing type re-export line:

```tsx
export type { WorldPin, PinScreenPosition, ModelViewerHandle } from './ModelViewerInner';
```

No other change is needed — `ModelViewer` already spreads `props` into `ModelViewerInner`, and `handleRef` is an ordinary prop rather than a React `ref`, so it crosses the `next/dynamic` boundary unaided.

- [ ] **Step 3: Thread the ref through `ViewerContainer.tsx`**

Extend the ModelViewer type import:

```tsx
import type { WorldPin, PinScreenPosition, ModelViewerHandle } from './ModelViewer';
```

Extend the re-export:

```tsx
export type { WorldPin, PinScreenPosition, ModelViewerHandle };
```

Add to `ViewerContainerProps`:

```tsx
  modelViewerRef?: React.Ref<ModelViewerHandle>;
```

Add `modelViewerRef` to the destructured parameter list, then pass it on the model branch:

```tsx
  if (MODEL_EXTENSIONS.includes(ext)) return <ModelViewer url={url} commentToolActive={commentToolActive} onSceneClick={onSceneClick} worldPins={worldPins} onPinPositionsUpdate={onPinPositionsUpdate} handleRef={modelViewerRef} />;
```

- [ ] **Step 4: Use the handle in the portal page**

In `app/portal/[id]/page.tsx`, extend the existing `ViewerContainer` type import to include `ModelViewerHandle`:

```tsx
import ViewerContainer, { type WorldPin, type PinScreenPosition, type ContentTransform, type PDFKonvaViewerHandle, type ModelViewerHandle } from '@/components/viewers/ViewerContainer';
```

Add the ref next to the other viewer refs (near `annotationCanvasRef`):

```tsx
  const modelViewerRef = useRef<ModelViewerHandle>(null);
```

Call it in `startAnnotationSession`, immediately before the capture. Replace the existing body:

```tsx
  const startAnnotationSession = useCallback(() => {
    if (annotating) return;
    setAnnotating(true);
    if (!isPDFFile) {
      const container = viewerAreaRef.current;
      // The 3D viewport composites the gizmo HUD into the same buffer the snapshot reads,
      // so ask it for a model-only frame first. No-op for image and video viewers.
      modelViewerRef.current?.renderCleanFrame();
      setViewerSnapshot(container ? captureViewerSnapshot(container) : null);
    }
  }, [annotating, isPDFFile]);
```

Pass the ref to `ViewerContainer`, next to `pdfViewerRef`:

```tsx
            pdfViewerRef={pdfKonvaRef}
            modelViewerRef={modelViewerRef}
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx next lint --file components/viewers/ModelViewerInner.tsx --file components/viewers/ModelViewer.tsx --file components/viewers/ViewerContainer.tsx --file "app/portal/[id]/page.tsx"`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`.

- [ ] **Step 6: Verify against the harness**

With `AUTH_SECRET=dev-only npm run dev` running, open `http://localhost:3000/portal/dev-gizmo` and run this in the browser console. It reproduces exactly what `captureViewerSnapshot` does, first without and then with the clean-frame call:

```js
const canvas = document.querySelector('canvas');
const grab = () => {
  const off = document.createElement('canvas');
  off.width = canvas.width; off.height = canvas.height;
  const ctx = off.getContext('2d');
  ctx.fillStyle = '#f0f0f0'; ctx.fillRect(0, 0, off.width, off.height);
  ctx.drawImage(canvas, 0, 0);
  return ctx.getImageData(off.width - 160, off.height - 160, 160, 160).data;
};
const nonBg = (d) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] !== 0xf0 || d[i+1] !== 0xf0 || d[i+2] !== 0xf0) n++; return n; };
console.log('gizmo corner, normal frame:', nonBg(grab()));
```

Expected: a large non-background count, because the gizmo occupies that corner.

Then confirm the fix path produces a clean corner. The dev route does not hold the ref, so give it one — replace `app/portal/dev-gizmo/page.tsx` with this version, which stashes the handle on `window`:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import ModelViewer, { type ModelViewerHandle } from '@/components/viewers/ModelViewer';

export default function DevGizmoPage() {
  const ref = useRef<ModelViewerHandle>(null);

  useEffect(() => {
    (window as unknown as { __gizmo?: ModelViewerHandle | null }).__gizmo = ref.current;
  }, []);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <ModelViewer url="/dev-sample.stl" handleRef={ref} />
    </div>
  );
}
```

Then re-run the snippet from above with the clean-frame call in front of the grab:

```js
window.__gizmo.renderCleanFrame();
console.log('gizmo corner, clean frame:', nonBg(grab()));
```

Expected: the corner count drops to zero, or near it, since only the model is drawn and the tube does not reach that corner. Compare against the number the previous snippet printed — it should fall by orders of magnitude.

- [ ] **Step 7: Commit**

```bash
git add components/viewers/ModelViewerInner.tsx components/viewers/ModelViewer.tsx components/viewers/ViewerContainer.tsx "app/portal/[id]/page.tsx"
git commit -m "fix(portal): keep the view gizmo out of annotation snapshots

drei's Hud composites the gizmo into the same framebuffer the snapshot
reads. Unmounting on annotate cannot work — capture is synchronous in the
same tick — so expose renderCleanFrame() and call it before reading pixels."
```

---

### Task 4: Gizmo clicks must not place comment pins

**Files:**
- Modify: `components/viewers/ModelViewerInner.tsx:132-160` (the `handlePointerDown` callback in `SceneInteraction`)

**Interfaces:**
- Consumes: `isPointerOverGizmo` from `lib/gizmoLayout.ts` (Task 1).
- Produces: nothing new.

**The problem:** `SceneInteraction` places pins from a **native** listener (`canvas.addEventListener('pointerdown', handlePointerDown)`). drei's cube calls `e.stopPropagation()` on React Three Fiber's *synthetic* event, which does not stop a native DOM listener. With the comment tool armed, clicking the cube would snap the view **and** drop a pin on whatever sits behind the gizmo.

- [ ] **Step 1: Add the import**

In `components/viewers/ModelViewerInner.tsx`:

```tsx
import { isPointerOverGizmo } from '@/lib/gizmoLayout';
```

- [ ] **Step 2: Guard the handler**

In `SceneInteraction`'s `handlePointerDown`, insert the guard immediately after `rect` is computed and before the mouse coordinates are derived:

```tsx
      const rect = gl.domElement.getBoundingClientRect();

      // The gizmo is a HUD layer, not scene geometry, and its React Three Fiber
      // stopPropagation does not reach this native listener — so exclude its rect by hand.
      if (isPointerOverGizmo(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height)) return;

      mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
```

`rect.width` and `rect.height` are CSS pixels, which is what `isPointerOverGizmo` expects.

- [ ] **Step 3: Type-check, lint, and re-run unit tests**

Run: `npx tsc --noEmit && npx next lint --file components/viewers/ModelViewerInner.tsx && npm test`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`, and `# fail 0`.

- [ ] **Step 4: Commit**

```bash
git add components/viewers/ModelViewerInner.tsx
git commit -m "fix(portal): gizmo clicks no longer drop comment pins

The pin handler is a native pointerdown listener, which React Three
Fiber's synthetic stopPropagation does not reach."
```

---

### Task 5: End-to-end check and harness cleanup

**Files:**
- Delete: `scripts/make-sample-stl.mjs`, `public/dev-sample.stl`, `app/portal/dev-gizmo/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: nothing.

- [ ] **Step 1: Verify the full suite**

Run: `npm test && npx tsc --noEmit && npx next lint`
Expected: `# fail 0`, no `tsc` output, `✔ No ESLint warnings or errors`.

- [ ] **Step 2: End-to-end check in the real portal, if credentials allow**

This needs a real `.env.local` with database and S3 credentials, which this checkout does not have. If they are available, open a portal with a 3D file and confirm:

1. The gizmo appears bottom-right and tracks the camera.
2. Clicking a cube face tweens the view.
3. With the comment tool armed, clicking the cube snaps the view and places **no** pin.
4. Clicking the model itself with the comment tool armed still places a pin normally.
5. Existing comment pins still track the model while orbiting. This is the one regression the risk table flags: `GizmoHelper` takes over the render loop at `renderPriority=1`, and pin projection runs in a priority-0 `useFrame`.
6. Starting an annotation session produces a snapshot with **no** gizmo in the corner.
7. Image, video and PDF annotation still capture exactly as before.

If credentials are unavailable, say so plainly in the final report rather than implying this ran. Tasks 1–4 each carry their own verification, so the feature is not unverified — only this integration pass is skipped.

- [ ] **Step 3: Delete the harness**

```bash
rm -f scripts/make-sample-stl.mjs public/dev-sample.stl app/portal/dev-gizmo/page.tsx
```

- [ ] **Step 4: Confirm the working tree is clean**

Run: `git status --short`
Expected: no `dev-gizmo`, `dev-sample.stl`, or `make-sample-stl.mjs` entries. The pre-existing untracked `design_handoff_portal_view/` and `docs/superpowers/` entries are expected and must be left alone.

- [ ] **Step 5: Push**

```bash
git push origin main
```
