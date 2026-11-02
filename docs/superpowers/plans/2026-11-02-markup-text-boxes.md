# Markup Text Boxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Figma-style markup text. A click makes an auto-width box and a drag makes a fixed-width one. Side handles set the width, corners scale the font. A floating bar sets size, bold, italic, alignment, a soft fill and a border, and typed text matches the committed Konva text exactly.

**Architecture:**
- Pure arithmetic goes in `lib/markup/text.ts` (unit-tested): presets, clamps, gesture→box, corner/side resize, bar placement and key parsing.
- The object model (`useAnnotationObjects`) gains six text-style fields and two actions.
- A text renders as a Konva `Group` (id, transform) holding an optional fill/border `Shape` and a `Text`.
- `CanvasTextEditor` mirrors that box in DOM.
- One shared hook, `useMarkupText`, owns creation, editing, the bar's target and the shortcuts for both surfaces, so `PDFKonvaViewer` and `AnnotationCanvas` only wire it.
- `TextStyleBar` is plain DOM, positioned from the selection's on-screen rect (`useNodesScreenRect`).

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind, react-konva 18.2.14 / Konva 10.2.3, `node --test` (Node 25 type stripping).

**Spec:** `docs/superpowers/specs/2026-11-02-markup-text-boxes-design.md`

## Global Constraints

- Branch `feature/markup-text-boxes`, already checked out. Do not switch branches.
- **Never `git add -A` or `git add .`.** Add explicit paths only. Five long-lived untracked dirs (`design_handoff_*`, `logo/`, `stiko_handoff/`) must never be committed.
- `lib/markup/text.ts` has **no imports** (no React, no Konva, no `@/` alias, no relative imports) and uses only erasable TS syntax (no enums, no parameter properties). `node --test` loads it raw.
- Accent `#5B60FF` (the typing frame and the selection box).
- Fill swatches: white `#FFFFFF`, yellow `#FFF4B8`, red `#FFE0E0`, blue `#DDE8FF`, green `#DDF5E3`, grey `#EEEEEE`, plus None.
- Font size presets `12, 14, 16, 20, 24, 32, 48, 64`. Typed sizes are clamped to **6–400**.
- Padding **8** with a fill or a border, else **0**. The border is **1.5px** in the text colour.
- New text defaults: **20px, bold on, italic off, left-aligned, no fill, no border**, the current markup colour.
- A Text-tool press is a drag only when it moves **more than 4 screen px** horizontally. Otherwise it is a click and makes an auto-width box.
- One selected text: **top/bottom handles hidden**. A **corner** scales the font (keepRatio, baked into `fontSize`). A **side** sets the width (the text reflows, and auto-width becomes fixed). Mixed/multi selections keep today's group behaviour.
- Finish editing with **Esc**, **Ctrl/⌘+Enter** or a **click outside the editor and the bar**. The text stays **selected**, and blank text is discarded.
- Open editing by Pointer double-click, a **Text-tool click on an existing text**, or **Enter with exactly one text selected** (never while an input, textarea, select, contenteditable or button has focus).
- The bar shows for a text-only selection or the edited text. It is hidden during a drag or transform. Clicking it never finishes editing, starts a selection box or draws.
- The stroke-width picker is **hidden** when the toolbar's selection type is `'text'`. A `strokeWidth` patch no longer changes a text's font size, and a `color` patch still recolours text.
- **Do not change** `app/portal/[id]/page.tsx` or `components/viewers/ViewerContainer.tsx`. Everything flows through the existing `onSelectionChange` / `selectionType` / `onObjectCreated` / `applyStyleToSelection` props.
- Gates at every commit: `npx tsc --noEmit` (no output), `npm run lint` (`✔ No ESLint warnings or errors`), `npm test` (`# fail 0`).
- Browser verification: `npm run dev` cannot load pdf.js on this checkout. Use `npm run build` + `npx next start -p 3000`. If the build needs env, use the fallback `AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' R2_ACCESS_KEY_ID=dev R2_SECRET_ACCESS_KEY=dev R2_ENDPOINT_URL='https://example.invalid' R2_BUCKET_NAME=dev npm run build`. The harness route goes under `app/portal/<name>/` (no leading underscore) and static files go in `public/uploads/`. **Harness files are never committed.**
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `lib/markup/text.ts` | modify | All pure text arithmetic and constants; drops the stroke↔font ladder (Task 2) and the 40 % wrap width (Task 8) |
| `scripts/tests/markupTextBox.test.mjs` | create | Tests for the new helpers |
| `scripts/tests/markupText.test.mjs` | modify | Drop tests of removed helpers |
| `components/markup/useAnnotationObjects.ts` | modify | Text-style fields, `updateTextStyle`, `setTextWidth`, new `addText`/`bakeTextTransform`, `textOnlySelection`, `toolbarObject` |
| `components/markup/textNode.ts` | create | Konva-side text helpers: Group/box names, hit-id resolution, glyph line rects |
| `components/markup/AnnotationObjects.tsx` | modify | Text as Group + box Shape + Text; per-anchor Transformer; side-drag reflow; gesture reporting; Text-tool click edits |
| `components/markup/useMarqueeSelect.ts` | modify | Hit-test text Groups by glyphs (plain) or box (filled/bordered) |
| `components/markup/CanvasTextEditor.tsx` | rewrite | DOM mirror of the Konva box: padding, align, bold/italic, fill, border, auto-width, rotation, finish keys, swallow the finishing press |
| `components/markup/TextStyleBar.tsx` | create | The floating bar |
| `components/markup/useNodesScreenRect.ts` | create | Union on-screen rect of Konva nodes, re-measured on every layer draw |
| `components/markup/useMarkupText.ts` | create | Shared create/edit/commit/target/shortcut logic for both surfaces |
| `components/markup/AnnotationCanvas.tsx` | modify | Wire the hook, bar, drag-to-create, eraser id |
| `components/viewers/PDFKonvaViewer.tsx` | modify | Same wiring, with zoom/pan |
| `components/markup/DrawingTools.tsx` | modify | Hide the stroke picker for text |

---

### Task 1: Pure text helpers

**Files:**
- Modify: `lib/markup/text.ts` (append after `isBlank`, end of file)
- Create: `scripts/tests/markupTextBox.test.mjs`

**Interfaces:**
- Consumes: existing `MIN_FONT_SIZE` (= 6) in the same file.
- Produces (all exported from `lib/markup/text.ts`):
  - `MARKUP_ACCENT = '#5B60FF'`, `TEXT_PADDING = 8`, `TEXT_BORDER_WIDTH = 1.5`
  - `FONT_SIZE_PRESETS: readonly number[]`, `MAX_FONT_SIZE = 400`, `MIN_TEXT_WIDTH = 20`, `TEXT_DRAG_MIN_SCREEN_PX = 4`
  - `TEXT_BAR_GAP = 8`, `TEXT_BAR_ROTATER_GAP = 64`, `TEXT_BAR_MARGIN = 8`, `TEXT_BAR_TOP_INSET = 64`
  - `type TextAlign = 'left' | 'center' | 'right'`
  - `interface TextStyle { fontSize: number; bold: boolean; italic: boolean; align: TextAlign; fill: string; border: boolean }`
  - `DEFAULT_TEXT_STYLE: Readonly<TextStyle>`
  - `TEXT_FILL_SWATCHES: readonly { value: string; label: string }[]`
  - `interface RectLike { x: number; y: number; width: number; height: number }`
  - `textPadding(obj: { fill: string; border: boolean }): number`
  - `clampFontSize(n: number): number`
  - `stepFontSize(size: number, dir: 1 | -1): number`
  - `isTextDrag(box: { width: number }, minScreenPx: number, scale?: number): boolean`
  - `scaledTextOnCorner(fontSize: number, width: number, scale: number): { fontSize: number; width: number }`
  - `widthOnSideDrag(width: number, scaleX: number): number`
  - `konvaFontStyle(s: { bold: boolean; italic: boolean }): string`
  - `fontStepFromKey(e: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey?: boolean }): 1 | -1 | 0`
  - `textBoxFromGesture(start: { x: number; y: number }, end: { x: number; y: number }, scale: number, bounds: RectLike): { x: number; y: number; width: number; autoWidth: boolean }`
  - `placeTextBar(sel: RectLike, bar: { width: number; height: number }, view: { width: number; height: number }, gapAbove: number): { left: number; top: number }`

- [ ] **Step 1: Write the failing test.** Create `scripts/tests/markupTextBox.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKUP_ACCENT,
  TEXT_PADDING,
  TEXT_BORDER_WIDTH,
  FONT_SIZE_PRESETS,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_TEXT_WIDTH,
  TEXT_DRAG_MIN_SCREEN_PX,
  DEFAULT_TEXT_STYLE,
  TEXT_FILL_SWATCHES,
  TEXT_BAR_GAP,
  TEXT_BAR_ROTATER_GAP,
  TEXT_BAR_MARGIN,
  TEXT_BAR_TOP_INSET,
  textPadding,
  clampFontSize,
  stepFontSize,
  isTextDrag,
  scaledTextOnCorner,
  widthOnSideDrag,
  konvaFontStyle,
  fontStepFromKey,
  textBoxFromGesture,
  placeTextBar,
} from '../../lib/markup/text.ts';

test('the values the spec fixes', () => {
  assert.equal(MARKUP_ACCENT, '#5B60FF');
  assert.equal(TEXT_PADDING, 8);
  assert.equal(TEXT_BORDER_WIDTH, 1.5);
  assert.deepEqual([...FONT_SIZE_PRESETS], [12, 14, 16, 20, 24, 32, 48, 64]);
  assert.equal(MIN_FONT_SIZE, 6);
  assert.equal(MAX_FONT_SIZE, 400);
  assert.equal(TEXT_DRAG_MIN_SCREEN_PX, 4);
  assert.deepEqual(
    { ...DEFAULT_TEXT_STYLE },
    { fontSize: 20, bold: true, italic: false, align: 'left', fill: '', border: false },
  );
  assert.deepEqual(
    TEXT_FILL_SWATCHES.map((s) => s.value),
    ['#FFFFFF', '#FFF4B8', '#FFE0E0', '#DDE8FF', '#DDF5E3', '#EEEEEE'],
  );
  assert.deepEqual(TEXT_FILL_SWATCHES.map((s) => s.label), ['White', 'Yellow', 'Red', 'Blue', 'Green', 'Grey']);
});

test('padding only appears with a fill or a border, so plain text sits where it was typed', () => {
  assert.equal(textPadding({ fill: '', border: false }), 0);
  assert.equal(textPadding({ fill: '#FFF4B8', border: false }), 8);
  assert.equal(textPadding({ fill: '', border: true }), 8);
  assert.equal(textPadding({ fill: '#FFFFFF', border: true }), 8);
});

test('clampFontSize keeps 6..400 and turns garbage into the default', () => {
  assert.equal(clampFontSize(3), 6);
  assert.equal(clampFontSize(500), 400);
  assert.equal(clampFontSize(18), 18);
  assert.equal(clampFontSize(Number.NaN), 20);
  assert.equal(clampFontSize(Number.POSITIVE_INFINITY), 20);
});

test('stepFontSize moves to the next or previous preset, from on or off the ladder', () => {
  assert.equal(stepFontSize(20, 1), 24);
  assert.equal(stepFontSize(20, -1), 16);
  assert.equal(stepFontSize(18, 1), 20);
  assert.equal(stepFontSize(18, -1), 16);
  assert.equal(stepFontSize(8, 1), 12);
  // Past either end there is no preset to move to: stay put (clamped).
  assert.equal(stepFontSize(64, 1), 64);
  assert.equal(stepFontSize(100, 1), 100);
  assert.equal(stepFontSize(100, -1), 64);
  assert.equal(stepFontSize(12, -1), 12);
  assert.equal(stepFontSize(6, -1), 6);
});

test('isTextDrag measures the HORIZONTAL travel in screen pixels', () => {
  assert.equal(isTextDrag({ width: 4 }, 4), false);
  assert.equal(isTextDrag({ width: 5 }, 4), true);
  assert.equal(isTextDrag({ width: -5 }, 4), true);
  // 3 page px at 2x zoom is 6 screen px: a drag. At 1x it is a click.
  assert.equal(isTextDrag({ width: 3 }, 4, 2), true);
  assert.equal(isTextDrag({ width: 3 }, 4, 1), false);
});

test('a corner scales font and width together, and a clamped font drags the width back with it', () => {
  assert.deepEqual(scaledTextOnCorner(20, 200, 2), { fontSize: 40, width: 400 });
  assert.deepEqual(scaledTextOnCorner(20, 100, -1.5), { fontSize: 30, width: 150 });
  // 20 * 0.1 = 2, clamped to 6: the width follows the 0.3 the font really got.
  const shrunk = scaledTextOnCorner(20, 200, 0.1);
  assert.equal(shrunk.fontSize, 6);
  assert.ok(Math.abs(shrunk.width - 60) < 1e-9);
  const grown = scaledTextOnCorner(300, 100, 2);
  assert.equal(grown.fontSize, 400);
  assert.ok(Math.abs(grown.width - (100 * 400) / 300) < 1e-9);
  assert.equal(scaledTextOnCorner(20, 10, 1).width, MIN_TEXT_WIDTH);
});

test('a side drag scales only the width, never below the floor', () => {
  assert.equal(widthOnSideDrag(200, 1.5), 300);
  assert.equal(widthOnSideDrag(200, -0.5), 100);
  assert.equal(widthOnSideDrag(200, 0.01), MIN_TEXT_WIDTH);
});

test('konvaFontStyle builds the fontStyle string Konva expects', () => {
  assert.equal(konvaFontStyle({ bold: false, italic: false }), 'normal');
  assert.equal(konvaFontStyle({ bold: true, italic: false }), 'bold');
  assert.equal(konvaFontStyle({ bold: false, italic: true }), 'italic');
  assert.equal(konvaFontStyle({ bold: true, italic: true }), 'italic bold');
});

test('fontStepFromKey: Cmd/Ctrl+Shift+> and < only', () => {
  const k = (o) => ({ key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o });
  assert.equal(fontStepFromKey(k({ key: '>', metaKey: true, shiftKey: true })), 1);
  assert.equal(fontStepFromKey(k({ key: '<', ctrlKey: true, shiftKey: true })), -1);
  // Layouts that report the unshifted key still carry the physical code.
  assert.equal(fontStepFromKey(k({ key: '.', code: 'Period', metaKey: true, shiftKey: true })), 1);
  assert.equal(fontStepFromKey(k({ key: ',', code: 'Comma', ctrlKey: true, shiftKey: true })), -1);
  assert.equal(fontStepFromKey(k({ key: '>', metaKey: true })), 0);
  assert.equal(fontStepFromKey(k({ key: '>', shiftKey: true })), 0);
  assert.equal(fontStepFromKey(k({ key: '>', metaKey: true, shiftKey: true, altKey: true })), 0);
  assert.equal(fontStepFromKey(k({ key: 'a', metaKey: true, shiftKey: true })), 0);
});

test('textBoxFromGesture: a click makes an auto-width box at the press', () => {
  const page = { x: 0, y: 0, width: 1000, height: 800 };
  assert.deepEqual(textBoxFromGesture({ x: 100, y: 50 }, { x: 102, y: 51 }, 1, page), { x: 100, y: 50, width: 0, autoWidth: true });
  // Too close to the right edge: pulled in so at least MIN_TEXT_WIDTH stays on the surface.
  assert.deepEqual(textBoxFromGesture({ x: 995, y: 50 }, { x: 995, y: 50 }, 1, page), { x: 980, y: 50, width: 0, autoWidth: true });
  // Left of an inset surface (AnnotationCanvas's fitted background): pushed onto it.
  assert.deepEqual(
    textBoxFromGesture({ x: 10, y: 10 }, { x: 10, y: 10 }, 1, { x: 50, y: 0, width: 500, height: 500 }),
    { x: 50, y: 10, width: 0, autoWidth: true },
  );
});

test('textBoxFromGesture: a drag makes a fixed box as wide as the drag, in either direction', () => {
  const page = { x: 0, y: 0, width: 1000, height: 800 };
  assert.deepEqual(textBoxFromGesture({ x: 100, y: 50 }, { x: 300, y: 120 }, 1, page), { x: 100, y: 50, width: 200, autoWidth: false });
  assert.deepEqual(textBoxFromGesture({ x: 300, y: 120 }, { x: 100, y: 50 }, 1, page), { x: 100, y: 50, width: 200, autoWidth: false });
  // Off the right edge: clipped to the surface.
  assert.deepEqual(textBoxFromGesture({ x: 900, y: 10 }, { x: 1100, y: 40 }, 1, page), { x: 900, y: 10, width: 100, autoWidth: false });
  // The threshold is in SCREEN px: 3 page px is a click at 1x and a drag at 2x (floored to MIN_TEXT_WIDTH).
  assert.equal(textBoxFromGesture({ x: 100, y: 50 }, { x: 103, y: 50 }, 1, page).autoWidth, true);
  assert.deepEqual(textBoxFromGesture({ x: 100, y: 50 }, { x: 103, y: 50 }, 2, page), { x: 100, y: 50, width: MIN_TEXT_WIDTH, autoWidth: false });
});

test('placeTextBar: centred above, dropping below when there is no room, clamped to the view', () => {
  const view = { width: 800, height: 600 };
  const bar = { width: 300, height: 36 };
  assert.equal(TEXT_BAR_GAP, 8);
  assert.equal(TEXT_BAR_ROTATER_GAP, 64);
  assert.equal(TEXT_BAR_MARGIN, 8);
  assert.equal(TEXT_BAR_TOP_INSET, 64);
  assert.deepEqual(placeTextBar({ x: 300, y: 300, width: 200, height: 50 }, bar, view, TEXT_BAR_GAP), { left: 250, top: 256 });
  // A selection shows the rotate handle above it: the bar clears it.
  assert.deepEqual(placeTextBar({ x: 300, y: 300, width: 200, height: 50 }, bar, view, TEXT_BAR_ROTATER_GAP), { left: 250, top: 200 });
  // Above would land under the main toolbar's band: go below, at the plain gap.
  assert.deepEqual(placeTextBar({ x: 300, y: 80, width: 200, height: 50 }, bar, view, TEXT_BAR_GAP), { left: 250, top: 138 });
  assert.equal(placeTextBar({ x: 0, y: 300, width: 20, height: 20 }, bar, view, TEXT_BAR_GAP).left, 8);
  assert.equal(placeTextBar({ x: 780, y: 300, width: 20, height: 20 }, bar, view, TEXT_BAR_GAP).left, 492);
  assert.equal(placeTextBar({ x: 300, y: 40, width: 200, height: 600 }, bar, view, TEXT_BAR_GAP).top, 556);
  // A view narrower than the bar pins it to the left margin rather than off-screen.
  assert.equal(placeTextBar({ x: 50, y: 300, width: 20, height: 20 }, bar, { width: 200, height: 600 }, TEXT_BAR_GAP).left, 8);
});
```

