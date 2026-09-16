# Measure Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a measure tool to the portal toolbar — linear distance, angular measurement, a calibration gesture, and a units selector — working across the 3D, PDF and image viewers.

**Architecture:** One pure, unit-tested core in `lib/measure/` does all arithmetic. Each of the three viewers measures in its own intrinsic coordinate space and renders measurements in whatever layer its existing snapshot capture already reads, so no new snapshot code is needed. Calibration persists per file and per page in a new table; measurements themselves are ephemeral, exactly like today's markup.

**Tech Stack:** Next.js 14 app router, React, TypeScript, three.js + react-three-fiber, react-konva, pdf.js, Neon Postgres via `@neondatabase/serverless`, `node --test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-09-16-measure-tool-design.md`

## Global Constraints

- **Test runner is `node --test`.** Tests live in `scripts/tests/<name>.test.mjs` and run via `npm test`. They import library modules **by relative path with the `.ts` extension** — e.g. `import { formatLength } from '../../lib/measure/units.ts'`.
- **Modules under `lib/` that are unit-tested must not use the `@/` alias.** `node --test` does not resolve it. Use relative imports with the explicit `.ts` extension, e.g. `import { extensionOf } from '../fileFormats.ts'` (see `lib/storageKeys.ts:1` for the established pattern).
- **Never `import` a value from `lib/queries`** in a tested module — `import type` only.
- **Never run `git add -A` or `git add .` in this repo.** Four long-lived untracked directories (`stiko_handoff/`, `design_handoff_*/`) get swept into unrelated commits. Stage exact paths.
- **Every commit message ends with the trailer:**
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
  Commit commands below omit it for brevity; add it to every one.
- **Migrations are applied by hand in this repo and have been forgotten twice.** Any new read of a new table must be wrapped in `try/catch` and degrade, never throw.
- **Canonical stored quantity is `mm_per_unit`** — real millimetres per one intrinsic unit of the file.
- **Copy rule:** user-facing text says "Package", never "Portal". Code says "portal" everywhere.
- Angles are always displayed in degrees. Lengths use the file's `measureUnit`, defaulting to `mm`.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `lib/measure/units.ts` | The mm/cm/m/in/ft table, conversion, and display formatting |
| `lib/measure/geometry.ts` | Distance and angle, dimension-agnostic over number arrays |
| `lib/measure/calibration.ts` | Format assumption table, calibration arithmetic, scale resolution |
| `lib/measure/gesture.ts` | The click-counting state machine and degeneracy rejection |
| `lib/measure/space.ts` | Image stage→natural and PDF rendered-px→point conversions |
| `lib/migrations/012-measure-calibration.sql` | `file_calibrations` table, `files.measure_unit` column |
| `app/api/files/[id]/measure/route.ts` | The single write endpoint, with the three-way gate |
| `components/markup/useMeasurements.ts` | Session store: committed measurements, pending gesture, selection |
| `components/markup/MeasureObjects.tsx` | Konva rendering of measurements, shared by both 2D surfaces |
| `components/viewers/MeasureLayer.tsx` | In-scene WebGL rendering of measurements for the 3D viewer |
| `components/markup/CalibrationPanel.tsx` | The "This distance is [ ] [ unit ]" input panel |
| `scripts/tests/measureUnits.test.mjs` | |
| `scripts/tests/measureGeometry.test.mjs` | |
| `scripts/tests/measureCalibration.test.mjs` | |
| `scripts/tests/measureGesture.test.mjs` | |
| `scripts/tests/measureSpace.test.mjs` | |

**Modified:**

| Path | Change |
| --- | --- |
| `lib/schema.sql` | Mirror the migration |
| `lib/types.ts` | `FileRecord.calibrations`, `FileRecord.measureUnit` |
| `app/api/files/route.ts` | Fold calibrations and unit into the file listing, fail-soft |
| `app/api/conversions/webhook/route.ts` | Delete stale calibrations alongside `part_colors` |
| `components/markup/useAnnotationObjects.ts` | Extend `ToolType` with the three measure tools |
| `components/markup/DrawingTools.tsx` | The Measure button, its sub-bar, the units chip |
| `components/markup/AnnotationCanvas.tsx` | Measure gestures and layer on the image surface |
| `components/viewers/PDFKonvaViewer.tsx` | Measure gestures and layer on the PDF surface; use the shared render-scale constant |
| `components/viewers/ModelViewerInner.tsx` | Dispatch picking on the armed tool; render `MeasureLayer` |
| `components/viewers/ModelViewer.tsx` | Prop pass-through |
| `components/viewers/ViewerContainer.tsx` | Prop pass-through |
| `app/portal/[id]/page.tsx` | Tool wiring, session rule, scale resolution, calibration save |

---

## Task 1: Units and formatting

**Files:**
- Create: `lib/measure/units.ts`
- Test: `scripts/tests/measureUnits.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft'`
  - `const LENGTH_UNITS: readonly LengthUnit[]`
  - `const DEFAULT_LENGTH_UNIT: LengthUnit`
  - `isLengthUnit(value: unknown): value is LengthUnit`
  - `mmPerLengthUnit(unit: LengthUnit): number`
  - `toMillimetres(value: number, unit: LengthUnit): number`
  - `fromMillimetres(mm: number, unit: LengthUnit): number`
  - `formatLength(mm: number, unit: LengthUnit): string`
  - `formatAngle(radians: number): string`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/measureUnits.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LENGTH_UNITS,
  DEFAULT_LENGTH_UNIT,
  isLengthUnit,
  mmPerLengthUnit,
  toMillimetres,
  fromMillimetres,
  formatLength,
  formatAngle,
} from '../../lib/measure/units.ts';

test('the dropdown offers exactly the five agreed units, in order', () => {
  assert.deepEqual([...LENGTH_UNITS], ['mm', 'cm', 'm', 'in', 'ft']);
  assert.equal(DEFAULT_LENGTH_UNIT, 'mm');
});

test('isLengthUnit accepts the five and rejects everything else', () => {
  for (const unit of LENGTH_UNITS) assert.equal(isLengthUnit(unit), true, unit);
  for (const junk of ['km', 'MM', '', null, undefined, 3, {}]) {
    assert.equal(isLengthUnit(junk), false, String(junk));
  }
});

test('imperial factors are the exact international definitions', () => {
  assert.equal(mmPerLengthUnit('in'), 25.4);
  assert.equal(mmPerLengthUnit('ft'), 304.8);
});

test('every unit round-trips through millimetres', () => {
  for (const unit of LENGTH_UNITS) {
    const mm = toMillimetres(7, unit);
    assert.ok(Math.abs(fromMillimetres(mm, unit) - 7) < 1e-9, unit);
  }
});

test('formatLength uses a precision that suits each unit', () => {
  assert.equal(formatLength(1234.56, 'mm'), '1235 mm');
  assert.equal(formatLength(1234.56, 'cm'), '123.5 cm');
  assert.equal(formatLength(1234.56, 'm'), '1.235 m');
  assert.equal(formatLength(1234.56, 'in'), '48.60 in');
  assert.equal(formatLength(1234.56, 'ft'), '4.05 ft');
});

