# Portal Markup Enhancements — Design

**Date:** 2026-08-27
**Status:** Approved. Implementation plan: `docs/superpowers/plans/2026-08-27-portal-markup-enhancements.md`
**Scope:** Type text directly inside an on-canvas box that grows to fit it; make every applied markup object re-editable with the colour and stroke controls; remove the black border from annotation snapshots; and restyle the annotation banner into a floating pill that speaks the portal's design language.

---

## Why

Four reported defects across the portal markup session, from one user report.

> "i dont want to type on a separate text input box, and then press enter. i want to type straight inside the marquee text box."

> "everything i type should be visible inside the marquee box, when the text is long, it shouldnt disappear."

> "any applied object (shape, text, free hand, etc.) can be selected and modified with different colors and stroke width."

> "the snapshot captured during annotation doesnt look very good. there is always a black border in the snapshot."

They are independent symptoms, but three of the four sit in the same two files — `components/markup/AnnotationCanvas.tsx` and `components/viewers/PDFKonvaViewer.tsx`, which carry near-duplicate copies of the same markup surface.

### Complaint 1: text is typed somewhere other than where it lands

Both surfaces implement the text tool as a floating HTML popup: a bordered white card with an `<input>`, a Cancel button and an Add button, positioned near the click point (`AnnotationCanvas.tsx:199-223`, `PDFKonvaViewer.tsx:222-262`). Only on Enter or Add does `ann.addText` create the Konva object.

So the text is composed in one place and appears in another, at a different size, in a different colour, on a different background. The popup input is also a fixed `minWidth: 150` single-line field: long text scrolls out of view inside it while you type, which is the "it shouldnt disappear" half of the report.

### Complaint 2: colour and stroke width are write-once

`DrawingTools` raises `onColorChange` / `onStrokeWidthChange`, and `page.tsx` routes them into `drawingColor` / `drawingStrokeWidth` (`page.tsx:170-171`). Those are read only by `startDraw` and `addText` at *creation* time. Nothing anywhere calls `ann.updateObject` with a `color` or `strokeWidth` patch, so once an object exists its style is frozen.

Move, scale, rotate and delete already work — `AnnotationObjects` binds a `Transformer` to the selection and commits `onTransformEnd`/`onDragEnd`, and both surfaces handle Delete/Backspace. Style is the only missing axis.

### Complaint 3: the snapshot's black border, which has two causes

Both surfaces capture with `stage.toDataURL({ pixelRatio: 2, mimeType: 'image/jpeg' })`. JPEG has no alpha channel, so **every transparent pixel in the stage encodes as black**. Two separate things leave transparent pixels:

**Cause A — the banner shrinks the viewer after the snapshot is taken.** `startAnnotationSession` (`page.tsx:513-524`) runs `setAnnotating(true)` and then, in the same synchronous block, `captureViewerSnapshot(container)`. React has not re-rendered yet, so the capture reads the viewer at its full height. The re-render then mounts the annotation banner — a `flex-shrink-0` row inside the centre column's `flex flex-col gap-3` (`page.tsx:887`) — which costs the viewer that row's height plus a `gap-3`. A snapshot of the taller viewport is then letterboxed into the shorter stage by `bgFit` (`AnnotationCanvas.tsx:85-91`), leaving vertical bars down the left and right. They are transparent, so they save black. This is the wide, always-present border in the report.

**Cause B — the matte is CSS, not canvas.** The surround is painted by the wrapping `div` (`bg-gray-900` on `AnnotationCanvas.tsx:171`, `bg-gray-100` on `PDFKonvaViewer.tsx:315`). `toDataURL` reads the Konva stage, which knows nothing about its container's CSS background. So even a one-pixel rounding gap — or the genuinely different aspect ratio of an attachment session — reaches the encoder as transparent, and therefore black.

Cause A is why the border is wide. Cause B is why it is black. Both must be fixed: lightening the matte alone would leave grey bars, and stopping the resize alone would leave attachment sessions black.

### Complaint 4: the banner is off-language