- [ ] **Step 2: Run it to make sure it fails.**

Run: `node --test scripts/tests/markupTextBox.test.mjs`
Expected: FAIL with `SyntaxError: The requested module '../../lib/markup/text.ts' does not provide an export named 'DEFAULT_TEXT_STYLE'` (or whichever missing export is reported first).

- [ ] **Step 3: Implement.** Append to the end of `lib/markup/text.ts`, after `isBlank`:

```ts

/** The selection / editing accent. The same colour as the selection box in AnnotationObjects. */
export const MARKUP_ACCENT = '#5B60FF';

/** Inset between a text box's edge and its glyphs, when the box has a fill or a border. */
export const TEXT_PADDING = 8;

/** A text box's border: this wide, in the text's own colour, centred on the box edge. */
export const TEXT_BORDER_WIDTH = 1.5;

/** The floating bar's size presets, small to large. Also the steps of Cmd/Ctrl+Shift+> and <. */
export const FONT_SIZE_PRESETS: readonly number[] = [12, 14, 16, 20, 24, 32, 48, 64];

export const MAX_FONT_SIZE = 400;

/** A fixed-width box narrower than this would wrap every character onto its own line. */
export const MIN_TEXT_WIDTH = 20;

/** A Text-tool press that travels at most this far, in SCREEN px, is a click: an auto-width box. */
export const TEXT_DRAG_MIN_SCREEN_PX = 4;

/** Gap between the floating bar and the box it styles. */
export const TEXT_BAR_GAP = 8;

/**
 * The gap above a SELECTED text. Konva's Transformer puts its rotate handle 50px above the box
 * (rotateAnchorOffset) with a 10px anchor, so a bar at the plain gap would sit on top of the
 * handle and swallow every attempt to rotate. While editing there is no Transformer, so the bar
 * can come in close.
 */
export const TEXT_BAR_ROTATER_GAP = 64;

/** The bar never comes closer than this to the viewer's edges. */
export const TEXT_BAR_MARGIN = 8;

/**
 * The main markup toolbar floats over the top ~58px of every viewer. A bar that would rise into
 * that band drops below the text instead.
 */
export const TEXT_BAR_TOP_INSET = 64;

export type TextAlign = 'left' | 'center' | 'right';

/** Everything the floating bar edits on a text object. */
export interface TextStyle {
  fontSize: number;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  /** A CSS colour, or '' for no fill. */
  fill: string;
  border: boolean;
}

export const DEFAULT_TEXT_STYLE: Readonly<TextStyle> = {
  fontSize: 20,
  bold: true,
  italic: false,
  align: 'left',
  fill: '',
  border: false,
};

/** Soft callout fills. 'None' is the empty string and is not listed here. */
export const TEXT_FILL_SWATCHES: readonly { value: string; label: string }[] = [
  { value: '#FFFFFF', label: 'White' },
  { value: '#FFF4B8', label: 'Yellow' },
  { value: '#FFE0E0', label: 'Red' },
  { value: '#DDE8FF', label: 'Blue' },
  { value: '#DDF5E3', label: 'Green' },
  { value: '#EEEEEE', label: 'Grey' },
];

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 8 with a fill or a border; 0 otherwise, so a plain text sits exactly where it was typed. */
export function textPadding(obj: { fill: string; border: boolean }): number {
  return obj.fill || obj.border ? TEXT_PADDING : 0;
}

/** Any number into 6..400. Not-a-number (an emptied size field) means the default size. */
export function clampFontSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TEXT_STYLE.fontSize;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, n));
}

/**
 * The next preset above (dir 1) or below (dir -1) `size`. Strictly above/below, so an on-ladder
 * size always moves; past either end there is nothing to move to and the size stays.
 */
export function stepFontSize(size: number, dir: 1 | -1): number {
  if (dir > 0) {
    for (const p of FONT_SIZE_PRESETS) if (p > size) return p;
  } else {
    for (let i = FONT_SIZE_PRESETS.length - 1; i >= 0; i--) {
      if (FONT_SIZE_PRESETS[i] < size) return FONT_SIZE_PRESETS[i];
    }
  }
  return clampFontSize(size);
}

/**
 * Whether a Text-tool press became a drag. Horizontal travel only: the box's width is the one
 * thing a drag sets (its height always fits the text), so a vertical-only drag means nothing
 * and stays a click. `box` is in drawing units and `scale` is screen px per drawing unit.
 */
export function isTextDrag(box: { width: number }, minScreenPx: number, scale = 1): boolean {
  return Math.abs(box.width) * scale > minScreenPx;
}

/**
 * A corner drag: the font scales and is baked in, and the wrap width scales by what the font
 * ACTUALLY got. Using the raw factor would let a clamped font leave the width racing ahead of it.
 */
export function scaledTextOnCorner(fontSize: number, width: number, scale: number): { fontSize: number; width: number } {
  const s = Math.abs(scale);
  const next = clampFontSize(fontSize * s);
  const k = fontSize > 0 ? next / fontSize : s;
  return { fontSize: next, width: Math.max(MIN_TEXT_WIDTH, width * k) };
}

/** A side drag: only the width changes. */
export function widthOnSideDrag(width: number, scaleX: number): number {
  return Math.max(MIN_TEXT_WIDTH, width * Math.abs(scaleX));
}

/** Konva's `fontStyle` attribute. Konva puts it first in the canvas font shorthand, where style and weight may come in either order. */
export function konvaFontStyle(s: { bold: boolean; italic: boolean }): string {
  if (s.bold && s.italic) return 'italic bold';
  if (s.bold) return 'bold';
  if (s.italic) return 'italic';
  return 'normal';
}

/**
 * Cmd/Ctrl+Shift+> is +1 and Cmd/Ctrl+Shift+< is -1; anything else is 0. `code` covers layouts
 * whose `key` reports the unshifted '.' / ','.
 */
export function fontStepFromKey(e: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}): 1 | -1 | 0 {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return 0;
  if (e.key === '>' || e.key === '.' || e.code === 'Period') return 1;
  if (e.key === '<' || e.key === ',' || e.code === 'Comma') return -1;
  return 0;
}

/**
 * Where a Text-tool press puts its box, in drawing units. A click is an auto-width box at the
 * press, kept on the surface; a drag is a fixed box as wide as the drag (either direction),
 * clipped to the surface. `scale` is screen px per drawing unit (the threshold is in screen px).
 */
export function textBoxFromGesture(
  start: { x: number; y: number },
  end: { x: number; y: number },
  scale: number,
  bounds: RectLike,
): { x: number; y: number; width: number; autoWidth: boolean } {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const maxX = bounds.x + bounds.width;
  if (!isTextDrag({ width: right - left }, TEXT_DRAG_MIN_SCREEN_PX, scale)) {
    // The box grows rightwards as you type, so all that can be kept on the surface is its origin.
    return { x: Math.max(bounds.x, Math.min(start.x, maxX - MIN_TEXT_WIDTH)), y: start.y, width: 0, autoWidth: true };
  }
  const l = Math.max(bounds.x, left);
  const width = Math.max(MIN_TEXT_WIDTH, Math.min(maxX, right) - l);
  return { x: Math.max(bounds.x, Math.min(l, maxX - width)), y: Math.min(start.y, end.y), width, autoWidth: false };
}

/**
 * The floating bar's top-left, in the viewer's own pixels. It is centred over the selection,
 * `gapAbove` above it, and drops below (at TEXT_BAR_GAP) when above would rise into the top
 * toolbar band. It is then clamped inside the view.
 */
export function placeTextBar(
  sel: RectLike,
  bar: { width: number; height: number },
  view: { width: number; height: number },
  gapAbove: number,
): { left: number; top: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
  const left = clamp(sel.x + sel.width / 2 - bar.width / 2, TEXT_BAR_MARGIN, view.width - bar.width - TEXT_BAR_MARGIN);
  const above = sel.y - gapAbove - bar.height;
  const top = above >= TEXT_BAR_TOP_INSET ? above : sel.y + sel.height + TEXT_BAR_GAP;
  return { left, top: clamp(top, TEXT_BAR_MARGIN, view.height - bar.height - TEXT_BAR_MARGIN) };
}
```

- [ ] **Step 4: Run the tests and make sure they pass.**

Run: `node --test scripts/tests/markupTextBox.test.mjs`
Expected: `# pass 12` `# fail 0`.

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc prints nothing; lint prints `✔ No ESLint warnings or errors`; tests end `# fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add lib/markup/text.ts scripts/tests/markupTextBox.test.mjs
git commit -m "$(cat <<'EOF'
feat(markup): pure helpers for Figma-style text boxes

Presets, clamps, click-vs-drag box, corner/side resize, bar placement and the
font-step shortcut, all unit-tested and free of React and Konva.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Text style in the object model

**Files:**
- Modify: `components/markup/useAnnotationObjects.ts` (full replacement below)
- Modify: `lib/markup/text.ts` (remove the stroke↔font ladder)
- Modify: `scripts/tests/markupText.test.mjs` (full replacement below)
- Modify: `components/markup/AnnotationCanvas.tsx` (the `addText` call and one import)
- Modify: `components/viewers/PDFKonvaViewer.tsx` (the `addText` call and one import)

**Interfaces:**
- Consumes (Task 1): `DEFAULT_TEXT_STYLE`, `MIN_TEXT_WIDTH`, `clampFontSize`, `scaledTextOnCorner`, `widthOnSideDrag`, `TextAlign`, `TextStyle`.
- Produces:
  - `AnnotationObject` gains `bold: boolean; italic: boolean; align: TextAlign; fill: string; border: boolean; autoWidth: boolean`. For a text, `width` is the box's OUTER width (padding included), and it is ignored while `autoWidth` is set.
  - `addText(p: { x: number; y: number }, opts: { text?: string; color: string; strokeWidth: number; width: number; autoWidth: boolean }): string`. It is always created at `DEFAULT_TEXT_STYLE`.
  - `updateTextStyle(ids: readonly string[], patch: Partial<TextStyle>): void`. It touches text objects only, and `fontSize` is clamped.
  - `setTextWidth(id: string, width: number): void`. It sets `width` (floored at `MIN_TEXT_WIDTH`) and clears `autoWidth`.
  - `bakeTextTransform(id, t)` has the same signature as before, now via `scaledTextOnCorner` / `widthOnSideDrag`. An auto-width text keeps `autoWidth`.
  - `applyStyle` / `applyStyleToSelected`: `strokeWidth` is ignored on text. `color` still applies.
  - `textOnlySelection: boolean` is true when there is at least one selected object and every selected object is text.
  - `toolbarObject: AnnotationObject | null` is the object the toolbar should reflect. That is the primary, unless the selection mixes text with other objects, in which case it is the first non-text member.
  - Removed from `lib/markup/text.ts`: `STROKE_PRESETS`, `FONT_SIZES`, `fontSizeForStrokeWidth`, `strokeWidthForFontSize`.

- [ ] **Step 1: Replace `components/markup/useAnnotationObjects.ts`** with:

```ts
'use client';

import { useState, useRef, useCallback } from 'react';
import {
  DEFAULT_TEXT_STYLE,
  MIN_TEXT_WIDTH,
  clampFontSize,
  scaledTextOnCorner,
  widthOnSideDrag,
  type TextAlign,
  type TextStyle,
} from '@/lib/markup/text';
import { startGeometry, updateGeometry, isBoxTool, type DraftTool } from '@/lib/markup/draft';
import { pickId, mergeSelection } from '@/lib/markup/selection';

export type AnnotationObjectType = 'freehand' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloud' | 'text' | 'image';
export type AnnTool = 'pointer' | 'freehand' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloud' | 'text' | 'eraser';

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

export interface AnnotationObject {
  id: string;
  type: AnnotationObjectType;
  points: number[];               // freehand/line/arrow (flat [x,y,...], in object space)
  x: number; y: number;           // rect/text origin; drag offset for all types
  width: number; height: number;  // rect; on text, the box's OUTER width (ignored while autoWidth)
  text: string; fontSize: number; // text
  // Text style (the floating bar). Non-text objects carry DEFAULT_TEXT_STYLE's values and never
  // read them, so every object has one shape.
  bold: boolean; italic: boolean; align: TextAlign;
  fill: string;                   // '' = no fill
  border: boolean;
  autoWidth: boolean;             // no wrapping; the box hugs its longest line
  src: string;                    // image
  rotation: number; scaleX: number; scaleY: number;
  color: string; strokeWidth: number;
}

/** What a surface reports upward about its selection, so the toolbar can reflect it. */
export interface MarkupSelection {
  type: AnnotationObjectType;
  color: string;
  strokeWidth: number;
}

const GESTURE_TOOLS = new Set<AnnTool>(['freehand', 'line', 'arrow', 'rect', 'ellipse', 'cloud']);

