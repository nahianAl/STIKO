# Camera Focal Length Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A drop-up control at the bottom-left of the 3D viewport — eye icon, editable value, up arrow — that sets the camera's focal length in millimetres by typing or by choosing a photographic preset.

**Architecture:** Focal length is the source of truth and field of view is derived from it alone, against a fixed 24mm frame height — never from the viewport aspect, so it does NOT need to be re-applied on resize; a panel toggle reveals scene rather than zooming the model. State lives in the portal page for the session only: no column, no endpoint, no permission, no migration. The conversion is a pure module so it can be tested against three's own implementation (with three's film gauge pinned to 24mm so its own aspect-dependence cancels out).

**Tech Stack:** Next.js 14, React 18, `@react-three/fiber` 8.18, `three` 0.169 (`PerspectiveCamera.setFocalLength`), TypeScript 5, Tailwind with the `stiko` palette. Tests run on `node --test scripts/tests/*.mjs`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-13-camera-focal-length-design.md`

## Global Constraints

- No new npm dependencies.
- Presets are exactly `15, 24, 35, 50, 85, 135` millimetres. Default `35`. Typed values clamped to `8`–`300`.
- Focal length is the source of truth; **nothing sets `camera.fov` directly** once this ships.
- fov is derived from the focal length alone, against a fixed 24mm frame height — **never from the viewport aspect** — so it must NOT be re-applied on resize. A panel toggle must reveal or hide scene, not zoom the model.
- `ApplyFocalLength` must run **before** `FitCameraToModel` ever reads `cam.fov`. This is guaranteed by `FitCameraToModel` being gated on `bounds`, which starts `null` and resets to `null` on every url change, so the two can never mount in the same commit — not by JSX sibling order.
- **No re-fit on change.** Changing the lens zooms the view; the camera does not move and the OrbitControls dolly limits are left as computed at load.
- Session only — resets on file switch and reload. Nothing is persisted.
- 3D files only, and hidden while an annotation session is active.
- Docs under `docs/superpowers/` are deliberately untracked — edit them, never `git add` them.
- Never `git add -A`, `git add .`, or `git commit -a`. Commit explicit paths. `design_handoff_portal_view/`, `docs/superpowers/` and `stiko_handoff/` stay untracked.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `lib/focalLength.ts` | Create | Presets, bounds, focal-length↔fov conversion, clamping, input parsing. Pure. |
| `scripts/tests/focalLength.test.mjs` | Create | Unit tests, cross-checked against three's own camera. |
| `components/viewers/FocalLengthControl.tsx` | Create | The drop-up pill: eye icon, editable value, up arrow. DOM, not 3D. |
| `components/viewers/ModelViewerInner.tsx` | Modify | `ApplyFocalLength` inside the Canvas; accept a `focalLength` prop. |
| `components/viewers/ViewerContainer.tsx` | Modify | Thread `focalLength` to the model branch. |
| `app/portal/[id]/page.tsx` | Modify | Own the state, render the control in the viewer area, reset on file switch. |

---

### Task 1: The conversion

**Files:**
- Create: `lib/focalLength.ts`
- Test: `scripts/tests/focalLength.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `FOCAL_LENGTH_PRESETS: readonly number[]`, `DEFAULT_FOCAL_LENGTH: number`, `MIN_FOCAL_LENGTH: number`, `MAX_FOCAL_LENGTH: number`, `fovForFocalLength(focalLength: number): number` (degrees, lens alone — no aspect parameter), `clampFocalLength(value: number): number`, `parseFocalLength(input: string, fallback: number): number`. Tasks 2, 3 and 4 consume these. (`focalLengthForFov` was dropped — see Task 1 Step 3.)

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/focalLength.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FOCAL_LENGTH_PRESETS,
  DEFAULT_FOCAL_LENGTH,
  MIN_FOCAL_LENGTH,
  MAX_FOCAL_LENGTH,
  fovForFocalLength,
  clampFocalLength,
  parseFocalLength,
} from '../../lib/focalLength.ts';