test('formatAngle reports degrees to one decimal', () => {
  assert.equal(formatAngle(Math.PI / 2), '90.0°');
  assert.equal(formatAngle(Math.PI), '180.0°');
  assert.equal(formatAngle(0), '0.0°');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="units"` or simply `node --test scripts/tests/measureUnits.test.mjs`
Expected: FAIL — `Cannot find module .../lib/measure/units.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/measure/units.ts`:

```ts
/**
 * Display units for measurements, and the arithmetic between them.
 *
 * Millimetres are the canonical stored unit throughout the measure feature — that is what
 * `file_calibrations.mm_per_unit` holds, and what every function here converts to and from.
 * Millimetres because the STEP pipeline already assumes them (see lib/model/stepWireframe.ts)
 * and because no unit offered here needs a fractional base.
 */

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

export const LENGTH_UNITS: readonly LengthUnit[] = ['mm', 'cm', 'm', 'in', 'ft'];

export const DEFAULT_LENGTH_UNIT: LengthUnit = 'mm';

/** Exact international definitions: an inch is 25.4 mm by definition, not by measurement. */
const MM_PER_UNIT: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

/**
 * Decimal places per unit, chosen so one step of the last digit is roughly a millimetre.
 * Reporting a 1.2 m dimension as "1.2 m" throws away the precision the measurement had.
 */
const DECIMALS: Record<LengthUnit, number> = { mm: 0, cm: 1, m: 3, in: 2, ft: 2 };

export function isLengthUnit(value: unknown): value is LengthUnit {
  return typeof value === 'string' && (LENGTH_UNITS as readonly string[]).includes(value);
}

export function mmPerLengthUnit(unit: LengthUnit): number {
  return MM_PER_UNIT[unit];
}

export function toMillimetres(value: number, unit: LengthUnit): number {
  return value * MM_PER_UNIT[unit];
}

export function fromMillimetres(mm: number, unit: LengthUnit): number {
  return mm / MM_PER_UNIT[unit];
}

export function formatLength(mm: number, unit: LengthUnit): string {
  return `${fromMillimetres(mm, unit).toFixed(DECIMALS[unit])} ${unit}`;
}

/** Angles are always degrees, on every surface, whatever the length unit is. */
export function formatAngle(radians: number): string {
  return `${((radians * 180) / Math.PI).toFixed(1)}°`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/tests/measureUnits.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add lib/measure/units.ts scripts/tests/measureUnits.test.mjs
git commit -m "feat: measurement units and display formatting"
```

---

## Task 2: Distance and angle

**Files:**
- Create: `lib/measure/geometry.ts`
- Test: `scripts/tests/measureGeometry.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Point = readonly number[]`
  - `distance(a: Point, b: Point): number` — throws `RangeError` on mismatched dimensions
  - `angleAt(vertex: Point, a: Point, b: Point): number` — radians in `[0, π]`, `NaN` when a leg has zero length

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/measureGeometry.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, angleAt } from '../../lib/measure/geometry.ts';

test('distance works in 2D and 3D from the same implementation', () => {
  assert.equal(distance([0, 0], [3, 4]), 5);
  assert.equal(distance([0, 0, 0], [0, 3, 4]), 5);
  assert.equal(distance([1, 1, 1], [1, 1, 1]), 0);
});

test('distance refuses to compare points of different dimensions', () => {
  assert.throws(() => distance([0, 0], [1, 1, 1]), RangeError);
});

test('angleAt measures the angle at the middle point', () => {
  const right = angleAt([0, 0], [1, 0], [0, 1]);
  assert.ok(Math.abs(right - Math.PI / 2) < 1e-12);

  const straight = angleAt([0, 0], [1, 0], [-1, 0]);
  assert.ok(Math.abs(straight - Math.PI) < 1e-12);
});

test('angleAt works in 3D', () => {
  const right = angleAt([0, 0, 0], [5, 0, 0], [0, 0, 5]);
  assert.ok(Math.abs(right - Math.PI / 2) < 1e-12);
});

// The trap this exists for: dot/(|a||b|) can land on 1.0000000000000002 for genuinely
// collinear input, and Math.acos of that is NaN. Without clamping, pointing at two points
// on the same edge produces a blank label instead of 0.0°.
test('angleAt clamps floating-point overshoot instead of returning NaN', () => {
  const collinear = angleAt([0, 0, 0], [0.1, 0.2, 0.3], [0.2, 0.4, 0.6]);
  assert.ok(Number.isFinite(collinear), 'expected a finite angle');
  assert.ok(Math.abs(collinear) < 1e-6);
});

test('angleAt returns NaN when a leg has no length', () => {
  assert.ok(Number.isNaN(angleAt([0, 0], [0, 0], [1, 0])));
  assert.ok(Number.isNaN(angleAt([0, 0], [1, 0], [0, 0])));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/measureGeometry.test.mjs`
Expected: FAIL — `Cannot find module .../lib/measure/geometry.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/measure/geometry.ts`:

```ts
/**
 * The two measurements the tool takes, over plain number arrays.
 *
 * Dimension-agnostic on purpose: the 2D surfaces pass [x, y] and the 3D viewer passes
 * [x, y, z], and there is no reason for two implementations of Pythagoras to exist and drift.
 */

export type Point = readonly number[];

export function distance(a: Point, b: Point): number {
  if (a.length !== b.length) {
    throw new RangeError(`Cannot measure between a ${a.length}D and a ${b.length}D point`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * The angle at `vertex`, between the rays to `a` and to `b`. Radians, in [0, π].
 *
 * NaN when either leg has zero length — there is no angle at a point that coincides with its
 * own vertex, and the caller must reject the gesture rather than render "NaN°".
 */
export function angleAt(vertex: Point, a: Point, b: Point): number {
  if (vertex.length !== a.length || vertex.length !== b.length) {
    throw new RangeError('Cannot measure an angle between points of different dimensions');
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vertex.length; i++) {
    const va = a[i] - vertex[i];
    const vb = b[i] - vertex[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return NaN;

  // Clamp before acos. For genuinely collinear input the quotient can exceed 1 by one ulp,
  // and Math.acos(1.0000000000000002) is NaN — a blank label for a perfectly valid gesture.
  const cosine = Math.min(1, Math.max(-1, dot / denominator));
  return Math.acos(cosine);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/tests/measureGeometry.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add lib/measure/geometry.ts scripts/tests/measureGeometry.test.mjs
git commit -m "feat: distance and angle for measurements"
```

---

## Task 3: Calibration and scale resolution

**Files:**
- Create: `lib/measure/calibration.ts`
- Test: `scripts/tests/measureCalibration.test.mjs`

**Interfaces:**
- Consumes: `LengthUnit`, `toMillimetres` from Task 1; `extensionOf` from `lib/fileFormats.ts`.
- Produces:
  - `const UNPAGED = 0`
  - `type ScaleSource = 'calibrated' | 'assumed' | 'unknown'`
  - `interface Scale { mmPerUnit: number | null; source: ScaleSource }`
  - `assumedMmPerUnit(filename: string): number | null`
  - `mmPerUnitFrom(intrinsicDistance: number, realDistance: number, unit: LengthUnit): number`
  - `resolveScale(input: { filename: string; calibrations?: Record<number, number>; page?: number }): Scale`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/measureCalibration.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNPAGED,
  assumedMmPerUnit,
  mmPerUnitFrom,
  resolveScale,
} from '../../lib/measure/calibration.ts';

test('STEP files are millimetres, because that is what OCCT emits', () => {
  assert.equal(assumedMmPerUnit('bracket.step'), 1);
  assert.equal(assumedMmPerUnit('BRACKET.STP'), 1);
});

test('glTF files are metres, per the glTF specification', () => {
  assert.equal(assumedMmPerUnit('tower.glb'), 1000);
  assert.equal(assumedMmPerUnit('tower.gltf'), 1000);
});

test('formats with no unit convention are unknown, not guessed', () => {
  for (const name of ['part.obj', 'part.stl', 'part.ply', 'part.3ds', 'part.dae']) {
    assert.equal(assumedMmPerUnit(name), null, name);
  }
});

test('2D files never carry an assumption — they are calibrated or nothing', () => {
  assert.equal(assumedMmPerUnit('sheet.pdf'), null);
  assert.equal(assumedMmPerUnit('site.jpg'), null);
});

test('mmPerUnitFrom divides the real distance by the measured one', () => {
  // 200 intrinsic units spanned 2 metres, so one unit is 10 mm.
  assert.equal(mmPerUnitFrom(200, 2, 'm'), 10);
  assert.equal(mmPerUnitFrom(100, 100, 'mm'), 1);
});

test('mmPerUnitFrom rejects input that would produce a nonsense scale', () => {
  assert.throws(() => mmPerUnitFrom(0, 100, 'mm'), RangeError);
  assert.throws(() => mmPerUnitFrom(100, 0, 'mm'), RangeError);
  assert.throws(() => mmPerUnitFrom(-5, 100, 'mm'), RangeError);
  assert.throws(() => mmPerUnitFrom(100, Number.NaN, 'mm'), RangeError);
});

test('a stored calibration beats the format assumption', () => {
  const scale = resolveScale({ filename: 'tower.glb', calibrations: { [UNPAGED]: 3 } });
  assert.deepEqual(scale, { mmPerUnit: 3, source: 'calibrated' });
});

test('with no calibration a known format falls back to its assumption', () => {
  assert.deepEqual(resolveScale({ filename: 'tower.glb' }), {
    mmPerUnit: 1000,
    source: 'assumed',
  });
});

test('with no calibration and no convention the scale is unknown', () => {
  assert.deepEqual(resolveScale({ filename: 'sheet.pdf' }), {
    mmPerUnit: null,
    source: 'unknown',
  });
});

// A multi-sheet PDF genuinely mixes scales: a 1:50 plan and a 1:20 detail in one document.
test('calibration is looked up per page', () => {
  const calibrations = { 1: 50, 2: 20 };
  assert.equal(resolveScale({ filename: 's.pdf', calibrations, page: 1 }).mmPerUnit, 50);
  assert.equal(resolveScale({ filename: 's.pdf', calibrations, page: 2 }).mmPerUnit, 20);
  assert.equal(resolveScale({ filename: 's.pdf', calibrations, page: 3 }).source, 'unknown');
});

// The trap: a STEP upload is VIEWED as a converted GLB. Reading the extension off the loaded
// file would apply the glTF metre convention and report every STEP model 1000x too large.
test('the assumption reads the original upload name, never the converted GLB', () => {
  assert.equal(resolveScale({ filename: 'bracket.step' }).mmPerUnit, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/measureCalibration.test.mjs`
Expected: FAIL — `Cannot find module .../lib/measure/calibration.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/measure/calibration.ts`:

```ts
import { extensionOf } from '../fileFormats.ts';
import { toMillimetres, type LengthUnit } from './units.ts';

/**
 * How many real millimetres one INTRINSIC unit of a file spans, and where that number came from.
 *
 * "Intrinsic unit" differs per surface and each definition is a trap if got wrong:
 *   image — one NATURAL pixel of the source image (not displayed px, not snapshot px, both of
 *           which change with zoom and viewport)
 *   pdf   — one PDF point (1/72"), NOT one rendered pixel; the viewer renders at
 *           PDF_RENDER_SCALE (see lib/measure/space.ts)
 *   3D    — one world unit of the LOADED GLB
 */

/** The page key for a file that has no pages. Matches file_calibrations.page_number's default. */
export const UNPAGED = 0;

export type ScaleSource = 'calibrated' | 'assumed' | 'unknown';

export interface Scale {
  /** Null only when source is 'unknown'. */
  mmPerUnit: number | null;
  source: ScaleSource;
}

/**
 * What one world unit means for a 3D format that has a unit convention, in millimetres.
 *
 * Read from the ORIGINAL upload's filename, never from the file the viewer actually loaded. A
 * STEP upload is viewed as a converted GLB, but stepToGlb emits OCCT's millimetres — so a .step
 * file is 1 mm per unit even though the bytes on screen are a .glb. Keying off the loaded file
 * would apply the glTF metre convention and read every STEP model 1000x too large.
 *
 * Null means "no convention exists": measuring is blocked until someone calibrates. That covers
 * OBJ/STL/PLY/3DS/DAE, and also every 2D format — an image or a PDF is calibrated or nothing.
 */
export function assumedMmPerUnit(filename: string): number | null {
  switch (extensionOf(filename)) {
    case 'step':
    case 'stp':
      return 1;
    case 'glb':
    case 'gltf':
      return 1000;
    default:
      return null;
  }
}

/**
 * The scale implied by "this measured span is that far in the real world".
 *
 * Throws rather than returning a sentinel: a non-positive or non-finite scale would be stored,
 * pass the CHECK constraint's own guard only by accident, and silently corrupt every subsequent
 * reading on the file.
 */
export function mmPerUnitFrom(
  intrinsicDistance: number,
  realDistance: number,
  unit: LengthUnit,
): number {
  if (!Number.isFinite(intrinsicDistance) || intrinsicDistance <= 0) {
    throw new RangeError('The measured distance must be a positive number');
  }
  if (!Number.isFinite(realDistance) || realDistance <= 0) {
    throw new RangeError('The real distance must be a positive number');
  }
  return toMillimetres(realDistance, unit) / intrinsicDistance;
}

export interface ScaleInput {
  /** The ORIGINAL upload's filename — see assumedMmPerUnit. */
  filename: string;
  /** Stored mm-per-unit keyed by page number; UNPAGED for files without pages. */
  calibrations?: Record<number, number>;
  /** Which page is on screen. Defaults to UNPAGED. */
  page?: number;
}

export function resolveScale({ filename, calibrations, page = UNPAGED }: ScaleInput): Scale {
  const calibrated = calibrations?.[page];
  if (typeof calibrated === 'number' && Number.isFinite(calibrated) && calibrated > 0) {
    return { mmPerUnit: calibrated, source: 'calibrated' };
  }

  const assumed = assumedMmPerUnit(filename);
  if (assumed !== null) return { mmPerUnit: assumed, source: 'assumed' };

  return { mmPerUnit: null, source: 'unknown' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/tests/measureCalibration.test.mjs`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add lib/measure/calibration.ts scripts/tests/measureCalibration.test.mjs
git commit -m "feat: calibration arithmetic and scale resolution"
```

---

## Task 4: The gesture state machine

**Files:**
- Create: `lib/measure/gesture.ts`
- Test: `scripts/tests/measureGesture.test.mjs`

**Interfaces:**
- Consumes: `distance`, `angleAt` from Task 2; `UNPAGED` from Task 3.
- Produces:
  - `type MeasureKind = 'linear' | 'angular'`
  - `interface MeasurementDraft { kind: MeasureKind; points: number[][]; page: number }`
  - `interface PendingGesture { kind: MeasureKind; points: number[][]; page: number }`
  - `type GestureResult = { status: 'pending'; gesture: PendingGesture } | { status: 'committed'; measurement: MeasurementDraft } | { status: 'rejected'; reason: 'degenerate' }`
  - `beginGesture(kind: MeasureKind, page?: number): PendingGesture`
  - `addPoint(gesture: PendingGesture, point: number[], minSeparation: number): GestureResult`
  - `pointsNeeded(kind: MeasureKind): number`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/measureGesture.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginGesture, addPoint, pointsNeeded } from '../../lib/measure/gesture.ts';

test('a linear needs two points, an angle needs three', () => {
  assert.equal(pointsNeeded('linear'), 2);
  assert.equal(pointsNeeded('angular'), 3);
});

test('two clicks commit a linear measurement', () => {
  let g = beginGesture('linear');
  const first = addPoint(g, [0, 0], 3);
  assert.equal(first.status, 'pending');
  assert.deepEqual(first.gesture.points, [[0, 0]]);

  const second = addPoint(first.gesture, [100, 0], 3);
  assert.equal(second.status, 'committed');
  assert.equal(second.measurement.kind, 'linear');
  assert.deepEqual(second.measurement.points, [[0, 0], [100, 0]]);
});

test('three clicks commit an angular measurement in leg-vertex-leg order', () => {
  let r = addPoint(beginGesture('angular'), [10, 0], 3);
  r = addPoint(r.gesture, [0, 0], 3);
  assert.equal(r.status, 'pending');
  r = addPoint(r.gesture, [0, 10], 3);
  assert.equal(r.status, 'committed');
  assert.deepEqual(r.measurement.points, [[10, 0], [0, 0], [0, 10]]);
});

test('a linear shorter than minSeparation is rejected, not committed', () => {
  const first = addPoint(beginGesture('linear'), [0, 0], 3);
  const second = addPoint(first.gesture, [1, 1], 3);
  assert.equal(second.status, 'rejected');
  assert.equal(second.reason, 'degenerate');
});

test('minSeparation is per-surface — 3D passes a scene-scaled epsilon', () => {
  const first = addPoint(beginGesture('linear'), [0, 0, 0], 0.0001);
  const second = addPoint(first.gesture, [0.01, 0, 0], 0.0001);
  assert.equal(second.status, 'committed');
});

test('an angle with a zero-length leg is rejected', () => {
  let r = addPoint(beginGesture('angular'), [0, 0], 3);
  r = addPoint(r.gesture, [0, 0], 3);
  r = addPoint(r.gesture, [0, 10], 3);
  assert.equal(r.status, 'rejected');
});

test('three collinear clicks are rejected — almost always a misclick', () => {
  let r = addPoint(beginGesture('angular'), [0, 0], 3);
  r = addPoint(r.gesture, [50, 0], 3);
  r = addPoint(r.gesture, [100, 0], 3);
  assert.equal(r.status, 'rejected');
});

test('the page is carried from the gesture onto the committed measurement', () => {
  const first = addPoint(beginGesture('linear', 4), [0, 0], 3);
  const second = addPoint(first.gesture, [100, 0], 3);
  assert.equal(second.measurement.page, 4);
});

test('a rejected gesture does not mutate the pending gesture it came from', () => {
  const first = addPoint(beginGesture('linear'), [0, 0], 3);
  const before = JSON.stringify(first.gesture);
  addPoint(first.gesture, [1, 1], 3);
  assert.equal(JSON.stringify(first.gesture), before);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/measureGesture.test.mjs`
Expected: FAIL — `Cannot find module .../lib/measure/gesture.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/measure/gesture.ts`:

```ts
import { distance, angleAt } from './geometry.ts';
import { UNPAGED } from './calibration.ts';

/**
 * Click-counting for the two measurement gestures, and the rules for throwing one away.
 *
 * Lives here rather than in each surface so "three clicks makes an angle" is one tested fact
 * instead of three implementations that drift. Every function is pure: `addPoint` returns a new
 * gesture rather than mutating the one it was given, so a rejected click leaves the caller's
 * state exactly as it was.
 */

export type MeasureKind = 'linear' | 'angular';

export interface PendingGesture {
  kind: MeasureKind;
  points: number[][];
  page: number;
}

export interface MeasurementDraft {
  kind: MeasureKind;
  points: number[][];
  page: number;
}

export type GestureResult =
  | { status: 'pending'; gesture: PendingGesture }
  | { status: 'committed'; measurement: MeasurementDraft }
  | { status: 'rejected'; reason: 'degenerate' };

/** How close to 0 or π an angle may come before the three clicks read as a misclick. */
const COLLINEAR_TOLERANCE = 1e-3;

export function pointsNeeded(kind: MeasureKind): number {
  return kind === 'linear' ? 2 : 3;
}

export function beginGesture(kind: MeasureKind, page: number = UNPAGED): PendingGesture {
  return { kind, points: [], page };
}

/**
 * Add a click.
 *
 * `minSeparation` is in the SURFACE's own units, which is why it is a parameter rather than a
 * constant: 3 is the right floor in Konva stage pixels and meaningless in a 3D scene, where the
 * caller passes something derived from the model's bounding radius.
 */
export function addPoint(
  gesture: PendingGesture,
  point: number[],
  minSeparation: number,
): GestureResult {
  const points = [...gesture.points, [...point]];

  if (points.length < pointsNeeded(gesture.kind)) {
    return { status: 'pending', gesture: { ...gesture, points } };
  }

  if (gesture.kind === 'linear') {
    if (distance(points[0], points[1]) < minSeparation) {
      return { status: 'rejected', reason: 'degenerate' };
    }
  } else {
    // Stored leg, vertex, leg — the vertex is the middle click, which is where the arc goes.
    const [a, vertex, b] = points;
    if (distance(a, vertex) < minSeparation || distance(b, vertex) < minSeparation) {
      return { status: 'rejected', reason: 'degenerate' };
    }
    const angle = angleAt(vertex, a, b);
    const collinear =
      !Number.isFinite(angle) ||
      angle < COLLINEAR_TOLERANCE ||
      Math.PI - angle < COLLINEAR_TOLERANCE;
    if (collinear) return { status: 'rejected', reason: 'degenerate' };
  }

  return { status: 'committed', measurement: { kind: gesture.kind, points, page: gesture.page } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/tests/measureGesture.test.mjs`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add lib/measure/gesture.ts scripts/tests/measureGesture.test.mjs
git commit -m "feat: measurement gesture state machine"
```

---

## Task 5: Surface coordinate conversions

**Files:**
- Create: `lib/measure/space.ts`
- Test: `scripts/tests/measureSpace.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Rect { x: number; y: number; width: number; height: number }`
  - `interface ImageSnapshotSpace { imageRect: Rect; naturalWidth: number; naturalHeight: number }`
  - `naturalPerStagePixel(bgFit: Rect, snapshotWidth: number, space: ImageSnapshotSpace): number`
  - `const PDF_RENDER_SCALE = 2`
  - `pointsPerStagePixel(): number`

**Why only a scale and not a point mapping:** both steps of the image chain are uniform, aspect-preserving scales, so converting a *distance* needs only the product of their scale factors. Measurements are rendered in stage space and never need their coordinates converted — only their lengths. Adding a point mapping would be code with no caller.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/measureSpace.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  naturalPerStagePixel,
  pointsPerStagePixel,
  PDF_RENDER_SCALE,
} from '../../lib/measure/space.ts';

test('an unscaled, unletterboxed chain is 1:1', () => {
  const scale = naturalPerStagePixel(
    { x: 0, y: 0, width: 800, height: 600 },
    800,
    { imageRect: { x: 0, y: 0, width: 800, height: 600 }, naturalWidth: 800, naturalHeight: 600 },
  );
  assert.ok(Math.abs(scale - 1) < 1e-12);
});

// AnnotationCanvas contain-fits the snapshot into the stage, so a stage wider than the
// snapshot's aspect leaves matte on both sides and bgFit.width < snapshot width.
test('a letterboxed bgFit is accounted for', () => {
  const scale = naturalPerStagePixel(
    { x: 100, y: 0, width: 400, height: 300 },
    800,
    { imageRect: { x: 0, y: 0, width: 800, height: 600 }, naturalWidth: 800, naturalHeight: 600 },
  );
  assert.ok(Math.abs(scale - 2) < 1e-12);
});

// The image branch of captureViewerSnapshot draws the <img> at its on-screen size, which is
// smaller than the source whenever the viewer is fit-to-window on a large photo.
test('a downscaled <img> inside the snapshot is accounted for', () => {
  const scale = naturalPerStagePixel(
    { x: 0, y: 0, width: 800, height: 600 },
    800,
    { imageRect: { x: 0, y: 0, width: 400, height: 300 }, naturalWidth: 4000, naturalHeight: 3000 },
  );
  assert.ok(Math.abs(scale - 10) < 1e-12);
});

test('both factors compound', () => {
  const scale = naturalPerStagePixel(
    { x: 100, y: 0, width: 400, height: 300 },
    800,
    { imageRect: { x: 0, y: 0, width: 400, height: 300 }, naturalWidth: 4000, naturalHeight: 3000 },
  );
  assert.ok(Math.abs(scale - 20) < 1e-12);
});

test('degenerate geometry throws rather than producing a silently wrong scale', () => {
  const space = {
    imageRect: { x: 0, y: 0, width: 800, height: 600 },
    naturalWidth: 800,
    naturalHeight: 600,
  };
  assert.throws(() => naturalPerStagePixel({ x: 0, y: 0, width: 0, height: 0 }, 800, space), RangeError);
  assert.throws(() => naturalPerStagePixel({ x: 0, y: 0, width: 800, height: 600 }, 0, space), RangeError);
  assert.throws(
    () =>
      naturalPerStagePixel({ x: 0, y: 0, width: 800, height: 600 }, 800, {
        imageRect: { x: 0, y: 0, width: 0, height: 0 },
        naturalWidth: 800,
        naturalHeight: 600,
      }),
    RangeError,
  );
});

// The 2x trap: PDFKonvaViewer renders at scale 2, so page coordinates are twice the points.
// Storing mm-per-rendered-pixel would make every PDF calibration exactly 2x wrong.
test('PDF page pixels are half a point each, at the viewer render scale', () => {
  assert.equal(PDF_RENDER_SCALE, 2);
  assert.equal(pointsPerStagePixel(), 0.5);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/measureSpace.test.mjs`
Expected: FAIL — `Cannot find module .../lib/measure/space.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/measure/space.ts`:

```ts
/**
 * Converting a measured span on a 2D surface into that file's own intrinsic units.
 *
 * This is the arithmetic that fails silently. A wrong factor here does not throw and does not
 * look wrong — it produces plausible numbers that are simply incorrect, on a tool whose entire
 * purpose is to be trusted. Hence: every input validated, every factor separately tested.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageSnapshotSpace {
  /** Where the source <img> was drawn inside the captured snapshot, in snapshot pixels. */
  imageRect: Rect;
  naturalWidth: number;
  naturalHeight: number;
}

function requirePositive(value: number, what: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${what} must be a positive, finite number`);
  }
}

/**
 * How many NATURAL image pixels one AnnotationCanvas stage pixel spans.
 *
 * Two uniform, aspect-preserving steps compound into one factor:
 *
 *   stage px  --bgFit-->  snapshot px  --imageRect-->  natural px
 *
 * `bgFit` is AnnotationCanvas's contain-fit of the snapshot into the stage (it already computes
 * this for the native-resolution capture path). `imageRect` is where captureViewerSnapshot drew
 * the <img> inside the snapshot, captured at freeze time — the viewer's zoom is baked into it,
 * which is exactly why calibration must be stored in natural pixels and never in stage pixels.
 */
export function naturalPerStagePixel(
  bgFit: Rect,
  snapshotWidth: number,
  space: ImageSnapshotSpace,
): number {
  requirePositive(bgFit.width, 'The fitted background width');
  requirePositive(snapshotWidth, 'The snapshot width');
  requirePositive(space.imageRect.width, 'The image rect width');
  requirePositive(space.naturalWidth, 'The natural image width');

  const stageToSnapshot = snapshotWidth / bgFit.width;
  const snapshotToNatural = space.naturalWidth / space.imageRect.width;
  return stageToSnapshot * snapshotToNatural;
}

/**
 * The scale PDFKonvaViewer renders pages at. PDFKonvaViewer must import this constant rather
 * than repeating the literal: a PDF's intrinsic unit is the POINT (1/72"), and storing
 * mm-per-rendered-pixel instead would make every PDF calibration exactly this factor wrong.
 */
export const PDF_RENDER_SCALE = 2;

/** How many PDF points one rendered page pixel spans. */
export function pointsPerStagePixel(): number {
  return 1 / PDF_RENDER_SCALE;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/tests/measureSpace.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Verify the whole suite still passes**

Run: `npm test`
Expected: PASS — all pre-existing tests plus the five new files

- [ ] **Step 6: Commit**

```bash
git add lib/measure/space.ts scripts/tests/measureSpace.test.mjs
git commit -m "feat: image and PDF measurement coordinate conversions"
```

---

## Task 6: BatchedMesh vertex-snap spike

**Files:**
- Modify: `docs/superpowers/plans/2026-09-16-measure-tool.md` (record the outcome in this task)

**Interfaces:**
- Consumes: nothing.
- Produces: a recorded decision that Task 13 depends on — either "vertex snap is viable" or "ship free surface points in v1".

**Why this is its own task:** the 3D design assumes a raycast hit against the model exposes enough data to find the triangle's vertices. The model is drawn as merged `BatchedMesh` batches (`lib/model/buildBatches.ts`), and three's `BatchedMesh` raycast reports a `batchId`. If `intersection.face` and the underlying position attribute are not reachable per-hit, snapping needs a different approach — and that is much cheaper to learn now than after the layer is built on top of it.

- [ ] **Step 1: Start the app and open a STEP or GLB model**

```bash
npm run dev
```

Open a package containing a 3D file in the browser. (If no local database is configured, follow the local visual verification route already used for viewer work.)

- [ ] **Step 2: Add a temporary probe to the existing pick raycast**

In `components/viewers/ModelViewerInner.tsx`, inside `handlePointerUp`'s existing loop over
`raycaster.current.intersectObject(model, true)`, temporarily log what a hit carries:

```ts
console.log('HIT', {
  type: hit.object.type,
  batchId: (hit as { batchId?: number }).batchId,
  hasFace: hit.face !== null && hit.face !== undefined,
  faceIndices: hit.face ? [hit.face.a, hit.face.b, hit.face.c] : null,
  positionCount: (hit.object as THREE.Mesh).geometry?.getAttribute('position')?.count ?? null,
});
```

- [ ] **Step 3: Click several parts of the model and read the console**

Record, for a `BatchedMesh` hit specifically:
- Is `hit.face` non-null?
- Are `hit.face.a/b/c` valid indices into the hit object's `position` attribute?
- Does reading those three vertices and transforming them by the object's `matrixWorld` produce points that sit on the clicked feature?

- [ ] **Step 4: Record the decision in this plan file**

Append to this task, replacing this step's text:

> **Outcome:** `hit.face` IS / IS NOT available on BatchedMesh hits. Task 13 therefore implements
> vertex snapping / free surface points only.

If vertex snap is **not** viable, edit Task 13 Step 3 to drop `nearestVertexSnap` and its call site,
and edit the spec's "Decisions" table entry for 3D point picking to read "free surface point; vertex
snap deferred".

- [ ] **Step 5: Remove the probe**

Revert the temporary `console.log`. Confirm `git diff components/viewers/ModelViewerInner.tsx` is empty.

- [ ] **Step 6: Commit the decision**

```bash
git add docs/superpowers/plans/2026-09-16-measure-tool.md
git commit -m "docs: record BatchedMesh vertex-snap spike outcome"
```

---

## Task 7: Migration and stale-calibration cleanup

**Files:**
- Create: `lib/migrations/012-measure-calibration.sql`
- Modify: `lib/schema.sql` (append after the `part_colors` block)
- Modify: `app/api/conversions/webhook/route.ts:88-98`

**Interfaces:**
- Consumes: nothing.
- Produces: table `file_calibrations (id, file_id, page_number, mm_per_unit, set_by, created_at)` and column `files.measure_unit`.

- [ ] **Step 1: Write the migration**

Create `lib/migrations/012-measure-calibration.sql`:

```sql
-- Calibration for the measure tool: how many real millimetres one INTRINSIC unit of a file
-- spans. Mirrored in lib/schema.sql.
--
-- "Intrinsic unit" is per surface, and each definition is a trap if got wrong:
--   image — one NATURAL pixel of the source image. Not displayed px, not snapshot px: both
--           change with zoom and viewport, so a calibration stored in either is wrong the next
--           time the file is opened.
--   pdf   — one PDF point (1/72"). The viewer renders pages at PDF_RENDER_SCALE (2), so page
--           coordinates are twice the points; dividing by that scale before storing is what
--           keeps every PDF calibration from being exactly 2x wrong.
--   3D    — one world unit of the LOADED GLB, i.e. converted_storage_key when one exists.
--
-- Rows are per PAGE, not just per file: a multi-sheet PDF genuinely mixes scales, e.g. a 1:50
-- plan and a 1:20 detail in one document.
--
-- page_number is NOT NULL DEFAULT 0 rather than nullable, and that is load-bearing. Postgres
-- treats NULLs as DISTINCT inside a UNIQUE constraint, so a nullable column would silently
-- permit duplicate calibration rows for the same image, and whichever row the read happened to
-- order first would win. 0 means "this file has no pages".
--
-- A 3D calibration is anchored to the loaded GLB's scale. Every place that assigns
-- converted_storage_key must therefore delete this file's rows alongside it — the same
-- obligation part_colors carries, for the same reason. See the DELETE in
-- app/api/conversions/webhook/route.ts and its comment on why it tolerates its own failure.
CREATE TABLE IF NOT EXISTS file_calibrations (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  page_number INT NOT NULL DEFAULT 0,
  mm_per_unit DOUBLE PRECISION NOT NULL CHECK (mm_per_unit > 0),
  set_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (file_id, page_number)
);

CREATE INDEX IF NOT EXISTS file_calibrations_file_id_idx ON file_calibrations(file_id);

-- Which unit measurements are READ in. File-scoped and single-valued, so a column rather than a
-- third table. NULL means nobody has chosen, and the client falls back to millimetres.
ALTER TABLE files ADD COLUMN IF NOT EXISTS measure_unit TEXT DEFAULT NULL;
```

- [ ] **Step 2: Mirror it into `lib/schema.sql`**

Append the same two statements (table + index + column) to `lib/schema.sql`, immediately after the
`part_colors` table block that ends at the `part_colors_file_id_idx` index, keeping the full comment.

- [ ] **Step 3: Apply the migration**

```bash
set -a && . .env.local && set +a && npm run migrate -- --dry
```
Expected: lists `012-measure-calibration.sql` as outstanding.

```bash
set -a && . .env.local && set +a && npm run migrate
```
Expected: applies it and records it in `schema_migrations`.

- [ ] **Step 4: Verify the constraint actually bites**

```bash
set -a && . .env.local && set +a && node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT column_name, is_nullable, column_default FROM information_schema.columns
     WHERE table_name = 'file_calibrations' ORDER BY ordinal_position\`
  .then((r) => console.log(r));
"
```
Expected: `page_number` shows `is_nullable: 'NO'` and `column_default: '0'`.

- [ ] **Step 5: Add the stale-calibration deletion to the conversions webhook**

In `app/api/conversions/webhook/route.ts`, directly after the existing `part_colors` `try/catch`
block (which ends at line 98), add a sibling block:

```ts
      // Same obligation as the part_colors delete above, same reasoning, same tolerance for its
      // own failure. A 3D calibration says what one world unit of the LOADED GLB means in
      // millimetres. converted_storage_key just started pointing at CloudConvert's own GLB,
      // whose scale has nothing to do with whatever produced the saved number — left in place,
      // every measurement on this file would silently read wrong, with no error anywhere.
      //
      // Its own statement and its own try/catch, deliberately NOT sharing a transaction with the
      // UPDATE above: if 012-measure-calibration.sql has not been applied yet, a throw here must
      // not roll back a conversion whose GLB is already in S3.
      try {
        await sql`
          DELETE FROM file_calibrations WHERE file_id = ${fileId}
        `;
      } catch (calibrationErr) {
        console.error(
          `Failed to delete stale file_calibrations for file ${fileId} after conversion` +
            ' (likely 012-measure-calibration.sql has not been applied yet):',
          calibrationErr instanceof Error ? calibrationErr.message : String(calibrationErr)
        );
      }
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/migrations/012-measure-calibration.sql lib/schema.sql app/api/conversions/webhook/route.ts
git commit -m "feat: file_calibrations table and stale-calibration cleanup"
```

---

## Task 8: The write endpoint

**Files:**
- Create: `app/api/files/[id]/measure/route.ts`

**Interfaces:**
- Consumes: `isLengthUnit` (Task 1), `UNPAGED` (Task 3), `getFileAccess` from `lib/access`.
- Produces: `PATCH /api/files/[id]/measure`, body `{ unit?: LengthUnit; calibration?: { page: number; mmPerUnit: number } }`, responding `{ ok: true }` or an error object.

**Gate, in one place:**
| Action | Requires |
| --- | --- |
| set `unit` | `canComment` |
| set `calibration` where no row exists for that page | `canComment` |
| set `calibration` where a row already exists | `canTransform` |

- [ ] **Step 1: Write the route**

Create `app/api/files/[id]/measure/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getFileAccess } from '@/lib/access';
import { isLengthUnit } from '@/lib/measure/units';

/**
 * Set the display unit and/or the calibration for one file.
 *
 * One route rather than two because the gate is the interesting part and it belongs in one
 * place. The client hides controls a role may not use, but that is presentation only — this is
 * the actual boundary.
 *
 * The three-way rule: a reviewer who opens an uncalibrated drawing can calibrate it and get to
 * work, because blocking that blocks the feature's main use case. But once a calibration exists,
 * changing it silently shifts every number everyone else reads, which is the same class of
 * shared-scene edit as moving an object or colouring a part — so overwriting needs canTransform.
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await getFileAccess(session.user.id, params.id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canComment) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || (body.unit === undefined && body.calibration === undefined)) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  if (body.unit !== undefined) {
    if (!isLengthUnit(body.unit)) {
      return NextResponse.json({ error: 'Invalid unit' }, { status: 400 });
    }
    await sql`UPDATE files SET measure_unit = ${body.unit} WHERE id = ${params.id}`;
  }

  if (body.calibration !== undefined) {
    const { page, mmPerUnit } = body.calibration ?? {};

    if (!Number.isInteger(page) || page < 0) {
      return NextResponse.json({ error: 'Invalid page' }, { status: 400 });
    }
    // Mirrors the CHECK constraint. A non-positive or non-finite scale would not merely be
    // wrong, it would make every reading on the file wrong with no error shown anywhere.
    if (typeof mmPerUnit !== 'number' || !Number.isFinite(mmPerUnit) || mmPerUnit <= 0) {
      return NextResponse.json({ error: 'Invalid calibration' }, { status: 400 });
    }

    const existing = await sql`
      SELECT id FROM file_calibrations
      WHERE file_id = ${params.id} AND page_number = ${page}
    `;

    if (existing.length > 0 && !access.canTransform) {
      return NextResponse.json(
        { error: 'This file is already calibrated. Ask the package owner to change it.' },
        { status: 403 }
      );
    }

    await sql`
      INSERT INTO file_calibrations (id, file_id, page_number, mm_per_unit, set_by)
      VALUES (${randomUUID()}, ${params.id}, ${page}, ${mmPerUnit}, ${session.user.id})
      ON CONFLICT (file_id, page_number)
      DO UPDATE SET mm_per_unit = EXCLUDED.mm_per_unit, set_by = EXCLUDED.set_by
    `;
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Exercise the route against the running app**

With `npm run dev` running and signed in, from the browser console on a package page:

```js
await fetch('/api/files/<A_REAL_FILE_ID>/measure', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ unit: 'cm', calibration: { page: 0, mmPerUnit: 12.5 } }),
}).then((r) => r.json());
```
Expected: `{ ok: true }`

Then confirm the guards reject bad input:

```js
await fetch('/api/files/<A_REAL_FILE_ID>/measure', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ calibration: { page: 0, mmPerUnit: 0 } }),
}).then((r) => r.status);
```
Expected: `400`

- [ ] **Step 4: Commit**

```bash
git add "app/api/files/[id]/measure/route.ts"
git commit -m "feat: measure calibration and unit endpoint"
```

---

## Task 9: Read path — fold calibrations into the file listing

**Files:**
- Modify: `lib/types.ts:71` (after `partColors`)
- Modify: `app/api/files/route.ts` (after the `part_colors` block ending at line 95)

**Interfaces:**
- Consumes: `LengthUnit` (Task 1), `UNPAGED` (Task 3).
- Produces: `FileRecord.calibrations?: Record<number, number>` and `FileRecord.measureUnit?: LengthUnit | null`.

- [ ] **Step 1: Extend the type**

In `lib/types.ts`, immediately after the `partColors` field:

```ts
  /**
   * Calibration for the measure tool: millimetres per intrinsic unit, keyed by page number
   * (0 for files without pages). Absent or empty means uncalibrated — which for a 2D file
   * means linear measurement is blocked, and for a 3D file means the format's own unit
   * convention applies instead.
   */
  calibrations?: Record<number, number>;
  /** Which unit measurements are read in on this file. Null until someone chooses. */
  measureUnit?: LengthUnit | null;
```

Add the import at the top of `lib/types.ts`:

```ts
import type { LengthUnit } from './measure/units.ts';
```

- [ ] **Step 2: Fold the read into the files route**

In `app/api/files/route.ts`, after the `part_colors` `try/catch` that assigns `colorsByFile`, add:

```ts
  // Same one-query-per-version shape as the colours above, and the same fail-soft contract for
  // the same reason: this endpoint is load-bearing for file listing app-wide, migrations here
  // are applied by hand, and this repo has forgotten one twice. An unapplied
  // 012-measure-calibration.sql must degrade to "the measure tool is unavailable", never to a
  // file-listing outage.
  let calibrationsByFile = new Map<string, Record<number, number>>();
  try {
    const calibrationRows = await sql`
      SELECT fc.file_id AS "fileId", fc.page_number AS "pageNumber", fc.mm_per_unit AS "mmPerUnit"
      FROM file_calibrations fc
      JOIN files f ON f.id = fc.file_id
      WHERE f.version_id = ${versionId}
    `;
    calibrationRows.forEach((row) => {
      const forFile = calibrationsByFile.get(row.fileId as string) ?? {};
      forFile[Number(row.pageNumber)] = Number(row.mmPerUnit);
      calibrationsByFile.set(row.fileId as string, forFile);
    });
  } catch (error) {
    console.error(
      `Failed to fetch file_calibrations for version ${versionId}:`,
      error instanceof Error ? error.message : String(error)
    );
    // Fall back to uncalibrated; a file listing matters more than a measurement.
    calibrationsByFile = new Map();
  }
```

- [ ] **Step 3: Attach both fields to each file row**

`files.measure_unit` is a plain column, so add it to this route's main file `SELECT` list beside
the other aliased columns:

```sql
      f.measure_unit AS "measureUnit",
```

Then in the `rows.map(...)` that builds each file object, add the calibrations:

```ts
      calibrations: calibrationsByFile.get(row.id as string) ?? {},
```

`measureUnit` needs no mapping — it arrives on `row` already aliased.

- [ ] **Step 4: Typecheck and verify the response**

Run: `npx tsc --noEmit`
Expected: no errors.

With the app running, in the browser console on a package page:

```js
await fetch('/api/files?versionId=<A_REAL_VERSION_ID>').then((r) => r.json());
```
Expected: each file object carries `calibrations` (an object) and `measureUnit` (a string or null). The file calibrated in Task 8 shows `{ "0": 12.5 }` and `"cm"`.

- [ ] **Step 5: Confirm the fail-soft path**

Temporarily rename the table and reload the package page:

```bash
set -a && . .env.local && set +a && node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`ALTER TABLE file_calibrations RENAME TO file_calibrations_tmp\`.then(() => console.log('renamed'));
"
```
Expected: the package page still lists its files; the server console logs the fetch failure. Then restore:

```bash
set -a && . .env.local && set +a && node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`ALTER TABLE file_calibrations_tmp RENAME TO file_calibrations\`.then(() => console.log('restored'));
"
```

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts app/api/files/route.ts
git commit -m "feat: serve file calibrations and measure unit with the file listing"
```

---

## Task 10: Tool types and the session store

**Files:**
- Modify: `components/markup/useAnnotationObjects.ts:9-19`
- Create: `components/markup/useMeasurements.ts`

**Interfaces:**
- Consumes: `MeasureKind`, `beginGesture`, `addPoint`, `PendingGesture`, `MeasurementDraft` (Task 4).
- Produces:
  - `type MeasureTool = 'measure' | 'angle' | 'calibrate'`
  - `ToolType` widened to `AnnTool | 'comment' | MeasureTool`
  - `const MEASURE_TOOLS: readonly MeasureTool[]`
  - `isMeasureTool(tool: ToolType): tool is MeasureTool`
  - `measureKindFor(tool: ToolType): MeasureKind | null`
  - `interface Measurement extends MeasurementDraft { id: string }`
  - `useMeasurements()` returning `{ measurements, pending, selectedId, setSelectedId, begin, addPoint, cancel, remove, clear }`

- [ ] **Step 1: Widen `ToolType`**

In `components/markup/useAnnotationObjects.ts`, replace the `ToolType` declaration and its comment:

```ts
/** The three measure-tool modes. Not AnnTools: they create no markup object and carry no style. */
export type MeasureTool = 'measure' | 'angle' | 'calibrate';

export const MEASURE_TOOLS: readonly MeasureTool[] = ['measure', 'angle', 'calibrate'];

/**
 * Everything the toolbar can have armed. One definition, imported by the toolbar, both
 * drawing surfaces and the portal page — it used to be hand-copied into four files, which
 * is one place to forget when a tool is added.
 *
 * 'comment' is the pin mode, which is a toolbar state but never an AnnTool: it places a
 * comment rather than drawing an object. The measure tools are the same kind of exception —
 * they produce measurements, which are their own layer with no colour and no stroke width, so
 * they must never reach the markup style model.
 */
export type ToolType = AnnTool | 'comment' | MeasureTool;

export function isMeasureTool(tool: ToolType): tool is MeasureTool {
  return (MEASURE_TOOLS as readonly string[]).includes(tool);
}
```

- [ ] **Step 2: Write the session store**

Create `components/markup/useMeasurements.ts`:

```ts
'use client';

import { useState, useRef, useCallback } from 'react';
import {
  beginGesture,
  addPoint as addGesturePoint,
  type MeasureKind,
  type MeasurementDraft,
  type PendingGesture,
} from '@/lib/measure/gesture';
import { UNPAGED } from '@/lib/measure/calibration';

export interface Measurement extends MeasurementDraft {
  id: string;
}

/**
 * Measurements for one viewing session, mirroring useAnnotationObjects.
 *
 * Surface-agnostic: each surface feeds points in its OWN intrinsic space (stage pixels for the
 * 2D surfaces, model-frame coordinates for the 3D one) and renders them back in that same space.
 * Nothing here knows about pixels, world units or millimetres — conversion to a displayed number
 * happens at render time, where the file's scale is known.
 *
 * Measurements are session-only, exactly like markup: the way to keep one is to snapshot it into
 * a comment.
 */
export function useMeasurements() {
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [pending, setPending] = useState<PendingGesture | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const idRef = useRef(0);

  const begin = useCallback((kind: MeasureKind, page: number = UNPAGED) => {
    setPending(beginGesture(kind, page));
  }, []);

  /**
   * Returns the committed measurement, or null while the gesture is still collecting points or
   * when the gesture was rejected as degenerate. A rejection restarts the gesture rather than
   * leaving a half-finished one on screen — the user's next click should begin cleanly.
   */
  const addPoint = useCallback(
    (point: number[], minSeparation: number): Measurement | null => {
      let committed: Measurement | null = null;
      setPending((current) => {
        if (!current) return current;
        const result = addGesturePoint(current, point, minSeparation);
        if (result.status === 'pending') return result.gesture;
        if (result.status === 'rejected') return beginGesture(current.kind, current.page);
        committed = { ...result.measurement, id: `measure-${idRef.current++}` };
        return beginGesture(current.kind, current.page);
      });
      if (committed) setMeasurements((prev) => [...prev, committed as Measurement]);
      return committed;
    },
    []
  );

  const cancel = useCallback(() => setPending(null), []);

  const remove = useCallback((id: string) => {
    setMeasurements((prev) => prev.filter((m) => m.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  const clear = useCallback(() => {
    setMeasurements([]);
    setPending(null);
    setSelectedId(null);
  }, []);

  return { measurements, pending, selectedId, setSelectedId, begin, addPoint, cancel, remove, clear };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY where `ToolType` newly fails to narrow — specifically `app/portal/[id]/page.tsx:1684` casting to `AnnTool`. Note them; Task 12 fixes them.

- [ ] **Step 4: Commit**

```bash
git add components/markup/useAnnotationObjects.ts components/markup/useMeasurements.ts
git commit -m "feat: measure tool types and session store"
```

---

## Task 11: Toolbar button, sub-bar and units chip

**Files:**
- Modify: `components/markup/DrawingTools.tsx`

**Interfaces:**
- Consumes: `ToolType`, `MeasureTool` (Task 10); `LENGTH_UNITS`, `LengthUnit` (Task 1); `ScaleSource` (Task 3).
- Produces: new `DrawingToolsProps` fields `measureUnit`, `onMeasureUnitChange`, `scaleSource`, `canCalibrate`.

- [ ] **Step 1: Add the new props**

In `DrawingToolsProps`, after `selectionType`:

```ts
  /** The unit measurements are read in on this file. */
  measureUnit: LengthUnit;
  onMeasureUnitChange: (unit: LengthUnit) => void;
  /**
   * Whether this file has a usable scale. 'unknown' disables Linear — a length with no scale is
   * a pixel count, not a dimension. Angular is never gated: angles are scale-invariant, so
   * calibration does not affect them.
   */
  scaleSource: ScaleSource;
  /** False for roles that may not calibrate, and during an attachment session (no file to store on). */
  canCalibrate: boolean;
  /**
   * False hides the Measure button outright. Video and unsupported types have no stable
   * intrinsic space — a moving frame cannot be calibrated meaningfully — so the honest
   * presentation is no button at all rather than a permanently disabled one.
   */
  measureAvailable: boolean;
```

Add `MeasureTool` to the existing `useAnnotationObjects` import line, so it reads
`import type { AnnotationObjectType, MeasureTool, ToolType } from './useAnnotationObjects';`, then
add two more imports at the top:

```ts
import { LENGTH_UNITS, type LengthUnit } from '@/lib/measure/units';
import type { ScaleSource } from '@/lib/measure/calibration';
```

- [ ] **Step 2: Add the icons and the sub-tool table**

After the `EraserIcon` definition:

```tsx
const MeasureIcon = (
  <svg {...px(19)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 15.5 15.5 2.5a1.4 1.4 0 0 1 2 0l4 4a1.4 1.4 0 0 1 0 2l-13 13a1.4 1.4 0 0 1-2 0l-4-4a1.4 1.4 0 0 1 0-2Z" />
    <path d="M7 11l2 2M10.5 7.5l2 2M14 4l2 2" />
  </svg>
);

const LinearIcon = (
  <svg {...ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <line x1="2" y1="8" x2="14" y2="8" />
    <polyline points="4.5,5.5 2,8 4.5,10.5" />
    <polyline points="11.5,5.5 14,8 11.5,10.5" />
  </svg>
);

const AngleIcon = (
  <svg {...ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3,13 13,13 3,4 3,13" />
    <path d="M7 13a4.5 4.5 0 0 0-1.4-3.2" />
  </svg>
);

const CalibrateIcon = (
  <svg {...ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <line x1="2" y1="11" x2="14" y2="11" />
    <path d="M2 8.5v2.5M6 9.5v1.5M10 9.5v1.5M14 8.5v2.5" />
    <path d="M9.5 5.5 12 3l1.5 1.5L11 7Z" />
  </svg>
);

const MEASURE_SUB_TOOLS: { id: MeasureTool; label: string; icon: React.ReactNode }[] = [
  { id: 'measure', label: 'Linear', icon: LinearIcon },
  { id: 'angle', label: 'Angle', icon: AngleIcon },
  { id: 'calibrate', label: 'Calibrate', icon: CalibrateIcon },
];
```

- [ ] **Step 3: Let `ToolButton` render a disabled slot**

Add a `disabled` prop to `ToolButton` and honour it, so a gated tool reads as unavailable rather
than silently doing nothing:

```tsx
function ToolButton({
  label, active, onClick, hideLabel, expanded, disabled, children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  hideLabel?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative flex">
      <button
        aria-label={label}
        aria-pressed={expanded === undefined ? active : undefined}
        aria-expanded={expanded}
        disabled={disabled}
        onClick={onClick}
        className={`${slot(active)} ${disabled ? 'cursor-not-allowed opacity-40 hover:scale-100 hover:shadow-none' : ''}`}
      >
        {children}
      </button>
      {!hideLabel && <span className={LABEL}>{label}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Widen the menu state and render the sub-bar**

Change the menu state to include the two new panels:

```tsx
  const [menu, setMenu] = useState<'shapes' | 'stroke' | 'picker' | 'measure' | 'units' | null>(null);
```

Add, immediately after the Shapes block and before the Stroke width block:

```tsx
        {/* Measure — linear, angular, calibrate and the unit the readings are in */}
        {measureAvailable && (
        <div className="relative flex">
          <ToolButton
            label="Measure"
            active={MEASURE_SUB_TOOLS.some((t) => t.id === activeTool) || menu === 'measure'}
            expanded={menu === 'measure'}
            hideLabel={menu !== null}
            onClick={() => setMenu(menu === 'measure' ? null : 'measure')}
          >
            {MeasureIcon}
          </ToolButton>
          {menu === 'measure' && (
            <div className={SUB_BAR}>
              <div className={BAR}>
                {MEASURE_SUB_TOOLS.map((t) => {
                  // Linear needs a scale; without one a "length" is a pixel count. Angular never
                  // does — angles are scale-invariant. Calibrate is gated by role instead.
                  const disabled =
                    (t.id === 'measure' && scaleSource === 'unknown') ||
                    (t.id === 'calibrate' && !canCalibrate);
                  const label =
                    t.id === 'measure' && scaleSource === 'unknown'
                      ? 'Calibrate this file first'
                      : t.id === 'calibrate' && !canCalibrate
                        ? 'You cannot calibrate this file'
                        : t.label;
                  return (
                    <ToolButton
                      key={t.id}
                      label={label}
                      active={activeTool === t.id}
                      disabled={disabled}
                      onClick={() => onToolChange(activeTool === t.id ? 'pointer' : t.id)}
                    >
                      {t.icon}
                    </ToolButton>
                  );
                })}

                <div className="w-px h-[24px] bg-stiko-divider mx-[6px]" />

                {/* Units — a chip showing the current unit, not a ToolButton: it opens a list
                    rather than arming a mode. Anchored right-edge to trigger, like the colour
                    picker, so it cannot clip in a narrow viewer pane. */}
                <div className="relative flex">
                  <button
                    aria-label="Measurement units"
                    aria-expanded={menu === 'units'}
                    onClick={() => setMenu(menu === 'units' ? 'measure' : 'units')}
                    className={`${slot(menu === 'units')} w-[44px] text-[11px] font-semibold tracking-heading`}
                  >
                    {measureUnit}
                  </button>
                  {menu === 'units' && (
                    <div className="absolute top-full mt-[13px] right-0 z-50 rounded-sheet bg-white border border-stiko-border shadow-stiko-panel py-[4px]">
                      {LENGTH_UNITS.map((u) => (
                        <button
                          key={u}
                          onClick={() => { onMeasureUnitChange(u); setMenu('measure'); }}
                          aria-pressed={u === measureUnit}
                          className={`block w-[72px] px-[12px] py-[6px] text-left text-[12px] ${
                            u === measureUnit ? 'text-stiko-primary font-semibold' : 'text-stiko-secondary'
                          } hover:bg-stiko-tint`}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        )}
```

- [ ] **Step 5: Keep the units panel from closing the measure sub-bar**

The existing click-outside effect closes `menu` when a click lands outside `rootRef`. The units
panel renders inside that root, so nothing changes — but verify by opening Measure, opening Units,
and clicking a unit: the measure sub-bar must stay open. No code change expected; if it closes,
the units button's `onClick` is setting `null` instead of `'measure'`.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only at the `DrawingTools` call site in `app/portal/[id]/page.tsx` (the five new required props), fixed in Task 12.

- [ ] **Step 7: Commit**

```bash
git add components/markup/DrawingTools.tsx
git commit -m "feat: measure button, sub-bar and units chip in the markup toolbar"
```

---
## Task 12: Portal page wiring

**Files:**
- Modify: `app/portal/[id]/page.tsx`
- Modify: `components/viewers/PDFKonvaViewer.tsx` (report page changes upward)
- Modify: `components/viewers/ViewerContainer.tsx` (pass the new callback through)

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 4, 10, 11.
- Produces: `measureScale`, `measureUnit`, `handleMeasureUnitChange`, `handleCalibrationCommit`,
  `pdfPage`, and a live `useMeasurements()` store, all passed down to the toolbar and the surfaces.
- Also produces `PDFKonvaViewerProps.onPageChange?: (page: number) => void`.

- [ ] **Step 1: Report PDF page changes upward**

`app/portal/[id]/page.tsx` needs the current PDF page reactively — the toolbar's disabled state and
the calibration lookup both depend on it, and `getCurrentPage()` on the imperative handle is a pull,
not a subscription.

In `components/viewers/PDFKonvaViewer.tsx` add the prop:

```ts
  /** Fires whenever the visible page changes, so callers can resolve per-page calibration. */
  onPageChange?: (page: number) => void;
```

and call it from the effect that already sets the page state, plus once when the document first
renders. Thread it through `ViewerContainer` unchanged.

- [ ] **Step 2: Add the three new pieces of page state**

`canComment` is not currently tracked on this page — only `canUpload` and `canTransform` are
(`app/portal/[id]/page.tsx:183-184`). Add it beside them:

```tsx
  const [canComment, setCanComment] = useState(false);
  const [pdfPage, setPdfPage] = useState(UNPAGED);
  const [measureError, setMeasureError] = useState<string | null>(null);
```

and set it in the access fetch alongside the other two (around lines 796-801), in **both** the
success and the failure branch:

```tsx
        setCanComment(Boolean(info?.access?.canComment));
```
```tsx
        setCanComment(false);
```

- [ ] **Step 3: Instantiate the measurement store**

Beside the other hooks:

```tsx
  const measure = useMeasurements();
```

Imports to add at the top of the file:

```tsx
import { DEFAULT_LENGTH_UNIT, type LengthUnit } from '@/lib/measure/units';
import { resolveScale, UNPAGED, mmPerUnitFrom } from '@/lib/measure/calibration';
import { isMeasureTool, type MeasureTool } from '@/components/markup/useAnnotationObjects';
import { useMeasurements } from '@/components/markup/useMeasurements';
import CalibrationPanel from '@/components/markup/CalibrationPanel';
```

- [ ] **Step 4: Resolve the file's scale and unit**

Add beside the existing `is3DFile` / `isPDFFile` memos:

```tsx
  const measureUnit: LengthUnit = selectedFile?.measureUnit ?? DEFAULT_LENGTH_UNIT;

  const isVideoFile = useMemo(() => {
    if (!selectedFile) return false;
    const ext = selectedFile.filename.split('.').pop()?.toLowerCase() ?? '';
    return ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext);
  }, [selectedFile]);

  // filename is the ORIGINAL upload's, never the converted GLB. A STEP file is on screen as a
  // GLB, and reading the extension off the loaded file would apply the glTF metre convention
  // and report every STEP model 1000x too large.
  const measureScale = useMemo(
    () =>
      selectedFile
        ? resolveScale({
            filename: selectedFile.filename,
            calibrations: selectedFile.calibrations,
            page: isPDFFile ? pdfPage : UNPAGED,
          })
        : { mmPerUnit: null, source: 'unknown' as const },
    [selectedFile, isPDFFile, pdfPage]
  );
```

- [ ] **Step 5: Start a session for measure tools on every surface except 3D**

Replace the draw-tool session-starter effect:

```tsx
  // Start an annotation session when a draw tool is picked (only session-starter).
  //
  // Measure tools join this for 2D files but NOT for 3D: startAnnotationSession freezes the
  // viewport into a snapshot, and a frozen 3D model cannot be orbited, which is most of the
  // point of measuring one. For PDFs the call sets `annotating` without freezing anything,
  // which is exactly what that surface wants — it disables stage panning so a drag reads as a
  // gesture rather than a pan.
  useEffect(() => {
    const needsSurface = DRAW_TOOLS.includes(activeTool) || (isMeasureTool(activeTool) && !is3DFile);
    if (!needsSurface) return;
    startAnnotationSession();
  }, [activeTool, is3DFile, startAnnotationSession]);
```

- [ ] **Step 6: Extend the mutual-exclusion effects**

In the two effects that currently test `DRAW_TOOLS.includes(activeTool)`, test the measure tools too:

```tsx
  // Tag placement, drawing and measuring are mutually exclusive — disarm tagging when a draw or
  // measure tool is selected.
  useEffect(() => {
    if (DRAW_TOOLS.includes(activeTool) || isMeasureTool(activeTool)) setTagging(false);
  }, [activeTool]);
```

and

```tsx
    if (tagging || DRAW_TOOLS.includes(activeTool) || isMeasureTool(activeTool)) {
      setTransformMode(null);
      setSelectedPlane(null);
    }
  }, [tagging, activeTool]);
```

- [ ] **Step 7: Drive the gesture lifecycle**

```tsx
  // Arming a measure tool begins a gesture; disarming abandons whatever was half-placed.
  // 'calibrate' collects the same two points a linear does — only what happens on commit differs.
  useEffect(() => {
    if (!isMeasureTool(activeTool)) { measure.cancel(); return; }
    measure.begin(activeTool === 'angle' ? 'angular' : 'linear', isPDFFile ? pdfPage : UNPAGED);
  }, [activeTool, isPDFFile, pdfPage, measure.begin, measure.cancel]);

  // Escape abandons a pending gesture; Delete removes a selected measurement. One handler for all
  // three surfaces, because the store lives here and the 3D viewer has no keyboard surface of
  // its own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'Escape' && isMeasureTool(activeTool)) {
        measure.begin(activeTool === 'angle' ? 'angular' : 'linear', isPDFFile ? pdfPage : UNPAGED);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && measure.selectedId) {
        e.preventDefault();
        measure.remove(measure.selectedId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool, isPDFFile, pdfPage, measure.selectedId, measure.remove, measure.begin]);

  // Turning a page mid-gesture must not let the second click land on a different sheet.
  useEffect(() => {
    measure.cancel();
  }, [pdfPage, measure.cancel]);
```

In the existing file-switch effect (the one that already clears `viewerSnapshot` and `annotating`),
add `measure.clear();`.

- [ ] **Step 8: Save the unit and the calibration**

```tsx
  const handleMeasureUnitChange = useCallback(
    async (unit: LengthUnit) => {
      if (!selectedFileId) return;
      // Optimistic: readings relabel immediately. A failed write resyncs from the server rather
      // than leaving the toolbar showing a unit the server never accepted.
      setFiles((prev) => prev.map((f) => (f.id === selectedFileId ? { ...f, measureUnit: unit } : f)));
      const res = await fetch(`/api/files/${selectedFileId}/measure`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit }),
      });
      if (!res.ok && selectedVersionId) fetchFiles(selectedVersionId);
    },
    [selectedFileId, selectedVersionId, fetchFiles]
  );

  /**
   * Commit a calibration from the two points the gesture collected plus the distance the user
   * typed. `intrinsicDistance` is supplied by the surface, already converted out of stage space
   * into the file's own intrinsic unit — stage pixels are never stored.
   */
  const handleCalibrationCommit = useCallback(
    async (intrinsicDistance: number, realDistance: number, entryUnit: LengthUnit) => {
      if (!selectedFileId) return;
      const page = isPDFFile ? pdfPage : UNPAGED;

      let mmPerUnit: number;
      try {
        mmPerUnit = mmPerUnitFrom(intrinsicDistance, realDistance, entryUnit);
      } catch {
        setMeasureError('Enter a distance greater than zero.');
        return;
      }

      const res = await fetch(`/api/files/${selectedFileId}/measure`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calibration: { page, mmPerUnit } }),
      });

      if (res.ok) {
        setMeasureError(null);
        setFiles((prev) =>
          prev.map((f) =>
            f.id === selectedFileId
              ? { ...f, calibrations: { ...(f.calibrations ?? {}), [page]: mmPerUnit } }
              : f
          )
        );
        setActiveTool('pointer');
        return;
      }

      const body = await res.json().catch(() => ({}));
      // A 404 from this route on an app that is otherwise working means the table is missing —
      // this repo applies migrations by hand and has forgotten one twice. Say so, rather than
      // accepting a calibration that silently vanishes.
      setMeasureError(
        body?.error ??
          (res.status === 500
            ? "Measurement isn't available yet on this deployment."
            : 'Could not save the calibration.')
      );
    },
    [selectedFileId, isPDFFile, pdfPage]
  );
```

- [ ] **Step 9: Render the calibration panel**

Beside the toolbar, shown once the calibrate gesture has both its points:

```tsx
        {activeTool === 'calibrate' && measure.pending?.points.length === 2 && (
          <CalibrationPanel
            unit={measureUnit}
            error={measureError}
            onCommit={(realDistance, entryUnit) =>
              handleCalibrationCommit(calibrationIntrinsicDistance, realDistance, entryUnit)
            }
            onCancel={() => { setMeasureError(null); setActiveTool('pointer'); }}
          />
        )}
```

`calibrationIntrinsicDistance` is the span of `measure.pending.points` converted into the file's
intrinsic unit — `distance(p0, p1) * intrinsicPerStagePixel` on the 2D surfaces (Tasks 14 and 15
define that factor) and `distance(p0, p1)` unchanged in 3D, where the picked points are already in
world units.

- [ ] **Step 10: Pass the new props to `DrawingTools`**

```tsx
                measureUnit={measureUnit}
                onMeasureUnitChange={handleMeasureUnitChange}
                scaleSource={measureScale.source}
                canCalibrate={canComment && annotatingFile === null}
                measureAvailable={!isVideoFile}
```

`annotatingFile === null` is load-bearing: during an attachment session the surface is a pasted
screenshot with no file id, so there is nowhere to store a calibration and nothing to resolve a
scale against.

- [ ] **Step 11: Remove the now-unneeded cast**

At `app/portal/[id]/page.tsx:1684`, change `activeTool={activeTool as AnnTool}` to
`activeTool={activeTool}` once Task 15 has widened `AnnotationCanvas`'s prop to `ToolType`. If
Task 15 has not run yet, leave the cast and return here afterwards.

- [ ] **Step 12: Typecheck and smoke-test**

Run: `npx tsc --noEmit`
Expected: no errors (with Tasks 13-15 pending, the surfaces simply ignore the measure props).

With `npm run dev`, open a package and confirm:
- On an image or PDF, the Measure sub-bar shows Linear disabled with "Calibrate this file first".
- On a STEP file, Linear is enabled.
- On a video, the Measure button is absent entirely.
- The units chip opens, and a chosen unit survives a page reload.

- [ ] **Step 13: Commit**

```bash
git add "app/portal/[id]/page.tsx" components/viewers/PDFKonvaViewer.tsx components/viewers/ViewerContainer.tsx
git commit -m "feat: wire measure tool state, scale resolution and calibration saving"
```

---

## Task 13: 3D measurement surface

**Files:**
- Create: `components/viewers/MeasureLayer.tsx`
- Modify: `components/viewers/ModelViewerInner.tsx` (the `SceneInteraction` pick handler, and the scene body)
- Modify: `components/viewers/ModelViewer.tsx`, `components/viewers/ViewerContainer.tsx` (prop pass-through)

**Interfaces:**
- Consumes: `Measurement` (Task 10), `formatLength`, `formatAngle` (Task 1), `distance`, `angleAt` (Task 2).
- Produces: `MeasureLayer` props `{ measurements, pending, mmPerUnit, unit, selectedId, onSelect, clippingPlanes, radius }`.

- [ ] **Step 1: Write the layer**

Create `components/viewers/MeasureLayer.tsx`:

```tsx
'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { distance, angleAt } from '@/lib/measure/geometry';
import { formatLength, formatAngle, type LengthUnit } from '@/lib/measure/units';
import type { Measurement } from '@/components/markup/useMeasurements';
import type { PendingGesture } from '@/lib/measure/gesture';

/**
 * Measurements drawn INSIDE the WebGL scene rather than as a DOM overlay.
 *
 * That is not a style choice. captureViewerSnapshot reads only the WebGL canvas, so a drei <Html>
 * label would be missing from every snapshot a user posts — and since measurements are ephemeral,
 * the snapshot is the only way to keep one. A sprite with a canvas texture is captured for free.
 *
 * For the same reason this group is deliberately NOT marked userData.excludeFromSnapshot, unlike
 * the transform handles: renderCleanFrame must keep measurements and drop only viewer chrome.
 */

const LINE_COLOR = '#1C2030';
const ARC_SEGMENTS = 32;

/** Label sprites are sized against the camera each frame so text stays legible at any zoom. */
const LABEL_WORLD_HEIGHT_FRACTION = 0.035;

function makeLabelTexture(text: string): THREE.CanvasTexture {
  const padding = 12;
  const fontSize = 40;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  const width = Math.ceil(ctx.measureText(text).width) + padding * 2;
  const height = fontSize + padding * 2;
  canvas.width = width;
  canvas.height = height;

  const c = canvas.getContext('2d')!;
  c.fillStyle = 'rgba(255,255,255,0.94)';
  c.beginPath();
  c.roundRect(0, 0, width, height, 14);
  c.fill();
  c.strokeStyle = 'rgba(28,32,48,0.18)';
  c.lineWidth = 2;
  c.stroke();
  c.font = `600 ${fontSize}px system-ui, sans-serif`;
  c.fillStyle = LINE_COLOR;
  c.textBaseline = 'middle';
  c.fillText(text, padding, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function midpoint(a: number[], b: number[]): THREE.Vector3 {
  return new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

/** The arc between the two legs of an angle, drawn at a fraction of the shorter leg. */
function arcPoints(vertex: number[], a: number[], b: number[]): THREE.Vector3[] {
  const v = new THREE.Vector3(...vertex);
  const va = new THREE.Vector3(...a).sub(v);
  const vb = new THREE.Vector3(...b).sub(v);
  const radius = Math.min(va.length(), vb.length()) * 0.28;
  va.normalize();
  vb.normalize();
  const total = va.angleTo(vb);
  const axis = new THREE.Vector3().crossVectors(va, vb).normalize();
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const step = va.clone().applyAxisAngle(axis, (total * i) / ARC_SEGMENTS);
    points.push(step.multiplyScalar(radius).add(v));
  }
  return points;
}

type LabelEntry = {
  measurement: Measurement;
  texture: THREE.CanvasTexture;
  anchor: THREE.Vector3;
  /** Assigned by the sprite's ref callback; read each frame to rescale against the camera. */
  sprite?: THREE.Sprite;
};

interface MeasureLayerProps {
  measurements: Measurement[];
  pending: PendingGesture | null;
  /** Null when the file has no usable scale; linear measurement is disabled upstream in that case. */
  mmPerUnit: number | null;
  unit: LengthUnit;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** The active cross-section planes, so a measurement clips with the model it belongs to. */
  clippingPlanes: THREE.Plane[];
}

export default function MeasureLayer({
  measurements, pending, mmPerUnit, unit, selectedId, onSelect, clippingPlanes,
}: MeasureLayerProps) {
  const labelFor = (m: Measurement): string => {
    if (m.kind === 'angular') return formatAngle(angleAt(m.points[1], m.points[0], m.points[2]));
    if (mmPerUnit === null) return '';
    return formatLength(distance(m.points[0], m.points[1]) * mmPerUnit, unit);
  };

  const entries = useMemo<LabelEntry[]>(
    () =>
      measurements.map((m) => ({
        measurement: m,
        texture: makeLabelTexture(labelFor(m)),
        anchor:
          m.kind === 'angular'
            ? new THREE.Vector3(...m.points[1])
            : midpoint(m.points[0], m.points[1]),
      })),
    // Rebuilt when the unit or scale changes: the label text is baked into the texture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [measurements, mmPerUnit, unit]
  );

  // Sprites are scaled against camera distance every frame so a label neither shrinks to nothing
  // on a large model nor swallows a small one.
  useFrame(({ camera: cam }) => {
    for (const entry of entries) {
      const sprite = entry.sprite;
      if (!sprite) continue;
      const dist = cam.position.distanceTo(entry.anchor);
      const height = dist * LABEL_WORLD_HEIGHT_FRACTION;
      const aspect = entry.texture.image.width / entry.texture.image.height;
      sprite.scale.set(height * aspect, height, 1);
    }
  });

  const material = (
    <lineBasicMaterial color={LINE_COLOR} clippingPlanes={clippingPlanes} depthTest={false} />
  );

  return (
    <group renderOrder={999}>
      {entries.map((entry) => {
        const m = entry.measurement;
        const selected = m.id === selectedId;
        const legs =
          m.kind === 'linear'
            ? [m.points[0], m.points[1]]
            : [m.points[0], m.points[1], m.points[2]];
        return (
          <group key={m.id} onClick={(e) => { e.stopPropagation(); onSelect(m.id); }}>
            <line>
              <bufferGeometry
                attach="geometry"
                onUpdate={(g) => g.setFromPoints(legs.map((p) => new THREE.Vector3(...p)))}
              />
              <lineBasicMaterial
                color={selected ? '#5B60FF' : LINE_COLOR}
                clippingPlanes={clippingPlanes}
                depthTest={false}
                linewidth={1}
              />
            </line>
            {m.kind === 'angular' && (
              <line>
                <bufferGeometry
                  attach="geometry"
                  onUpdate={(g) => g.setFromPoints(arcPoints(m.points[1], m.points[0], m.points[2]))}
                />
                {material}
              </line>
            )}
            <sprite ref={(s) => { entry.sprite = s ?? undefined; }} position={entry.anchor}>
              <spriteMaterial map={entry.texture} depthTest={false} transparent />
            </sprite>
          </group>
        );
      })}

      {pending && pending.points.length > 0 && (
        <line>
          <bufferGeometry
            attach="geometry"
            onUpdate={(g) => g.setFromPoints(pending.points.map((p) => new THREE.Vector3(...p)))}
          />
          <lineDashedMaterial color={LINE_COLOR} dashSize={0.5} gapSize={0.3} depthTest={false} />
        </line>
      )}
    </group>
  );
}
```

- [ ] **Step 2: Dispatch picking on the armed tool**

In `ModelViewerInner.tsx`'s `SceneInteraction`, the existing `handlePointerDown` runs the pin
raycast when `commentToolActive`. Generalise it: accept a new prop `measureActive` and a callback

```ts
  onMeasurePoint?: (point: number[], minSeparation: number) => void;
```

the same signature all three surfaces use, so the store never has to know which one called it. In
the same handler — after the existing clipping-plane guard that selects `hit` — branch:

```ts
        if (measureActive && onMeasurePoint) {
          // local[] is already the MODEL's own frame, the same frame comment pins are stored in,
          // so a measurement travels with a moved or rotated object instead of floating where it
          // was placed.
          //
          // minSeparation is scene-scaled and computed HERE rather than by the caller: geometry
          // in this repo arrives with no unit convention and bounding radii span 1 to 10,000
          // (see lib/sceneScale.ts), so a fixed floor would reject every click on a small model
          // and accept every misclick on a large one. `radius` is the model's bounding radius,
          // already available in this component for the scene furniture.
          onMeasurePoint(
            nearestVertexSnap(hit, camera, gl) ?? [local[0], local[1], local[2]],
            radius * 1e-4,
          );
          return;
        }
```

Add `nearestVertexSnap` beside the handler:

```ts
/** Snap radius in screen pixels. Beyond this the free surface point is the honest answer. */
const VERTEX_SNAP_PX = 12;

/**
 * The nearest vertex of the hit triangle, in the model's own frame, when one is within
 * VERTEX_SNAP_PX of the cursor on screen. Null otherwise.
 *
 * Reads face indices straight off the intersection rather than precomputing anything: the model
 * is drawn as merged BatchedMesh batches, so there is no per-part vertex structure to consult.
 */
function nearestVertexSnap(
  hit: THREE.Intersection,
  camera: THREE.Camera,
  gl: THREE.WebGLRenderer,
): [number, number, number] | null {
  const face = hit.face;
  const mesh = hit.object as THREE.Mesh;
  const position = mesh.geometry?.getAttribute('position');
  if (!face || !position) return null;

  const size = new THREE.Vector2();
  gl.getSize(size);
  const cursor = hit.point.clone().project(camera);

  let best: { point: THREE.Vector3; px: number } | null = null;
  for (const index of [face.a, face.b, face.c]) {
    const local = new THREE.Vector3().fromBufferAttribute(position, index);
    const world = local.clone().applyMatrix4(mesh.matrixWorld);
    const projected = world.clone().project(camera);
    const px = Math.hypot(
      ((projected.x - cursor.x) * size.x) / 2,
      ((projected.y - cursor.y) * size.y) / 2,
    );
    if (!best || px < best.px) best = { point: world, px };
  }

  if (!best || best.px > VERTEX_SNAP_PX) return null;
  const local = best.point.clone();
  hit.object.parent?.worldToLocal(local);
  return [local.x, local.y, local.z];
}
```

**If Task 6 recorded that `hit.face` is unavailable on BatchedMesh hits**, delete
`nearestVertexSnap` and call `onMeasurePoint([local[0], local[1], local[2]])` directly.

- [ ] **Step 3: Render the layer and thread the props**

In `ModelViewerInner`'s scene body, render `<MeasureLayer ... />` inside the same group the model
is in, so measurements share the model's transform. Add `measurements`, `pendingMeasurement`,
`measureActive`, `onMeasurePoint`, `mmPerUnit`, `measureUnit`, `selectedMeasurementId` and
`onSelectMeasurement` to `ModelViewerInnerProps`, then pass them through `ModelViewer.tsx` and
`ViewerContainer.tsx` unchanged.

- [ ] **Step 4: Wire it in the portal page**

Task 12 already created the `measure` store and drives the gesture lifecycle, so this step only
connects the 3D viewer to it. Pass down through `ViewerContainer` and `ModelViewer`:

```tsx
                measureActive={isMeasureTool(activeTool)}
                onMeasurePoint={(point, minSeparation) => measure.addPoint(point, minSeparation)}
                measurements={measure.measurements}
                pendingMeasurement={measure.pending}
                mmPerUnit={measureScale.mmPerUnit}
                measureUnit={measureUnit}
                selectedMeasurementId={measure.selectedId}
                onSelectMeasurement={measure.setSelectedId}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Verify in the browser**

With `npm run dev` and a STEP or GLB file open:
1. Arm Linear, click two corners. A dimension appears with a plausible number.
2. Orbit. The measurement stays welded to the geometry.
3. Arm Angle, click three points. An arc and a degree reading appear.
4. Click a measurement, press Delete. It disappears.
5. Move the object with the transform gizmo. The measurement travels with it.
6. Add a cross-section plane through the measurement. The line clips with the model.

- [ ] **Step 7: Commit**

```bash
git add components/viewers/MeasureLayer.tsx components/viewers/ModelViewerInner.tsx components/viewers/ModelViewer.tsx components/viewers/ViewerContainer.tsx "app/portal/[id]/page.tsx"
git commit -m "feat: measure linear and angular distances in the 3D viewer"
```

---

## Task 14: 2D measurement rendering and the PDF surface

**Files:**
- Create: `components/markup/MeasureObjects.tsx`
- Create: `components/markup/CalibrationPanel.tsx`
- Modify: `components/viewers/PDFKonvaViewer.tsx`

**Interfaces:**
- Consumes: `Measurement` (Task 10), `PendingGesture` (Task 4), formatting (Task 1), `pointsPerStagePixel`, `PDF_RENDER_SCALE` (Task 5).
- Produces:
  - `MeasureObjects` props `{ measurements, pending, mmPerIntrinsicUnit, intrinsicPerStagePixel, unit, selectedId, onSelect }`
  - `CalibrationPanel` props `{ unit, onCommit(realDistance: number, unit: LengthUnit): void, onCancel(): void }`

- [ ] **Step 1: Write the shared Konva renderer**

Create `components/markup/MeasureObjects.tsx`:

```tsx
'use client';

import { Line, Text, Circle, Group } from 'react-konva';
import { distance, angleAt } from '@/lib/measure/geometry';
import { formatLength, formatAngle, type LengthUnit } from '@/lib/measure/units';
import type { Measurement } from './useMeasurements';
import type { PendingGesture } from '@/lib/measure/gesture';

/**
 * Measurements on a Konva surface, shared by the PDF viewer and the image annotation canvas.
 *
 * Points arrive in STAGE coordinates and are rendered in stage coordinates; only the LENGTH is
 * converted. Two uniform scales stand between a stage pixel and a millimetre —
 * `intrinsicPerStagePixel` (stage px to the file's own unit) and `mmPerIntrinsicUnit` (that unit
 * to millimetres) — and separating them is what keeps calibration storable in file-intrinsic
 * units while the drawing stays in whatever space the surface happens to use.
 *
 * Deliberately NOT part of the annotation object model: measurements carry no colour and no
 * stroke width, so they must never reach the markup style picker, and the eraser must not sweep
 * them away mid-review.
 */

const STROKE = '#1C2030';
const SELECTED = '#5B60FF';

interface MeasureObjectsProps {
  measurements: Measurement[];
  pending: PendingGesture | null;
  /** Null when uncalibrated: angular still renders, linear shows no number. */
  mmPerIntrinsicUnit: number | null;
  intrinsicPerStagePixel: number;
  unit: LengthUnit;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Only measurements on this page render. Pass 0 for surfaces without pages. */
  page: number;
}

export default function MeasureObjects({
  measurements, pending, mmPerIntrinsicUnit, intrinsicPerStagePixel, unit, selectedId, onSelect, page,
}: MeasureObjectsProps) {
  const labelFor = (m: Measurement): string => {
    if (m.kind === 'angular') return formatAngle(angleAt(m.points[1], m.points[0], m.points[2]));
    if (mmPerIntrinsicUnit === null) return '';
    const stagePx = distance(m.points[0], m.points[1]);
    return formatLength(stagePx * intrinsicPerStagePixel * mmPerIntrinsicUnit, unit);
  };

  return (
    <>
      {measurements
        .filter((m) => m.page === page)
        .map((m) => {
          const selected = m.id === selectedId;
          const flat = m.points.flat();
          const anchor = m.kind === 'angular'
            ? m.points[1]
            : [(m.points[0][0] + m.points[1][0]) / 2, (m.points[0][1] + m.points[1][1]) / 2];
          return (
            <Group key={m.id} id={m.id} onClick={() => onSelect(m.id)} onTap={() => onSelect(m.id)}>
              <Line points={flat} stroke={selected ? SELECTED : STROKE} strokeWidth={selected ? 3 : 2} lineCap="round" />
              {m.points.map((p, i) => (
                <Circle key={i} x={p[0]} y={p[1]} radius={3.5} fill={selected ? SELECTED : STROKE} />
              ))}
              <Text
                x={anchor[0] + 8}
                y={anchor[1] - 20}
                text={labelFor(m)}
                fontSize={14}
                fontStyle="600"
                fill={STROKE}
                // A white plate behind the number, so a dimension stays readable over dark
                // drawing content instead of disappearing into it.
                shadowColor="#FFFFFF"
                shadowBlur={6}
                shadowOpacity={1}
              />
            </Group>
          );
        })}

      {pending && pending.points.length > 0 && (
        <Line points={pending.points.flat()} stroke={STROKE} strokeWidth={1.5} dash={[6, 4]} />
      )}
    </>
  );
}
```

- [ ] **Step 2: Write the calibration panel**

Create `components/markup/CalibrationPanel.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { LENGTH_UNITS, type LengthUnit } from '@/lib/measure/units';
import { BAR } from './toolbarStyles';

/**
 * "This distance is [ 2400 ] [ mm ]" — shown after the two calibration clicks land.
 *
 * Its own unit selector rather than reusing the toolbar's: the number someone reads off a
 * drawing is in whatever unit the drawing is dimensioned in, which has nothing to do with the
 * unit they want to READ measurements in afterwards.
 */
export default function CalibrationPanel({
  unit, error, onCommit, onCancel,
}: {
  unit: LengthUnit;
  /** A failed save, shown in place rather than swallowed — the panel is the only thing on screen. */
  error: string | null;
  onCommit: (realDistance: number, unit: LengthUnit) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const [entryUnit, setEntryUnit] = useState<LengthUnit>(unit);

  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed > 0;

  return (
    <div className="absolute left-1/2 top-[76px] z-40 -translate-x-1/2">
      <div className={`${BAR} gap-[8px] px-[12px]`}>
        <span className="text-[12px] text-stiko-secondary">This distance is</span>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid) onCommit(parsed, entryUnit);
            if (e.key === 'Escape') onCancel();
          }}
          inputMode="decimal"
          aria-label="Real distance"
          className="h-[30px] w-[88px] rounded-[9px] border border-stiko-divider px-[8px] text-[13px]"
        />
        <select
          value={entryUnit}
          onChange={(e) => setEntryUnit(e.target.value as LengthUnit)}
          aria-label="Unit of the real distance"
          className="h-[30px] rounded-[9px] border border-stiko-divider px-[6px] text-[12px]"
        >
          {LENGTH_UNITS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <button
          disabled={!valid}
          onClick={() => onCommit(parsed, entryUnit)}
          className="h-[30px] rounded-[9px] bg-stiko-primary px-[12px] text-[12px] font-semibold text-white disabled:opacity-40"
        >
          Set
        </button>
        <button onClick={onCancel} className="h-[30px] px-[8px] text-[12px] text-stiko-secondary">
          Cancel
        </button>
        {error && <span className="text-[11px] text-red-500">{error}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Use the shared render-scale constant in the PDF viewer**

In `components/viewers/PDFKonvaViewer.tsx`, replace the literal at line 231:

```ts
const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
```

with the import `import { PDF_RENDER_SCALE, pointsPerStagePixel } from '@/lib/measure/space';`.
This is what keeps a PDF calibration from being exactly `PDF_RENDER_SCALE` times wrong.

- [ ] **Step 4: Handle measure gestures on the PDF stage**

In `handleStageMouseDown`, before the existing `if (!annotating) return;` pan branch, add:

```ts
      if (isMeasureTool(activeTool)) {
        const p = getPageCoords(stage);
        // 3 page pixels, the same floor the drawing tools use for a valid gesture. The signature
        // matches the 3D surface's so the store never learns which surface called it; the page a
        // measurement belongs to comes from the gesture, not from here.
        if (p) onMeasurePoint?.([p.x, p.y], 3);
        return;
      }
```

Add props `measurements`, `pendingMeasurement`, `onMeasurePoint`, `mmPerIntrinsicUnit`,
`measureUnit`, `selectedMeasurementId`, `onSelectMeasurement`, and render inside the annotation
layer, after `<AnnotationObjects .../>`:

```tsx
            <MeasureObjects
              measurements={measurements}
              pending={pendingMeasurement}
              mmPerIntrinsicUnit={mmPerIntrinsicUnit}
              intrinsicPerStagePixel={pointsPerStagePixel()}
              unit={measureUnit}
              selectedId={selectedMeasurementId}
              onSelect={onSelectMeasurement}
              page={pageNumber}
            />
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Verify in the browser**

Open a PDF with a known dimension printed on it:
1. Arm Calibrate, click the two ends of a dimensioned line, type the printed value, press Enter.
2. Arm Linear, measure the same line. The reading matches the printed dimension.
3. Measure a different feature and check it against its own printed dimension.
4. Change pages. Measurements from page 1 do not render on page 2, and page 2 reports itself
   uncalibrated until it is calibrated separately.
5. Post a comment with the measurement on screen. The snapshot attached to the comment contains it.

- [ ] **Step 7: Commit**

```bash
git add components/markup/MeasureObjects.tsx components/markup/CalibrationPanel.tsx components/viewers/PDFKonvaViewer.tsx
git commit -m "feat: measure and calibrate on the PDF surface"
```

---

## Task 15: Image measurement surface

**Files:**
- Modify: `app/portal/[id]/page.tsx:71-145` (`captureViewerSnapshot` return shape)
- Modify: `components/markup/AnnotationCanvas.tsx`

**Interfaces:**
- Consumes: `naturalPerStagePixel`, `ImageSnapshotSpace` (Task 5); `MeasureObjects` (Task 14).
- Produces: `captureViewerSnapshot` returns `{ dataUrl: string; imageSpace: ImageSnapshotSpace | null } | null`.

- [ ] **Step 1: Widen the snapshot capture's return**

In `app/portal/[id]/page.tsx`, change `captureViewerSnapshot` to return an object. The image branch
already computes `imgRect` and `containerRect`; report them:

```ts
interface ViewerSnapshot {
  dataUrl: string;
  /**
   * Where the source image sits inside the snapshot, and how big it really is. Non-null only
   * for the image branch — it is what lets a calibration be stored in NATURAL pixels rather
   * than in whatever zoom the viewer happened to be at when the frame was frozen.
   */
  imageSpace: ImageSnapshotSpace | null;
}
```

In the image branch, after `ctx.drawImage(...)`, return:

```ts
      try {
        return {
          dataUrl: offscreen.toDataURL('image/jpeg', 0.92),
          imageSpace: {
            imageRect: {
              x: imgRect.left - containerRect.left,
              y: imgRect.top - containerRect.top,
              width: imgRect.width,
              height: imgRect.height,
            },
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
          },
        };
      } catch (e) {
        console.error('Image capture failed:', e);
      }
```

The WebGL and video branches return `{ dataUrl, imageSpace: null }`. Update `startAnnotationSession`
and `handleAnnotateAttachment` to store both the data URL and the space (a new `viewerImageSpace`
state), and every existing consumer of `viewerSnapshot` to read `.dataUrl`.

- [ ] **Step 2: Widen `AnnotationCanvas`'s tool prop and add measure props**

Change `activeTool: AnnTool` to `activeTool: ToolType`, and add:

```ts
  measurements: Measurement[];
  pendingMeasurement: PendingGesture | null;
  onMeasurePoint: (point: number[], minSeparation: number) => void;
  /** Millimetres per natural image pixel. Null when uncalibrated. */
  mmPerIntrinsicUnit: number | null;
  /** Natural image pixels per stage pixel — from naturalPerStagePixel(bgFit, ...). */
  intrinsicPerStagePixel: number;
  measureUnit: LengthUnit;
  selectedMeasurementId: string | null;
  onSelectMeasurement: (id: string | null) => void;
```

In `handleMouseDown`, before the drawing branches:

```ts
    if (isMeasureTool(activeTool)) {
      const p = stage.getPointerPosition();
      if (p) onMeasurePoint([p.x, p.y], 3);
      return;
    }
```

Render `<MeasureObjects ... page={0} />` in the annotation layer after `<AnnotationObjects />`.

- [ ] **Step 3: Compute the stage-to-natural factor in the portal page**

`bgFit` lives inside `AnnotationCanvas`. Expose it on `AnnotationCanvasHandle`:

```ts
  /** The fitted background box, for callers converting stage distances into image pixels. */
  backgroundFit: () => { x: number; y: number; width: number; height: number } | null;
  /** The loaded background's pixel width — the snapshot's own width. */
  backgroundWidth: () => number | null;
```

Then in the portal page:

```tsx
  const intrinsicPerStagePixel = useMemo(() => {
    const fit = annotationCanvasRef.current?.backgroundFit();
    const width = annotationCanvasRef.current?.backgroundWidth();
    if (!fit || !width || !viewerImageSpace) return 1;
    return naturalPerStagePixel(fit, width, viewerImageSpace);
  }, [viewerImageSpace, viewerSnapshot]);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify in the browser**

Open an image file of something with a known dimension:
1. Arm Calibrate, click across the known feature, enter its real size.
2. Arm Linear. Measure the same feature — it reads back what you entered.
3. Reload the page. Zoom the image to a different level, arm Measure again, measure the same
   feature. **It still reads the same.** This is the whole reason the calibration is stored in
   natural pixels; if this step disagrees, `naturalPerStagePixel` is being fed the wrong rect.
4. Confirm the eraser does not delete a measurement, and that Delete on a selected one does.

- [ ] **Step 6: Commit**

```bash
git add "app/portal/[id]/page.tsx" components/markup/AnnotationCanvas.tsx
git commit -m "feat: measure and calibrate on the image surface"
```

---

## Task 16: Full verification pass

**Files:** none modified — this task is verification.

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS, including all five new measure test files.

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 3: Walk the spec's required browser checks**

1. Place a measurement in 3D, orbit, confirm it stays anchored to the geometry.
2. Start a draw session and confirm the measurement is present in the captured JPEG.
3. Calibrate a PDF and confirm the reading matches a known dimension on the sheet.
4. Calibrate an image, reload the file, confirm the calibration survived and still reads correctly
   at a different zoom.

- [ ] **Step 4: Walk the gated and degenerate cases**

1. An OBJ or STL file: Linear is disabled until calibrated; Angular works.
2. A video file: the Measure button is absent.
3. An attachment annotation session: Linear and Calibrate are disabled; Angular works.
4. Two clicks in the same spot produce nothing — no zero-length dimension appears.
5. Three collinear clicks produce nothing.
6. Escape mid-gesture leaves no partial measurement behind.
7. Switching files clears every measurement.

- [ ] **Step 5: Confirm the role gate end to end**

As a commenter-role account, calibrate an uncalibrated file — it succeeds. Attempt to recalibrate
the same file — the request is refused with the "Ask the package owner" message. As the owner,
recalibrating succeeds.

- [ ] **Step 6: Commit any fixes, then merge**

```bash
git add <exact paths touched>
git commit -m "fix: <what the verification pass found>"
```

Then follow `superpowers:finishing-a-development-branch` to integrate.

---

## Notes for the implementer

- **The 3D label must be a WebGL sprite, not a DOM element.** This is the single most likely thing
  to be "improved" into a drei `<Html>` during implementation, and it would silently break the only
  way a measurement can be kept — `captureViewerSnapshot` reads the WebGL canvas alone.
- **Never store a calibration in stage, screen or snapshot pixels.** All three change with zoom and
  viewport. Natural pixels for images, points for PDFs, loaded-GLB world units for 3D.
- **The unit assumption reads the ORIGINAL filename.** A `.step` file is on screen as a `.glb`.
- **Measurements are not annotation objects.** No colour, no stroke width, not erasable by the
  eraser, never reported through `onSelectionChange`.