export function useAnnotationObjects() {
  const [objects, setObjects] = useState<AnnotationObject[]>([]);
  const [draft, setDraft] = useState<AnnotationObject | null>(null);
  // Ordered; the first id is the "primary" the toolbar reflects. A list rather than one id so
  // Shift+click and the selection box can hold several objects at once.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedId = selectedIds[0] ?? null;
  /** Replace the selection with one object, or clear it. The single-object API every caller had. */
  const setSelectedId = useCallback((id: string | null) => setSelectedIds(id ? [id] : []), []);
  /** A press on an object with the Pointer: see pickId. */
  const pick = useCallback((id: string, additive: boolean) => setSelectedIds((ids) => pickId(ids, id, additive)), []);
  /** The selection box's hits: see mergeSelection. */
  const selectMany = useCallback((ids: string[], additive: boolean) => setSelectedIds((cur) => mergeSelection(cur, ids, additive)), []);
  const idRef = useRef(0);
  const draftRef = useRef<AnnotationObject | null>(null);

  const base = (type: AnnotationObjectType, color: string, strokeWidth: number): AnnotationObject => ({
    id: `obj-${idRef.current++}`, type, points: [], x: 0, y: 0, width: 0, height: 0,
    text: '', fontSize: DEFAULT_TEXT_STYLE.fontSize,
    bold: DEFAULT_TEXT_STYLE.bold, italic: DEFAULT_TEXT_STYLE.italic, align: DEFAULT_TEXT_STYLE.align,
    fill: DEFAULT_TEXT_STYLE.fill, border: DEFAULT_TEXT_STYLE.border, autoWidth: false,
    src: '', rotation: 0, scaleX: 1, scaleY: 1, color, strokeWidth,
  });

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

  const endDraw = useCallback((): string | null => {
    const d = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!d) return null;
    const valid = d.type === 'freehand' ? d.points.length > 2
      : isBoxTool(d.type) ? Math.abs(d.width) > 3 && Math.abs(d.height) > 3
      : (d.type === 'line' || d.type === 'arrow') ? Math.hypot(d.points[2] - d.points[0], d.points[3] - d.points[1]) > 3
      : true;
    if (!valid) return null;
    let obj = d;
    if (isBoxTool(d.type)) {
      obj = { ...d, x: Math.min(d.x, d.x + d.width), y: Math.min(d.y, d.y + d.height), width: Math.abs(d.width), height: Math.abs(d.height) };
    }
    setObjects((prev) => [...prev, obj]);
    setSelectedIds([obj.id]);
    return obj.id;
  }, []);

  /**
   * Creates the text object *before* anything is typed, so the editor can be bound to a real
   * object and every keystroke can write through to it. That is what puts the text where it
   * will land rather than in a popup somewhere else — and it is why this no longer rejects
   * empty text. Discarding a blank box is the caller's job, on commit.
   *
   * Always at DEFAULT_TEXT_STYLE: the size lives in the floating bar now, not in the toolbar's
   * stroke width. `strokeWidth` is stored only so a selected text reports something sane to the
   * toolbar; nothing draws with it.
   */
  const addText = useCallback(
    (p: { x: number; y: number }, opts: { text?: string; color: string; strokeWidth: number; width: number; autoWidth: boolean }): string => {
      const o = base('text', opts.color, opts.strokeWidth);
      o.x = p.x;
      o.y = p.y;
      o.text = opts.text ?? '';
      o.autoWidth = opts.autoWidth;
      o.width = opts.autoWidth ? 0 : Math.max(MIN_TEXT_WIDTH, opts.width);
      setObjects((prev) => [...prev, o]);
      setSelectedIds([o.id]);
      return o.id;
    },
    []
  );

  const addImage = useCallback((p: { x: number; y: number }, src: string, width: number, height: number) => {
    const o = base('image', '#000000', 0);
    o.x = p.x; o.y = p.y; o.src = src; o.width = width; o.height = height;
    setObjects((prev) => [...prev, o]);
    setSelectedIds([o.id]);
    return o.id;
  }, []);

  const updateObject = useCallback((id: string, patch: Partial<AnnotationObject>) => {
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }, []);

  /** Write-through from the text editor. Separate from updateObject so the editor cannot
   *  accidentally clobber geometry it does not own. */
  const updateText = useCallback((id: string, text: string) => {
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, text } : o)));
  }, []);

  /**
   * Restyle an existing object from the main toolbar. A colour recolours anything but an image.
   * A stroke width means nothing to a text (its size is the floating bar's) or to an image.
   */
  const applyStyle = useCallback((id: string, patch: { color?: string; strokeWidth?: number }) => {
    setObjects((prev) =>
      prev.map((o) => {
        if (o.id !== id || o.type === 'image') return o;
        const next = { ...o };
        if (patch.color !== undefined) next.color = patch.color;
        if (patch.strokeWidth !== undefined && o.type !== 'text') next.strokeWidth = patch.strokeWidth;
        return next;
      })
    );
  }, []);

  /** Restyle every selected object (see applyStyle for what each type takes). */
  const applyStyleToSelected = useCallback((patch: { color?: string; strokeWidth?: number }) => {
    for (const id of selectedIds) applyStyle(id, patch);
  }, [selectedIds, applyStyle]);

  /**
   * The floating text bar. Text objects only — an id of anything else is skipped, so a caller
   * can pass a whole selection. Field by field rather than a spread, so a patch carrying an
   * explicit `undefined` cannot blank a field.
   */
  const updateTextStyle = useCallback((ids: readonly string[], patch: Partial<TextStyle>) => {
    const want = new Set(ids);
    setObjects((prev) =>
      prev.map((o) => {
        if (!want.has(o.id) || o.type !== 'text') return o;
        const next = { ...o };
        if (patch.fontSize !== undefined) next.fontSize = clampFontSize(patch.fontSize);
        if (patch.bold !== undefined) next.bold = patch.bold;
        if (patch.italic !== undefined) next.italic = patch.italic;
        if (patch.align !== undefined) next.align = patch.align;
        if (patch.fill !== undefined) next.fill = patch.fill;
        if (patch.border !== undefined) next.border = patch.border;
        return next;
      })
    );
  }, []);

  /** A side-handle drag: the box is now this wide and wraps. An auto-width box becomes fixed. */
  const setTextWidth = useCallback((id: string, width: number) => {
    setObjects((prev) =>
      prev.map((o) => (o.id === id && o.type === 'text' ? { ...o, width: Math.max(MIN_TEXT_WIDTH, width), autoWidth: false } : o))
    );
  }, []);

  /**
   * Folds a text object's transform scale into its font size and wrap width, resetting the
   * scale to 1, so a stored scale can never multiply against a size set from the bar later.
   *
   * Corner drags (keepRatio) and even group scales arrive with scaleX === scaleY: the font and
   * width scale together. A group's SIDE anchor stretches one axis only (Konva ignores keepRatio
   * there), and the wrap width then follows the horizontal scale on its own. An auto-width text
   * has no wrap width to scale: it re-measures around its new font size.
   */
  const bakeTextTransform = useCallback(
    (id: string, t: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }) => {
      setObjects((prev) =>
        prev.map((o) => {
          if (o.id !== id) return o;
          const sx = Math.abs(t.scaleX) || 1;
          const sy = Math.abs(t.scaleY) || 1;
          const corner = scaledTextOnCorner(o.fontSize, o.width, sy);
          const width = o.autoWidth ? o.width : Math.abs(sx - sy) < 1e-3 ? corner.width : widthOnSideDrag(o.width, sx);
          return {
            ...o,
            x: t.x,
            y: t.y,
            rotation: t.rotation,
            scaleX: 1,
            scaleY: 1,
            fontSize: corner.fontSize,
            width,
          };
        })
      );
    },
    []
  );

  const deleteObject = useCallback((id: string) => {
    setObjects((prev) => prev.filter((o) => o.id !== id));
    setSelectedIds((ids) => ids.filter((i) => i !== id));
  }, []);

  /** Delete every selected object. */
  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    const drop = new Set(selectedIds);
    setObjects((prev) => prev.filter((o) => !drop.has(o.id)));
    setSelectedIds([]);
  }, [selectedIds]);

  const clear = useCallback(() => {
    setObjects([]); setDraft(null); setSelectedIds([]); draftRef.current = null;
  }, []);

  const hasObjects = useCallback(() => objects.length > 0, [objects]);

  // Derived rather than stored, so it can never disagree with `objects`. Consumers must depend
  // on its FIELDS, not its identity — `find` returns a fresh reference on every render.
  const selectedObject = objects.find((o) => o.id === selectedId) ?? null;

  const selectedObjects = selectedIds
    .map((id) => objects.find((o) => o.id === id))
    .filter((o): o is AnnotationObject => !!o);
  /** Selected, and every selected object is a text: the floating bar's case. */
  const textOnlySelection = selectedObjects.length > 0 && selectedObjects.every((o) => o.type === 'text');
  /**
   * What the main toolbar reflects. The primary — unless the selection mixes text with other
   * objects, when it is the first non-text member: the toolbar hides its stroke picker for
   * 'text', and in a mixed selection that picker still has shapes to restyle. Same identity rule
   * as selectedObject: depend on its fields.
   */
  const toolbarObject = textOnlySelection ? selectedObject : selectedObjects.find((o) => o.type !== 'text') ?? null;

  return {
    objects, draft, selectedIds, selectedId, setSelectedId, pick, selectMany, selectedObject,
    textOnlySelection, toolbarObject,
    startDraw, moveDraw, endDraw, addText, addImage,
    updateObject, updateText, applyStyle, applyStyleToSelected, bakeTextTransform,
    updateTextStyle, setTextWidth,
    deleteObject, deleteSelected, clear, hasObjects,
  };
}
```

- [ ] **Step 2: Update the two `addText` callers.** In `components/markup/AnnotationCanvas.tsx`, replace

```ts
import { fontSizeForStrokeWidth, wrapWidthForContent, isBlank } from '@/lib/markup/text';
```

with

```ts
import { wrapWidthForContent, isBlank } from '@/lib/markup/text';
```

and replace the line

```ts
        fontSize: fontSizeForStrokeWidth(strokeWidth),
```

with

```ts
        strokeWidth,
        autoWidth: false,
```

In `components/viewers/PDFKonvaViewer.tsx`, replace

```ts
import { fontSizeForStrokeWidth, wrapWidthForContent, isBlank } from '@/lib/markup/text';
```

with

```ts
import { wrapWidthForContent, isBlank } from '@/lib/markup/text';
```

and replace the line

```ts
          fontSize: fontSizeForStrokeWidth(strokeWidth),
```

with

```ts
          strokeWidth,
          autoWidth: false,
```

(Both surfaces still create a fixed 40 %-of-content box here. Task 7 and Task 8 replace this with click/drag creation.)

- [ ] **Step 3: Remove the ladder from `lib/markup/text.ts`.** Replace this block:

```ts
/** Toolbar stroke presets, thin to thick. Index-aligned with FONT_SIZES. */
export const STROKE_PRESETS: readonly number[] = [2, 4, 6];

/** What each stroke preset means for a text object. Index-aligned with STROKE_PRESETS. */
export const FONT_SIZES: readonly number[] = [16, 24, 34];

/** A text box narrower than this is not worth typing in, whatever the content width says. */
export const MIN_WRAP_WIDTH = 120;

/** A resize handle dragged to nothing must still leave something selectable. */
export const MIN_FONT_SIZE = 6;

/** Fraction of the content width a fresh text box wraps at. */
const WRAP_FRACTION = 0.4;

/**
 * Index of the entry in `ladder` nearest to `value`.
 *
 * Ties resolve to the earlier (smaller) entry, because `<` rather than `<=` means a later
 * entry has to be strictly closer to win. That determinism matters: `strokeWidthForFontSize`
 * is fed continuous sizes from a manual resize, and a toolbar chip that flickered between two
 * presets for the same object would look like a bug.
 */
function nearestIndex(ladder: readonly number[], value: number): number {
  let best = 0;
  for (let i = 1; i < ladder.length; i++) {
    if (Math.abs(ladder[i] - value) < Math.abs(ladder[best] - value)) best = i;
  }
  return best;
}

/** Toolbar stroke width -> text font size. Off-ladder widths clamp to the nearest preset. */
export function fontSizeForStrokeWidth(strokeWidth: number): number {
  return FONT_SIZES[nearestIndex(STROKE_PRESETS, strokeWidth)];
}

/** Text font size -> the toolbar stroke preset that should read as active. */
export function strokeWidthForFontSize(fontSize: number): number {
  return STROKE_PRESETS[nearestIndex(FONT_SIZES, fontSize)];
}
```

with:

```ts
/** A text box narrower than this is not worth typing in, whatever the content width says. */
export const MIN_WRAP_WIDTH = 120;

/** A resize handle dragged to nothing must still leave something selectable. */
export const MIN_FONT_SIZE = 6;

/** Fraction of the content width a fresh text box wraps at. */
const WRAP_FRACTION = 0.4;
```

- [ ] **Step 4: Replace `scripts/tests/markupText.test.mjs`** with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FONT_SIZE_PRESETS,
  MIN_WRAP_WIDTH,
  MIN_FONT_SIZE,
  wrapWidthForContent,
  isBlank,
} from '../../lib/markup/text.ts';

test('wrap width is 40% of the content', () => {
  assert.equal(wrapWidthForContent(1000), 400);
  assert.equal(wrapWidthForContent(2000), 800);
});

test('wrap width never falls below the floor, so a narrow page is still typable', () => {
  // 40% of 200 is 80, under the floor — but 200 itself is over it, so the floor is what wins.
  // Content must be wider than MIN_WRAP_WIDTH here, or the clamp below takes precedence and
  // this asserts nothing about the floor.
  const content = MIN_WRAP_WIDTH * 2;
  assert.ok(content * 0.4 < MIN_WRAP_WIDTH, 'test setup: 40% must fall under the floor');
  assert.equal(wrapWidthForContent(content), MIN_WRAP_WIDTH);
});

test('the clamp to content beats the floor, so the box never exceeds the page', () => {
  // Content narrower than the floor. The floor must not push the box wider than the page it
  // sits on, so this returns the content width rather than MIN_WRAP_WIDTH.
  const narrow = MIN_WRAP_WIDTH - 20;
  assert.equal(wrapWidthForContent(narrow), narrow);
});

test('an unmeasured container yields the floor rather than a zero-width box', () => {
  // Both surfaces render before their ResizeObserver has fired at least once.
  assert.equal(wrapWidthForContent(0), MIN_WRAP_WIDTH);
  assert.equal(wrapWidthForContent(-5), MIN_WRAP_WIDTH);
});

test('blank text is anything with no visible glyphs', () => {
  assert.equal(isBlank(''), true);
  assert.equal(isBlank('   '), true);
  assert.equal(isBlank('\n\n'), true);
  assert.equal(isBlank(' \t \n '), true);
  assert.equal(isBlank('a'), false);
  assert.equal(isBlank('  hi  '), false);
});

test('MIN_FONT_SIZE keeps a shrunk text object selectable', () => {
  assert.ok(MIN_FONT_SIZE > 0);
  assert.ok(MIN_FONT_SIZE <= FONT_SIZE_PRESETS[0]);
});
```

- [ ] **Step 5: Gate.**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc prints nothing; `✔ No ESLint warnings or errors`; `# fail 0`.
If tsc reports `fontSizeForStrokeWidth` anywhere, a caller was missed: `grep -rn "fontSizeForStrokeWidth\|strokeWidthForFontSize" app components lib scripts` must print nothing.

- [ ] **Step 6: Commit.**

```bash
git add components/markup/useAnnotationObjects.ts lib/markup/text.ts scripts/tests/markupText.test.mjs components/markup/AnnotationCanvas.tsx components/viewers/PDFKonvaViewer.tsx
git commit -m "$(cat <<'EOF'
feat(markup): text style fields and actions in the object model

Bold/italic/align/fill/border/autoWidth on every object, updateTextStyle,
setTextWidth, corner/side-aware baking, and a toolbarObject that skips text in
mixed selections. A stroke width no longer resizes text.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Text renders as Group + box + Text, with per-anchor resizing

**Files:**
- Create: `components/markup/textNode.ts`
- Modify: `components/markup/AnnotationObjects.tsx` (full replacement below)
- Modify: `components/markup/useMarqueeSelect.ts` (the text special case)
- Modify: `components/markup/AnnotationCanvas.tsx` (eraser id, `onSetTextWidth`)
- Modify: `components/viewers/PDFKonvaViewer.tsx` (eraser id, `onSetTextWidth`)

**Interfaces:**
- Consumes (Tasks 1–2): `TEXT_BORDER_WIDTH`, `TEXT_FONT_FAMILY`, `konvaFontStyle`, `textPadding`, `widthOnSideDrag`. The `AnnotationObject` text fields. `ann.setTextWidth`.
- Produces:
  - `textNode.ts`: `TEXT_GROUP_NAME = 'markup-text'`, `TEXT_BOX_NAME = 'markup-text-box'`, `hitObjectId(shape: Konva.Node | null | undefined): string`, `textOf(node: Konva.Node): Konva.Text | null`, `glyphLineRects(t: Konva.Text): { x: number; y: number; width: number; height: number }[]`, `glyphSpan(t: Konva.Text): { x: number; width: number }`.
  - `AnnotationObjects` new optional props: `onSetTextWidth?: (id: string, width: number) => void` and `onGestureChange?: (active: boolean) => void` (true on drag/transform start, false on end). `onEditText` now also fires for a Text-tool press on an existing text.
  - Konva tree for a text: a `Group` with `id=obj.id` and `name='markup-text'` that carries x/y/rotation/scale, drag and transform. It holds an optional `Shape` named `'markup-text-box'` (present only with a fill or a border) and then a `Text` (no id).

- [ ] **Step 1: Create `components/markup/textNode.ts`:**

```ts
// components/markup/textNode.ts
// Konva-side helpers for markup text. A text object is a Group (which carries the object id and
// every transform) wrapping an optional fill/border Shape and a Text, neither of which has an id.
import type Konva from 'konva';

/** Name on the Group that stands for one markup text object. */
export const TEXT_GROUP_NAME = 'markup-text';

/** Name on the optional fill/border shape drawn behind the glyphs. */
export const TEXT_BOX_NAME = 'markup-text-box';

/**
 * The markup object id a hit shape belongs to. Most markup is a single Konva shape carrying its
 * own id, but `stage.getIntersection` always returns the LEAF, and a text's leaves have no id —
 * its Group does. Only a text Group's id is borrowed: any other parent (a comment pin's Group, a
 * measurement's) must not turn a press on its child into an id the eraser would act on.
 */
export function hitObjectId(shape: Konva.Node | null | undefined): string {
  if (!shape) return '';
  const own = shape.id();
  if (own) return own;
  const parent = shape.getParent();
  return parent && parent.hasName(TEXT_GROUP_NAME) ? parent.id() : '';
}

/** The Text inside a markup text Group, or null for any other node. */
export function textOf(node: Konva.Node): Konva.Text | null {
  const group = node as Konva.Group;
  if (typeof group.findOne !== 'function') return null;
  return group.findOne<Konva.Text>('Text') ?? null;
}

/**
 * Each rendered line's glyph box, in the Text node's own space. Mirrors Konva's own alignment
 * arithmetic (Text._sceneFunc): a line is offset inside the width-minus-padding by its slack,
 * all of it for 'right' and half of it for 'center'.
 */
export function glyphLineRects(t: Konva.Text): { x: number; y: number; width: number; height: number }[] {
  const pad = t.padding();
  const inner = t.width() - pad * 2;
  const lineHeight = t.fontSize() * t.lineHeight();
  const align = t.align();
  return t.textArr.map((line, i) => {
    const slack = Math.max(0, inner - line.width);
    const dx = align === 'center' ? slack / 2 : align === 'right' ? slack : 0;
    return { x: pad + dx, y: pad + i * lineHeight, width: line.width, height: lineHeight };
  });
}