test('fov matches three.js for every preset, against a 24mm frame height', () => {
  // three stays the oracle for the arithmetic even though we no longer use its aspect
  // behaviour: with filmGauge 24 and any aspect <= 1, three's own getFilmHeight() is
  // 24 / max(aspect, 1) = 24, exactly our fixed frame. Both aspects below must agree,
  // which is also what proves our fov ignores the viewport shape.
  for (const aspect of [1, 0.5]) {
    for (const mm of FOCAL_LENGTH_PRESETS) {
      const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
      camera.filmGauge = 24;
      camera.setFocalLength(mm);
      assert.ok(
        Math.abs(fovForFocalLength(mm) - camera.fov) < 1e-9,
        `aspect ${aspect}, ${mm}mm: ${fovForFocalLength(mm)} !== ${camera.fov}`,
      );
    }
  }
});

test('fov is the same whatever the viewport shape', () => {
  // The regression this whole change exists to prevent: a panel toggle must not zoom the
  // model. fovForFocalLength takes no aspect, so this is true by construction — the test
  // guards against someone reintroducing an aspect parameter.
  assert.equal(fovForFocalLength.length, 1);
  for (const mm of FOCAL_LENGTH_PRESETS) {
    assert.ok(Number.isFinite(fovForFocalLength(mm)));
  }
});

test('a longer lens is always a narrower field of view', () => {
  // Monotonicity is what makes the control feel sane; an inverted branch would still
  // round-trip and still look plausible in isolation.
  for (let i = 1; i < FOCAL_LENGTH_PRESETS.length; i++) {
    const wider = fovForFocalLength(FOCAL_LENGTH_PRESETS[i - 1]);
    const longer = fovForFocalLength(FOCAL_LENGTH_PRESETS[i]);
    assert.ok(longer < wider, `${FOCAL_LENGTH_PRESETS[i]}mm not narrower`);
  }
});

test('the default is one of the presets and inside the range', () => {
  assert.ok(FOCAL_LENGTH_PRESETS.includes(DEFAULT_FOCAL_LENGTH));
  assert.ok(FOCAL_LENGTH_PRESETS.every((mm) => mm >= MIN_FOCAL_LENGTH && mm <= MAX_FOCAL_LENGTH));
});

test('clamping holds the bounds', () => {
  assert.equal(clampFocalLength(0), MIN_FOCAL_LENGTH);
  assert.equal(clampFocalLength(-50), MIN_FOCAL_LENGTH);
  assert.equal(clampFocalLength(1000), MAX_FOCAL_LENGTH);
  assert.equal(clampFocalLength(MIN_FOCAL_LENGTH), MIN_FOCAL_LENGTH);
  assert.equal(clampFocalLength(MAX_FOCAL_LENGTH), MAX_FOCAL_LENGTH);
  assert.equal(clampFocalLength(50), 50);
});

test('parsing accepts what a person would actually type', () => {
  assert.equal(parseFocalLength('50', 35), 50);
  assert.equal(parseFocalLength('  50  ', 35), 50);
  assert.equal(parseFocalLength('50mm', 35), 50);
  assert.equal(parseFocalLength('50 mm', 35), 50);
  assert.equal(parseFocalLength('42.5', 35), 42.5);
});

test('parsing clamps rather than accepting an unusable lens', () => {
  assert.equal(parseFocalLength('1', 35), MIN_FOCAL_LENGTH);
  assert.equal(parseFocalLength('9999', 35), MAX_FOCAL_LENGTH);
});