The banner is amber-on-amber (`bg-amber-50`, `border-amber-200`, `text-amber-700`, `bg-amber-400` dot) with a text link and a filled `bg-amber-600` button, at `text-xs`. Nothing in that sentence is a Stiko token. The portal's own language — established in `DrawingTools`, `FocalLengthControl` and the redesign — is white `rounded-sheet` surfaces, `stiko-border` hairlines, `shadow-stiko-panel`, `stiko-ink` / `stiko-secondary` text, and tinted 34×34 chips.

---

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Text editing mechanism | **HTML `<textarea>` overlaid on the Konva text node**, the canonical Konva recipe. |
| 2 | Commit gesture | **Click away or Escape commits. `Enter` inserts a newline.** Empty/whitespace discards the object. |
| 3 | Box growth | **Grows with the text, wrapping at 40% of the content width**, then growing downward. |
| 4 | Stroke presets on text | **Map to font size** — Thin/Medium/Thick → 16 / 24 / 34 px. |
| 5 | Re-editability of non-text objects | **Style plus move/scale/rotate.** No geometry/point handles, no re-entering a freehand stroke. |
| 6 | Snapshot fix | **Keep the full frame; paint the surround in the viewer's own light background** rather than cropping to content. |
| 7 | Banner placement | **Floating pill, bottom-centre, inside the viewer area.** |
| 8 | Banner actions | **Icon-only:** ✕ on semi-transparent light red, ✓ on semi-transparent light green. |
| 9 | Banner text size | **14px**, up from 12px. |
| 10 | Toolbar reflects selection | **Yes** — selecting an object pulls its colour and width into the toolbar. |

### Why decision 1 rather than pure Konva

Konva has no text input primitive. Rendering a caret and handling keystrokes directly on the canvas would mean reimplementing caret movement, selection, word wrap, clipboard and IME composition from scratch — a large surface area of edge cases for no user-visible gain over a native field. The overlaid textarea gets all of that from the browser.

The cost is that the textarea must mirror the stage transform. On `AnnotationCanvas` the stage is unscaled, so the mirror is the identity. On `PDFKonvaViewer` the stage carries `scaleX/scaleY = stageScale` and `x/y = stagePos` (`PDFKonvaViewer.tsx:329-333`), so both the position and the font size must be multiplied through. This is the only real complexity in the feature and it is contained in one prop.

`contentEditable` was rejected: it accepts pasted rich text and HTML, which would then need stripping.

### Why decision 6 rather than cropping

Cropping to the content region gives a perfectly seamless image but silently discards any markup drawn outside it — in an attachment session, the letterbox around a portrait image is a natural place to write a note, and losing it without warning is worse than a light-grey band. With decision 7 removing the letterbox from ordinary sessions entirely, the matte is only visible when the aspect ratio genuinely differs, where a light band reads as intentional.

### Why decision 5 is a non-goal

Per-vertex editing — dragging an arrow's tip, a rectangle's corner, a point on a freehand stroke — was offered and **declined by the user** in favour of style plus the existing transform handles. Each shape type would need its own anchor set and hit-testing. Worth revisiting if users start redrawing shapes rather than adjusting them.

---

## Approach

### In-place text, shared by both surfaces

`ann.addText` currently refuses empty text (`useAnnotationObjects.ts:76`), which forces the create-after-typing order that puts the input somewhere else. Inverting that is what makes in-place editing possible:

1. Click with the text tool → an **empty** text object is created at that point and immediately opened for editing.
2. `CanvasTextEditor` renders a textarea over its position, matching font family, size, colour and the stage scale, with a dashed marquee border.
3. Every keystroke writes through to the object via `updateText`, so the committed Konva `Text` and the editor never disagree about content.
4. Clicking anywhere outside, or Escape, closes the editor. If the text is empty or whitespace, the object is deleted rather than committed.

Double-clicking a committed text object with the pointer tool re-opens the same editor seeded with the existing content and the caret at the end — the "add more text to it" requirement.

While the editor is open the Konva `Text` node is hidden (`visible={false}`), so the glyphs are not drawn twice at slightly different rasterisations.

#### Wrapping must agree in two places