/** The horizontal extent of the glyphs across all lines, in the Text node's own space. */
export function glyphSpan(t: Konva.Text): { x: number; width: number } {
  const rects = glyphLineRects(t).filter((r) => r.width > 0);
  if (!rects.length) return { x: 0, width: 0 };
  const x0 = Math.min(...rects.map((r) => r.x));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  return { x: x0, width: x1 - x0 };
}
```

- [ ] **Step 2: Replace `components/markup/AnnotationObjects.tsx`** with:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Line, Arrow, Rect, Shape, Text, Group, Image as KonvaImage, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { Box } from '@/lib/markup/selection';
import type { AnnotationObject, AnnTool } from './useAnnotationObjects';
import { TEXT_BORDER_WIDTH, TEXT_FONT_FAMILY, konvaFontStyle, textPadding, widthOnSideDrag } from '@/lib/markup/text';
import { TEXT_BOX_NAME, TEXT_GROUP_NAME, glyphLineRects, textOf } from './textNode';
import { cloudArcs } from '@/lib/markup/cloud';
import { normalizedBox } from '@/lib/markup/draft';
import useShiftKey from './useShiftKey';
import { ROTATION_SNAPS_DEG, ROTATION_SNAP_TOLERANCE_DEG } from '@/lib/markup/rotationSnap';

/** Every handle. Konva's own default, spelled out because a lone text swaps in a subset. */
const ALL_ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right'];

/** One text: corners scale the font, sides set the width. No top/bottom — the height always fits the text. */
const TEXT_ANCHORS = ['top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-right'];

const isSideAnchor = (a: string | null | undefined) => a === 'middle-left' || a === 'middle-right';

/**
 * A plain text is hit on its glyphs, line by line. Konva's default Text hit area is the whole
 * width x height, and the width is the WRAP width — a two-word label in a 300px box would
 * swallow clicks meant for whatever is beside it. (A text with a fill or border is hit on its
 * whole box instead, by the box shape behind it.)
 */
function glyphHitFunc(ctx: Konva.Context, shape: Konva.Shape) {
  ctx.beginPath();
  for (const r of glyphLineRects(shape as Konva.Text)) ctx.rect(r.x, r.y, Math.max(r.width, 1), r.height);
  ctx.closePath();
  ctx.fillStrokeShape(shape);
}

function ImageObj({ obj, common, onLoaded }: { obj: AnnotationObject; common: Omit<React.ComponentProps<typeof KonvaImage>, 'image'>; onLoaded?: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!obj.src) return;
    let alive = true;
    const i = new window.Image();
    i.onload = () => { if (!alive) return; setImg(i); onLoaded?.(); };
    i.src = obj.src;
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj.src]);
  if (!img) return null;
  return <KonvaImage {...common} image={img} width={obj.width} height={obj.height} />;
}

interface AnnotationObjectsProps {
  objects: AnnotationObject[];
  draft: AnnotationObject | null;
  selectedIds: string[];
  activeTool: AnnTool;
  /** Shift (additive) toggles; see pickId. */
  onSelect: (id: string, additive: boolean) => void;
  onErase: (id: string) => void;
  onChange: (id: string, patch: Partial<AnnotationObject>) => void;
  /** The text object currently open in the editor. Its Konva node is hidden so the glyphs are
   *  not drawn twice at slightly different rasterisations. */
  editingId?: string | null;
  /** Open a committed text for editing: a Pointer double-click, or a Text-tool press on it. */
  onEditText?: (id: string) => void;
  /** Text transforms bake their scale instead of storing it — see bakeTextTransform. */
  onBakeText?: (id: string, t: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }) => void;
  /** A side-handle drag on a lone text ended at this box width — see setTextWidth. */
  onSetTextWidth?: (id: string, width: number) => void;
  /** True while an object is being dragged or transformed, false when it ends. The floating text bar hides meanwhile. */
  onGestureChange?: (active: boolean) => void;
  /** The live selection box, in the same drawing space as the objects. */
  marquee?: Box | null;
}

export default function AnnotationObjects({ objects, draft, selectedIds, activeTool, onSelect, onErase, onChange, editingId = null, onEditText, onBakeText, onSetTextWidth, onGestureChange, marquee = null }: AnnotationObjectsProps) {
  const trRef = useRef<Konva.Transformer>(null);
  // Bumped when an ImageObj finishes decoding, so the Transformer rebinds once the
  // (initially null) image node actually exists in the stage.
  const [imgLoadTick, setImgLoadTick] = useState(0);
  const shiftHeld = useShiftKey();

  // Exactly one object selected, and it is a text: corner = font size, side = width.
  const singleText = selectedIds.length === 1 && objects.some((o) => o.id === selectedIds[0] && o.type === 'text');

  // Bind the Transformer to every selected node — except one open in the text editor, where
  // resize handles would fight the caret and sit over the textarea.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const stage = tr.getStage();
    const nodes = stage
      ? selectedIds
          .filter((id) => id !== editingId)
          .map((id) => stage.findOne(`#${id}`))
          .filter((n): n is Konva.Node => !!n)
      : [];
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, objects, activeTool, imgLoadTick, editingId]);

  // Object press: select (pointer), erase, or — Text tool on a text — edit it. Ignored for the
  // draw tools so you can draw over objects.
  const handleObj = (e: Konva.KonvaEventObject<MouseEvent>, obj: AnnotationObject) => {
    // Erase this object immediately (so a plain click erases with no drag needed), but do NOT
    // cancel the bubble: the stage-level handler owns the drag-erase sweep and arms it on this
    // same mousedown. Swallowing the event here would mean a drag that starts on top of an
    // object erases that one object and then arms nothing, leaving the rest of the drag inert.
    // The stage handler will also erase this object a moment later via getIntersection; that's
    // a harmless double delete since deleteObject filters by id.
    if (activeTool === 'eraser') { onErase(obj.id); }
    else if (activeTool === 'pointer') { e.cancelBubble = true; onSelect(obj.id, e.evt.shiftKey); }
    else if (activeTool === 'text' && obj.type === 'text' && onEditText) {
      // Edit it rather than stacking a new box on top. Cancelled so the stage never starts a
      // create gesture underneath.
      e.cancelBubble = true;
      onEditText(obj.id);
    }
  };

  const renderObj = (obj: AnnotationObject, isDraft: boolean) => {
    const common = {
      id: obj.id,
      x: obj.x,
      y: obj.y,
      rotation: obj.rotation,
      scaleX: obj.scaleX,
      scaleY: obj.scaleY,
      draggable: !isDraft && activeTool === 'pointer',
      onMouseDown: isDraft ? undefined : (e: Konva.KonvaEventObject<MouseEvent>) => handleObj(e, obj),
      onTap: isDraft ? undefined : (e: Konva.KonvaEventObject<MouseEvent>) => handleObj(e, obj),
      onDragStart: isDraft ? undefined : () => onGestureChange?.(true),
      // Konva's Transformer drags the other selected nodes along with this one. Persist every
      // selected position here rather than trusting each node to report its own dragend, so a
      // group move can never leave state behind the canvas. Writing the same value twice is harmless.
      onDragEnd: isDraft ? undefined : (e: Konva.KonvaEventObject<DragEvent>) => {
        onGestureChange?.(false);
        const stage = e.target.getStage();
        const ids = selectedIds.includes(obj.id) ? selectedIds : [obj.id];
        for (const sid of ids) {
          const n = sid === obj.id ? e.target : stage?.findOne(`#${sid}`);
          if (n) onChange(sid, { x: n.x(), y: n.y() });
        }
      },
      onTransformStart: isDraft ? undefined : () => onGestureChange?.(true),
      onTransformEnd: isDraft ? undefined : (e: Konva.KonvaEventObject<Event>) => {
        onGestureChange?.(false);
        const n = e.currentTarget;
        const t = { x: n.x(), y: n.y(), rotation: n.rotation(), scaleX: n.scaleX(), scaleY: n.scaleY() };
        if (obj.type !== 'text') { onChange(obj.id, t); return; }
        // Still set during transformend — Konva clears it only after firing.
        if (singleText && isSideAnchor(trRef.current?.getActiveAnchor())) {
          // onTransform already folded every frame's stretch into the Text's width (scale is
          // back to 1). Persist that width and the origin, which moves on a middle-left drag.
          const tx = textOf(n);
          onChange(obj.id, { x: t.x, y: t.y, rotation: t.rotation, scaleX: 1, scaleY: 1 });
          if (tx) onSetTextWidth?.(obj.id, tx.width());
          return;
        }
        if (onBakeText) {
          // Reset on the node as well as in state: React re-renders a frame later, and without
          // this the text visibly springs to double size and back.
          n.scaleX(1);
          n.scaleY(1);
          onBakeText(obj.id, t);
        } else {
          onChange(obj.id, t);
        }
      },
    };
    const hit = Math.max(obj.strokeWidth, 12);
    switch (obj.type) {
      case 'freehand':
        return <Line key={obj.id} {...common} points={obj.points} stroke={obj.color} strokeWidth={obj.strokeWidth} lineCap="round" lineJoin="round" tension={0.4} hitStrokeWidth={hit} />;
      case 'line':
        return <Line key={obj.id} {...common} points={obj.points} stroke={obj.color} strokeWidth={obj.strokeWidth} lineCap="round" hitStrokeWidth={hit} />;
      case 'arrow':
        return <Arrow key={obj.id} {...common} points={obj.points} stroke={obj.color} fill={obj.color} strokeWidth={obj.strokeWidth} pointerLength={10} pointerWidth={8} hitStrokeWidth={hit} />;
      case 'rect':
        return <Rect key={obj.id} {...common} width={obj.width} height={obj.height} stroke={obj.color} strokeWidth={obj.strokeWidth} />;
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
      case 'text': {
        const pad = textPadding(obj);
        const boxed = pad > 0;
        return (
          <Group
            key={obj.id}
            {...common}
            name={TEXT_GROUP_NAME}
            visible={editingId !== obj.id}
            // A side handle on a lone text sets its WIDTH. Konva's Transformer only knows how to
            // scale, so fold the horizontal stretch into the Text's width on every frame: the
            // glyphs reflow instead of stretching. Width first, then the scale reset — the reset
            // is what makes the Transformer re-measure the group, and it must see the reflowed
            // height. Corners are left alone and baked on transformend.
            onTransform={(e: Konva.KonvaEventObject<Event>) => {
              if (!singleText || !isSideAnchor(trRef.current?.getActiveAnchor())) return;
              const g = e.currentTarget;
              const t = textOf(g);
              if (!t) return;
              t.width(widthOnSideDrag(t.width(), g.scaleX()));
              g.scaleX(1);
              g.scaleY(1);
            }}
            onDblClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
              if (isDraft || activeTool !== 'pointer' || !onEditText) return;
              e.cancelBubble = true;
              onEditText(obj.id);
            }}
            onDblTap={(e: Konva.KonvaEventObject<Event>) => {
              if (isDraft || activeTool !== 'pointer' || !onEditText) return;
              e.cancelBubble = true;
              onEditText(obj.id);
            }}
          >
            {boxed && (
              <Shape
                name={TEXT_BOX_NAME}
                fill={obj.fill || undefined}
                stroke={obj.border ? obj.color : undefined}
                strokeWidth={obj.border ? TEXT_BORDER_WIDTH : 0}
                // Sized off the sibling Text at draw time, not from props: an auto-width box is
                // as wide as Konva measured the glyphs, and a side-handle drag changes the Text's
                // width every frame without a React render. The scene function doubles as the hit
                // function, so a filled or bordered text is clickable anywhere inside its box.
                sceneFunc={(ctx, shape) => {
                  const parent = shape.getParent();
                  const t = parent ? textOf(parent) : null;
                  if (!t) return;
                  ctx.beginPath();
                  ctx.rect(0, 0, t.width(), t.height());
                  ctx.closePath();
                  ctx.fillStrokeShape(shape);
                }}
              />
            )}
            <Text
              text={obj.text}
              fontSize={obj.fontSize}
              fontFamily={TEXT_FONT_FAMILY}
              fontStyle={konvaFontStyle(obj)}
              fill={obj.color}
              align={obj.align}
              padding={pad}
              lineHeight={1}
              // `width` is the box's outer width, padding included — Konva's own convention, so
              // the Text and the box shape agree. Auto-width leaves it unset and Konva sizes the
              // node to its longest line.
              width={obj.autoWidth ? undefined : obj.width}
              wrap={obj.autoWidth ? 'none' : 'word'}
              hitFunc={boxed ? undefined : glyphHitFunc}
            />
          </Group>
        );
      }
      case 'image':
        return <ImageObj key={obj.id} obj={obj} common={common} onLoaded={() => setImgLoadTick((t) => t + 1)} />;
      default:
        return null;
    }
  };

  return (
    <>
      {objects.map((o) => renderObj(o, false))}
      {draft && renderObj(draft, true)}
      <Transformer
        ref={trRef}
        rotateEnabled
        // A group scales evenly: stretching several nodes unevenly skews any rotated member, and
        // the object model has no skew to store it in, so the canvas and the saved markup would
        // disagree. A lone text's corners scale its font, which must stay in proportion too.
        // Other single objects can still be stretched freely. (Side anchors ignore keepRatio.)
        keepRatio={selectedIds.length > 1 || singleText}
        enabledAnchors={singleText ? TEXT_ANCHORS : ALL_ANCHORS}
        ignoreStroke
        // Konva's rotationSnaps are ABSOLUTE angles, which is exactly the behaviour wanted:
        // Shift straightens a crooked object rather than stepping it 90 deg from wherever it
        // was. An empty array means no snapping at all.
        rotationSnaps={shiftHeld ? ROTATION_SNAPS_DEG : []}
        rotationSnapTolerance={ROTATION_SNAP_TOLERANCE_DEG}
        boundBoxFunc={(oldBox, newBox) => (newBox.width < 5 || newBox.height < 5 ? oldBox : newBox)}
      />
      {marquee && (
        <Rect
          x={marquee.x}
          y={marquee.y}
          width={marquee.width}
          height={marquee.height}
          stroke="#5B60FF"
          strokeWidth={1}
          dash={[4, 4]}
          fill="rgba(91, 96, 255, 0.08)"
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Update the selection-box hit test.** In `components/markup/useMarqueeSelect.ts`, add the import after the `selection` import:

```ts
import { TEXT_BOX_NAME, TEXT_GROUP_NAME, glyphSpan, textOf } from './textNode';
```

and replace:

```ts
      // A text node's box is its WRAP width, often far wider than its words; test the glyphs,
      // the same area a click hits (AnnotationObjects' text hitFunc). Unrotated text only — a
      // rotated label keeps its full client rect, which is still a fair "touching" test.
      if (node.getClassName() === 'Text' && !node.rotation()) {
        const t = node as Konva.Text;
        r.width = t.getTextWidth() * Math.abs(t.scaleX());
      }
```

with:

```ts
      // A plain text's box is its WRAP width, often far wider than its words; test the glyphs,
      // the same area a click hits (AnnotationObjects' glyphHitFunc). A text with a fill or a
      // border is hit on its whole box, so its client rect already is the right test. The id
      // sits on the text's Group (the layer's direct child), not on its Text. Unrotated text
      // only — a rotated label keeps its full client rect, which is still a fair "touching" test.
      if (node.hasName(TEXT_GROUP_NAME) && !node.rotation() && !(node as Konva.Group).findOne(`.${TEXT_BOX_NAME}`)) {
        const t = textOf(node);
        if (t) {
          const span = glyphSpan(t);
          r.x = node.x() + span.x * node.scaleX();
          r.width = span.width * Math.abs(node.scaleX());
        }
      }
```

- [ ] **Step 4: The eraser resolves a text leaf to its Group.** In `components/markup/AnnotationCanvas.tsx`, add after `import AnnotationObjects from './AnnotationObjects';`:

```ts
import { hitObjectId } from './textNode';
```

and replace:

```ts
    // The LEAF shape under the cursor, never the Group wrapping it — which is why every
    // erasable measurement shape carries its own id and not just its Group (see MeasureObjects).
    const id = stage.getIntersection(p)?.id();
```

with:

```ts
    // The LEAF shape under the cursor, never the Group wrapping it — which is why every
    // erasable measurement shape carries its own id and not just its Group (see MeasureObjects).
    // A markup text is the one exception: its id is on its Group, and hitObjectId borrows it.
    const id = hitObjectId(stage.getIntersection(p));
```

In `components/viewers/PDFKonvaViewer.tsx`, add after `import AnnotationObjects from '@/components/markup/AnnotationObjects';`:

```ts
import { hitObjectId } from '@/components/markup/textNode';
```

and replace:

```ts
      // The LEAF shape under the cursor, never the Group wrapping it — which is why every
      // erasable measurement shape carries its own id and not just its Group (see
      // MeasureObjects).
      const id = stage.getIntersection(p)?.id();
```

with:

```ts
      // The LEAF shape under the cursor, never the Group wrapping it — which is why every
      // erasable measurement shape carries its own id and not just its Group (see
      // MeasureObjects). A markup text is the one exception: its id is on its Group, and
      // hitObjectId borrows it.
      const id = hitObjectId(stage.getIntersection(p));
```

- [ ] **Step 5: Pass `onSetTextWidth`.** In `components/markup/AnnotationCanvas.tsx` replace:

```tsx
              onBakeText={ann.bakeTextTransform}
            />
```

with:

```tsx
              onBakeText={ann.bakeTextTransform}
              onSetTextWidth={ann.setTextWidth}
            />
```

In `components/viewers/PDFKonvaViewer.tsx` replace:

```tsx
                  onBakeText={ann.bakeTextTransform}
                />
```

with:

```tsx
                  onBakeText={ann.bakeTextTransform}
                  onSetTextWidth={ann.setTextWidth}
                />
```

- [ ] **Step 6: Gate.**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc prints nothing; `✔ No ESLint warnings or errors`; `# fail 0`.

- [ ] **Step 7: Commit.**

```bash
git add components/markup/textNode.ts components/markup/AnnotationObjects.tsx components/markup/useMarqueeSelect.ts components/markup/AnnotationCanvas.tsx components/viewers/PDFKonvaViewer.tsx
git commit -m "$(cat <<'EOF'
feat(markup): text as a Konva Group with optional fill and border

Side handles reflow the width live, corners scale and bake the font, top and
bottom handles are hidden for a lone text. Plain text hits on its glyphs, boxed
text on its whole box; the eraser and selection box follow the id to the Group.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The editor mirrors the box exactly

**Files:**
- Modify: `components/markup/CanvasTextEditor.tsx` (full replacement below)
- Modify: `components/markup/AnnotationCanvas.tsx` (editor props, one import)
- Modify: `components/viewers/PDFKonvaViewer.tsx` (editor props, one import)

**Interfaces:**
- Consumes: `AnnotationObject` (Task 2), and `MARKUP_ACCENT`, `TEXT_BORDER_WIDTH`, `TEXT_FONT_FAMILY`, `fontStepFromKey`, `textPadding`, `stepFontSize` (Task 1).
- Produces: `CanvasTextEditor` props `{ object: AnnotationObject; x: number; y: number; scale: number; onChange: (text: string) => void; onCommit: () => void; onStepFontSize: (dir: 1 | -1) => void }`. Here `x`/`y` are the box's top-left in container px.
  - DOM contract: the box div carries `data-markup-text-chrome` and the textarea carries `data-markup-text-editor`. Any element with `data-markup-text-chrome` counts as "inside" for the outside-click finish. `TextStyleBar` (Task 5) relies on this.
  - A press on this surface's own canvas that finishes an edit is swallowed (`preventDefault` on `pointerdown` suppresses Konva's `mousedown`/`mouseup`), so it cannot deselect, start a selection box or create another text.

- [ ] **Step 1: Replace `components/markup/CanvasTextEditor.tsx`** with:

```tsx
'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MARKUP_ACCENT, TEXT_BORDER_WIDTH, TEXT_FONT_FAMILY, fontStepFromKey, textPadding } from '@/lib/markup/text';
import type { AnnotationObject } from './useAnnotationObjects';

/** Caret room on an auto-width box, so a caret after the last glyph is neither clipped nor scrolled into view by a pixel. */
const CARET_ROOM = 2;

/**
 * A textarea standing exactly where the Konva text node is, so markup text is typed where it
 * will land rather than in a popup somewhere else.
 *
 * Konva has no text input primitive, and rendering a caret onto the canvas would mean
 * reimplementing caret movement, selection, wrapping, clipboard and IME composition. Overlaying
 * a real form control gets all of that from the browser. The cost is that the overlay has to
 * mirror the Konva box exactly, or the text jumps at the moment it is committed:
 *
 * - The outer div is the BOX: as wide as the Konva Text (padding included), as tall as its lines
 *   plus padding, with the same fill. The border is drawn as box-shadows centred on the edge —
 *   what Konva's 1.5px stroke does — so it never enters the box model and cannot shift a glyph.
 * - The textarea is the CONTENT: inset by the padding, padding 0 itself, lineHeight 1, and the
 *   same family, weight, style and alignment. Fixed width wraps at width minus padding, as Konva
 *   does; auto-width never wraps and is measured to the widest line with a hidden mirror span.
 * - Everything scales by `scale` (the stage zoom; 1 on the unscaled AnnotationCanvas) and rotates
 *   about the top-left, which is the Konva Group's origin.
 *
 * The accent frame is an `outline`, which also sits outside the box model.
 */
export default function CanvasTextEditor({
  object,
  x,
  y,
  scale,
  onChange,
  onCommit,
  onStepFontSize,
}: {
  object: AnnotationObject;
  x: number;
  y: number;
  scale: number;
  onChange: (text: string) => void;
  onCommit: () => void;
  onStepFontSize: (dir: 1 | -1) => void;
}) {
  const { text: value, color, fontSize, bold, italic, align, fill, border, autoWidth, width, rotation } = object;
  const ref = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Hidden span used only to measure the widest rendered line — never shown, never focusable.
  const mirrorRef = useRef<HTMLSpanElement>(null);
  // Widest line in screen px (auto-width only), and the textarea's content height.
  const [contentWidth, setContentWidth] = useState(0);
  const [contentHeight, setContentHeight] = useState(fontSize * scale);

  // Handlers stay in refs so the document listener below can be bound once, on mount.
  // Re-binding a document-level pointerdown handler on every keystroke risks the handler that
  // closes the editor being attached during the very click that is supposed to close it.
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const stepRef = useRef(onStepFontSize);
  stepRef.current = onStepFontSize;

  const pad = textPadding(object) * scale;
  const displayFontSize = fontSize * scale;
  const fontWeight = bold ? 'bold' : 'normal';
  const fontStyle = italic ? 'italic' : 'normal';

  // Focus with the caret at the end — the re-edit paths open on existing text, and landing the
  // caret at the start there would make appending feel broken.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Auto-width: the box hugs the widest line. getBoundingClientRect rather than offsetWidth,
  // which rounds to whole pixels and would make the box disagree with Konva's fractional width.
  useLayoutEffect(() => {
    if (!autoWidth) return;
    const mirror = mirrorRef.current;
    if (!mirror) return;
    let widest = 0;
    for (const line of value.split('\n')) {
      mirror.textContent = line;
      widest = Math.max(widest, mirror.getBoundingClientRect().width);
    }
    setContentWidth(widest);
  }, [value, displayFontSize, fontWeight, fontStyle, autoWidth]);

  const textWidth = autoWidth ? contentWidth + CARET_ROOM : Math.max(1, width * scale - pad * 2);

  // Grow to fit. Height is reset to auto first, or scrollHeight only ever ratchets upward and
  // the box never shrinks back when text is deleted. After the width measure, since wrapping
  // depends on it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const h = el.scrollHeight;
    el.style.height = `${h}px`;
    setContentHeight(h);
  }, [value, displayFontSize, fontWeight, fontStyle, textWidth]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target;
      // The box itself, and the floating text bar, are inside.
      if (t instanceof Element && t.closest('[data-markup-text-chrome]')) return;
      // A press on THIS surface's canvas finishes the edit and must do nothing else: not
      // deselect the text (it stays selected), not start a selection box, not create another
      // text. Konva acts on the compatibility mousedown/mouseup, and cancelling pointerdown
      // suppresses those without touching any other click on the page.
      const host = boxRef.current?.parentElement;
      if (t instanceof HTMLCanvasElement && host?.contains(t)) e.preventDefault();
      commitRef.current();
    };
    // Capture phase: the surface's own stage handlers must not act on the click that closed the
    // editor before the editor has seen it.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const boxWidth = autoWidth ? contentWidth + pad * 2 : width * scale;
  const boxHeight = contentHeight + pad * 2;
  // The auto-width textarea is CARET_ROOM wider than its text, and Konva aligns lines inside the
  // text's own width. Pull the extra out of whichever side the alignment pushes the text away from.
  const shift = autoWidth ? (align === 'center' ? CARET_ROOM / 2 : align === 'right' ? CARET_ROOM : 0) : 0;
  const halfBorder = (TEXT_BORDER_WIDTH / 2) * scale;

  return (
    <>
      {/* Hidden mirror used only to measure the widest line. Same font metrics as the textarea —
          any divergence here would make the measurement lie. */}
      <span
        ref={mirrorRef}
        aria-hidden
        style={{
          position: 'absolute',
          top: -9999,
          left: -9999,
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'pre',
          fontFamily: TEXT_FONT_FAMILY,
          fontWeight,
          fontStyle,
          fontSize: displayFontSize,
          lineHeight: 1,
        }}
      />
      <div
        ref={boxRef}
        data-markup-text-chrome=""
        className="absolute z-40"
        style={{
          left: x,
          top: y,
          width: boxWidth,
          height: boxHeight,
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
          transformOrigin: '0 0',
          background: fill || 'transparent',
          boxShadow: border ? `inset 0 0 0 ${halfBorder}px ${color}, 0 0 0 ${halfBorder}px ${color}` : undefined,
          outline: `1px solid ${MARKUP_ACCENT}`,
          outlineOffset: border ? halfBorder + 2 : 2,
        }}
      >
        <textarea
          ref={ref}
          data-markup-text-editor=""
          value={value}
          rows={1}
          wrap={autoWidth ? 'off' : 'soft'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Keys typed here are text, never canvas shortcuts (Delete, Enter-to-edit, page turns).
            e.stopPropagation();
            if (e.nativeEvent.isComposing) return;
            // Plain Enter inserts a newline. Esc and Ctrl/Cmd+Enter finish.
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              e.preventDefault();
              commitRef.current();
              return;
            }
            const step = fontStepFromKey(e);
            if (step) {
              e.preventDefault();
              stepRef.current(step);
            }
          }}
          spellCheck={false}
          className="absolute resize-none overflow-hidden"
          style={{
            left: pad - shift,
            top: pad,
            width: textWidth,
            color,
            fontFamily: TEXT_FONT_FAMILY,
            fontWeight,
            fontStyle,
            fontSize: displayFontSize,
            lineHeight: 1,
            textAlign: align,
            padding: 0,
            margin: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            whiteSpace: autoWidth ? 'pre' : 'pre-wrap',
            overflowWrap: autoWidth ? 'normal' : 'break-word',
          }}
        />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Update the AnnotationCanvas call site.** In `components/markup/AnnotationCanvas.tsx`, replace

```ts
import { wrapWidthForContent, isBlank } from '@/lib/markup/text';
```

with

```ts
import { stepFontSize, wrapWidthForContent, isBlank } from '@/lib/markup/text';
```

and replace:

```tsx
          // The stage is untransformed here, so object space is screen space.
          x={editingObj.x}
          y={editingObj.y}
          scale={1}
          color={editingObj.color}
          fontSize={editingObj.fontSize}
          wrapWidth={editingObj.width}
          value={editingObj.text}
          onChange={(t) => ann.updateText(editingObj.id, t)}
          onCommit={commitText}
```

with:

```tsx
          object={editingObj}
          // The stage is untransformed here, so object space is screen space.
          x={editingObj.x}
          y={editingObj.y}
          scale={1}
          onChange={(t) => ann.updateText(editingObj.id, t)}
          onCommit={commitText}
          onStepFontSize={(dir) => ann.updateTextStyle([editingObj.id], { fontSize: stepFontSize(editingObj.fontSize, dir) })}
```

- [ ] **Step 3: Update the PDFKonvaViewer call site.** In `components/viewers/PDFKonvaViewer.tsx`, replace

```ts
import { wrapWidthForContent, isBlank } from '@/lib/markup/text';
```

with

```ts
import { stepFontSize, wrapWidthForContent, isBlank } from '@/lib/markup/text';
```

and replace:

```tsx
              x={editingObj.x * stageScale + stagePos.x}
              y={editingObj.y * stageScale + stagePos.y}
              scale={stageScale}
              color={editingObj.color}
              fontSize={editingObj.fontSize}
              wrapWidth={editingObj.width}
              value={editingObj.text}
              onChange={(t) => ann.updateText(editingObj.id, t)}
              onCommit={commitText}
```

with:

```tsx
              object={editingObj}
              x={editingObj.x * stageScale + stagePos.x}
              y={editingObj.y * stageScale + stagePos.y}
              scale={stageScale}
              onChange={(t) => ann.updateText(editingObj.id, t)}
              onCommit={commitText}
              onStepFontSize={(dir) => ann.updateTextStyle([editingObj.id], { fontSize: stepFontSize(editingObj.fontSize, dir) })}
```

- [ ] **Step 4: Gate.**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc prints nothing; `✔ No ESLint warnings or errors`; `# fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add components/markup/CanvasTextEditor.tsx components/markup/AnnotationCanvas.tsx components/viewers/PDFKonvaViewer.tsx
git commit -m "$(cat <<'EOF'
feat(markup): text editor mirrors padding, alignment, style, fill and border

Auto-width grows without wrapping, fixed width wraps at the box; a solid accent
frame replaces the dashed one. Esc and Ctrl/Cmd+Enter finish, Cmd/Ctrl+Shift+>/<
step the size, and the outside press that finishes is swallowed by the canvas.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The floating text bar

**Files:**
- Create: `components/markup/TextStyleBar.tsx`

**Interfaces:**
- Consumes (Task 1): `FONT_SIZE_PRESETS`, `TEXT_BAR_GAP`, `TEXT_BAR_ROTATER_GAP`, `TEXT_FILL_SWATCHES`, `clampFontSize`, `placeTextBar`, `RectLike`, `TextAlign`, `TextStyle`. Also the `data-markup-text-chrome` / `data-markup-text-editor` DOM contract (Task 4).
- Produces: `default export TextStyleBar(props: TextStyleBarProps)` with
  `interface TextStyleBarProps { anchor: RectLike; view: { width: number; height: number }; style: TextStyle; editing: boolean; onChange: (patch: Partial<TextStyle>) => void }`.
  - `anchor` is the selection's box in the same container px the bar is absolutely positioned in.
  - `editing` picks the gap above (`TEXT_BAR_GAP` while editing, `TEXT_BAR_ROTATER_GAP` for a selection).
  - Controls are labelled for tests: `Font size` (input), `Font size presets`, `Bold`, `Italic`, `Align left|center|right`, `Fill`, `No fill`, `<Label> fill`, `Border`.

- [ ] **Step 1: Create `components/markup/TextStyleBar.tsx`:**

```tsx
'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  FONT_SIZE_PRESETS,
  TEXT_BAR_GAP,
  TEXT_BAR_ROTATER_GAP,
  TEXT_FILL_SWATCHES,
  clampFontSize,
  placeTextBar,
  type RectLike,
  type TextAlign,
  type TextStyle,
} from '@/lib/markup/text';

