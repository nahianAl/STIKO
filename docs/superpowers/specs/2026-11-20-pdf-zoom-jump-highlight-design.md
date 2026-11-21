# PDF viewer: sharp zoom, comment → page jump, highlighter

Date: 2026-11-20 · Branch: `feature/pdf-zoom-jump-highlight` · No migration.

Three independent changes to the PDF viewer (`components/viewers/PDFKonvaViewer.tsx`,
`components/viewers/pdf/PdfScrollView.tsx`). DWG/DXF reach this same viewer as vector PDFs
(ezdxf → PyMuPDF in `converter/`), so changes 1 and 2 cover them with no extra work.

## 1. Sharp zoom

### Problem
- **Single-page mode** renders the page once at `PDF_RENDER_SCALE` (2) into an image and the Konva
  Stage scales that image up to 500 %. Past ~100 % on a 2× display the pixels are stretched.
- **Scroll mode** re-renders each visible page at the settled zoom × dpr, but `cappedRenderScale`
  limits a canvas to 16 M px / 16 384 px a side. An A1 sheet at 2× is already ~16 M px, so large
  drawings stop gaining resolution almost immediately.

### Design: a viewport-sized "detail" render over the base
The base render stays exactly as it is — same size, same coordinate space — so pins, markup,
measurements and per-page calibration (all in page pixels at `PDF_RENDER_SCALE`) are untouched.

On top of it, after zoom/pan has been still for `SETTLE_MS` (150 ms), draw a **detail render**:
only the part of the page that is on screen, at the true on-screen resolution
(zoom × devicePixelRatio, dpr capped at 2 as scroll mode already does). Its canvas is at most the
viewport's size × dpr, so it never meets the canvas limits regardless of sheet size or zoom.

- pdf.js renders a sub-rectangle by rendering the page viewport at the target scale with a
  translate transform (`transform: [1,0,0,1,-x,-y]`) into a canvas the size of the visible rect.
- A new zoom/pan cancels the in-flight detail render (`task.cancel()`), and the stale detail is
  hidden immediately so a misaligned tile never shows; the stretched base shows until the new
  detail lands. The view is never blank.
- The detail is only drawn when it would add resolution: when the needed device-pixel density
  exceeds what the base already has. At fit-zoom nothing extra is rendered.
- Pure geometry in `lib/pdf/detailTile.ts` (no React, no `@/` imports, node-testable):
  - `visiblePageRect(...)` — the intersection of the viewport with the page, in page pixels,
    snapped outward to whole device pixels so the tile edges don't shimmer.
  - `needsDetail(...)` — true when the on-screen density exceeds the base's density.
  - `detailRenderParams(...)` — pdf.js scale, transform offset and canvas size for a rect.
- A shared `renderPageRegion(page, rect, scale)` next to `renderPageToCanvas` in
  `lib/pdf/pageRender.ts`, returning the same cancellable `PageRenderJob`.

**Single-page:** a non-listening Konva `Image` in the page layer, positioned/sized in page pixels
at the visible rect, above the base image and below markup/pins. Because it is part of the stage,
`captureSnapshot` while zoomed in now captures the sharper pixels too.

**Scroll mode:** each rendered `ScrollPage` gets an absolutely positioned second `<canvas>` covering
the visible part of that page, drawn only for pages where `needsDetail` holds (i.e. the base hit the
canvas cap). Pages out of view drop their detail canvas (`releaseCanvas`).

Max zoom stays 500 %.

## 2. Clicking a tagged comment jumps to its page

### Problem
`PDFKonvaViewer` receives `activeCommentId` but only uses it to highlight a pin; it never changes
page. Pins are filtered to `currentPage`, so a comment on page 7 clicked while on page 2 does
nothing visible.

### Design
An effect in `PDFKonvaViewer` keyed on `activeCommentId` (and on the document becoming ready, so a
Brief citation that switches files still lands once that PDF has loaded):

1. Resolve the comment. Skip if it has no `pageNumber`, the page is out of range, or a markup /
   measure session is open (`annotating` — the page is locked then).
2. **Single-page:** if `pageNumber !== currentPage`, `setCurrentPage(pageNumber)`. Once that page
   is laid out, if the pin is outside the visible stage area, pan so it is centred, keeping zoom.
3. **Scroll mode:** if the pin is not in view, scroll so the pin is centred (new
   `scrollToPoint(page, xPct, yPct)` on the scroll view handle, built on the existing layout math).
4. Fires once per change of `activeCommentId` — paging away afterwards is never undone. Clearing
   the active comment (toggle off) does nothing.

Pure part in `lib/pdf/viewMode.ts`: `commentJumpTarget(comment, numPages, annotating)` and a
`panToCentre(...)` helper for the single-page stage position.

## 3. Highlighter

### Design
A new markup tool, **Highlighter**, beside Freehand in `DrawingTools`.

- New `AnnTool` / `AnnotationObjectType`: `'highlight'`. Same gesture as freehand (points array);
  holding **Shift** constrains it to a straight band, matching the other tools' shift behaviour.
- Rendered as a Konva `Line`: `strokeWidth` = chosen width × `HIGHLIGHT_WIDTH_FACTOR` (≈6),
  `lineCap="round"`, `lineJoin="round"`, `opacity` ≈0.35 and
  `globalCompositeOperation="multiply"` so the drawing underneath stays dark and legible. Opacity is
  on the node, so a stroke crossing itself does not darken.
- Colour: the current markup colour. Arming Highlighter while the picker is on the default markup
  colour switches the picker to highlighter yellow; any other colour is kept as chosen.
- Selectable, movable, scalable, rotatable, erasable and undoable through the existing object model
  — no special cases beyond rendering.
- **Availability:** shown for PDF, DWG, DXF and image files, including image attachment sessions.
  **Hidden on 3D models** (`DrawingTools` gets a `highlightAvailable` prop; the portal passes
  `!is3DFile || annotatingFile !== null` — an attachment session draws on an image). If the tool is
  armed and the selection switches to a 3D file, it falls back to the pointer.
- No persistence change: markup is flattened into a snapshot image. The legacy `markups` table
  CHECK is already documented as stale and is left alone.

## Out of scope
- Text-selection highlighting (most CAD PDFs have outlined text; user chose the pen tool).
- Raising max zoom above 500 %.
- Faster first render of the base page (the `toDataURL` → `Image` step).

## Testing
- `node --test` units: `visiblePageRect`, `needsDetail`, `detailRenderParams`, `commentJumpTarget`,
  `panToCentre`, highlight style constants / shift constraint.
- `tsc --noEmit`, lint, full test suite, `next build`.
- Browser pass on `next build` + `next start` (the dev server cannot load pdf.js): an A1 drawing
  zoomed to 500 % in both modes is sharp; zoom/pan never blanks; comment on another page jumps in
  both modes, and from a Brief citation; no jump during a markup session; highlighter on a PDF and
  an image, absent on a 3D file; highlighter erase + undo.