The editor wraps at `0.4 × contentWidth` via CSS. The committed Konva `Text` must wrap identically or the text will reflow the moment it is committed. So the object stores the wrap `width` it was edited at, and renders with `width={obj.width} wrap="word"`. The editor and the node then share one number rather than two independent wrapping implementations.

**"Content width" differs per surface, and must be the surface's own object space, not its screen size.** On `AnnotationCanvas` it is `bgFit.width` — the fitted background region, not the whole stage, so the wrap width does not depend on how much matte happens to surround the snapshot. On `PDFKonvaViewer` it is `pageSize.width`, the page's own coordinate space, so a text box wraps the same way regardless of the current zoom. Both are already computed in their respective files. Deriving the wrap width from the *stage* would make it zoom-dependent on the PDF surface, which would reflow committed text on every zoom step.

Width measurement uses a hidden mirror element with the same font and `white-space: pre-wrap`, which is what lets the box track the text exactly rather than being sized by a guess.

#### Delete/Backspace must not fire while typing

Both surfaces bind a window-level Delete/Backspace handler that removes the selection. Both already bail when `document.activeElement` is an `INPUT`, `TEXTAREA` or `contentEditable` (`AnnotationCanvas.tsx:74`, `PDFKonvaViewer.tsx:80`), so the focused textarea is covered by the existing guard. No change needed — but it is the reason the editor must be a real focused form control rather than a styled div.

### Style edits reach the selection

Two additions to each surface's imperative handle:

- `applyStyleToSelection({ color?, strokeWidth? })` — patches the selected object. For `text`, `strokeWidth` is translated through the preset map to `fontSize`; for `image`, both are ignored.
- an `onSelectionChange(style | null)` callback — reports the selected object's `{ type, color, strokeWidth }` upward, or `null` when the selection is cleared.

In `page.tsx`, `onColorChange` and `onStrokeWidthChange` gain a second effect: set the default for the next object **and** push onto the current selection. Nothing else changes, and with no selection the behaviour is exactly as it is today.

`onSelectionChange` also drives a new `selectionType: AnnotationObjectType | null` state, passed to `DrawingTools`. That is what the stroke picker reads to decide whether to present itself as stroke weights or as text sizes — the toolbar has no other way to know what kind of object is selected. It is `null` whenever nothing is selected, which is the existing appearance.

Feeding the selection's style back into `drawingColor` / `drawingStrokeWidth` is a deliberate design-tool convention — clicking a green arrow makes green the active swatch — and it means one piece of state drives both the toolbar's appearance and the next object's style, rather than two that can disagree.

#### Text scale must be baked, not accumulated

The `Transformer` resizes by setting `scaleX/scaleY`, which `onTransformEnd` commits verbatim (`AnnotationObjects.tsx:67-70`). For text that would multiply against a font-size preset: a text object scaled to 2× and then set to "Thick" would render at 68px, not 34px.

So for `type === 'text'` only, transform-end bakes the scale into the object — `fontSize × scaleY`, `width × scaleX` — and resets `scaleX/scaleY` to 1. This is standard Konva text handling and it keeps the font-size presets absolute.

### A seamless snapshot

**Cause A — stop the reflow.** The banner moves inside `viewerAreaRef` as an absolutely-positioned pill (decision 7). The viewer area's height then no longer depends on whether a session is running, so the snapshot and the stage always share an aspect ratio and `bgFit` produces no letterbox at all.

The pill cannot appear in the capture: `captureViewerSnapshot` reads the `<canvas>` element and `stage.toDataURL()` reads the Konva stage. Neither sees sibling DOM. This is the same property already relied on by `FocalLengthControl` and documented at `FocalLengthControl.tsx:21`.

The bottom-centre slot is free during a session — `FocalLengthControl`, `CrossSectionControl` and `TransformTools` are all gated on `!annotating` (`page.tsx:956`, `page.tsx:967`).

**Cause B — put the matte inside the stage.** A `Rect` covering the full stage becomes the first node of each surface's bottom layer:

- `AnnotationCanvas`: `#f0f0f0`, matching the 3D viewer's own background (`ModelViewerInner.tsx:605`), so on a 3D snapshot the seam between the model's background and the matte is invisible.
- `PDFKonvaViewer`: `#f3f4f6`, matching its existing `bg-gray-100` container.

On the PDF surface the rect must be expressed in **page space**, because the scale and translation live on the `Stage` and every layer inherits them. Covering the visible container means:

```
x      = -stagePos.x / stageScale
y      = -stagePos.y / stageScale
width  =  containerSize.width  / stageScale
height =  containerSize.height / stageScale
```

The on-screen CSS matte is lightened to the same values (`bg-gray-900` → `#f0f0f0` on `AnnotationCanvas`), so what is captured is what was on screen. `AnnotationCanvas` keeps its existing transparent-when-no-background branch — with no snapshot the live viewer must still show through.

### The banner as a floating pill

`AnnotationBanner` is built from the toolbar's own recipe so it reads as a sibling of the markup bar:

```
        ┌──────────────────────────────────────────────┐
        │ ●  Marking up — apply to attach it   │ ✕ │ ✓ │
        └──────────────────────────────────────────────┘
          ↑              ↑                      ↑    ↑
       primary dot    14px, ink/secondary    red   green
                                            chip   chip
```

