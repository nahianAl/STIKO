# Markup Toolbar Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rotation snapping, ellipse and cloud shapes, shift-constrained drawing, drag-to-erase, and an extended colour row with a custom picker to the portal markup tools.

**Architecture:** Every piece of arithmetic is extracted into a self-contained, unit-tested module under `lib/markup/`, and the React components become thin wiring over those modules. This follows the established repo pattern (`lib/markup/text.ts` + `scripts/tests/markupText.test.mjs`, `lib/crossSection.ts` + `scripts/tests/crossSection.test.mjs`). Tasks 1–6 are pure logic with TDD; tasks 7–15 wire it into components and are verified in a browser.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, Konva 10 / react-konva 18, three.js + @react-three/drei, Tailwind. Tests: `node --test` (node 25) over `.ts` sources via native type-stripping.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-28-markup-toolbar-enhancements-design.md`.
- **No `@/` alias imports in any `lib/markup/*.ts` module reached by a test.** The node test runner resolves neither the alias nor JSX. Use relative paths (`../commentColors`). Components may keep using `@/`.
- **`lib/commentColors.ts` `PALETTE` must keep exactly five entries.** It feeds `paletteForKey`, whose modulus decides every existing comment's pin and avatar colour.
- **Rotation snapping is absolute** (0/90/180/270), never incremental from the drag start.
- **Both drawing surfaces must stay in step:** `components/markup/AnnotationCanvas.tsx` and `components/viewers/PDFKonvaViewer.tsx`. `AnnotationCanvas` has an untransformed stage; `PDFKonvaViewer` has a zoomed/panned stage and converts pointer coords to page coords via `getPageCoords`. Drawing uses page coords; eraser hit-testing uses container coords.
- **Verification commands** (run from the repo root, `/Users/user/Desktop/STIKO-main`):
  - `npm test` — the node test suite.
  - `npx tsc --noEmit` — type check. Must be clean at every task boundary.
  - `npm run lint` — eslint.
- Commit after every task. Conventional-commit prefixes, matching repo history (`feat(markup):`, `fix(section):`, `perf(viewer):`).

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `lib/markup/colors.ts` | The markup colour list (five pastels + black). Nothing else. |
| `lib/markup/color.ts` | Hex ⇄ RGB ⇄ HSV conversion for the picker. Pure maths, no React. |
| `lib/markup/draft.ts` | Draft geometry for every gesture tool: start, update, shift constraints, box normalisation. |
| `lib/markup/rotationSnap.ts` | The snap angle set, Konva tolerance, and Euler right-angle rounding. |
| `lib/markup/cloud.ts` | Scallop arc geometry for the revision cloud. |
| `lib/markup/eraseSweep.ts` | Sample-point interpolation along an eraser drag. |
| `components/markup/useShiftKey.ts` | React hook reporting whether Shift is held. Used by the markup Transformer and the 3D gizmo. |
| `components/markup/ColorPickerPopover.tsx` | The custom colour picker panel. |
| `scripts/tests/markupColors.test.mjs` | Tests for `colors.ts` and `color.ts`. |
| `scripts/tests/markupDraft.test.mjs` | Tests for `draft.ts`. |
| `scripts/tests/markupRotationSnap.test.mjs` | Tests for `rotationSnap.ts`. |
| `scripts/tests/markupCloud.test.mjs` | Tests for `cloud.ts`. |
| `scripts/tests/markupEraseSweep.test.mjs` | Tests for `eraseSweep.ts`. |

**Modified:**

| Path | Change |
|---|---|
| `components/markup/useAnnotationObjects.ts` | `ellipse`/`cloud` types, one exported `ToolType`, draft geometry delegated to `lib/markup/draft.ts`, `moveDraw` takes `constrain`. |
| `components/markup/AnnotationObjects.tsx` | Render ellipse and cloud; Transformer rotation snapping. |
| `components/markup/AnnotationCanvas.tsx` | Pass `shiftKey` to `moveDraw`; drag-erase. |
| `components/viewers/PDFKonvaViewer.tsx` | Same two, plus import the shared `ToolType`. |
| `components/markup/DrawingTools.tsx` | Two shape buttons; colour row from `MARKUP_COLORS`; picker chip. |
| `components/viewers/TransformGizmo.tsx` | Shift-snap the 3D rotate gizmo. |
| `components/viewers/ViewerContainer.tsx` | Import the shared `ToolType`. |
| `app/portal/[id]/page.tsx` | Import the shared `ToolType`; add the new tools to `DRAW_TOOLS`. |

---

### Task 1: Markup colour list

**Files:**
- Create: `lib/markup/colors.ts`
- Create: `scripts/tests/markupColors.test.mjs`

**Interfaces:**
- Consumes: `PALETTE`, `Pastel` from `lib/commentColors.ts` (existing).
- Produces: `MARKUP_COLORS: Pastel[]` (6 entries), `BLACK: Pastel`, `isPresetColor(color: string): boolean`.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/markupColors.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKUP_COLORS, BLACK, isPresetColor } from '../../lib/markup/colors.ts';
import { PALETTE } from '../../lib/commentColors.ts';

test('the markup row is the five comment pastels plus black, in that order', () => {
  assert.equal(MARKUP_COLORS.length, 6);
  assert.deepEqual(MARKUP_COLORS.slice(0, 5), PALETTE);
  assert.equal(MARKUP_COLORS[5], BLACK);
});

test('the comment palette itself is untouched at five entries', () => {
  // paletteForKey takes PALETTE.length as its modulus. A sixth entry there would
  // recolour the pin and avatar of every comment ever written.
  assert.equal(PALETTE.length, 5);
  assert.ok(!PALETTE.some((p) => p.name === 'black'));
});

test('black strokes black but shows a grey chip', () => {
  assert.equal(BLACK.name, 'black');
  assert.equal(BLACK.accent, '#111111');
  assert.notEqual(BLACK.swatch.toLowerCase(), '#111111');
  assert.match(BLACK.swatch, /^#[0-9A-Fa-f]{6}$/);
});

test('isPresetColor recognises every swatch and nothing else', () => {
  for (const c of MARKUP_COLORS) assert.ok(isPresetColor(c.accent), `${c.name} not recognised`);
  assert.ok(isPresetColor('#111111'.toUpperCase()), 'case must not matter');
  assert.ok(!isPresetColor('#123456'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module .../lib/markup/colors.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/markup/colors.ts`:

```typescript
// lib/markup/colors.ts
// The colours the markup toolbar offers.
//
// Deliberately NOT the same list as the comment palette. PALETTE also drives comment pins
// and avatars through paletteForKey, whose modulus is PALETTE.length — adding a sixth entry
// there would silently reshuffle the colour of every comment ever written, and a black pin
// reads as a rendering bug. Markup stroke colour is independent of all that, so the two
// lists diverge here.
//
// Relative import, not the '@/' alias: this module is unit-tested by `node --test`, which
// does not resolve the alias.
import { PALETTE, type Pastel } from '../commentColors';

/**
 * Grey chip, black stroke. The swatch row's language is "the chip is a pastel hint of the
 * stroke it sets" — a black chip in a row of pastels reads as a hole rather than a colour.
 */
export const BLACK: Pastel = {
  name: 'black',
  swatch: '#9AA1AC',
  dark: '#FFFFFF',
  accent: '#111111',
};

export const MARKUP_COLORS: Pastel[] = [...PALETTE, BLACK];