const BTN = 'flex h-[28px] min-w-[28px] items-center justify-center rounded-[8px] px-[5px] text-[13px] leading-none transition-colors';
const btn = (active: boolean) => `${BTN} ${active ? 'bg-stiko-tint text-stiko-primary' : 'text-stiko-secondary hover:bg-stiko-subtle'}`;
const MENU = 'absolute top-full mt-[6px] rounded-[10px] border border-stiko-border bg-white p-[4px] shadow-stiko-panel';

const ALIGNS: readonly TextAlign[] = ['left', 'center', 'right'];

function Divider() {
  return <span aria-hidden className="mx-[3px] h-[18px] w-px bg-stiko-divider" />;
}

function AlignIcon({ align }: { align: TextAlign }) {
  // Three lines; the short middle one hugs the side the text aligns to.
  const mid = align === 'left' ? { x1: 3, x2: 11 } : align === 'right' ? { x1: 7, x2: 15 } : { x1: 5, x2: 13 };
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="3" y1="5" x2="15" y2="5" />
      <line x1={mid.x1} y1="9" x2={mid.x2} y2="9" />
      <line x1="3" y1="13" x2="15" y2="13" />
    </svg>
  );
}

/** A fill swatch; '' is drawn as white with a red slash, the usual "none". */
function FillChip({ fill }: { fill: string }) {
  return (
    <span
      className="relative block h-[16px] w-[16px] overflow-hidden rounded-full border border-stiko-border-strong"
      style={{ background: fill || '#FFFFFF' }}
    >
      {!fill && <span className="absolute left-1/2 top-[-2px] h-[20px] w-[1.5px] -translate-x-1/2 rotate-45 bg-[#E5484D]" />}
    </span>
  );
}

const formatSize = (n: number) => String(Math.round(n * 10) / 10);

/** Put the caret back in the open text editor after the size field took focus. */
function refocusEditor() {
  document.querySelector<HTMLTextAreaElement>('[data-markup-text-editor]')?.focus();
}

export interface TextStyleBarProps {
  /** The selection's box, in the pixels of the container this bar is absolutely positioned in. */
  anchor: RectLike;
  /** That container's size, to clamp inside. */
  view: { width: number; height: number };
  /** What the controls show: the primary target text's style. */
  style: TextStyle;
  /** True while a text is open in the editor (no Transformer, so the bar can sit close). */
  editing: boolean;
  /** Applied by the surface to every target text. */
  onChange: (patch: Partial<TextStyle>) => void;
}

/**
 * The floating text bar: size, bold, italic, alignment, fill and border for the selected texts or
 * the one being edited. Plain DOM over the stage. `data-markup-text-chrome` makes CanvasTextEditor
 * treat a press here as inside the editor, and because it is not the canvas, a press here never
 * reaches Konva — so it can neither finish an edit nor start a selection box or a draw.
 */