- Shell: the toolbar's `BAR` — `h-[46px] px-[6px] rounded-sheet bg-white border border-stiko-border shadow-stiko-panel`.
- Position: `absolute bottom-3 left-1/2 -translate-x-1/2 z-30`.
- Dot: `stiko-primary` (#5B60FF), keeping the existing pulse.
- Text: 14px, `tracking-heading`; filename in `stiko-ink`, surrounding phrase in `stiko-secondary`.
- Buttons: the toolbar's `34×34 rounded-[11px]` slot geometry and hover lift.
  - **✕ Discard** — `bg-[#FFE2E2]/60`, border `stiko-chip-red`, glyph `#B23A52`; `bg-[#FFE2E2]` on hover.
  - **✓ Apply** — `bg-[#EDFFDA]/60`, border `stiko-chip-green`, glyph `#4B7A28`; `bg-[#EDFFDA]` on hover.
- Hover labels ("Discard" / "Apply") sit **above** the buttons — the mirror of the toolbar's labels, which hang below. The pill is at the bottom of the viewport, so below is the side without room.

Copy changes because "Done" no longer names a visible button:

| session | text |
|---|---|
| ordinary | `Marking up — apply to attach it to your comment` |
| attachment | `Marking up ` **`sketch.png`** ` — applying replaces the attachment` |

`BAR`, `SLOT_BASE`, `slot()` and `LABEL` are currently module-private constants in `DrawingTools.tsx`. Two components now need them, so they move to `components/markup/toolbarStyles.ts` — one definition rather than two that drift.

---

## Components

### `lib/markup/text.ts` (new)

Pure, no React, no Konva — reachable by the `node --test` suite.

- `STROKE_TO_FONT_SIZE` / `fontSizeForStrokeWidth(w)` / `strokeWidthForFontSize(px)` — the 2/4/6 ↔ 16/24/34 map, both directions (the reverse is what lets the toolbar show the right preset for a selected text object).
- `wrapWidthForContent(contentWidth)` — the 40% rule with a sensible floor, so the box is still usable on a narrow PDF page or a small fitted region.
- `isBlank(text)` — the discard-on-empty predicate, shared by editor commit and object creation.

### `lib/markup/matte.ts` (new)

- `matteRectForStage({ stagePos, stageScale, containerSize })` — the page-space background rect above. Pure arithmetic, directly testable.

### `components/markup/CanvasTextEditor.tsx` (new)

The overlaid textarea. Props: `x`, `y` (screen coords, already mapped by the caller), `scale`, `color`, `fontSize`, `wrapWidth`, `value`, `onChange`, `onCommit`, `onCancel`. Owns the auto-grow measurement, the dashed marquee, the outside-pointerdown and Escape listeners, and autofocus with the caret at the end. Knows nothing about Konva or about which surface it is on.

`fontSize` and `wrapWidth` arrive in object space and are multiplied by `scale` for display, so the caller passes the same numbers it stores on the object.

### `components/markup/toolbarStyles.ts` (new)

`BAR`, `SUB_BAR`, `SLOT_BASE`, `slot()`, `LABEL`, lifted verbatim from `DrawingTools.tsx`.

### `components/markup/AnnotationBanner.tsx` (new)

The floating pill. Props: `annotatingFileName: string | null`, `onDiscard`, `onApply`. Presentational.

### `components/markup/useAnnotationObjects.ts` (modified)

- `addText` accepts empty text and returns the id unconditionally; gains a `width` argument for the wrap width.
- `updateText(id, text)` — write-through from the editor.
- `applyStyle(id, { color?, strokeWidth? })` — routes `strokeWidth` to `fontSize` for text objects, no-ops for images.
- `bakeTextTransform(id, node)` — folds `scaleX/scaleY` into `fontSize`/`width`.

### `components/markup/AnnotationObjects.tsx` (modified)

- `text` renders with `width`, `wrap="word"`, and `visible={editingId !== obj.id}`.
- `onDblClick`/`onDblTap` on text raises `onEditText(id)` when the pointer tool is active.
- `onTransformEnd` routes text through `bakeTextTransform`.

### `components/markup/AnnotationCanvas.tsx` (modified)

Popup replaced by `CanvasTextEditor` at `scale = 1`; background `Rect` added to the bottom layer; CSS matte lightened; `applyStyleToSelection` and `onSelectionChange` added to the handle.

### `components/viewers/PDFKonvaViewer.tsx` (modified)

The same, at `scale = stageScale` with page-space ↔ screen conversion, and the matte rect from `matteRectForStage`.

### `components/markup/DrawingTools.tsx` (modified)

Imports its style constants from `toolbarStyles`; the stroke presets relabel to Small/Medium/Large and show glyph sizes rather than line weights when the selection is text.

### `app/portal/[id]/page.tsx` (modified)

Banner row replaced by `AnnotationBanner` inside `viewerAreaRef`; colour/width handlers also push to the selection; selection style flows back into `drawingColor`/`drawingStrokeWidth`.

---

## Integration points

- **Both surfaces stay independent.** They share `useAnnotationObjects`, `AnnotationObjects` and now `CanvasTextEditor`, but neither imports the other. The only surface-specific knowledge in the new code is the coordinate mapping, passed in as props.
- **`handleAnnotationDone` is unchanged.** It still asks the active surface for `hasObjects()` and `captureSnapshot()`. The `{ native: true }` attachment path is untouched — it already crops to `bgFit` and so never had the border.
- **`endSession` is unchanged**, but must now also close any open text editor. Committing on unmount is not enough: discarding a session mid-edit should discard the text too.
- **Comment pins, tagging and the transform gizmo are untouched.** The existing mutual-exclusion effects between `tagging`, `activeTool` and `transformMode` (`page.tsx:563-581`) keep working as-is.

## Testing

`node --test scripts/tests/*.mjs`, following `crossSection` / `focalLength` — pure logic in `lib/markup/`, exercised directly:

- `markupText.test.mjs` — the stroke↔font-size map round-trips; unmapped widths clamp to the nearest preset; `wrapWidthForContent` respects the floor on a narrow page; `isBlank` treats whitespace and newlines as empty.
- `markupMatte.test.mjs` — `matteRectForStage` covers the full container at scale 1, when zoomed in, when zoomed out, and when panned so the origin is off-screen; the rect's screen-space projection always contains the container rect.

Interaction is verified in the browser against the running app, per `stiko-local-visual-verification`: type a long multi-line label on a 3D model and on a PDF page, confirm it stays inside the growing box; recolour and resize a committed arrow, rect, freehand stroke and text; double-click text and append to it; then apply and confirm the attached snapshot has no black band on any of the three session types (3D, image, PDF) and none on an attachment session either.

## Rollback

Every change is additive or a straight substitution within the markup components; no schema, API or storage change. Reverting the commit restores the popup text tool, the write-once styling, the amber banner and the black border together. The four fixes are independent enough to revert individually if only one regresses.