/** True when `color` is one of the fixed swatches — i.e. not something the picker produced. */
export function isPresetColor(color: string): boolean {
  const c = color.toLowerCase();
  return MARKUP_COLORS.some((entry) => entry.accent.toLowerCase() === c);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | tail -20`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add lib/markup/colors.ts scripts/tests/markupColors.test.mjs
git commit -m "feat(markup): add black to the markup colour list

Kept separate from PALETTE so comment pin and avatar colours do not shift."
```

---

### Task 2: Hex/HSV conversion for the picker

**Files:**
- Create: `lib/markup/color.ts`
- Modify: `scripts/tests/markupColors.test.mjs` (append)

**Interfaces:**
- Produces: `interface HSV { h: number; s: number; v: number }` (h in degrees 0–360, s and v in 0–1); `normalizeHex(input: string): string | null`; `hexToRgb(hex: string): { r: number; g: number; b: number } | null`; `rgbToHex(r: number, g: number, b: number): string`; `hsvToHex(hsv: HSV): string`; `hexToHsv(hex: string): HSV | null`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/tests/markupColors.test.mjs`:

```javascript
import { normalizeHex, hexToRgb, rgbToHex, hsvToHex, hexToHsv } from '../../lib/markup/color.ts';

test('normalizeHex accepts the forms a person types and rejects the rest', () => {
  assert.equal(normalizeHex('#AABBCC'), '#aabbcc');
  assert.equal(normalizeHex('aabbcc'), '#aabbcc');
  assert.equal(normalizeHex('  #Abc '), '#aabbcc');
  assert.equal(normalizeHex('abc'), '#aabbcc');
  assert.equal(normalizeHex(''), null);
  assert.equal(normalizeHex('#12345'), null);
  assert.equal(normalizeHex('#gggggg'), null);
  assert.equal(normalizeHex('rebeccapurple'), null);
});

test('rgb round-trips through hex', () => {
  assert.deepEqual(hexToRgb('#ff8000'), { r: 255, g: 128, b: 0 });
  assert.equal(rgbToHex(255, 128, 0), '#ff8000');
  assert.equal(hexToRgb('nonsense'), null);
});

test('rgbToHex clamps and rounds rather than emitting garbage', () => {
  assert.equal(rgbToHex(-10, 300, 127.6), '#00ff80');
});

test('the primaries land where they should on the hue wheel', () => {
  assert.equal(hsvToHex({ h: 0, s: 1, v: 1 }), '#ff0000');
  assert.equal(hsvToHex({ h: 120, s: 1, v: 1 }), '#00ff00');
  assert.equal(hsvToHex({ h: 240, s: 1, v: 1 }), '#0000ff');
  assert.equal(hsvToHex({ h: 360, s: 1, v: 1 }), '#ff0000', 'hue must wrap');
  assert.equal(hsvToHex({ h: 200, s: 0, v: 1 }), '#ffffff', 'no saturation is white');
  assert.equal(hsvToHex({ h: 200, s: 1, v: 0 }), '#000000', 'no value is black');
});

test('hex survives a round trip through HSV', () => {
  // The picker holds HSV state and writes hex out. Dragging nothing must not drift the colour.
  for (const hex of ['#ff6b6b', '#4a9fe0', '#7bc24a', '#9a82f0', '#ffcf2e', '#111111', '#ffffff', '#3d7a5c']) {
    const hsv = hexToHsv(hex);
    assert.ok(hsv, `${hex} did not parse`);
    const back = hexToRgb(hsvToHex(hsv));
    const src = hexToRgb(hex);
    for (const ch of ['r', 'g', 'b']) {
      assert.ok(Math.abs(back[ch] - src[ch]) <= 1, `${hex} drifted on ${ch}: ${back[ch]} vs ${src[ch]}`);
    }
  }
});

test('hexToHsv reports the components the picker positions its handles from', () => {
  assert.deepEqual(hexToHsv('#000000'), { h: 0, s: 0, v: 0 });
  assert.deepEqual(hexToHsv('#ffffff'), { h: 0, s: 0, v: 1 });
  const red = hexToHsv('#ff0000');
  assert.equal(red.h, 0);
  assert.equal(red.s, 1);
  assert.equal(red.v, 1);
  assert.equal(hexToHsv('#00ffff').h, 180);
  assert.equal(hexToHsv('bad'), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module .../lib/markup/color.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/markup/color.ts`:

```typescript
// lib/markup/color.ts
// Colour-space conversion for the markup colour picker. Pure arithmetic, no React and no
// '@/' imports, so `node --test` can exercise it directly.

/** Hue in degrees 0-360; saturation and value in 0-1. The picker's own state shape. */
export interface HSV {
  h: number;
  s: number;
  v: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** '#abc' | 'abc' | '#AABBCC' | 'aabbcc' -> '#aabbcc'. Anything else -> null. */
export function normalizeHex(input: string): string | null {
  const t = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(t)) return `#${t[0]}${t[0]}${t[1]}${t[1]}${t[2]}${t[2]}`;
  if (/^[0-9a-f]{6}$/.test(t)) return `#${t}`;
  return null;
}

export function hexToRgb(hex: string): RGB | null {
  const n = normalizeHex(hex);
  if (!n) return null;
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  };
}

const channel = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function hsvToHex({ h, s, v }: HSV): string {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export function hexToHsv(hex: string): HSV | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | tail -20`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add lib/markup/color.ts scripts/tests/markupColors.test.mjs
git commit -m "feat(markup): add hex/HSV conversion for the colour picker"
```

---

### Task 3: Draft geometry and shift constraints

**Files:**
- Create: `lib/markup/draft.ts`
- Create: `scripts/tests/markupDraft.test.mjs`

**Interfaces:**
- Produces:
  - `type DraftTool = 'freehand' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloud'`
  - `const BOX_TOOLS: readonly ['rect', 'ellipse', 'cloud']`, `const SEGMENT_TOOLS: readonly ['line', 'arrow']`
  - `isBoxTool(tool: string): boolean`, `isSegmentTool(tool: string): boolean`
  - `interface Point { x: number; y: number }`
  - `interface DraftGeometry { points: number[]; x: number; y: number; width: number; height: number }`
  - `startGeometry(tool: DraftTool, p: Point): DraftGeometry`
  - `updateGeometry(tool: DraftTool, g: DraftGeometry, p: Point, constrain: boolean): DraftGeometry`
  - `constrainBox(width: number, height: number): { width: number; height: number }`
  - `constrainSegment(x0: number, y0: number, x1: number, y1: number): Point`
  - `normalizedBox(width: number, height: number): { left: number; top: number; width: number; height: number }`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/markupDraft.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOX_TOOLS,
  SEGMENT_TOOLS,
  isBoxTool,
  isSegmentTool,
  startGeometry,
  updateGeometry,
  constrainBox,
  constrainSegment,
  normalizedBox,
} from '../../lib/markup/draft.ts';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('the tool families are the documented ones', () => {
  assert.deepEqual([...BOX_TOOLS], ['rect', 'ellipse', 'cloud']);
  assert.deepEqual([...SEGMENT_TOOLS], ['line', 'arrow']);
  for (const t of BOX_TOOLS) assert.ok(isBoxTool(t));
  for (const t of SEGMENT_TOOLS) assert.ok(isSegmentTool(t));
  assert.ok(!isBoxTool('freehand'));
  assert.ok(!isBoxTool('text'));
  assert.ok(!isSegmentTool('rect'));
});

test('a box gesture anchors at the press point with no extent yet', () => {
  for (const tool of BOX_TOOLS) {
    const g = startGeometry(tool, { x: 10, y: 20 });
    assert.deepEqual(g, { points: [], x: 10, y: 20, width: 0, height: 0 });
  }
});

test('a segment gesture starts as a zero-length segment, freehand as one vertex', () => {
  assert.deepEqual(startGeometry('line', { x: 3, y: 4 }).points, [3, 4, 3, 4]);
  assert.deepEqual(startGeometry('arrow', { x: 3, y: 4 }).points, [3, 4, 3, 4]);
  assert.deepEqual(startGeometry('freehand', { x: 3, y: 4 }).points, [3, 4]);
});

test('freehand accumulates points and ignores the constraint', () => {
  let g = startGeometry('freehand', { x: 0, y: 0 });
  g = updateGeometry('freehand', g, { x: 1, y: 2 }, false);
  g = updateGeometry('freehand', g, { x: 3, y: 4 }, true);
  assert.deepEqual(g.points, [0, 0, 1, 2, 3, 4]);
});

test('an unconstrained box tracks the pointer in every direction', () => {
  const g = startGeometry('rect', { x: 100, y: 100 });
  assert.deepEqual(updateGeometry('rect', g, { x: 130, y: 110 }, false), { ...g, width: 30, height: 10 });
  assert.deepEqual(updateGeometry('rect', g, { x: 70, y: 60 }, false), { ...g, width: -30, height: -40 });
});

test('a constrained box squares off on the LARGER extent, keeping each sign', () => {
  // The larger extent, not the width: a mostly-vertical drag must not collapse to whatever
  // width it happens to have.
  assert.deepEqual(constrainBox(30, 10), { width: 30, height: 30 });
  assert.deepEqual(constrainBox(10, 30), { width: 30, height: 30 });
  assert.deepEqual(constrainBox(-30, 10), { width: -30, height: 30 });
  assert.deepEqual(constrainBox(10, -30), { width: 30, height: -30 });
  assert.deepEqual(constrainBox(-10, -30), { width: -30, height: -30 });
  assert.deepEqual(constrainBox(0, 0), { width: 0, height: 0 });
});

test('shift makes an ellipse a circle and a cloud square, on every box tool', () => {
  for (const tool of BOX_TOOLS) {
    const g = startGeometry(tool, { x: 0, y: 0 });
    const out = updateGeometry(tool, g, { x: 40, y: 12 }, true);
    assert.equal(Math.abs(out.width), Math.abs(out.height), `${tool} was not squared`);
    assert.equal(out.width, 40);
  }
});

test('a constrained segment snaps to 45 degrees and keeps its length', () => {
  const len = (p) => Math.hypot(p.x, p.y);
  const flat = constrainSegment(0, 0, 10, 1);
  close(flat.y, 0, 'a near-horizontal drag flattens');
  close(flat.x, Math.hypot(10, 1), 'length is preserved along the snapped direction');

  const diag = constrainSegment(0, 0, 10, 9);
  close(diag.x, diag.y, 'a near-diagonal drag becomes exactly diagonal');
  close(len(diag), Math.hypot(10, 9), 'length is preserved');

  const up = constrainSegment(0, 0, 1, -10);
  close(up.x, 0, 'a near-vertical drag straightens');
  close(up.y, -Math.hypot(1, 10), 'and keeps its sign');

  const still = constrainSegment(5, 5, 5, 5);
  assert.deepEqual(still, { x: 5, y: 5 }, 'a zero-length segment must not divide by zero');
});

test('an unconstrained segment moves only its far end', () => {
  const g = startGeometry('arrow', { x: 2, y: 3 });
  const out = updateGeometry('arrow', g, { x: 50, y: 4 }, false);
  assert.deepEqual(out.points, [2, 3, 50, 4]);
});

test('a constrained segment snaps relative to its own anchor, not the origin', () => {
  const g = startGeometry('line', { x: 100, y: 100 });
  const out = updateGeometry('line', g, { x: 110, y: 101 }, true);
  assert.equal(out.points[0], 100);
  assert.equal(out.points[1], 100);
  close(out.points[3], 100, 'snapped flat about the anchor');
});

test('normalizedBox describes the box a negative-extent draft occupies', () => {
  assert.deepEqual(normalizedBox(30, 20), { left: 0, top: 0, width: 30, height: 20 });
  assert.deepEqual(normalizedBox(-30, 20), { left: -30, top: 0, width: 30, height: 20 });
  assert.deepEqual(normalizedBox(-30, -20), { left: -30, top: -20, width: 30, height: 20 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module .../lib/markup/draft.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/markup/draft.ts`:

```typescript
// lib/markup/draft.ts
// The geometry of an in-progress draw gesture, and what Shift does to it.
//
// Extracted out of useAnnotationObjects so it can be unit-tested: the two drawing surfaces
// both delegate here, so the constraint behaves identically on a 3D snapshot and on a PDF.
// Pure arithmetic, no React and no '@/' imports.

export type DraftTool = 'freehand' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloud';

/** Tools drawn by dragging out a bounding box. They share all of their gesture maths. */
export const BOX_TOOLS = ['rect', 'ellipse', 'cloud'] as const;
/** Tools drawn as a single two-point segment. */
export const SEGMENT_TOOLS = ['line', 'arrow'] as const;

export type BoxTool = (typeof BOX_TOOLS)[number];
export type SegmentTool = (typeof SEGMENT_TOOLS)[number];

// Widened to `string` on purpose: callers hold an AnnotationObjectType, which also spans
// 'text' and 'image', and should be able to ask without casting first.
export function isBoxTool(tool: string): tool is BoxTool {
  return (BOX_TOOLS as readonly string[]).includes(tool);
}

export function isSegmentTool(tool: string): tool is SegmentTool {
  return (SEGMENT_TOOLS as readonly string[]).includes(tool);
}

export interface Point {
  x: number;
  y: number;
}

/** The subset of an AnnotationObject a draw gesture writes. */
export interface DraftGeometry {
  points: number[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export function startGeometry(tool: DraftTool, p: Point): DraftGeometry {
  if (tool === 'freehand') return { points: [p.x, p.y], x: 0, y: 0, width: 0, height: 0 };
  if (isSegmentTool(tool)) return { points: [p.x, p.y, p.x, p.y], x: 0, y: 0, width: 0, height: 0 };
  return { points: [], x: p.x, y: p.y, width: 0, height: 0 };
}

/**
 * Square off a box, so an ellipse drawn with Shift is a perfect circle.
 *
 * Both extents take the magnitude of the LARGER of the two and keep their own sign. Taking
 * the width would collapse a mostly-vertical drag to whatever width it happened to have,
 * which feels like the tool fighting you.
 */
export function constrainBox(width: number, height: number): { width: number; height: number } {
  const size = Math.max(Math.abs(width), Math.abs(height));
  return {
    width: width < 0 ? -size : size,
    height: height < 0 ? -size : size,
  };
}

/** Shift snaps a segment to eighths of a turn. */
export const SEGMENT_SNAP_STEP = Math.PI / 4;

/** The far end of a segment, snapped to the nearest 45 deg about its anchor, length kept. */
export function constrainSegment(x0: number, y0: number, x1: number, y1: number): Point {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: x1, y: y1 };
  const angle = Math.round(Math.atan2(dy, dx) / SEGMENT_SNAP_STEP) * SEGMENT_SNAP_STEP;
  return { x: x0 + Math.cos(angle) * length, y: y0 + Math.sin(angle) * length };
}

/**
 * Advance a draft to the current pointer position. `constrain` is the Shift key, read fresh
 * from each pointer event — so pressing or releasing Shift mid-drag takes effect on the next
 * move rather than instantly, which is the ordinary design-tool behaviour.
 */
export function updateGeometry(tool: DraftTool, g: DraftGeometry, p: Point, constrain: boolean): DraftGeometry {
  if (tool === 'freehand') return { ...g, points: [...g.points, p.x, p.y] };
  if (isSegmentTool(tool)) {
    const end = constrain ? constrainSegment(g.points[0], g.points[1], p.x, p.y) : p;
    return { ...g, points: [g.points[0], g.points[1], end.x, end.y] };
  }
  const width = p.x - g.x;
  const height = p.y - g.y;
  const box = constrain ? constrainBox(width, height) : { width, height };
  return { ...g, width: box.width, height: box.height };
}

/**
 * The box a possibly-negative-extent draft occupies, in the node's OWN coordinates — the
 * node sits at (x, y) and the box spans (0,0) to (width, height). Committed objects are
 * normalised on release, but a draft mid-drag is not, so anything drawing a box shape has
 * to cope with negative extents.
 */
export function normalizedBox(width: number, height: number): { left: number; top: number; width: number; height: number } {
  return {
    left: Math.min(0, width),
    top: Math.min(0, height),
    width: Math.abs(width),
    height: Math.abs(height),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | tail -20`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add lib/markup/draft.ts scripts/tests/markupDraft.test.mjs
git commit -m "feat(markup): extract draft geometry with shift constraints"
```

---

### Task 4: Rotation snap helpers

**Files:**
- Create: `lib/markup/rotationSnap.ts`
- Create: `scripts/tests/markupRotationSnap.test.mjs`

**Interfaces:**
- Produces: `RIGHT_ANGLE: number` (`Math.PI / 2`); `ROTATION_SNAPS_DEG: number[]` (`[0, 90, 180, 270]`); `ROTATION_SNAP_TOLERANCE_DEG: number` (`45`); `snapToRightAngle(radians: number): number`; `snapEulerToRightAngles(euler: [number, number, number]): [number, number, number]`.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/markupRotationSnap.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RIGHT_ANGLE,
  ROTATION_SNAPS_DEG,
  ROTATION_SNAP_TOLERANCE_DEG,
  snapToRightAngle,
  snapEulerToRightAngles,
} from '../../lib/markup/rotationSnap.ts';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('the Konva snap set is the four right angles, in degrees', () => {
  assert.deepEqual(ROTATION_SNAPS_DEG, [0, 90, 180, 270]);
});

test('the tolerance reaches halfway to the neighbouring snap', () => {
  // Konva's default is 5 deg, which would snap only near-aligned rotations and make Shift
  // look broken everywhere else. 45 puts every angle within reach of the nearest of four.
  assert.equal(ROTATION_SNAP_TOLERANCE_DEG, 45);
});

test('snapping is absolute, not incremental', () => {
  // An object at 7 deg goes to 0, never to 97.
  close(snapToRightAngle(0.12), 0, 'a small angle straightens');
  close(snapToRightAngle(RIGHT_ANGLE + 0.1), RIGHT_ANGLE, 'near a right angle');
  close(snapToRightAngle(Math.PI - 0.2), Math.PI, 'near a half turn');
  close(snapToRightAngle(-0.2), 0, 'negative small angles straighten too');
  close(snapToRightAngle(-1.4), -RIGHT_ANGLE, 'and negative right angles are kept negative');
  close(snapToRightAngle(2 * Math.PI - 0.05), 2 * Math.PI, 'a full turn is a snap point');
});

test('exactly halfway rounds away from zero, deterministically', () => {
  close(snapToRightAngle(RIGHT_ANGLE / 2), RIGHT_ANGLE, 'Math.round rounds up');
});

test('a straightened angle is never negative zero', () => {
  // -0 flows into three.js Euler and out to the persisted transform, where it compares
  // unequal to 0 under Object.is and shows up as a spurious diff.
  assert.ok(Object.is(snapToRightAngle(-0.01), 0), 'got -0');
});

test('an Euler triple snaps component-wise', () => {
  const out = snapEulerToRightAngles([0.05, RIGHT_ANGLE - 0.05, Math.PI + 0.05]);
  assert.equal(out.length, 3);
  close(out[0], 0, 'x');
  close(out[1], RIGHT_ANGLE, 'y');
  close(out[2], Math.PI, 'z');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module .../lib/markup/rotationSnap.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/markup/rotationSnap.ts`:

```typescript
// lib/markup/rotationSnap.ts
// What "hold Shift while rotating" means, shared by the two rotate affordances that have
// nothing else in common: the Konva Transformer on a markup object, and the drei
// TransformControls gizmo on the 3D model or a cross-section plane.
//
// Snapping is ABSOLUTE. An object at 7 deg goes to 0, not to 97. Shift therefore always
// produces an axis-aligned result, which is the whole point of the gesture — three.js's own
// rotationSnap quantises the drag DELTA instead and would never straighten a crooked object.

export const RIGHT_ANGLE = Math.PI / 2;

/** Konva's Transformer takes absolute snap angles in degrees. */
export const ROTATION_SNAPS_DEG = [0, 90, 180, 270];

/**
 * Konva's default rotationSnapTolerance is 5 deg, which would snap only rotations that are
 * already nearly aligned. 45 deg puts every angle within reach of the nearest of the four.
 */
export const ROTATION_SNAP_TOLERANCE_DEG = 45;

export function snapToRightAngle(radians: number): number {
  const snapped = Math.round(radians / RIGHT_ANGLE) * RIGHT_ANGLE;
  // Math.round(-0.001 / RIGHT_ANGLE) is -0, and -0 * RIGHT_ANGLE is -0. That would flow into
  // the persisted object transform and compare unequal to 0 under Object.is.
  return snapped === 0 ? 0 : snapped;
}

/**
 * All three components, not just the axis being dragged. Rounding every axis means an object
 * already sitting at 7 deg on X also straightens on X when you Shift-rotate about Y — which
 * is the intended reading of "snap the object to the nearest 90": a statement about the
 * object's final orientation, not about one drag's delta.
 */
export function snapEulerToRightAngles(euler: [number, number, number]): [number, number, number] {
  return [snapToRightAngle(euler[0]), snapToRightAngle(euler[1]), snapToRightAngle(euler[2])];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | tail -20`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add lib/markup/rotationSnap.ts scripts/tests/markupRotationSnap.test.mjs
git commit -m "feat(markup): add absolute right-angle rotation snapping helpers"
```

---

### Task 5: Cloud scallop geometry

**Files:**
- Create: `lib/markup/cloud.ts`
- Create: `scripts/tests/markupCloud.test.mjs`

**Interfaces:**
- Produces: `interface CloudArc { cx: number; cy: number; r: number; start: number; end: number }`; `MIN_SCALLOP_RADIUS: number`; `SCALLOPS_PER_SHORT_SIDE: number`; `cloudArcs(width: number, height: number): CloudArc[]`; `arcStart(a: CloudArc): { x: number; y: number }`; `arcEnd(a: CloudArc): { x: number; y: number }`.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/markupCloud.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudArcs, arcStart, arcEnd, MIN_SCALLOP_RADIUS } from '../../lib/markup/cloud.ts';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('a degenerate box has no cloud', () => {
  assert.deepEqual(cloudArcs(0, 40), []);
  assert.deepEqual(cloudArcs(40, 0), []);
  assert.deepEqual(cloudArcs(0, 0), []);
});

test('the path is closed and continuous, so the arcs form one outline', () => {
  // Each ctx.arc is joined to the previous with an implicit lineTo. If the endpoints did not
  // coincide, the cloud would be drawn with chords cutting across its own scallops.
  for (const [w, h] of [[200, 120], [37, 210], [9, 9], [500, 40]]) {
    const arcs = cloudArcs(w, h);
    assert.ok(arcs.length >= 4, `${w}x${h} produced too few arcs`);
    for (let i = 0; i < arcs.length; i++) {
      const end = arcEnd(arcs[i]);
      const next = arcStart(arcs[(i + 1) % arcs.length]);
      close(end.x, next.x, `${w}x${h} arc ${i} -> ${i + 1} x`);
      close(end.y, next.y, `${w}x${h} arc ${i} -> ${i + 1} y`);
    }
  }
});

test('every arc is centred on the perimeter of the box it was asked for', () => {
  const w = 160;
  const h = 100;
  for (const a of cloudArcs(w, h)) {
    const onVertical = (Math.abs(a.cx - 0) < 1e-9 || Math.abs(a.cx - w) < 1e-9) && a.cy >= 0 && a.cy <= h;
    const onHorizontal = (Math.abs(a.cy - 0) < 1e-9 || Math.abs(a.cy - h) < 1e-9) && a.cx >= 0 && a.cx <= w;
    assert.ok(onVertical || onHorizontal, `arc centre (${a.cx}, ${a.cy}) is not on the perimeter`);
    assert.ok(a.r > 0, 'arc radius must be positive');
  }
});

test('scallops stay legible on a small cloud and do not bloat on a large one', () => {
  const small = cloudArcs(12, 12);
  assert.ok(small.length >= 4, 'a tiny cloud still has a scallop per side');
  for (const a of small) assert.ok(a.r <= 12, 'a scallop never exceeds the box it decorates');

  const large = cloudArcs(800, 600);
  for (const a of large) {
    assert.ok(a.r >= MIN_SCALLOP_RADIUS, 'scallops never go below the legibility floor');
    assert.ok(a.r < 200, `a scallop of ${a.r} on an 800x600 box is a bulge, not a cloud`);
  }
  assert.ok(large.length > small.length, 'a bigger cloud has more scallops');
});

test('a box dragged up and left is mirrored, not drawn off into space', () => {
  // A draft mid-drag carries negative extents; only committed objects are normalised.
  const arcs = cloudArcs(-160, -100);
  assert.ok(arcs.length >= 4);
  for (const a of arcs) {
    assert.ok(a.cx >= -160 - 1e-9 && a.cx <= 1e-9, `cx ${a.cx} outside the box`);
    assert.ok(a.cy >= -100 - 1e-9 && a.cy <= 1e-9, `cy ${a.cy} outside the box`);
  }
});

test('the four sides are all represented', () => {
  const w = 120;
  const h = 80;
  const arcs = cloudArcs(w, h);
  assert.ok(arcs.some((a) => Math.abs(a.cy) < 1e-9), 'no top scallops');
  assert.ok(arcs.some((a) => Math.abs(a.cx - w) < 1e-9), 'no right scallops');
  assert.ok(arcs.some((a) => Math.abs(a.cy - h) < 1e-9), 'no bottom scallops');
  assert.ok(arcs.some((a) => Math.abs(a.cx) < 1e-9), 'no left scallops');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module .../lib/markup/cloud.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/markup/cloud.ts`:

```typescript
// lib/markup/cloud.ts
// The revision-cloud outline: a closed ring of outward scalloped arcs around a box.
//
// Emitted as data rather than drawn here, so the geometry can be unit-tested without a
// canvas. AnnotationObjects feeds these straight to ctx.arc in a Konva sceneFunc.

import { normalizedBox } from './draft';

export interface CloudArc {
  cx: number;
  cy: number;
  r: number;
  /** Canvas angles, swept in increasing order (ctx.arc with counterclockwise = false). */
  start: number;
  end: number;
}

/** Below this a scallop stops reading as a bump and just thickens the line. */
export const MIN_SCALLOP_RADIUS = 4;

/** Sets the target scallop size: the short side of the box gets about this many bumps. */
export const SCALLOPS_PER_SHORT_SIDE = 4;

export function arcStart(a: CloudArc): { x: number; y: number } {
  return { x: a.cx + a.r * Math.cos(a.start), y: a.cy + a.r * Math.sin(a.start) };
}

export function arcEnd(a: CloudArc): { x: number; y: number } {
  return { x: a.cx + a.r * Math.cos(a.end), y: a.cy + a.r * Math.sin(a.end) };
}

/**
 * Arcs are emitted in perimeter order — top left-to-right, right top-to-bottom, bottom
 * right-to-left, left bottom-to-top — and each arc's end point is exactly the next one's
 * start point, so the implicit lineTo between consecutive ctx.arc calls is a zero-length
 * move rather than a chord slicing across the outline.
 *
 * Radius is solved per axis (r = side / 2n) rather than taken as a fixed target, so the
 * scallops divide each side exactly and the corners meet.
 *
 * `width` and `height` may be negative: a draft mid-drag is not normalised.
 */
export function cloudArcs(width: number, height: number): CloudArc[] {
  const box = normalizedBox(width, height);
  if (box.width <= 0 || box.height <= 0) return [];

  const target = Math.max(MIN_SCALLOP_RADIUS, Math.min(box.width, box.height) / (SCALLOPS_PER_SHORT_SIDE * 2));
  const countFor = (side: number) => Math.max(1, Math.round(side / (2 * target)));
  const nx = countFor(box.width);
  const ny = countFor(box.height);
  const rx = box.width / (2 * nx);
  const ry = box.height / (2 * ny);

  const { left, top } = box;
  const right = left + box.width;
  const bottom = top + box.height;
  const arcs: CloudArc[] = [];

  // Top edge, travelling right, bulging up (canvas y grows downward, so PI..2PI is the
  // upper half).
  for (let i = 0; i < nx; i++) {
    arcs.push({ cx: left + (2 * i + 1) * rx, cy: top, r: rx, start: Math.PI, end: 2 * Math.PI });
  }
  // Right edge, travelling down, bulging right.
  for (let i = 0; i < ny; i++) {
    arcs.push({ cx: right, cy: top + (2 * i + 1) * ry, r: ry, start: -Math.PI / 2, end: Math.PI / 2 });
  }
  // Bottom edge, travelling left, bulging down.
  for (let i = nx - 1; i >= 0; i--) {
    arcs.push({ cx: left + (2 * i + 1) * rx, cy: bottom, r: rx, start: 0, end: Math.PI });
  }
  // Left edge, travelling up, bulging left.
  for (let i = ny - 1; i >= 0; i--) {
    arcs.push({ cx: left, cy: top + (2 * i + 1) * ry, r: ry, start: Math.PI / 2, end: (3 * Math.PI) / 2 });
  }
  return arcs;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | tail -20`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add lib/markup/cloud.ts scripts/tests/markupCloud.test.mjs
git commit -m "feat(markup): add revision-cloud scallop geometry"
```

---

### Task 6: Eraser drag sampling

**Files:**
- Create: `lib/markup/eraseSweep.ts`
- Create: `scripts/tests/markupEraseSweep.test.mjs`

**Interfaces:**
- Produces: `ERASE_SAMPLE_SPACING: number` (`6`); `MAX_ERASE_SAMPLES: number` (`64`); `sweepPoints(from: Point | null, to: Point, spacing?: number): Point[]` where `Point` is re-exported from `lib/markup/draft.ts`.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/markupEraseSweep.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepPoints, ERASE_SAMPLE_SPACING, MAX_ERASE_SAMPLES } from '../../lib/markup/eraseSweep.ts';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('the first sample of a drag is just the point itself', () => {
  assert.deepEqual(sweepPoints(null, { x: 5, y: 7 }), [{ x: 5, y: 7 }]);
});

test('a move shorter than the spacing is one sample', () => {
  assert.deepEqual(sweepPoints({ x: 0, y: 0 }, { x: 2, y: 2 }), [{ x: 2, y: 2 }]);
});

test('a fast flick is filled in so no object between frames is skipped', () => {
  const pts = sweepPoints({ x: 0, y: 0 }, { x: 60, y: 0 });
  assert.ok(pts.length >= 60 / ERASE_SAMPLE_SPACING, `only ${pts.length} samples across 60px`);
  let prev = { x: 0, y: 0 };
  for (const p of pts) {
    assert.ok(Math.hypot(p.x - prev.x, p.y - prev.y) <= ERASE_SAMPLE_SPACING + 1e-9, 'gap too wide');
    prev = p;
  }
});

test('the drag always ends exactly under the cursor', () => {
  const pts = sweepPoints({ x: 10, y: 10 }, { x: 137, y: -44 });
  close(pts[pts.length - 1].x, 137, 'last x');
  close(pts[pts.length - 1].y, -44, 'last y');
});

test('the origin is not re-sampled', () => {
  // It was erased on the previous event; re-testing it every move is pure waste.
  const pts = sweepPoints({ x: 0, y: 0 }, { x: 30, y: 0 });
  assert.ok(pts[0].x > 0, 'first sample must be past the origin');
});

test('an enormous jump is capped rather than allocating thousands of samples', () => {
  const pts = sweepPoints({ x: 0, y: 0 }, { x: 100000, y: 0 });
  assert.equal(pts.length, MAX_ERASE_SAMPLES);
  close(pts[pts.length - 1].x, 100000, 'and still ends under the cursor');
});

test('spacing is overridable', () => {
  assert.equal(sweepPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 50).length, 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module .../lib/markup/eraseSweep.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/markup/eraseSweep.ts`:

```typescript
// lib/markup/eraseSweep.ts
// Dragging the eraser must delete everything the path crosses, but pointer events arrive
// once a frame — a quick flick can jump a hundred pixels between two of them, straight over
// an object. This fills the gap in with sample points to hit-test.

import type { Point } from './draft';

export type { Point };

/** Roughly half the smallest object we care about hitting; small enough to never skip one. */
export const ERASE_SAMPLE_SPACING = 6;

/** A backstop on a pathological jump (window resize, tab restore) — 64 hit tests is plenty. */
export const MAX_ERASE_SAMPLES = 64;

/**
 * Sample points from just after `from` up to and including `to`.
 *
 * `from` is excluded because it was hit-tested on the previous event. `to` is always the
 * final element, so the object directly under the cursor is always erased even when the
 * sample count is capped.
 */
export function sweepPoints(from: Point | null, to: Point, spacing: number = ERASE_SAMPLE_SPACING): Point[] {
  if (!from) return [to];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= spacing) return [to];
  const steps = Math.min(MAX_ERASE_SAMPLES, Math.ceil(distance / spacing));
  const points: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    points.push({ x: from.x + (dx * i) / steps, y: from.y + (dy * i) / steps });
  }
  return points;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | tail -20`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add lib/markup/eraseSweep.ts scripts/tests/markupEraseSweep.test.mjs
git commit -m "feat(markup): add eraser drag sampling"
```

---

### Task 7: One shared ToolType

**Files:**
- Modify: `components/markup/useAnnotationObjects.ts:9-10`
- Modify: `components/markup/DrawingTools.tsx:8`
- Modify: `components/viewers/PDFKonvaViewer.tsx:17`
- Modify: `components/viewers/ViewerContainer.tsx:24`
- Modify: `app/portal/[id]/page.tsx:61`

**Interfaces:**
- Produces: `ToolType` exported from `components/markup/useAnnotationObjects.ts`, defined as `AnnTool | 'comment'`.

The same union is currently hand-copied into four files. Tasks 8–10 add two members to it, and a copy left behind would silently break a tool — `DRAW_TOOLS` in the portal page decides whether a click starts an annotation session at all. Collapse it first.

- [ ] **Step 1: Export one definition**

In `components/markup/useAnnotationObjects.ts`, leave `AnnotationObjectType` and `AnnTool` as they are and add below them:

```typescript
/**
 * Everything the toolbar can have armed. One definition, imported by the toolbar, both
 * drawing surfaces and the portal page — it used to be hand-copied into four files, which
 * is one place to forget when a tool is added.
 *
 * 'comment' is the pin mode, which is a toolbar state but never an AnnTool: it places a
 * comment rather than drawing an object.
 */
export type ToolType = AnnTool | 'comment';
```

- [ ] **Step 2: Replace the four copies**

In `components/markup/DrawingTools.tsx`, delete line 8 (`type ToolType = ...`) and extend the existing type import on line 9:

```typescript
import type { AnnotationObjectType, ToolType } from './useAnnotationObjects';
```

In `components/viewers/PDFKonvaViewer.tsx`, delete line 17 (`type ToolType = ...`) and extend the existing import on line 9:

```typescript
import { useAnnotationObjects, type AnnTool, type MarkupSelection, type ToolType } from '@/components/markup/useAnnotationObjects';
```

In `components/viewers/ViewerContainer.tsx`, delete line 24 (`type ToolType = ...`) and add near the other imports:

```typescript
import type { ToolType } from '@/components/markup/useAnnotationObjects';
```

In `app/portal/[id]/page.tsx`, delete line 61 (`type ToolType = ...`); line 31 already imports from that module, so extend it:

```typescript
import type { AnnTool, AnnotationObjectType, MarkupSelection, ToolType } from '@/components/markup/useAnnotationObjects';
```

- [ ] **Step 3: Verify nothing else defines it**

Run: `grep -rn "^type ToolType\|  type ToolType" --include="*.ts" --include="*.tsx" app components lib`
Expected: no output.

- [ ] **Step 4: Type check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (`npm run lint` may print pre-existing warnings; it must not print new ones.)

- [ ] **Step 5: Commit**

```bash
git add components/markup/useAnnotationObjects.ts components/markup/DrawingTools.tsx components/viewers/PDFKonvaViewer.tsx components/viewers/ViewerContainer.tsx "app/portal/[id]/page.tsx"
git commit -m "refactor(markup): define ToolType once instead of in four files"
```

---

### Task 8: Ellipse and cloud in the object model

**Files:**
- Modify: `components/markup/useAnnotationObjects.ts`

**Interfaces:**
- Consumes: `startGeometry`, `updateGeometry`, `isBoxTool` from `lib/markup/draft.ts` (Task 3).
- Produces: `AnnotationObjectType` and `AnnTool` gain `'ellipse' | 'cloud'`; `moveDraw(tool: AnnTool, p: Point, constrain?: boolean)` — third parameter optional so both surfaces still compile until Task 10 passes it.

- [ ] **Step 1: Widen the types and the gesture set**

Replace lines 9–10 of `components/markup/useAnnotationObjects.ts`:

```typescript
export type AnnotationObjectType = 'freehand' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloud' | 'text' | 'image';
export type AnnTool = 'pointer' | 'freehand' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloud' | 'text' | 'eraser';
```

Add to the imports at the top:

```typescript
import { startGeometry, updateGeometry, isBoxTool, type DraftTool } from '@/lib/markup/draft';
```

Replace the `GESTURE_TOOLS` constant:

```typescript
const GESTURE_TOOLS = new Set<AnnTool>(['freehand', 'line', 'arrow', 'rect', 'ellipse', 'cloud']);
```

- [ ] **Step 2: Delegate the gesture maths to lib/markup/draft**

Replace `startDraw` and `moveDraw` in `components/markup/useAnnotationObjects.ts`:

```typescript
  const startDraw = useCallback((tool: AnnTool, p: { x: number; y: number }, color: string, strokeWidth: number) => {
    if (!GESTURE_TOOLS.has(tool)) return;
    const o = { ...base(tool as AnnotationObjectType, color, strokeWidth), ...startGeometry(tool as DraftTool, p) };
    draftRef.current = o;
    setDraft(o);
  }, []);

  /**
   * `constrain` is the Shift key, read fresh off each pointer event by the surface. Optional
   * so a caller that does not care (a test, a surface not yet wired) behaves as before.
   */
  const moveDraw = useCallback((tool: AnnTool, p: { x: number; y: number }, constrain = false) => {
    const d = draftRef.current;
    if (!d || !GESTURE_TOOLS.has(tool)) return;
    const next = { ...d, ...updateGeometry(tool as DraftTool, d, p, constrain) };
    draftRef.current = next;
    setDraft(next);
  }, []);
```

- [ ] **Step 3: Make the release rules cover the new shapes**

In `endDraw`, replace the `valid` expression and the normalisation branch:

```typescript
    const valid = d.type === 'freehand' ? d.points.length > 2
      : isBoxTool(d.type) ? Math.abs(d.width) > 3 && Math.abs(d.height) > 3
      : (d.type === 'line' || d.type === 'arrow') ? Math.hypot(d.points[2] - d.points[0], d.points[3] - d.points[1]) > 3
      : true;
    if (!valid) return null;
    let obj = d;
    if (isBoxTool(d.type)) {
      obj = { ...d, x: Math.min(d.x, d.x + d.width), y: Math.min(d.y, d.y + d.height), width: Math.abs(d.width), height: Math.abs(d.height) };
    }
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: no errors. `AnnotationObjects.tsx` has no case for the new types yet, but its `switch` already falls through to `default: return null`, so it still compiles.

- [ ] **Step 5: Confirm the existing tests still pass**

Run: `npm test 2>&1 | tail -5`
Expected: `fail 0`

- [ ] **Step 6: Commit**

```bash
git add components/markup/useAnnotationObjects.ts
git commit -m "feat(markup): add ellipse and cloud to the object model"
```

---

### Task 9: Render ellipse and cloud

**Files:**
- Modify: `components/markup/AnnotationObjects.tsx`

**Interfaces:**
- Consumes: `cloudArcs` from `lib/markup/cloud.ts` (Task 5), `normalizedBox` from `lib/markup/draft.ts` (Task 3).

Both render as a Konva `<Shape sceneFunc>` drawing inside a box-local `(0,0) → (width, height)` frame, **not** as `<Ellipse>`. Konva's `Ellipse` is centre-origin; using it would make `x` mean "centre" for ellipses and "top-left" for rects, and the shared `onDragEnd` writes `e.target.x()` straight back into the object — so the two conventions would corrupt position on the first drag.

- [ ] **Step 1: Import what the shapes need**

In `components/markup/AnnotationObjects.tsx`, extend the react-konva import and add the two helpers:

```typescript
import { Line, Arrow, Rect, Shape, Text, Image as KonvaImage, Transformer } from 'react-konva';
import { cloudArcs } from '@/lib/markup/cloud';
import { normalizedBox } from '@/lib/markup/draft';
```

- [ ] **Step 2: Add the render cases**

In `renderObj`, immediately after the `case 'rect':` line, add:

```tsx
      case 'ellipse':
      case 'cloud': {
        const box = normalizedBox(obj.width, obj.height);
        return (
          <Shape
            key={obj.id}
            {...common}
            // The Transformer reads these to size its bounding box; the drawing below is
            // independent of them.
            width={box.width}
            height={box.height}
            stroke={obj.color}
            strokeWidth={obj.strokeWidth}
            sceneFunc={(ctx, shape) => {
              ctx.beginPath();
              if (obj.type === 'ellipse') {
                ctx.ellipse(box.left + box.width / 2, box.top + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2);
              } else {
                // Consecutive arcs share endpoints exactly (see lib/markup/cloud), so the
                // implicit lineTo between them is a zero-length move, not a chord.
                for (const a of cloudArcs(obj.width, obj.height)) {
                  ctx.arc(a.cx, a.cy, a.r, a.start, a.end, false);
                }
              }
              ctx.closePath();
              ctx.strokeShape(shape);
            }}
            // Stroke-only shapes have no fillable interior, so Konva's default hit test would
            // only register on the line itself and clicks inside the shape would fall through
            // to whatever is beneath. A filled bounding box matches what Rect gives for free.
            hitFunc={(ctx, shape) => {
              ctx.beginPath();
              ctx.rect(box.left, box.top, box.width, box.height);
              ctx.closePath();
              ctx.fillStrokeShape(shape);
            }}
          />
        );
      }
```

- [ ] **Step 3: Type check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/markup/AnnotationObjects.tsx
git commit -m "feat(markup): render ellipse and cloud objects"
```

---

### Task 10: Shape buttons and shift-constrained drawing

**Files:**
- Modify: `components/markup/DrawingTools.tsx:88-127` (`SHAPE_TOOLS`)
- Modify: `app/portal/[id]/page.tsx:65` (`DRAW_TOOLS`)
- Modify: `components/markup/AnnotationCanvas.tsx` (`handleMouseMove`)
- Modify: `components/viewers/PDFKonvaViewer.tsx` (`handleStageMouseMove`)

This is the first task with visible behaviour: after it, ellipse and cloud can be drawn, and Shift constrains every shape.

- [ ] **Step 1: Add the two toolbar entries**

Append to the `SHAPE_TOOLS` array in `components/markup/DrawingTools.tsx`, after the `rect` entry:

```tsx
  {
    id: 'ellipse',
    label: 'Ellipse',
    icon: (
      <svg {...ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        <ellipse cx="8" cy="8" rx="5.5" ry="4.5" />
      </svg>
    ),
  },
  {
    id: 'cloud',
    label: 'Cloud',
    icon: (
      <svg {...px(19)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M6 17a3.2 3.2 0 0 1 0-6.4 4.2 4.2 0 0 1 7.2-2.9A3.4 3.4 0 0 1 18.6 10a3.5 3.5 0 0 1 0 7H6Z" />
      </svg>
    ),
  },
```

- [ ] **Step 2: Let the new tools start an annotation session**

In `app/portal/[id]/page.tsx`, line 65:

```typescript
const DRAW_TOOLS: ToolType[] = ['freehand', 'line', 'arrow', 'rect', 'ellipse', 'cloud', 'text'];
```

- [ ] **Step 3: Pass the Shift key from both surfaces**

In `components/markup/AnnotationCanvas.tsx`, replace `handleMouseMove`:

```tsx
  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const p = e.target.getStage()?.getPointerPosition();
    // Read Shift off the event rather than tracking it: the constraint applies from the next
    // pointer move, which is what every other design tool does.
    if (p) ann.moveDraw(activeTool, p, e.evt.shiftKey);
  };
```

In `components/viewers/PDFKonvaViewer.tsx`, replace the body of `handleStageMouseMove`:

```tsx
    const handleStageMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!annotating) return;
      const stage = e.target.getStage();
      if (!stage) return;
      const coords = getPageCoords(stage);
      if (coords) ann.moveDraw(activeTool as AnnTool, coords, e.evt.shiftKey);
    }, [annotating, activeTool, getPageCoords, ann]);
```

- [ ] **Step 4: Type check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Verify in a browser**

Start the app per `stiko-local-visual-verification` (`npm run dev`, open a package, open a file). On **both** a 3D/image file and a PDF:

- Shapes menu now shows Line, Arrow, Rectangle, Ellipse, Cloud.
- Drawing an ellipse and a cloud works in all four drag directions, and each can then be selected, dragged, scaled and rotated.
- Holding Shift while dragging: rectangle and cloud come out square, ellipse a perfect circle, line and arrow snap to 45° steps. Releasing Shift mid-drag returns to free drawing.

Expected: all of the above. Fix and re-verify before committing.

- [ ] **Step 6: Commit**

```bash
git add components/markup/DrawingTools.tsx "app/portal/[id]/page.tsx" components/markup/AnnotationCanvas.tsx components/viewers/PDFKonvaViewer.tsx
git commit -m "feat(markup): add ellipse and cloud tools with shift-constrained drawing"
```

---

### Task 11: Shift-snap the markup Transformer

**Files:**
- Create: `components/markup/useShiftKey.ts`
- Modify: `components/markup/AnnotationObjects.tsx`

**Interfaces:**
- Consumes: `ROTATION_SNAPS_DEG`, `ROTATION_SNAP_TOLERANCE_DEG` from `lib/markup/rotationSnap.ts` (Task 4).
- Produces: `useShiftKey(): boolean` — default export from `components/markup/useShiftKey.ts`. Task 12 uses it too.

- [ ] **Step 1: Write the hook**

Create `components/markup/useShiftKey.ts`:

```typescript
'use client';

import { useEffect, useState } from 'react';

/**
 * Whether Shift is currently held, for the two gestures that modify their behaviour while it
 * is: rotation snapping on the markup Transformer and on the 3D gizmo.
 *
 * Drawing does NOT use this — a draw gesture reads shiftKey off the pointer event it is
 * already handling, which is both simpler and immune to the missed-keyup problem below.
 */
export default function useShiftKey(): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') setHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') setHeld(false); };
    // A tab switch or a drag that ends over browser chrome never delivers the keyup, which
    // would otherwise leave snapping stuck on for the rest of the session.
    const clear = () => setHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, []);

  return held;
}
```

- [ ] **Step 2: Snap the Transformer**

In `components/markup/AnnotationObjects.tsx`, add the imports:

```typescript
import useShiftKey from './useShiftKey';
import { ROTATION_SNAPS_DEG, ROTATION_SNAP_TOLERANCE_DEG } from '@/lib/markup/rotationSnap';
```

Inside the component, next to the other hooks:

```typescript
  const shiftHeld = useShiftKey();
```

Extend the `<Transformer>` at the bottom of the render:

```tsx
      <Transformer
        ref={trRef}
        rotateEnabled
        keepRatio={false}
        ignoreStroke
        // Konva's rotationSnaps are ABSOLUTE angles, which is exactly the behaviour wanted:
        // Shift straightens a crooked object rather than stepping it 90 deg from wherever it
        // was. An empty array means no snapping at all.
        rotationSnaps={shiftHeld ? ROTATION_SNAPS_DEG : []}
        rotationSnapTolerance={ROTATION_SNAP_TOLERANCE_DEG}
        boundBoxFunc={(oldBox, newBox) => (newBox.width < 5 || newBox.height < 5 ? oldBox : newBox)}
      />
```

- [ ] **Step 3: Type check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Verify in a browser**

On both surfaces: draw a rectangle, select it, and drag the rotate handle. Without Shift it rotates freely. Holding Shift, it lands on 0/90/180/270 — including from an already-crooked start. Releasing Shift mid-rotation returns to free rotation.

- [ ] **Step 5: Commit**

```bash
git add components/markup/useShiftKey.ts components/markup/AnnotationObjects.tsx
git commit -m "feat(markup): shift snaps object rotation to right angles"
```

---

### Task 12: Shift-snap the 3D rotate gizmo

**Files:**
- Modify: `components/viewers/TransformGizmo.tsx`

**Interfaces:**
- Consumes: `useShiftKey` (Task 11), `snapEulerToRightAngles` from `lib/markup/rotationSnap.ts` (Task 4).

- [ ] **Step 1: Snap on every change while Shift is held**

In `components/viewers/TransformGizmo.tsx`, add the imports:

```typescript
import useShiftKey from '@/components/markup/useShiftKey';
import { snapEulerToRightAngles } from '@/lib/markup/rotationSnap';
```

Inside the component, next to the other hooks:

```typescript
  const shiftHeld = useShiftKey();
```

Add an `onObjectChange` handler to the `<TransformControls>`, immediately before the existing `onMouseDown`:

```tsx
      // Absolute snapping, applied after the control has written its own rotation for this
      // frame. three's own rotationSnap quantises the drag DELTA instead, which would step an
      // object 90 deg from wherever it started and never straighten a crooked one.
      //
      // Safe to overwrite each frame: three recomputes the rotation from the drag's start
      // quaternion every move, so this cannot accumulate.
      onObjectChange={() => {
        if (mode !== 'rotate' || !shiftHeld) return;
        const [x, y, z] = snapEulerToRightAngles([target.rotation.x, target.rotation.y, target.rotation.z]);
        target.rotation.set(x, y, z);
      }}
```

`onMouseUp` already reads the rotation off `target` to build the commit payload, so the persisted value is the snapped one with no further change.

- [ ] **Step 2: Type check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Verify in a browser**

Open a 3D file as a user who may transform the object:

- Arm Rotate, drag a gizmo ring without Shift → free rotation, as before.
- Drag with Shift → the model lands on right angles on every axis. Release, reload the page: the snapped rotation persisted.
- Open the cross-section tool, select a plane, arm Rotate, drag with Shift → the plane snaps too, and the cut updates with it.
- Orbiting still works after a gizmo drag (the existing unmount safeguards are untouched).

- [ ] **Step 4: Commit**

```bash
git add components/viewers/TransformGizmo.tsx
git commit -m "feat(viewer): shift snaps the 3D rotate gizmo to right angles"
```

---

### Task 13: Drag to erase

**Files:**
- Modify: `components/markup/AnnotationCanvas.tsx`
- Modify: `components/viewers/PDFKonvaViewer.tsx`

**Interfaces:**
- Consumes: `sweepPoints` from `lib/markup/eraseSweep.ts` (Task 6).

`stage.getIntersection` takes **container** coordinates, which is what `getPointerPosition()` returns on both surfaces — so Konva's own hit graph absorbs rotation, scale, and the PDF stage's zoom/pan. This is the one place in `PDFKonvaViewer` that must *not* convert to page coordinates first.

- [ ] **Step 1: Add the sweep to AnnotationCanvas**

In `components/markup/AnnotationCanvas.tsx`, add the import:

```typescript
import { sweepPoints } from '@/lib/markup/eraseSweep';
```

Add next to the other refs in the component:

```typescript
  // Eraser drag state. Refs, not state: this changes on every pointer move and nothing
  // renders from it.
  const erasingRef = useRef(false);
  const lastErasePointRef = useRef<{ x: number; y: number } | null>(null);

  /** Delete whatever object is under `p`, given in CONTAINER coordinates. */
  const eraseAt = (stage: Konva.Stage, p: { x: number; y: number }) => {
    const id = stage.getIntersection(p)?.id();
    // Konva returns the Transformer's own handles and any unnamed node too; only our objects
    // carry an id.
    if (id) ann.deleteObject(id);
  };

  const stopErasing = () => {
    erasingRef.current = false;
    lastErasePointRef.current = null;
  };
```

In `handleMouseDown`, replace the line `if (activeTool === 'eraser') return;` with:

```tsx
    if (activeTool === 'eraser') {
      erasingRef.current = true;
      lastErasePointRef.current = p;
      eraseAt(stage, p);
      return;
    }
```

Replace `handleMouseMove` (which Task 10 last touched):

```tsx
  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    const p = stage?.getPointerPosition();
    if (!stage || !p) return;
    if (activeTool === 'eraser') {
      if (!erasingRef.current) return;
      // Interpolated, because pointer events arrive once a frame and a quick flick would
      // otherwise jump clean over an object.
      for (const pt of sweepPoints(lastErasePointRef.current, p)) eraseAt(stage, pt);
      lastErasePointRef.current = p;
      return;
    }
    ann.moveDraw(activeTool, p, e.evt.shiftKey);
  };
```

Extend the two `<Stage>` handlers that end a gesture:

```tsx
          onMouseUp={() => { stopErasing(); if (ann.endDraw()) onObjectCreated?.(); }}
          onMouseLeave={() => { stopErasing(); if (ann.endDraw()) onObjectCreated?.(); }}
```

- [ ] **Step 2: Add the same sweep to PDFKonvaViewer**

In `components/viewers/PDFKonvaViewer.tsx`, add the import:

```typescript
import { sweepPoints } from '@/lib/markup/eraseSweep';
```

Add next to the other refs:

```typescript
    const erasingRef = useRef(false);
    const lastErasePointRef = useRef<{ x: number; y: number } | null>(null);

    /**
     * Delete whatever object is under `p`. NOTE: container coordinates, not page coordinates
     * — getIntersection walks the stage's hit graph, which already accounts for the zoom and
     * pan that getPageCoords otherwise divides out.
     */
    const eraseAt = useCallback((stage: Konva.Stage, p: { x: number; y: number }) => {
      const id = stage.getIntersection(p)?.id();
      if (id) ann.deleteObject(id);
    }, [ann]);

    const stopErasing = useCallback(() => {
      erasingRef.current = false;
      lastErasePointRef.current = null;
    }, []);
```

In `handleStageMouseDown`, replace `if (activeTool === 'eraser') return;` with:

```tsx
      if (activeTool === 'eraser') {
        const p = stage.getPointerPosition();
        if (!p) return;
        erasingRef.current = true;
        lastErasePointRef.current = p;
        eraseAt(stage, p);
        return;
      }
```

and add `eraseAt` to that callback's dependency array.

Replace `handleStageMouseMove`:

```tsx
    const handleStageMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!annotating) return;
      const stage = e.target.getStage();
      if (!stage) return;
      if (activeTool === 'eraser') {
        if (!erasingRef.current) return;
        const p = stage.getPointerPosition();
        if (!p) return;
        for (const pt of sweepPoints(lastErasePointRef.current, p)) eraseAt(stage, pt);
        lastErasePointRef.current = p;
        return;
      }
      const coords = getPageCoords(stage);
      if (coords) ann.moveDraw(activeTool as AnnTool, coords, e.evt.shiftKey);
    }, [annotating, activeTool, getPageCoords, ann, eraseAt]);
```

Extend the `<Stage>` handlers:

```tsx
              onMouseUp={() => { stopErasing(); if (ann.endDraw()) onObjectCreated?.(); }}
              onMouseLeave={() => { stopErasing(); if (ann.endDraw()) onObjectCreated?.(); }}
```

- [ ] **Step 3: Type check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Verify in a browser**

On both surfaces, draw six or seven overlapping objects of mixed types (freehand, arrow, rect, ellipse, cloud, text, an inserted image), then with the eraser:

- A single click still erases one object.
- A slow drag across several erases each as the cursor reaches it.
- A fast flick across all of them erases every one — nothing is skipped.
- Dragging off the edge of the viewport and back does not leave the eraser stuck on.
- On the PDF, zoom in and pan, then repeat: objects still erase exactly under the cursor.

- [ ] **Step 5: Commit**

```bash
git add components/markup/AnnotationCanvas.tsx components/viewers/PDFKonvaViewer.tsx
git commit -m "feat(markup): erase every object along an eraser drag"
```

---

### Task 14: Black in the colour row

**Files:**
- Modify: `components/markup/DrawingTools.tsx` (import and the swatch row)

**Interfaces:**
- Consumes: `MARKUP_COLORS` from `lib/markup/colors.ts` (Task 1).

- [ ] **Step 1: Swap the list the row renders from**

In `components/markup/DrawingTools.tsx`, replace the `PALETTE` import:

```typescript
import { MARKUP_COLORS } from '@/lib/markup/colors';
```

In the swatch row, replace `PALETTE.map((p) => {` with `MARKUP_COLORS.map((p) => {`. Nothing else in the block changes — black is an ordinary entry whose `swatch` is grey and whose `accent` is the stroke.

Update the comment above the row to say why the list differs from the comment palette:

```tsx
        {/* Swatches — sets the markup stroke to the entry's saturated accent. Rendered from
            MARKUP_COLORS, not PALETTE: black is a markup colour only, and adding it to the
            comment palette would recolour every existing comment's pin and avatar.
            No hover label: the chip is its own label, and a tooltip per colour would be six
            tooltips fighting over the same strip of viewport. */}
```

- [ ] **Step 2: Confirm PALETTE is no longer imported here but is untouched elsewhere**

Run: `grep -n "PALETTE" components/markup/DrawingTools.tsx; grep -c "" lib/commentColors.ts && grep -n "name: '" lib/commentColors.ts`
Expected: no `PALETTE` in the toolbar; `lib/commentColors.ts` still lists exactly the five original names and no black.

- [ ] **Step 3: Type check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Verify in a browser**

- The toolbar shows six chips: five pastels plus a grey one.
- Picking grey draws in black, and the grey chip shows the selected ring.
- Selecting an existing object and picking grey restyles it to black.
- Comment pins and avatars are unchanged — open a package with existing comments and confirm the colours match what they were.

- [ ] **Step 5: Commit**

```bash
git add components/markup/DrawingTools.tsx
git commit -m "feat(markup): add black to the toolbar colour row"
```

---

### Task 15: Gradient colour picker

**Files:**
- Create: `components/markup/ColorPickerPopover.tsx`
- Modify: `components/markup/DrawingTools.tsx`

**Interfaces:**
- Consumes: `hexToHsv`, `hsvToHex`, `normalizeHex`, `type HSV` from `lib/markup/color.ts` (Task 2); `isPresetColor` from `lib/markup/colors.ts` (Task 1); `BAR`, `SUB_BAR` from `./toolbarStyles`.
- Produces: `ColorPickerPopover` — default export, props `{ color: string; onChange: (hex: string) => void }`.

- [ ] **Step 1: Write the picker panel**

Create `components/markup/ColorPickerPopover.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { hexToHsv, hsvToHex, normalizeHex, type HSV } from '@/lib/markup/color';

const FALLBACK: HSV = { h: 0, s: 0, v: 0 };

/**
 * The custom colour picker, hung under the gradient chip in the toolbar.
 *
 * HSV is the state, hex is the output: a saturation/value square and a hue strip are the two
 * controls, and both are trivial to position from an HSV triple and awkward from anything
 * else. The hex field is the escape hatch for someone who already knows the colour they want.
 */
export default function ColorPickerPopover({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(color) ?? FALLBACK);
  // What is in the text field, which is NOT always a valid colour — half-typed input has to
  // survive on screen rather than being rewritten under the caret on every keystroke.
  const [hexDraft, setHexDraft] = useState(() => normalizeHex(color) ?? '#000000');
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  // Follow the toolbar when the colour changes from outside — a swatch click, or selecting an
  // object, which pulls that object's style into the toolbar.
  useEffect(() => {
    const next = hexToHsv(color);
    if (!next) return;
    setHsv(next);
    setHexDraft(normalizeHex(color) ?? '#000000');
  }, [color]);

  const emit = useCallback((next: HSV) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setHexDraft(hex);
    onChange(hex);
  }, [onChange]);

  /** Fraction of the way across and down an element, clamped to it. */
  const fractionIn = (el: HTMLElement, e: PointerEvent | React.PointerEvent) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const startDrag = (
    ref: React.RefObject<HTMLDivElement>,
    toHsv: (f: { x: number; y: number }) => HSV
  ) => (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    // Pointer capture, so a drag that leaves the small square keeps tracking rather than
    // stopping dead at the edge.
    el.setPointerCapture(e.pointerId);
    emit(toHsv(fractionIn(el, e)));
    const move = (ev: PointerEvent) => emit(toHsv(fractionIn(el, ev)));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const commitHex = () => {
    const parsed = normalizeHex(hexDraft);
    if (!parsed) {
      // Unparseable input reverts rather than silently keeping a colour nobody chose.
      setHexDraft(hsvToHex(hsv));
      return;
    }
    const next = hexToHsv(parsed);
    if (next) setHsv(next);
    setHexDraft(parsed);
    onChange(parsed);
  };

  const pureHue = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  return (
    <div className="w-[188px] rounded-sheet bg-white border border-stiko-border shadow-stiko-panel p-[10px]">
      {/* Saturation (left to right) over value (top to bottom), on the current hue. */}
      <div
        ref={svRef}
        onPointerDown={startDrag(svRef, (f) => ({ h: hsv.h, s: f.x, v: 1 - f.y }))}
        className="relative h-[112px] w-full rounded-[9px] border border-stiko-divider cursor-crosshair touch-none"
        style={{
          background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0)), ${pureHue}`,
        }}
      >
        <span
          className="pointer-events-none absolute h-[12px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(28,32,48,0.35)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }}
        />
      </div>

      <div
        ref={hueRef}
        onPointerDown={startDrag(hueRef, (f) => ({ h: f.x * 360, s: hsv.s, v: hsv.v }))}
        className="relative mt-[10px] h-[12px] w-full rounded-full border border-stiko-divider cursor-ew-resize touch-none"
        style={{
          background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
        }}
      >
        <span
          className="pointer-events-none absolute top-1/2 h-[16px] w-[16px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(28,32,48,0.35)]"
          style={{ left: `${(hsv.h / 360) * 100}%`, background: pureHue }}
        />
      </div>

      <div className="mt-[10px] flex items-center gap-[8px]">
        <span className="h-[24px] w-[24px] shrink-0 rounded-[8px] border border-stiko-divider" style={{ background: hsvToHex(hsv) }} />
        <input
          aria-label="Hex colour"
          value={hexDraft}
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitHex(); }
            // The toolbar's Delete/Backspace handler deletes the selected object. It ignores
            // events from inputs, but stopping propagation here costs nothing and makes that
            // independent of the other handler's guard.
            e.stopPropagation();
          }}
          className="h-[28px] w-full min-w-0 rounded-[8px] border border-stiko-divider bg-white px-[8px] text-[12px] text-stiko-ink outline-none focus:border-stiko-primary-light"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the chip to the toolbar**

In `components/markup/DrawingTools.tsx`, add the popover import and extend the colours import
that Task 14 added (do not add a second import from the same module):

```typescript
import ColorPickerPopover from './ColorPickerPopover';
import { MARKUP_COLORS, isPresetColor } from '@/lib/markup/colors';
```

Widen the menu state so the picker takes part in the existing one-sub-bar-at-a-time rule and its outside-click dismissal — no new machinery:

```typescript
  const [menu, setMenu] = useState<'shapes' | 'stroke' | 'picker' | null>(null);
```

Add, immediately after the closing `</div>` of the swatch row and inside the `BAR` div:

```tsx
        {/* Custom colour — last in the row. The chip carries the gradient until a colour that
            is not one of the swatches is in play, at which point it shows that colour over the
            gradient so the current pick is visible without opening the panel. */}
        <div className="relative flex">
          <button
            aria-label="Custom colour"
            aria-expanded={menu === 'picker'}
            onClick={() => setMenu(menu === 'picker' ? null : 'picker')}
            className="h-[20px] w-[20px] rounded-[7px] border border-stiko-divider transition-transform duration-150 hover:scale-[1.15]"
            style={{
              background: isPresetColor(color)
                ? 'conic-gradient(from 90deg, #ff6b6b, #ffcf2e, #7bc24a, #4a9fe0, #9a82f0, #ff6b6b)'
                : color,
              boxShadow: isPresetColor(color) ? undefined : '0 0 0 2px #fff, 0 0 0 3.5px #5B60FF',
            }}
          />
          {menu === 'picker' && (
            <div className={SUB_BAR}>
              <ColorPickerPopover color={color} onChange={onColorChange} />
            </div>
          )}
        </div>
```

- [ ] **Step 3: Type check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Verify in a browser**

- The gradient chip is the last item in the toolbar and opens a panel below it.
- Dragging in the square and on the hue strip changes the drawing colour live; the next shape drawn uses it.
- A drag that leaves the panel keeps tracking, and releasing outside does not leave a handle stuck to the cursor.
- Typing `#3d7a5c` and pressing Enter sets that colour; typing nonsense and blurring reverts.
- With an object selected, changing the colour restyles that object — and the panel's handles jump to the selected object's colour when you select a different one.
- Opening the picker closes the Shapes or Stroke sub-bar, and clicking outside dismisses it.
- Picking a preset swatch again restores the gradient on the chip.

- [ ] **Step 5: Commit**

```bash
git add components/markup/ColorPickerPopover.tsx components/markup/DrawingTools.tsx
git commit -m "feat(markup): add a custom colour picker to the toolbar"
```

---

### Task 16: Full-suite verification

**Files:** none modified unless a check fails.

- [ ] **Step 1: Run everything**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: `fail 0` from the test suite, no type errors, no new lint output, and a successful production build.

- [ ] **Step 2: Walk the spec's manual checklist end to end**

Follow the numbered list in the spec's Testing section on **both** surfaces (a 3D snapshot session and a PDF session), in one sitting, on a clean reload. Every item must pass together — several of these features share the same pointer handlers, and the failure mode worth catching is one breaking another.

Pay particular attention to the interactions between features:
- Shift-drawing an ellipse, then Shift-rotating it, then erasing it by drag.
- A custom colour applied to a cloud, which is then selected — the toolbar must show that colour on the picker chip.
- Finishing a markup session with Done and confirming the flattened snapshot contains the ellipse, cloud, and custom-coloured objects exactly as they appeared.

- [ ] **Step 3: Commit any fixes, then stop**

If nothing needed fixing there is nothing to commit. Report the result of Step 1 verbatim rather than summarising it.