export default function TextStyleBar({ anchor, view, style, editing, onChange }: TextStyleBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [menu, setMenu] = useState<'size' | 'fill' | null>(null);
  // The size field's text while it has focus; null shows the live size. Mirrored in a ref so
  // Escape-then-blur (both inside one keydown) sees the cleared draft and commits nothing.
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);

  // Measure after every render: the bar's width depends on nothing it can predict (fonts, the
  // size field's digits). Sets state only on a real change, so it cannot loop.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setSize((s) => (s && s.width === w && s.height === h ? s : { width: w, height: h }));
  });

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [menu]);

  const writeDraft = (v: string | null) => {
    draftRef.current = v;
    setDraft(v);
  };
  const commitDraft = () => {
    const d = draftRef.current;
    writeDraft(null);
    if (d === null) return;
    const n = parseFloat(d);
    if (Number.isFinite(n)) onChange({ fontSize: clampFontSize(n) });
  };

  // A selection shows Konva's rotate handle 50px above the box; the bar clears it rather than
  // covering it. While editing there is no Transformer, so it comes in close.
  const pos = size ? placeTextBar(anchor, size, view, editing ? TEXT_BAR_GAP : TEXT_BAR_ROTATER_GAP) : null;

  return (
    <div
      ref={ref}
      data-markup-text-chrome=""
      role="toolbar"
      aria-label="Text style"
      className="absolute z-40 flex h-[38px] items-center gap-[2px] rounded-[12px] border border-stiko-border bg-white px-[5px] shadow-stiko-panel select-none"
      // Hidden, not absent, until measured: placing needs the bar's own size.
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      // Buttons must not take focus from the text being edited — the caret stays in the editor
      // while you restyle. The size field is the one control that needs focus.
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="relative flex items-center">
        <input
          aria-label="Font size"
          type="number"
          min={6}
          max={400}
          step={1}
          value={draft ?? formatSize(style.fontSize)}
          onFocus={(e) => {
            writeDraft(formatSize(style.fontSize));
            e.currentTarget.select();
          }}
          onChange={(e) => writeDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft();
              e.currentTarget.blur();
              if (editing) refocusEditor();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              writeDraft(null);
              e.currentTarget.blur();
              if (editing) refocusEditor();
            }
          }}
          className="h-[28px] w-[46px] rounded-[8px] border border-stiko-divider bg-white px-[6px] text-[13px] text-stiko-ink outline-none [appearance:textfield] focus:border-stiko-primary [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label="Font size presets"
          aria-expanded={menu === 'size'}
          className={btn(menu === 'size')}
          onClick={() => setMenu(menu === 'size' ? null : 'size')}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3.5 5 6.5 8 3.5" />
          </svg>
        </button>
        {menu === 'size' && (
          <div className={`${MENU} left-0 flex flex-col`}>
            {FONT_SIZE_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={`${btn(style.fontSize === p)} w-[56px] justify-start px-[10px]`}
                onClick={() => {
                  onChange({ fontSize: p });
                  setMenu(null);
                }}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      <Divider />

      <button type="button" aria-label="Bold" aria-pressed={style.bold} className={`${btn(style.bold)} font-bold`} onClick={() => onChange({ bold: !style.bold })}>
        B
      </button>
      <button type="button" aria-label="Italic" aria-pressed={style.italic} className={`${btn(style.italic)} font-serif italic`} onClick={() => onChange({ italic: !style.italic })}>
        I
      </button>

      <Divider />

      {ALIGNS.map((a) => (
        <button key={a} type="button" aria-label={`Align ${a}`} aria-pressed={style.align === a} className={btn(style.align === a)} onClick={() => onChange({ align: a })}>
          <AlignIcon align={a} />
        </button>
      ))}

      <Divider />

      <div className="relative flex">
        <button type="button" aria-label="Fill" aria-expanded={menu === 'fill'} className={btn(menu === 'fill')} onClick={() => setMenu(menu === 'fill' ? null : 'fill')}>
          <FillChip fill={style.fill} />
        </button>
        {menu === 'fill' && (
          <div className={`${MENU} left-1/2 flex -translate-x-1/2 gap-[2px]`}>
            <button
              type="button"
              aria-label="No fill"
              aria-pressed={!style.fill}
              className={btn(!style.fill)}
              onClick={() => {
                onChange({ fill: '' });
                setMenu(null);
              }}
            >
              <FillChip fill="" />
            </button>
            {TEXT_FILL_SWATCHES.map((s) => (
              <button
                key={s.value}
                type="button"
                aria-label={`${s.label} fill`}
                aria-pressed={style.fill === s.value}
                className={btn(style.fill === s.value)}
                onClick={() => {
                  onChange({ fill: s.value });
                  setMenu(null);
                }}
              >
                <FillChip fill={s.value} />
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" aria-label="Border" aria-pressed={style.border} className={btn(style.border)} onClick={() => onChange({ border: !style.border })}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3.5" y="4.5" width="11" height="9" rx="1.5" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Gate.**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc prints nothing; `✔ No ESLint warnings or errors`; `# fail 0`.

- [ ] **Step 3: Commit.**

```bash
git add components/markup/TextStyleBar.tsx
git commit -m "$(cat <<'EOF'
feat(markup): floating text bar component

Size field with presets, bold, italic, alignment, six soft fills and a border
toggle. Never steals the editor's caret, clamps itself inside the viewer and
clears the Transformer's rotate handle.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Shared text-session hook and the selection's screen rect

**Files:**
- Create: `components/markup/useNodesScreenRect.ts`
- Create: `components/markup/useMarkupText.ts`

**Interfaces:**
- Consumes: `useAnnotationObjects` return value (Task 2: `objects`, `selectedIds`, `textOnlySelection`, `setSelectedId`, `addText`, `deleteObject`, `updateTextStyle`). `normalizeBox`/`Box`/`Point` from `lib/markup/selection`. `fontStepFromKey`, `isBlank`, `stepFontSize`, `textBoxFromGesture`, `RectLike`, `TextStyle` (Task 1).
- Produces:
  - `useNodesScreenRect(stageRef: RefObject<Konva.Stage>, ids: readonly string[]): RectLike | null` returns the union of `node.getClientRect()` for those ids, in stage-container px. It re-measures on every layer `draw`.
  - `useMarkupText(ann, { enabled: boolean; activeTool: ToolType; onObjectCreated?: () => void })` returns:
    - `editingId: string | null`, `setEditingId(id: string | null)`
    - `startEditing(id: string)` selects the text and opens it. If the tool is not Pointer it calls `onObjectCreated` (back to Pointer).
    - `commit()` deletes the text if blank, else keeps it selected, then closes the editor.
    - `createBox: Box | null` is the live drag rect for drawing.
    - `beginCreate(p: Point)`, `moveCreate(p: Point)`
    - `endCreate(style: { color: string; strokeWidth: number }, scale: number, bounds: RectLike): string | null` creates the text, opens it and calls `onObjectCreated`. It returns null when no gesture was in flight.
    - `targetIds: readonly string[]` is `[editingId]` while editing, else the selection when it is text-only, else `[]`.
    - `targetObject: AnnotationObject | null` is the first target.
    - `applyStyle(patch: Partial<TextStyle>)` applies to every target. `stepFont(dir: 1 | -1)` steps every target from the first one's size.
    - `gesture: boolean`, `setGesture(active: boolean)`
    - A window `keydown` listener (only while `enabled`): Enter opens the one selected text, and Cmd/Ctrl+Shift+>/< steps the size of the target texts. Both are ignored while editing, while an input/textarea/select/contenteditable has focus, and (Enter only) while a button has focus.

- [ ] **Step 1: Create `components/markup/useNodesScreenRect.ts`:**

```ts
'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';
import type Konva from 'konva';
import type { RectLike } from '@/lib/markup/text';

function sameRect(a: RectLike | null, b: RectLike | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

/**
 * The on-screen box around some Konva nodes, in the stage CONTAINER's pixels — the space
 * CanvasTextEditor and TextStyleBar are absolutely positioned in. `getClientRect()` with no
 * `relativeTo` already includes the stage's own zoom and pan, so this is right on the zoomable
 * PDF stage and on the unscaled AnnotationCanvas alike.
 *
 * Re-measured on every layer draw rather than on a hand-kept list of what can move a node
 * (typing, the bar, a drag, a zoom, a pan, a resize): each of those redraws a layer, and
 * a draw happens after Konva has the new attributes, which a React effect cannot promise —
 * react-konva commits into Konva from its own reconciler. State is set only on a real change.
 */
export function useNodesScreenRect(stageRef: RefObject<Konva.Stage>, ids: readonly string[]): RectLike | null {
  const [rect, setRect] = useState<RectLike | null>(null);
  const key = ids.join(' ');

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !key) {
      setRect(null);
      return;
    }
    const wanted = key.split(' ');
    const measure = () => {
      let next: RectLike | null = null;
      for (const id of wanted) {
        const node = stage.findOne(`#${id}`);
        if (!node) continue;
        const r = node.getClientRect();
        if (!next) {
          next = { x: r.x, y: r.y, width: r.width, height: r.height };
        } else {
          const x = Math.min(next.x, r.x);
          const y = Math.min(next.y, r.y);
          next = {
            x,
            y,
            width: Math.max(next.x + next.width, r.x + r.width) - x,
            height: Math.max(next.y + next.height, r.y + r.height) - y,
          };
        }
      }
      setRect((cur) => (sameRect(cur, next) ? cur : next));
    };
    measure();
    const layers = stage.getLayers();
    for (const l of layers) l.on('draw.nodesScreenRect', measure);
    return () => {
      for (const l of layers) l.off('draw.nodesScreenRect', measure);
    };
  }, [stageRef, key]);

  return key ? rect : null;
}
```

- [ ] **Step 2: Create `components/markup/useMarkupText.ts`:**

```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeBox, type Box, type Point } from '@/lib/markup/selection';
import { fontStepFromKey, isBlank, stepFontSize, textBoxFromGesture, type RectLike, type TextStyle } from '@/lib/markup/text';
import type { AnnotationObject, ToolType, useAnnotationObjects } from './useAnnotationObjects';

type Annotations = ReturnType<typeof useAnnotationObjects>;

const NO_IDS: readonly string[] = [];

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const h = el as HTMLElement;
  return h.tagName === 'INPUT' || h.tagName === 'TEXTAREA' || h.tagName === 'SELECT' || h.isContentEditable;
}

export interface MarkupTextOptions {
  /** The surface takes markup input at all (always on AnnotationCanvas; `annotating` on the PDF viewer). */
  enabled: boolean;
  activeTool: ToolType;
  /** The portal's "back to the Pointer". Called when a text is created, or opened with the Text tool. */
  onObjectCreated?: () => void;
}

/**
 * Everything about markup TEXT that both drawing surfaces share: creating by click or drag,
 * opening and finishing the editor, which texts the floating bar edits, and the keyboard
 * shortcuts. The surfaces keep only what differs between them — their coordinate space.
 */
export function useMarkupText(ann: Annotations, { enabled, activeTool, onObjectCreated }: MarkupTextOptions) {
  const { objects, selectedIds, textOnlySelection, setSelectedId, addText, deleteObject, updateTextStyle } = ann;
  // The text currently open in the editor. The object itself already exists in `ann` — this is
  // only which one the editor is bound to.
  const [editingId, setEditingId] = useState<string | null>(null);
  // A drag or transform in flight: the bar hides.
  const [gesture, setGesture] = useState(false);
  // The live Text-tool drag, drawn as a selection-style box.
  const [createBox, setCreateBox] = useState<Box | null>(null);
  const startRef = useRef<Point | null>(null);
  const lastRef = useRef<Point | null>(null);

  // What the bar edits: the open text, or a selection made only of text.
  const targetIds: readonly string[] = editingId ? [editingId] : textOnlySelection ? selectedIds : NO_IDS;
  const targetObject: AnnotationObject | null = targetIds.length ? objects.find((o) => o.id === targetIds[0]) ?? null : null;

  // Read by handlers that are bound once (the window key listener) or must not change identity
  // on every keystroke (the PDF viewer's useCallback mouse handlers depend on them).
  const live = useRef({ editingId, objects, targetIds, activeTool, onObjectCreated });
  live.current = { editingId, objects, targetIds, activeTool, onObjectCreated };

  /** Open a committed text, selected. Every way in — double-click, the Text tool, Enter — lands here. */
  const startEditing = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
    // The Text tool on an existing text: hand back to the Pointer, as a create does, or the click
    // that finishes this edit would start another box — and the surfaces clear the selection
    // whenever a non-Pointer tool is armed.
    if (live.current.activeTool !== 'pointer') live.current.onObjectCreated?.();
  }, [setSelectedId]);

  /** Finish editing. Blank text was a mis-click and goes; anything else stays SELECTED. */
  const commit = useCallback(() => {
    const id = live.current.editingId;
    if (!id) return;
    const obj = live.current.objects.find((o) => o.id === id);
    if (obj && isBlank(obj.text)) deleteObject(id);
    else setSelectedId(id);
    setEditingId(null);
  }, [deleteObject, setSelectedId]);

  const beginCreate = useCallback((p: Point) => {
    startRef.current = p;
    lastRef.current = p;
  }, []);

  const moveCreate = useCallback((p: Point) => {
    const s = startRef.current;
    if (!s) return;
    lastRef.current = p;
    setCreateBox(normalizeBox(s, p));
  }, []);

  /**
   * Finish a Text-tool press: a click is an auto-width box, a drag a fixed-width one as wide as
   * the drag (see textBoxFromGesture). `scale` is screen px per drawing unit; `bounds` is the
   * surface the box must stay on. A no-op (null) when no press is in flight, so a surface can
   * call it from every mouseup and mouseleave.
   */
  const endCreate = useCallback((style: { color: string; strokeWidth: number }, scale: number, bounds: RectLike): string | null => {
    const s = startRef.current;
    const e = lastRef.current;
    if (!s || !e) return null;
    startRef.current = null;
    lastRef.current = null;
    setCreateBox(null);
    const b = textBoxFromGesture(s, e, scale, bounds);
    const id = addText({ x: b.x, y: b.y }, { color: style.color, strokeWidth: style.strokeWidth, width: b.width, autoWidth: b.autoWidth });
    setEditingId(id);
    // Back to the Pointer at once: with the Text tool still armed, the click that finishes this
    // box would start another.
    live.current.onObjectCreated?.();
    return id;
  }, [addText]);

  const applyStyle = useCallback((patch: Partial<TextStyle>) => {
    updateTextStyle(live.current.targetIds, patch);
  }, [updateTextStyle]);

  /** Every target steps from the FIRST one's size — the size the bar shows. */
  const stepFont = useCallback((dir: 1 | -1) => {
    const { targetIds: ids, objects: objs } = live.current;
    const first = objs.find((o) => o.id === ids[0]);
    if (first) updateTextStyle(ids, { fontSize: stepFontSize(first.fontSize, dir) });
  }, [updateTextStyle]);

  // Enter opens the one selected text; Cmd/Ctrl+Shift+> and < step the selected texts' size.
  // (While editing, the editor's own textarea handles both and stops the event.) Never while a
  // field has focus — the portal's comment box, the bar's size field — and Enter never from a
  // focused button, where Enter is that button's own click.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const { editingId: editing, targetIds: ids } = live.current;
      if (editing || e.defaultPrevented || !ids.length) return;
      const el = document.activeElement;
      if (isTypingTarget(el)) return;
      const step = fontStepFromKey(e);
      if (step) {
        e.preventDefault();
        stepFont(step);
        return;
      }
      if (
        e.key === 'Enter' && ids.length === 1 && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey
        && !e.repeat && !e.isComposing && el?.tagName !== 'BUTTON'
      ) {
        // preventDefault also keeps this Enter from typing a newline into the editor it opens.
        e.preventDefault();
        startEditing(ids[0]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, stepFont, startEditing]);

  return {
    editingId, setEditingId, startEditing, commit,
    createBox, beginCreate, moveCreate, endCreate,
    targetIds, targetObject, applyStyle, stepFont,
    gesture, setGesture,
  };
}
```

- [ ] **Step 3: Gate.**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc prints nothing; `✔ No ESLint warnings or errors`; `# fail 0`.

- [ ] **Step 4: Commit.**

```bash
git add components/markup/useNodesScreenRect.ts components/markup/useMarkupText.ts
git commit -m "$(cat <<'EOF'
feat(markup): shared text-session hook and selection screen rect

useMarkupText owns click/drag creation, open/finish, the bar's target and the
Enter / Cmd+Shift+>< shortcuts for both surfaces; useNodesScreenRect tracks the
selection on screen through every layer draw.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Wire AnnotationCanvas

**Files:**
- Modify: `components/markup/AnnotationCanvas.tsx`

**Interfaces:**
- Consumes: `useMarkupText`, `useNodesScreenRect` (Task 6), `TextStyleBar` (Task 5), `CanvasTextEditor` (Task 4), `AnnotationObjects` `onGestureChange` (Task 3).
- Produces: no new exports. Behaviour:
  - A Text-tool press starts a create gesture, and mouseup/leave (or the first move after a missed release) finishes it.
  - The bar renders for the target texts.
  - Double-click, a Text-tool click and Enter all open via `startEditing`.
  - Finishing keeps the text selected.

- [ ] **Step 1: Imports.** Replace:

```ts
import CanvasTextEditor from './CanvasTextEditor';
import { stepFontSize, wrapWidthForContent, isBlank } from '@/lib/markup/text';
```

with:

```ts
import CanvasTextEditor from './CanvasTextEditor';
import TextStyleBar from './TextStyleBar';
import { useMarkupText } from './useMarkupText';
import { useNodesScreenRect } from './useNodesScreenRect';
```

- [ ] **Step 2: Hook in the text session.** Replace:

```ts
  // The text object currently open for editing. The object itself already exists in `ann` —
  // this is only which one the editor is bound to.
  const [editingId, setEditingId] = useState<string | null>(null);

  const ann = useAnnotationObjects();
  const marquee = useMarqueeSelect(ann);
```

with:

```ts
  const ann = useAnnotationObjects();
  const marquee = useMarqueeSelect(ann);
  // Text creation, editing, the floating bar's target and its shortcuts — shared with the PDF viewer.
  const markupText = useMarkupText(ann, { enabled: true, activeTool, onObjectCreated });
  // Where the bar goes: the target texts' box, in this container's pixels.
  const barRect = useNodesScreenRect(stageRef, markupText.targetIds);
```

- [ ] **Step 3: Snapshot and clear.** Replace:

```ts
      if (editingId) (stage.findOne(`#${editingId}`) as Konva.Node | undefined)?.visible(true);
      setEditingId(null);
```

with:

```ts
      if (markupText.editingId) (stage.findOne(`#${markupText.editingId}`) as Konva.Node | undefined)?.visible(true);
      markupText.setEditingId(null);
```

and replace:

```ts
    clear: () => { setEditingId(null); ann.clear(); },
```

with:

```ts
    clear: () => { markupText.setEditingId(null); ann.clear(); },
```

- [ ] **Step 4: Text-tool press starts a gesture.** In `handleMouseDown`, replace the whole block:

```ts
    if (activeTool === 'text') {
      const wrapWidth = wrapWidthForContent(bgFit ? bgFit.width : size.width);
      // Keep the whole box on the surface. Clamp against the fitted background when there is
      // one — a native-resolution capture crops to exactly that region, so a box outside it
      // would be cropped away entirely.
      const bounds = bgFit ?? { x: 0, y: 0, width: size.width, height: size.height };
      const x = Math.max(bounds.x, Math.min(p.x, bounds.x + bounds.width - wrapWidth));
      const id = ann.addText({ x, y: p.y }, {
        text: '',
        color,
        strokeWidth,
        autoWidth: false,
        // The fitted background region, not the stage: the wrap width must not depend on how
        // much matte happens to surround the snapshot.
        width: wrapWidth,
      });
      setEditingId(id);
      // Return to the pointer immediately. Otherwise the click that commits this box would also
      // start another one, since the text tool would still be armed.
      onObjectCreated?.();
      return;
    }
```

with:

```ts
    if (activeTool === 'text') {
      // A press on an existing text never gets here: AnnotationObjects opens it for editing and
      // cancels the bubble. Anything else starts a create gesture; the mouseup decides click
      // (auto width) or drag (fixed width) — see finishText.
      markupText.beginCreate(p);
      return;
    }
```

- [ ] **Step 5: Text-tool move.** In `handleMouseMove`, replace:

```ts
    if (activeTool === 'pointer') {
      // A mouseup this stage never received (focus lost mid-drag) would leave the box stuck to
      // the cursor — the same guard the eraser uses above.
```

with:

```ts
    if (activeTool === 'text') {
      // A release this stage never received ends the press here, as the eraser's guard does.
      if (e.evt.buttons === 0) { finishText(); return; }
      markupText.moveCreate(p);
      return;
    }
    if (activeTool === 'pointer') {
      // A mouseup this stage never received (focus lost mid-drag) would leave the box stuck to
      // the cursor — the same guard the eraser uses above.
```

- [ ] **Step 6: Replace the commit helper with the finish helper.** Replace:

```ts
  const editingObj = editingId ? ann.objects.find((o) => o.id === editingId) ?? null : null;

  /** Blank in, nothing out — an empty box is a mis-click, not an object. */
  const commitText = () => {
    if (editingObj && isBlank(editingObj.text)) {
      ann.deleteObject(editingObj.id);
    }
    setEditingId(null);
  };
```

with:

```ts
  const editingObj = markupText.editingId ? ann.objects.find((o) => o.id === markupText.editingId) ?? null : null;

  /**
   * End a Text-tool press (a no-op when none is in flight). The box stays on the fitted
   * background when there is one — a native-resolution capture crops to exactly that region, so
   * a box outside it would be cropped away — else on the stage. The stage is untransformed, so
   * one stage pixel is one screen pixel for the drag threshold.
   */
  const finishText = () => {
    markupText.endCreate({ color, strokeWidth }, 1, bgFit ?? { x: 0, y: 0, width: size.width, height: size.height });
  };
```

- [ ] **Step 7: Mouseup / leave finish the press.** Replace:

```tsx
          onMouseUp={() => { stopErasing(); marquee.end(stageRef.current, 3); if (ann.endDraw()) onObjectCreated?.(); }}
          onMouseLeave={() => { stopErasing(); marquee.end(stageRef.current, 3); if (ann.endDraw()) onObjectCreated?.(); onMeasureHover?.(null); }}
```

with:

```tsx
          onMouseUp={() => { stopErasing(); finishText(); marquee.end(stageRef.current, 3); if (ann.endDraw()) onObjectCreated?.(); }}
          onMouseLeave={() => { stopErasing(); finishText(); marquee.end(stageRef.current, 3); if (ann.endDraw()) onObjectCreated?.(); onMeasureHover?.(null); }}
```

- [ ] **Step 8: AnnotationObjects props.** Replace:

```tsx
              marquee={marquee.box}
              onErase={ann.deleteObject}
              onChange={ann.updateObject}
              editingId={editingId}
              onEditText={setEditingId}
              onBakeText={ann.bakeTextTransform}
              onSetTextWidth={ann.setTextWidth}
```

with:

```tsx
              // The Text tool's live drag reuses the selection box's look.
              marquee={marquee.box ?? markupText.createBox}
              onErase={ann.deleteObject}
              onChange={ann.updateObject}
              editingId={markupText.editingId}
              onEditText={markupText.startEditing}
              onBakeText={ann.bakeTextTransform}
              onSetTextWidth={ann.setTextWidth}
              onGestureChange={markupText.setGesture}
```

- [ ] **Step 9: Editor commit/step and the bar.** Replace:

```tsx
          onChange={(t) => ann.updateText(editingObj.id, t)}
          onCommit={commitText}
          onStepFontSize={(dir) => ann.updateTextStyle([editingObj.id], { fontSize: stepFontSize(editingObj.fontSize, dir) })}
        />
      )}
```

with:

```tsx
          onChange={(t) => ann.updateText(editingObj.id, t)}
          onCommit={markupText.commit}
          onStepFontSize={markupText.stepFont}
        />
      )}

      {/* The floating text bar: the edited text, or a text-only selection. Hidden while an
          object is dragged or transformed, and until the selection has been measured. */}
      {markupText.targetObject && barRect && !markupText.gesture && (
        <TextStyleBar
          anchor={barRect}
          view={size}
          style={markupText.targetObject}
          editing={markupText.editingId !== null}
          onChange={markupText.applyStyle}
        />
      )}