test('parsing falls back rather than producing a bad number', () => {
  // A NaN reaching setFocalLength gives a NaN projection matrix and a blank viewport with
  // no error anywhere, so nonsense has to come back as the previous value.
  for (const bad of ['', '   ', 'abc', 'mm', '--5', 'NaN', 'Infinity', '1e400']) {
    assert.equal(parseFocalLength(bad, 35), 35, `accepted ${JSON.stringify(bad)}`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module` for `lib/focalLength.ts`.

- [ ] **Step 3: Write the implementation**

Create `lib/focalLength.ts`:

```ts
/**
 * Camera focal length for the 3D viewer, in millimetres.
 *
 * Focal length is the source of truth and field of view is derived from it, because fov
 * alone is meaningless without the frame it is measured against. Unlike three's own
 * PerspectiveCamera, which derives the frame height from a fixed film WIDTH divided by the
 * viewport aspect, this module fixes the frame HEIGHT instead: one lens, one angle of view,
 * whatever shape the viewport is. See the note on `FRAME_HEIGHT` for why.
 *
 * The tests cross-check every preset against a real THREE.PerspectiveCamera (with its film
 * gauge pinned so its own aspect-dependence cancels out) so the arithmetic cannot drift.
 */

/**
 * The 35mm-format frame HEIGHT, in millimetres.
 *
 * three's PerspectiveCamera derives fov from a fixed film WIDTH divided by the viewport
 * aspect, which means the same lens gives a different angle of view on a differently-shaped
 * viewport — so merely collapsing a side panel would zoom the model. We fix the frame height
 * instead: one lens, one angle of view, whatever shape the viewport is. Resizing then reveals
 * or hides scene, as it did before this control existed, and the number on the control still
 * describes what is on screen.
 */
const FRAME_HEIGHT = 24;

/** Standard lens steps, wide to telephoto. Any value between them can still be typed. */
export const FOCAL_LENGTH_PRESETS: readonly number[] = [15, 24, 35, 50, 85, 135];

export const DEFAULT_FOCAL_LENGTH = 35;

/** Below this the projection is fisheye; above it, near enough orthographic to feel broken. */
export const MIN_FOCAL_LENGTH = 8;
export const MAX_FOCAL_LENGTH = 300;

/** Vertical field of view in DEGREES. Depends on the lens alone, never on the viewport. */
export function fovForFocalLength(focalLength: number): number {
  return (2 * Math.atan(FRAME_HEIGHT / (2 * focalLength)) * 180) / Math.PI;
}

export function clampFocalLength(value: number): number {
  return Math.min(MAX_FOCAL_LENGTH, Math.max(MIN_FOCAL_LENGTH, value));
}

/**
 * Turn what someone typed into a usable focal length, or give back what they had.
 *
 * Anything unusable returns `fallback` rather than a bad number: a NaN reaching
 * setFocalLength produces a NaN projection matrix and a blank viewport, with no error
 * raised anywhere to explain it.
 */
export function parseFocalLength(input: string, fallback: number): number {
  const cleaned = input.trim().replace(/\s*mm$/i, '').trim();
  if (cleaned === '') return fallback;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return fallback;

  return clampFocalLength(value);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 8 new tests, `# fail 0`.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx next lint --file lib/focalLength.ts`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`.

- [ ] **Step 6: Commit**

```bash
git add lib/focalLength.ts scripts/tests/focalLength.test.mjs
git commit -m "feat(portal): focal length conversion for the 3D camera

Focal length is the source of truth; fov is derived from it and the
viewport aspect, so the same lens gives a different fov on a differently
shaped viewport. Every preset is cross-checked against a real
THREE.PerspectiveCamera so this module cannot drift from three's own maths."
```

---

### Task 2: Apply it to the camera

**Files:**
- Modify: `components/viewers/ModelViewerInner.tsx`
- Modify: `components/viewers/ViewerContainer.tsx`

**Interfaces:**
- Consumes: `fovForFocalLength`, `DEFAULT_FOCAL_LENGTH` from `lib/focalLength.ts` (Task 1).
- Produces: `ModelViewerInnerProps.focalLength?: number` and `ViewerContainerProps.focalLength?: number`. Task 4 supplies the value.

- [ ] **Step 1: Add the applying component**

In `components/viewers/ModelViewerInner.tsx`, add the import alongside the other `@/lib`
imports (around line 15):

```tsx
import { DEFAULT_FOCAL_LENGTH, fovForFocalLength } from '@/lib/focalLength';
```

`useEffect`, `useThree` and `THREE` are already imported in this file — do not add them again.

Add this component immediately ABOVE `FitCameraToModel`:

```tsx
/**
 * Drives the camera's field of view from a focal length in millimetres.
 *
 * The fov depends on the lens alone (see lib/focalLength.ts), so this does NOT need to
 * re-run on resize — that is deliberate, and it is why collapsing a side panel reveals more
 * scene rather than zooming the model.
 *
 * FitCameraToModel reads cam.fov when it works out how far back to sit, so it must never run
 * before this has set it. What guarantees that is not the sibling order below but the fact
 * that FitCameraToModel is gated on `bounds`, which starts null and is reset to null on every
 * url change — so the two can never mount in the same commit. Keep that gate.
 */
function ApplyFocalLength({ focalLength }: { focalLength: number }) {
  const { camera } = useThree();

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = fovForFocalLength(focalLength);
    cam.updateProjectionMatrix();
  }, [camera, focalLength]);

  return null;
}
```

- [ ] **Step 2: Accept and render it**

Add to `ModelViewerInnerProps`:

```tsx
  /** Camera focal length in millimetres. Drives the field of view. */
  focalLength?: number;
```

Accept it in the component signature with the default:

```tsx
  focalLength = DEFAULT_FOCAL_LENGTH,
```

Render it inside `<Suspense>`, immediately before the `MeasureModel` / `FitCameraToModel` lines:

```tsx
          <ApplyFocalLength focalLength={focalLength} />
```

- [ ] **Step 3: Thread it through the container**

In `components/viewers/ViewerContainer.tsx`, three edits:

1. Add to `ViewerContainerProps`, after `onTransformCommit` (line 33):

```tsx
  focalLength?: number;
```

2. Add `focalLength` to the destructured parameter list on line 64, after `onTransformCommit,`.

3. Add the prop to the model branch on line 122 — the `MODEL_EXTENSIONS` return, which is a
   single long line ending `onTransformCommit={onTransformCommit} />`:

```tsx
  if (MODEL_EXTENSIONS.includes(ext)) return <ModelViewer url={url} commentToolActive={commentToolActive} onSceneClick={onSceneClick} worldPins={worldPins} onPinPositionsUpdate={onPinPositionsUpdate} handleRef={modelViewerRef} transform={transform} transformMode={transformMode} onTransformCommit={onTransformCommit} focalLength={focalLength} />;
```

`ModelViewer.tsx` needs no change: it takes `ModelViewerInnerProps` and spreads them, so the
new prop flows through as soon as `ModelViewerInnerProps` has it.

- [ ] **Step 4: Type-check, lint and test**

Run: `npx tsc --noEmit && npx next lint --file components/viewers/ModelViewerInner.tsx --file components/viewers/ViewerContainer.tsx && npm test`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add components/viewers/ModelViewerInner.tsx components/viewers/ViewerContainer.tsx
git commit -m "feat(portal): drive the viewer camera from a focal length

Applied before the camera fit, which reads cam.fov to decide how far back
to sit. fov depends on the lens alone, against a fixed 24mm frame height,
so it is deliberately NOT re-applied on resize — a panel toggle reveals
scene rather than zooming the model."
```

---

### Task 3: The control

**Files:**
- Create: `components/viewers/FocalLengthControl.tsx`

**Interfaces:**
- Consumes: `FOCAL_LENGTH_PRESETS`, `parseFocalLength` from `lib/focalLength.ts` (Task 1).
- Produces: a default-exported `FocalLengthControl` taking `{ value: number; onChange: (mm: number) => void }`. Task 4 renders it.

- [ ] **Step 1: Write the component**

Create `components/viewers/FocalLengthControl.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { FOCAL_LENGTH_PRESETS, parseFocalLength } from '@/lib/focalLength';

/**
 * Camera focal length, as a single pill: eye icon, the value, and an arrow that opens the
 * presets upward.
 *
 * Lives in the viewer's DOM rather than the 3D scene, which is also why it never appears in
 * an annotation snapshot — the snapshot is a read of the canvas, and this is not in it.
 */
export default function FocalLengthControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (millimetres: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close the menu on an outside click or Escape, the way the toolbar's own popovers do.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startEditing = () => {
    setDraft(String(value));
    setEditing(true);
    setOpen(false);
  };

  const commit = () => {
    onChange(parseFocalLength(draft, value));
    setEditing(false);
  };

  return (
    <div ref={rootRef} className="absolute bottom-3 left-3 z-20 select-none">
      {open && (
        <div className="mb-1.5 overflow-hidden rounded-panel bg-white shadow-stiko-sheet border border-stiko-border">
          {FOCAL_LENGTH_PRESETS.map((mm) => (
            <button
              key={mm}
              onClick={() => {
                onChange(mm);
                setOpen(false);
              }}
              className={`block w-full px-3 py-1.5 text-left text-xs transition-colors ${
                mm === value
                  ? 'bg-stiko-tint text-stiko-primary'
                  : 'text-stiko-secondary hover:bg-stiko-tint'
              }`}
            >
              {mm}mm
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 rounded-panel bg-white shadow-stiko-panel border border-stiko-border h-8 pl-2 pr-1">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-stiko-muted"
          aria-hidden
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
        </svg>

        {editing ? (
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            aria-label="Focal length in millimetres"
            className="w-12 bg-transparent text-xs text-stiko-ink outline-none"
          />
        ) : (
          <button
            onClick={startEditing}
            title="Set focal length"
            className="w-12 text-left text-xs text-stiko-ink"
          >
            {value}mm
          </button>
        )}

        <button
          onClick={() => {
            setEditing(false);
            setOpen((o) => !o);
          }}
          title="Focal length presets"
          aria-expanded={open}
          className="flex h-6 w-6 items-center justify-center rounded-[8px] text-stiko-muted transition-colors hover:bg-stiko-tint"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx next lint --file components/viewers/FocalLengthControl.tsx`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`.

- [ ] **Step 3: Commit**

```bash
git add components/viewers/FocalLengthControl.tsx
git commit -m "feat(portal): focal length drop-up control

Eye icon, editable value and an arrow that opens the presets upward so the
menu never runs off the bottom of the viewport. Typed values are parsed and
clamped; anything unusable reverts to the current value."
```

---

### Task 4: Wire it into the page

**Files:**
- Modify: `app/portal/[id]/page.tsx`

**Interfaces:**
- Consumes: `DEFAULT_FOCAL_LENGTH` from `lib/focalLength.ts` (Task 1); `focalLength` on `ViewerContainer` (Task 2); `FocalLengthControl` (Task 3).
- Produces: nothing.

- [ ] **Step 1: Add the imports and state**

In `app/portal/[id]/page.tsx`, add:

```tsx
import FocalLengthControl from '@/components/viewers/FocalLengthControl';
import { DEFAULT_FOCAL_LENGTH } from '@/lib/focalLength';
```

and, next to the other viewer state (near `transformMode`):

```tsx
  // Session only: a lens is how you happen to be looking at something, not a property of
  // the design, so it is deliberately not persisted the way the object transform is.
  const [focalLength, setFocalLength] = useState(DEFAULT_FOCAL_LENGTH);
```

- [ ] **Step 2: Reset it on file switch**

Add this line to the existing effect keyed on `[selectedFileId]` that already clears
`viewerSnapshot`, `annotating`, `transformMode` and the rest:

```tsx
    setFocalLength(DEFAULT_FOCAL_LENGTH);
```

- [ ] **Step 3: Pass it to the viewer**

At the `<ViewerContainer ... />` render site, add:

```tsx
            focalLength={focalLength}
```

- [ ] **Step 4: Render the control**

Inside the viewer-area `<div ref={viewerAreaRef} ...>`, after the `MarkupOverlay` block and
before the `AnnotationCanvas` block, add:

```tsx
            {/* Hidden during a markup session: the live viewer is replaced by a frozen
                snapshot then, so this would sit on the drawing surface and adjust a camera
                nobody is looking at. */}
            {selectedFileId && is3DFile && !annotating && (
              <FocalLengthControl value={focalLength} onChange={setFocalLength} />
            )}
```

- [ ] **Step 5: Type-check, lint and test**

Run: `npx tsc --noEmit && npx next lint && npm test`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add "app/portal/[id]/page.tsx"
git commit -m "feat(portal): focal length control in the 3D viewport

Session-only state, reset on file switch, and hidden during a markup
session where the live viewer is replaced by a frozen snapshot."
```

---

### Task 5: Verification and cleanup

**Files:**
- Create then delete (never committed): `scripts/make-sample-stl.mjs`, `public/uploads/sample-medium.stl`, `app/portal/dev-gizmo/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: nothing.

- [ ] **Step 1: Build the harness**

Create `scripts/make-sample-stl.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';
const REPO = process.cwd();
const THREE = await import(path.join(REPO, 'node_modules/three/build/three.module.js'));
const OUT = path.join(REPO, 'public/uploads');
fs.mkdirSync(OUT, { recursive: true });
const geom = new THREE.CylinderGeometry(100, 100, 200, 48, 1, false).toNonIndexed();
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

Create `app/portal/dev-gizmo/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import ModelViewer from '@/components/viewers/ModelViewer';
import FocalLengthControl from '@/components/viewers/FocalLengthControl';
import { DEFAULT_FOCAL_LENGTH } from '@/lib/focalLength';

export default function DevGizmoPage() {
  const [focalLength, setFocalLength] = useState(DEFAULT_FOCAL_LENGTH);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <ModelViewer url="/uploads/sample-medium.stl" focalLength={focalLength} />
      <FocalLengthControl value={focalLength} onChange={setFocalLength} />
      <div style={{ position: 'absolute', top: 8, left: 8, font: '11px monospace', zIndex: 30 }}>
        <span id="fl">{focalLength}</span>mm
      </div>
    </div>
  );
}
```

Samples must live under `public/uploads/` specifically: `middleware.ts`'s matcher excludes
`uploads`, so the file is served raw. Anywhere else in `public/` it is redirected to `/login`
and the STL loader parses HTML.

- [ ] **Step 2: Run the dev server**

Run: `AUTH_SECRET=dev-only DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' npm run dev`

Both are required even though this page queries nothing: `middleware.ts` imports `lib/auth` →
`lib/db`, which throws at module load without `DATABASE_URL`. Supply them inline — do **not**
create a `.env.local`.

- [ ] **Step 3: Check the control**

Open `http://localhost:3000/portal/dev-gizmo` and confirm:

1. The pill sits at the bottom-left: eye icon, `35mm`, up arrow.
2. The arrow opens the preset list **upward**, and the current value is highlighted.
3. Choosing a preset changes the perspective — near-far exaggeration visibly reduces going
   from 15mm to 135mm.
4. **The camera does not move.** The object gets bigger with a longer lens; it must not stay
   the same size, which would mean a dolly-zoom crept in.
5. Clicking the value lets you type. Enter commits, Escape reverts, clicking away commits.
6. Typing `500` clamps to `300`; typing `abc` reverts to the previous value.
7. Clicking outside the open menu closes it.

- [ ] **Step 4: Check the resize behaviour**

With a non-default lens set (say 85mm), resize the browser window narrower and wider.
Confirm the displayed number does not change **and** that the view stays consistent with it —
this is the property that breaks if the focal length is applied once instead of on every size
change.

- [ ] **Step 5: Check the framing claim**

The spec claims the 35mm default leaves the object the same apparent size on load as the old
fixed 50° field of view, because the camera fit derives its distance from fov. Confirm by
reloading at the default and comparing against a screenshot taken with `git stash` on this
branch — or, more cheaply, confirm the object fills a similar fraction of the frame and is
fully visible, with no clipping.

- [ ] **Step 6: Delete the harness**

```bash
rm -rf app/portal/dev-gizmo public/uploads scripts/make-sample-stl.mjs .next/types/app/portal/dev-gizmo
```

Deleting the route without clearing its generated types leaves `tsc` failing on a stale
`.next/types` entry.

- [ ] **Step 7: Full verification**

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

- [ ] **Step 8: Confirm the tree is clean**

Run: `git status --short`
Expected: no `dev-gizmo`, `sample-medium.stl` or `make-sample-stl.mjs` entries. The
pre-existing untracked `design_handoff_portal_view/`, `docs/superpowers/` and `stiko_handoff/`
are expected and must be left alone.