```

- [ ] **Step 10: Gate.**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc prints nothing; `✔ No ESLint warnings or errors`; `# fail 0`.
Then `grep -n "setEditingId\|editingId\b" components/markup/AnnotationCanvas.tsx` must show only `markupText.` uses.

- [ ] **Step 11: Commit.**

```bash
git add components/markup/AnnotationCanvas.tsx
git commit -m "$(cat <<'EOF'
feat(markup): click/drag text, floating bar and Enter-to-edit on AnnotationCanvas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Wire PDFKonvaViewer and drop the 40 % wrap width

**Files:**
- Modify: `components/viewers/PDFKonvaViewer.tsx`
- Modify: `lib/markup/text.ts` (remove `MIN_WRAP_WIDTH`, `WRAP_FRACTION`, `wrapWidthForContent`)
- Modify: `scripts/tests/markupText.test.mjs` (full replacement)

**Interfaces:**
- Consumes: the same as Task 7.
- Produces: the same behaviour as Task 7, in page space. The drag threshold uses `stageScale`, the box stays on the page, and shortcuts are enabled only while `annotating`.

- [ ] **Step 1: Imports.** Replace:

```ts
import CanvasTextEditor from '@/components/markup/CanvasTextEditor';
import { stepFontSize, wrapWidthForContent, isBlank } from '@/lib/markup/text';
```

with:

```ts
import CanvasTextEditor from '@/components/markup/CanvasTextEditor';
import TextStyleBar from '@/components/markup/TextStyleBar';
import { useMarkupText } from '@/components/markup/useMarkupText';
import { useNodesScreenRect } from '@/components/markup/useNodesScreenRect';
```

- [ ] **Step 2: Hook in the text session.** Replace:

```ts
    const { begin: marqueeBegin, move: marqueeMove, cancel: marqueeCancel } = marquee;
    // The text object currently open for editing. The object itself already exists in `ann` —
    // this is only which one the editor is bound to.
    const [editingId, setEditingId] = useState<string | null>(null);
```

with:

```ts
    const { begin: marqueeBegin, move: marqueeMove, cancel: marqueeCancel } = marquee;
    // Text creation, editing, the floating bar's target and its shortcuts — shared with
    // AnnotationCanvas. Shortcuts only inside a markup session.
    const markupText = useMarkupText(ann, { enabled: annotating, activeTool, onObjectCreated });
    const { beginCreate: textBegin, moveCreate: textMove, endCreate: textEnd } = markupText;
    // Where the bar goes: the target texts' box, in this container's pixels (zoom and pan included).
    const barRect = useNodesScreenRect(stageRef, markupText.targetIds);
```

- [ ] **Step 3: Snapshot and clear.** Replace:

```ts
        if (editingId) (stage.findOne(`#${editingId}`) as Konva.Node | undefined)?.visible(true);
        setEditingId(null);
```

with:

```ts
        if (markupText.editingId) (stage.findOne(`#${markupText.editingId}`) as Konva.Node | undefined)?.visible(true);
        markupText.setEditingId(null);
```

and replace:

```ts
      clearDrawings: () => { setEditingId(null); ann.clear(); },
```

with:

```ts
      clearDrawings: () => { markupText.setEditingId(null); ann.clear(); },
```

- [ ] **Step 4: The finish helper.** Insert immediately before `    const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {`:

```ts
    // End a Text-tool press (a no-op when none is in flight): on mouseup, on leaving the stage,
    // or on the first move after a release this stage never saw. The box stays on the page, and
    // the drag threshold is in screen pixels — page pixels times the zoom.
    const finishText = useCallback(() => {
      textEnd({ color, strokeWidth }, stageScale, { x: 0, y: 0, width: pageSize.width, height: pageSize.height });
    }, [textEnd, color, strokeWidth, stageScale, pageSize.width, pageSize.height]);

```

- [ ] **Step 5: Text-tool press starts a gesture.** In `handleStageMouseDown`, replace:

```ts
      if (activeTool === 'text') {
        const wrapWidth = wrapWidthForContent(pageSize.width);
        const x = Math.max(0, Math.min(coords.x, pageSize.width - wrapWidth));
        const id = ann.addText({ x, y: coords.y }, {
          text: '',
          color,
          strokeWidth,
          autoWidth: false,
          // The page's own width, not the stage's: the stage width changes with the zoom, and a
          // zoom-dependent wrap would reflow committed text on every scroll.
          width: wrapWidth,
        });
        setEditingId(id);
        onObjectCreated?.();
        return;
      }
```

with:

```ts
      if (activeTool === 'text') {
        // A press on an existing text never gets here: AnnotationObjects opens it for editing
        // and cancels the bubble. Anything else starts a create gesture; the mouseup decides
        // click (auto width) or drag (fixed width) — see finishText.
        textBegin(coords);
        return;
      }
```

and replace its dependency list:

```ts
    }, [tagging, annotating, activeTool, getPageCoords, toPercent, onCommentPlace, currentPage, color, strokeWidth, ann, pageSize.width, onObjectCreated, eraseAt, onMeasurePoint, onSelectMeasurement, pendingMeasurement, marqueeBegin]);
```

with:

```ts
    }, [tagging, annotating, activeTool, getPageCoords, toPercent, onCommentPlace, currentPage, color, strokeWidth, ann, eraseAt, onMeasurePoint, onSelectMeasurement, pendingMeasurement, marqueeBegin, textBegin]);
```

- [ ] **Step 6: Text-tool move.** In `handleStageMouseMove`, replace:

```ts
      if (activeTool === 'pointer') {
        // A mouseup this stage never received (focus lost mid-drag) would leave the box stuck
        // to the cursor — the same guard the eraser uses above.
```

with:

```ts
      if (activeTool === 'text') {
        // A release this stage never received ends the press here, as the eraser's guard does.
        if (e.evt.buttons === 0) { finishText(); return; }
        const c = getPageCoords(stage);
        if (c) textMove(c);
        return;
      }
      if (activeTool === 'pointer') {
        // A mouseup this stage never received (focus lost mid-drag) would leave the box stuck
        // to the cursor — the same guard the eraser uses above.
```

and replace its dependency list:

```ts
    }, [annotating, activeTool, getPageCoords, ann, eraseAt, stopErasing, pendingMeasurement, onMeasureHover, marqueeMove, marqueeCancel]);
```

with:

```ts
    }, [annotating, activeTool, getPageCoords, ann, eraseAt, stopErasing, pendingMeasurement, onMeasureHover, marqueeMove, marqueeCancel, textMove, finishText]);
```

- [ ] **Step 7: Drop the old commit helper.** Replace:

```ts
    const editingObj = editingId ? ann.objects.find((o) => o.id === editingId) ?? null : null;

    const commitText = useCallback(() => {
      const obj = editingId ? ann.objects.find((o) => o.id === editingId) : null;
      if (obj && isBlank(obj.text)) ann.deleteObject(obj.id);
      setEditingId(null);
    }, [editingId, ann]);
```

with:

```ts
    const editingObj = markupText.editingId ? ann.objects.find((o) => o.id === markupText.editingId) ?? null : null;
```

- [ ] **Step 8: Mouseup / leave finish the press.** Replace:

```tsx
              onMouseUp={() => { stopErasing(); marquee.end(stageRef.current, 3 / stageScale); if (ann.endDraw()) onObjectCreated?.(); }}
              onMouseLeave={() => { stopErasing(); marquee.end(stageRef.current, 3 / stageScale); if (ann.endDraw()) onObjectCreated?.(); onMeasureHover?.(null); }}
```

with:

```tsx
              onMouseUp={() => { stopErasing(); finishText(); marquee.end(stageRef.current, 3 / stageScale); if (ann.endDraw()) onObjectCreated?.(); }}
              onMouseLeave={() => { stopErasing(); finishText(); marquee.end(stageRef.current, 3 / stageScale); if (ann.endDraw()) onObjectCreated?.(); onMeasureHover?.(null); }}
```

- [ ] **Step 9: AnnotationObjects props.** Replace:

```tsx
                  marquee={marquee.box}
                  onErase={ann.deleteObject}
                  onChange={ann.updateObject}
                  editingId={editingId}
                  onEditText={setEditingId}
                  onBakeText={ann.bakeTextTransform}
                  onSetTextWidth={ann.setTextWidth}
```

with:

```tsx
                  // The Text tool's live drag reuses the selection box's look.
                  marquee={marquee.box ?? markupText.createBox}
                  onErase={ann.deleteObject}
                  onChange={ann.updateObject}
                  editingId={markupText.editingId}
                  onEditText={markupText.startEditing}
                  onBakeText={ann.bakeTextTransform}
                  onSetTextWidth={ann.setTextWidth}
                  onGestureChange={markupText.setGesture}
```

- [ ] **Step 10: Editor commit/step and the bar.** Replace:

```tsx
              onChange={(t) => ann.updateText(editingObj.id, t)}
              onCommit={commitText}
              onStepFontSize={(dir) => ann.updateTextStyle([editingObj.id], { fontSize: stepFontSize(editingObj.fontSize, dir) })}
            />
          )}
```

with:

```tsx
              onChange={(t) => ann.updateText(editingObj.id, t)}
              onCommit={markupText.commit}
              onStepFontSize={markupText.stepFont}
            />
          )}

          {/* The floating text bar: the edited text, or a text-only selection. Hidden while an
              object is dragged or transformed, and until the selection has been measured. */}
          {annotating && markupText.targetObject && barRect && !markupText.gesture && (
            <TextStyleBar
              anchor={barRect}
              view={containerSize}
              style={markupText.targetObject}
              editing={markupText.editingId !== null}
              onChange={markupText.applyStyle}
            />
          )}
```

- [ ] **Step 11: Remove the 40 % wrap width from `lib/markup/text.ts`.** Delete these three blocks (each followed by one blank line):

```ts
/** A text box narrower than this is not worth typing in, whatever the content width says. */
export const MIN_WRAP_WIDTH = 120;

```

```ts
/** Fraction of the content width a fresh text box wraps at. */
const WRAP_FRACTION = 0.4;

```

```ts
/**
 * Wrap width for a fresh text box, in the content's own coordinate space.
 *
 * The caller passes the *content* width — the fitted background region on AnnotationCanvas,
 * the page width on PDFKonvaViewer — never the stage width. On a zoomable surface the stage
 * width changes with the zoom, and deriving the wrap from it would reflow already-committed
 * text on every zoom step.
 */
export function wrapWidthForContent(contentWidth: number): number {
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return MIN_WRAP_WIDTH;
  return Math.min(contentWidth, Math.max(Math.round(contentWidth * WRAP_FRACTION), MIN_WRAP_WIDTH));
}

```

- [ ] **Step 12: Replace `scripts/tests/markupText.test.mjs`** with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FONT_SIZE_PRESETS, MIN_FONT_SIZE, TEXT_FONT_FAMILY, isBlank } from '../../lib/markup/text.ts';

test('blank text is anything with no visible glyphs', () => {
  assert.equal(isBlank(''), true);
  assert.equal(isBlank('   '), true);
  assert.equal(isBlank('\n\n'), true);
  assert.equal(isBlank(' \t \n '), true);
  assert.equal(isBlank('a'), false);
  assert.equal(isBlank('  hi  '), false);
});

test('MIN_FONT_SIZE keeps a shrunk text object selectable', () => {
  assert.ok(MIN_FONT_SIZE > 0);
  assert.ok(MIN_FONT_SIZE <= FONT_SIZE_PRESETS[0]);
});

test('markup text is pinned to a family Konva and the DOM both resolve', () => {
  // The editor and the Konva node only measure alike when both are told the same family.
  assert.equal(TEXT_FONT_FAMILY, 'Arial');
});
```

- [ ] **Step 13: Gate.**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc prints nothing; `✔ No ESLint warnings or errors`; `# fail 0`.
Then `grep -rn "wrapWidthForContent\|MIN_WRAP_WIDTH\|commitText\|setEditingId(id)" app components lib scripts` must print nothing.

- [ ] **Step 14: Commit.**

```bash
git add components/viewers/PDFKonvaViewer.tsx lib/markup/text.ts scripts/tests/markupText.test.mjs
git commit -m "$(cat <<'EOF'
feat(markup): click/drag text, floating bar and Enter-to-edit on the PDF viewer

Retires the fixed 40%-of-page wrap width now that a click makes an auto-width
box and a drag sets the width.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Toolbar hides the stroke picker for text

**Files:**
- Modify: `components/markup/DrawingTools.tsx`
- Modify: `components/markup/AnnotationCanvas.tsx` (report `toolbarObject`)
- Modify: `components/viewers/PDFKonvaViewer.tsx` (report `toolbarObject`)

**Interfaces:**
- Consumes: `ann.toolbarObject` (Task 2).
- Produces: `onSelectionChange` now reports `toolbarObject`. Its `type` is `'text'` only for a text-only selection; for a mixed selection it reports the first non-text member. `DrawingTools` renders no `Stroke width` button while `selectionType === 'text'`. The portal page is unchanged.

- [ ] **Step 1: Surfaces report the toolbar object.** In `components/markup/AnnotationCanvas.tsx` replace:

```ts
  const sel = ann.selectedObject;
```

with:

```ts
  // toolbarObject, not selectedObject: in a mixed selection the toolbar reflects a shape, so the
  // stroke picker (hidden for text) stays available for the shapes it would restyle.
  const sel = ann.toolbarObject;
```

In `components/viewers/PDFKonvaViewer.tsx` replace:

```ts
    const sel = ann.selectedObject;
```

with:

```ts
    // toolbarObject, not selectedObject: in a mixed selection the toolbar reflects a shape, so
    // the stroke picker (hidden for text) stays available for the shapes it would restyle.
    const sel = ann.toolbarObject;
```

- [ ] **Step 2: `DrawingTools` prop doc.** Replace:

```ts
  /** Type of the currently selected markup object, or null. The stroke picker reads this to
   *  decide whether it is presenting stroke weights or text sizes — there is no other way for
   *  the toolbar to know what kind of object a width would be applied to. */
```

with:

```ts
  /** Type of the selected markup object the toolbar reflects, or null. 'text' only when the
   *  selection is text and nothing else — the stroke picker hides then, since a text's size
   *  lives in the floating text bar. */
```

- [ ] **Step 3: Drop the text-size presets.** Replace:

```ts
const STROKE_PRESETS = [
  { value: 2, label: 'Thin', textLabel: 'Small' },
  { value: 4, label: 'Medium', textLabel: 'Medium' },
  { value: 6, label: 'Thick', textLabel: 'Large' },
];

/** Glyph heights for the text-size variant of the picker, index-aligned with STROKE_PRESETS. */
const TEXT_PREVIEW_SIZES = [10, 13, 16];
```

with:

```ts
const STROKE_PRESETS = [
  { value: 2, label: 'Thin' },
  { value: 4, label: 'Medium' },
  { value: 6, label: 'Thick' },
];
```

- [ ] **Step 4: Hide rather than relabel.** Replace:

```ts
  // Width means font size on a text object, so the picker relabels rather than lying about it.
  const strokeIsTextSize = selectionType === 'text';
```

with:

```ts
  // A text-only selection has no stroke: its size lives in the floating text bar. Hide the
  // picker rather than offer a control that would do nothing.
  const strokeHidden = selectionType === 'text';
  // The picker can vanish with its sub-bar open (select a text while it is up). Close it, or
  // `menu` stays 'stroke' and every other label stays muted behind an invisible sub-bar.
  useEffect(() => {
    if (strokeHidden && menu === 'stroke') setMenu(null);
  }, [strokeHidden, menu]);
```

- [ ] **Step 5: The picker block.** Replace:

```tsx
        {/* Stroke width */}
        <div className="relative flex">
          <ToolButton
            label={strokeIsTextSize ? 'Text size' : 'Stroke width'}
            active={menu === 'stroke'}
            expanded={menu === 'stroke'}
            hideLabel={menu !== null}
            onClick={() => setMenu(menu === 'stroke' ? null : 'stroke')}
          >
            {StrokeWidthIcon}
          </ToolButton>
          {menu === 'stroke' && (
            <div className={SUB_BAR}>
              <div className={BAR}>
                {STROKE_PRESETS.map((s, i) => (
                  <ToolButton
                    key={s.value}
                    label={strokeIsTextSize ? s.textLabel : s.label}
                    active={strokeWidth === s.value}
                    onClick={() => { onStrokeWidthChange(s.value); setMenu(null); }}
                  >
                    {strokeIsTextSize ? (
                      <svg width="18" height="18" viewBox="0 0 18 18">
                        <text
                          x="9"
                          y="9"
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={TEXT_PREVIEW_SIZES[i]}
                          fontWeight="bold"
                          fill="currentColor"
                        >
                          A
                        </text>
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 18 18">
                        <line x1="2" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth={s.value} strokeLinecap="round" />
                      </svg>
                    )}
                  </ToolButton>
                ))}
              </div>
            </div>
          )}
        </div>
```

with:

```tsx
        {/* Stroke width — not for a text-only selection (see strokeHidden) */}
        {!strokeHidden && (
          <div className="relative flex">
            <ToolButton
              label="Stroke width"
              active={menu === 'stroke'}
              expanded={menu === 'stroke'}
              hideLabel={menu !== null}
              onClick={() => setMenu(menu === 'stroke' ? null : 'stroke')}
            >
              {StrokeWidthIcon}
            </ToolButton>
            {menu === 'stroke' && (
              <div className={SUB_BAR}>
                <div className={BAR}>
                  {STROKE_PRESETS.map((s) => (
                    <ToolButton
                      key={s.value}
                      label={s.label}
                      active={strokeWidth === s.value}
                      onClick={() => { onStrokeWidthChange(s.value); setMenu(null); }}
                    >
                      <svg width="18" height="18" viewBox="0 0 18 18">
                        <line x1="2" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth={s.value} strokeLinecap="round" />
                      </svg>
                    </ToolButton>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 6: Gate.**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc prints nothing; `✔ No ESLint warnings or errors`; `# fail 0`.
Then `grep -n "strokeIsTextSize\|TEXT_PREVIEW_SIZES\|textLabel" components/markup/DrawingTools.tsx` must print nothing, and `git diff --stat main -- 'app/portal/[id]/page.tsx' components/viewers/ViewerContainer.tsx` must print nothing.

- [ ] **Step 7: Commit.**

```bash
git add components/markup/DrawingTools.tsx components/markup/AnnotationCanvas.tsx components/viewers/PDFKonvaViewer.tsx
git commit -m "$(cat <<'EOF'
feat(markup): hide the stroke picker for a text-only selection

A text's size lives in the floating bar now. Mixed selections report their first
non-text member to the toolbar so the picker still restyles the shapes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Browser verification and cleanup

`npm run dev` cannot load pdf.js on this checkout (a pre-existing problem). Verify on a production build plus `npx next start -p 3000`. Nothing in this task is committed.

- [ ] **Step 1: Harness files (never committed).**

Generate a one-page PDF. Write this script to the session scratchpad as `make-pdf.mjs` (not in the repo), then run `node <scratchpad>/make-pdf.mjs /Users/user/Desktop/STIKO-main/public/uploads/harness-text.pdf` (create `public/uploads/` if it is missing):

```js
import { writeFileSync } from 'node:fs';
const content = 'BT /F1 24 Tf 72 700 Td (Harness page) Tj ET';
const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
let out = '%PDF-1.4\n';
const offsets = [];
objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const xref = out.length;
out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(process.argv[2], out);
```

Create `app/portal/harness-text/page.tsx`. It sits under `/portal/` so the middleware lets it through, and has no leading underscore:

```tsx
'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import DrawingTools from '@/components/markup/DrawingTools';
import type { AnnotationObjectType, MarkupSelection, ToolType } from '@/components/markup/useAnnotationObjects';
import type { PDFKonvaViewerHandle } from '@/components/viewers/PDFKonvaViewer';
import type { AnnotationCanvasHandle } from '@/components/markup/AnnotationCanvas';
import { DEFAULT_LENGTH_UNIT } from '@/lib/measure/units';

const PDFKonvaViewer = dynamic(() => import('@/components/viewers/PDFKonvaViewer'), { ssr: false });
const AnnotationCanvas = dynamic(() => import('@/components/markup/AnnotationCanvas'), { ssr: false });

export default function HarnessText() {
  const [surface, setSurface] = useState<'pdf' | 'image'>('pdf');
  const [tool, setTool] = useState<ToolType>('pointer');
  const [color, setColor] = useState('#E5484D');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [selectionType, setSelectionType] = useState<AnnotationObjectType | null>(null);
  const [bg, setBg] = useState<string | null>(null);
  const [snap, setSnap] = useState<string | null>(null);
  const pdfRef = useRef<PDFKonvaViewerHandle>(null);
  const imgRef = useRef<AnnotationCanvasHandle>(null);
  const active = () => (surface === 'pdf' ? pdfRef.current : imgRef.current);

  useEffect(() => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 800;
    const g = c.getContext('2d');
    if (g) {
      g.fillStyle = '#DFE7F5';
      g.fillRect(0, 0, 1200, 800);
      g.fillStyle = '#334';
      g.font = '40px Arial';
      g.fillText('Harness image', 60, 100);
    }
    setBg(c.toDataURL('image/png'));
    // Expose Konva for evaluate-based checks (Konva.stages[0]).
    import('konva').then((m) => { (window as unknown as { Konva: unknown }).Konva = m.default; });
  }, []);

  const onSel = useCallback((s: MarkupSelection | null) => {
    setSelectionType(s?.type ?? null);
    if (s && s.type !== 'image') { setColor(s.color); setStrokeWidth(s.strokeWidth); }
  }, []);
  const created = useCallback(() => setTool('pointer'), []);

  return (
    <div className="fixed inset-0 flex flex-col bg-white">
      <div className="flex gap-3 p-2 text-sm">
        <button id="h-pdf" onClick={() => setSurface('pdf')}>PDF</button>
        <button id="h-img" onClick={() => setSurface('image')}>Image</button>
        <button id="h-snap" onClick={() => setSnap(active()?.captureSnapshot() ?? null)}>Snapshot</button>
        <button id="h-red" onClick={() => active()?.applyStyleToSelection({ color: '#E5484D' })}>Apply red</button>
        <button id="h-thick" onClick={() => active()?.applyStyleToSelection({ strokeWidth: 6 })}>Stroke 6</button>
        <span id="h-sel">{selectionType ?? 'none'}</span>
        <span id="h-tool">{tool}</span>
      </div>
      <div className="relative flex-1">
        <div className="absolute inset-0">
          {surface === 'pdf' ? (
            <PDFKonvaViewer
              url="/uploads/harness-text.pdf"
              fileId="harness"
              activeTool={tool}
              color={color}
              strokeWidth={strokeWidth}
              onCommentPlace={() => {}}
              annotating
              comments={[]}
              activeCommentId={null}
              onCommentPinClick={() => {}}
              handleRef={pdfRef}
              onObjectCreated={created}
              onSelectionChange={onSel}
            />
          ) : (
            <AnnotationCanvas
              backgroundDataUrl={bg}
              activeTool={tool}
              color={color}
              strokeWidth={strokeWidth}
              handleRef={imgRef}
              onObjectCreated={created}
              onSelectionChange={onSel}
            />
          )}
        </div>
        <DrawingTools
          activeTool={tool}
          onToolChange={setTool}
          color={color}
          onColorChange={(c) => { setColor(c); active()?.applyStyleToSelection({ color: c }); }}
          strokeWidth={strokeWidth}
          onStrokeWidthChange={(w) => { setStrokeWidth(w); active()?.applyStyleToSelection({ strokeWidth: w }); }}
          tagging={false}
          onToggleTagging={() => {}}
          onInsertImage={() => {}}
          offsetTop={56}
          selectionType={selectionType}
          measureUnit={DEFAULT_LENGTH_UNIT}
          onMeasureUnitChange={() => {}}
          scaleSource="unknown"
          canCalibrate={false}
          measureAvailable={false}
        />
      </div>
      {snap && <img id="h-snap-img" src={snap} alt="" className="fixed bottom-2 right-2 w-[360px] border" />}
    </div>
  );
}
```

Build and start:

```bash
cd /Users/user/Desktop/STIKO-main && npm run build && npx next start -p 3000
```

If the build fails on missing env, use the fallback: `AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' R2_ACCESS_KEY_ID=dev R2_SECRET_ACCESS_KEY=dev R2_ENDPOINT_URL='https://example.invalid' R2_BUCKET_NAME=dev npm run build`, and start with the same prefix. Open `http://localhost:3000/portal/harness-text` with chrome-devtools.

Useful evaluate snippets:
- **Text groups:** `Konva.stages[0].find('.markup-text').map(g => { const t = g.findOne('Text'); return { id: g.id(), x: g.x(), y: g.y(), sx: g.scaleX(), w: t.width(), autoW: t.attrs.width === undefined, fs: t.fontSize(), style: t.fontStyle(), align: t.align(), pad: t.padding(), lines: t.textArr.length, box: !!g.findOne('.markup-text-box') }; })`
- **Transformer:** `const tr = Konva.stages[0].findOne('Transformer'); ({ nodes: tr.nodes().length, anchors: tr.enabledAnchors(), keepRatio: tr.keepRatio() })`
- **Bar:** `document.querySelector('[role=toolbar][aria-label="Text style"]')?.getBoundingClientRect()`
- **Editor:** `document.querySelector('[data-markup-text-editor]')` and its parent box rect.

- [ ] **Step 2: Checks.** Record pass/fail with evidence for each, preferring evaluate output over screenshots. Run every check on BOTH surfaces (`#h-pdf`, then `#h-img`) unless it is marked otherwise.
  1. **Click-create, auto-width, typeable at once.**
     - Arm Text and click empty space.
     - `document.activeElement` is the `[data-markup-text-editor]` textarea and `#h-tool` reads `pointer`.
     - Type `Hello world` with `type_text`. The textarea's computed `white-space` is `pre` and its box width grows (record it before and after). Press Enter, type a second line, and the box gets taller.
     - The box shows a solid 1px `rgb(91, 96, 255)` outline (`getComputedStyle(box).outlineStyle === 'solid'`).
  2. **Defaults.** After Esc, the Group's Text reports `fs: 20`, `style: 'bold'`, `align: 'left'`, `pad: 0`, `box: false` and `autoW: true`, and its fill is the current colour.
  3. **Drag-create, fixed width.**
     - Arm Text and drag 200 screen px.
     - Type a sentence long enough to wrap. The textarea wraps (`white-space: pre-wrap`, more than one line).
     - After Esc, Text `w` ≈ 200 / zoom, `autoW: false` and `lines > 1`.
     - A 3px drag makes an auto-width box instead.
  4. **Side handle reflows.**
     - Select a fixed-width text and drag the `middle-right` anchor 80px left. `w` shrinks by about 80 / zoom, `fs` is unchanged, `lines` increases and `sx === 1`.
     - On an auto-width text, the same drag sets `autoW: false`.
     - `middle-left` moves `x` and keeps the right edge.
  5. **Corner scales the font.** Drag `bottom-right` outward. `fs` grows in proportion, `sx === 1`, and a fixed box's `w` grows by the same factor.
  6. **Handles.** For a single text, `anchors` has no `top-center`/`bottom-center` and `keepRatio === true`. For text + rect (Shift+click), all 8 anchors show. Rotation still works with the rotater.
  7. **Three ways to re-open, caret at the end** (`selectionStart === value.length`):
     - (a) double-click with Pointer;
     - (b) arm Text and click the text's glyphs: no new Group appears (count unchanged) and the tool returns to `pointer`;
     - (c) select one text and press Enter. Enter does NOT open the editor while the bar's size field has focus, or with two texts selected.
  8. **Three ways to finish, staying selected:**
     - (a) Esc;
     - (b) ⌘/Ctrl+Enter, where the text gains no trailing newline;
     - (c) click empty canvas: the editor closes, the Transformer has 1 node, and no new text or selection box appears.
     - Clicking the bar (Bold) leaves the editor open with focus still in the textarea.
     - An empty text finished with Esc is removed (Group count drops).
  9. **Bar controls change the canvas** (selected, and again while editing):
     - Size field: type 32 then Enter, and `fs: 32`.
     - Preset menu 48 gives `fs: 48`. ⌘/Ctrl+Shift+> gives 64 and < gives 48.
     - Typing 500 gives 400, and typing 2 gives 6.
     - B toggles `style` between `bold` and `normal`. I adds `italic`. Align center/right sets `align`.
     - Fill yellow gives `box: true` and `pad: 8`, with box fill `#FFF4B8`. Border sets box stroke = text colour and strokeWidth 1.5.
     - Fill None + border off gives `box: false` and `pad: 0`, and the Group `x` is unchanged.
     - With two texts selected, Bold applies to both.
  10. **Hit areas.**
      - Plain fixed-width text: a click 40px right of its last glyph (inside the wrap width) does NOT select it.
      - With a fill: a click in the 8px padding selects it.
      - A selection box over the plain text's empty wrap area does not select it.
  11. **Snapshot.** With a filled, bordered text present, click `#h-snap` and screenshot `#h-snap-img`. The fill and border are visible.
  12. **No jump between editing and committed text** (PDF at zoom ≠ 1 — press zoom-in twice — and on AnnotationCanvas):
      - Use a filled, bordered, centred, italic text in the editor.
      - Compare the editor box rect, minus the container's rect, with `group.getClientRect({ skipStroke: true })`. Left, top, width and height agree within 1px.
      - Screenshot just the box region before and after Esc. The glyphs do not move.
      - Repeat for a plain left-aligned auto-width text.
  13. **Bar position.**
      - Centred above the selection: `|barCenterX − selCenterX| ≤ 1`, and the bar bottom sits 64px above the box top for a selection and 8px while editing.
      - A text near the top: the bar drops below it.
      - A text at the far right: the bar is clamped 8px inside.
      - The bar is absent mid-drag. Dispatch `mousedown` on the text's screen point, then a `mousemove`, read the DOM, then `mouseup`. The bar reappears at the new position.
  14. **Toolbar.**
      - A text-only selection has no `[aria-label="Stroke width"]` button and `#h-sel` reads `text`.
      - A rect selection shows the button.
      - A text + rect selection shows the button, and `#h-thick` (stroke 6) thickens the rect without changing the text's `fs`.
      - `#h-red` with a text selected recolours it.
  15. **Multi-select and eraser still work.**
      - A selection box over two shapes selects both.
      - A group corner drag with a text in it bakes its `fs`.
      - The eraser removes a plain text when its glyphs are clicked, and a filled text when its padding is clicked.
  16. **PDF only.** With `annotating` on, the stage does not pan. ←/→ do nothing while the editor is focused. The console has no errors beyond known harness noise (the unpkg pdf worker, missing session).

- [ ] **Step 3: Clean up and final gate.**
  - Stop the server.
  - Delete `app/portal/harness-text/`, `.next/types/app/portal/harness-text`, `public/uploads/harness-text.pdf` and the scratchpad script.
  - Run `npx tsc --noEmit && npm run lint && npm test && npm run build` (with the env fallback if needed). All must be clean.
  - `git status --short` must show only the five long-lived untracked dirs:
    ```
    ?? design_handoff_brief_section/
    ?? design_handoff_dashboard_redesign/
    ?? design_handoff_portal_view/
    ?? logo/
    ?? stiko_handoff/
    ```
  - Report the check results. Nothing is committed in this task.
