# PDF viewer: page sidebar + scroll mode, and page arrows

Date: 2026-11-01
Branch: `feature/pdf-sidebar-scroll` (off `main` at 7570c14)
Status: design approved in conversation; awaiting spec review

## Goal

Give the PDF viewer two ways to move through a document, chosen by one control:

- **Sidebar open → scroll mode.** A left panel shows a thumbnail of every page. The
  main viewport shows all pages stacked in one continuous vertical column.
- **Sidebar closed → single-page mode.** One page at a time (today's view), with a
  medium-sized arrow on each side of the viewport for previous / next page.

The mode is tied to the sidebar. There is no separate mode switch.

Applies to every surface that renders through `PDFKonvaViewer`: uploaded PDFs and
DWG/DXF drawings (which are converted to PDF).

## Decisions made with the user

| Question | Decision |
|---|---|
| Is the mode tied to the sidebar? | Yes. Open = scroll, closed = single-page. |
| Pins / markup / measuring in scroll mode | **Hybrid.** Pins show on every page and can be dropped on any page while scrolling. Starting a drawing or measuring session switches to single-page view on the current page and switches back when the session ends. |
| Which mode a PDF opens in | **Remember last choice** per device. First visit = single-page. A 1-page PDF always opens single-page. |
| Build approach | **Two views behind one component** (approach A below). |

## User-facing behaviour

### Header (left → right)

1. Sidebar toggle button (panel icon). `aria-pressed` reflects the state. Hidden for a
   1-page PDF.
2. Page counter `3 / 12`.
3. Zoom controls on the right, unchanged: `−`, `NN%`, `+`, `Fit`.

The two small header arrows are **removed**: the side arrows replace them in
single-page mode, and scroll mode doesn't need them.

### Single-page mode (sidebar closed)

- Same as today: one page on the Konva stage. Wheel zooms, drag pans, `Fit` fits the
  whole page.
- **Page arrows:** two round buttons, about 40px, floating over the viewport at the
  left and right edges, vertically centred, with a white background, soft shadow and
  chevron icon. They are positioned on the **viewport** edges, not the page edges, so
  zoom and pan never move them.
  - The previous arrow is hidden on page 1, and the next arrow on the last page.
  - Disabled under the same condition that locks the header arrows today
    (`pageNavLocked` in `PDFKonvaViewer`: any markup session, except a measuring session
    that has no markup objects yet).
  - Hidden entirely for a 1-page PDF.
- **Keyboard:** `←` / `→` turn pages, with the same guards as the arrows. Ignored when
  focus is in an input, textarea or contenteditable (for example the canvas text
  editor or the comment box).

### Scroll mode (sidebar open)

**Sidebar**
- About 180px wide, on the left of the viewer body (below the header), with its own
  vertical scroll.
- One thumbnail per page in page order, with the page number under it.
- The current page's thumbnail gets a highlighted outline (Stiko accent). The sidebar
  scrolls on its own to keep the current thumbnail in view, but only when it has gone
  out of view, so it doesn't jump while the user scrolls the sidebar by hand.
- Clicking a thumbnail smooth-scrolls the main view so that page's top is at the top.

**Main view**
- All pages in one vertical column, centred horizontally, with a 16px gap and a light
  shadow per page on the existing grey matte.
- Default zoom is **fit to width**: the widest page fits the viewport width minus
  padding. `Fit` returns to fit-width. `−`/`+` step the zoom as today, and `NN%` shows it.
- Wheel or trackpad scrolls natively. **Ctrl/⌘ + wheel** and **trackpad pinch** (which
  browsers deliver as ctrl+wheel) zoom, anchored on the cursor, so the content under the
  cursor stays put.
- **Current page** = the page covering the largest share of the viewport height. Ties go
  to the lower page number. It drives the header counter, the sidebar highlight,
  `onPageChange` and `getCurrentPage()`.

**Pins**
- Comment pins render on every page, reusing `components/markup/CommentPin.tsx` (DOM,
  percentage-positioned, same as the 3D/image overlay). Numbers come from the same
  `buildTagNumbers(comments)` the canvas uses, so they match the comment list.
- Clicking a pin calls `onCommentPinClick(comment)`. The active pin is styled active.
- The pending (not yet posted) pin renders with `CommentPin`'s `isPending` style.
- With `tagging` on, clicking anywhere on a page calls
  `onCommentPlace(xPct, yPct, pageNumber)`. This is the same contract the canvas uses,
  with coordinates as 0–100 percentages of that page.

**Narrow screens (< 768px)**
- The sidebar overlays the main view as a drawer with a scrim instead of pushing it
  aside. Otherwise the rule is the same everywhere: drawer open = scroll mode, drawer
  closed = single-page mode.
- Tapping a thumbnail scrolls to that page. Tapping the scrim or the toggle closes the
  drawer, which (as on desktop) switches to single-page view on the current page.

### Switching modes

- Toggling keeps the current page. Opening the sidebar scrolls the column to the current
  page. Closing it shows that page in single-page view, fitted.
- **Auto-switch for drawing and measuring:** when `annotating` becomes true while in
  scroll mode, the viewer switches to single-page view on the current page and hides the
  sidebar. When `annotating` returns to false, it switches back to scroll mode at that
  same page. This is internal state (`suspendedForSession`): it does **not** overwrite
  the remembered mode.
- Dropping a pin (`tagging`) does **not** switch modes. If the portal then starts a markup
  session for that comment, `annotating` flips and the auto-switch applies.

### Remembered mode

- `localStorage` key `stiko.pdfViewer.mode` = `"scroll" | "single"`. Every read and
  write is wrapped in try/catch. If nothing can be read, the viewer opens in single-page
  mode.
- Written only when the user toggles the sidebar, never by the auto-switch or by the
  1-page rule.

### Out of scope (possible follow-ups)

- Comment-count badges on thumbnails.
- Clicking a comment in the comment list to jump to its page. This doesn't exist today
  in either mode.
- Swipe gestures to turn pages in single-page mode (arrows and keys only).
- Text selection or search inside the PDF.

## Architecture

### Approach chosen: two views behind one component

`PDFKonvaViewer` stays the single entry point, with the **same props and the same
`PDFKonvaViewerHandle`**. `ViewerContainer` and `app/portal/[id]/page.tsx` do **not**
change.

- **Single-page mode** renders the existing Konva stage path unchanged (pages,
  markup, measure layer, pins, text editor). It only mounts in this mode.
- **Scroll mode** renders a new DOM view: a natively scrolling column of page canvases
  with DOM pins on top. There is no Konva in it, because hybrid mode means no markup or
  measuring ever happens there.

Rejected:
- **One tall Konva stage holding every page:** scrolling would be hand-built, and every
  page-space calculation (pins, markup, measure, snapshot, calibration) would gain a page
  offset. That is the riskiest code in the viewer. It is also heavy on memory for large
  drawing sets.
- **A PDF viewer library** (react-pdf-viewer etc.): a second PDF engine fighting the
  custom canvas, pins and measure tools.

### Files

New:

- `lib/pdf/viewMode.ts`: pure functions, no React, no `@/` imports (so `node --test`
  can load it):
  - `readStoredMode(storage): 'scroll' | 'single'` and `writeStoredMode(storage, mode)`.
    Both take a `Storage`-like object and are try/catch-guarded.
  - `effectiveMode({ stored, numPages, suspendedForSession }): 'scroll' | 'single'`.
  - `mostVisiblePage(rects: {page, top, bottom}[], viewportTop, viewportBottom): number`.
  - `fitWidthScale(pageWidths: number[], viewportWidth: number, padding: number): number`.
  - `zoomAnchoredScrollTop(...)`: the new `scrollTop` that keeps the content under the
    cursor fixed across a zoom change (and the same for `scrollLeft`).
  - `pagesToRender(rects, viewportTop, viewportBottom, overscanPx): Set<number>`.
- `lib/pdf/pageRender.ts`: renders a pdf.js page into a given canvas at a given CSS
  width and device-pixel ratio. Returns the pdf.js `RenderTask` so callers can cancel it.
- `components/viewers/pdf/PdfSidebar.tsx`: thumbnail list. Thumbnails render at about
  160 CSS px wide, lazily as they approach the visible area (IntersectionObserver), and
  stay cached for the life of the document.
- `components/viewers/pdf/PdfScrollView.tsx`: the stacked column:
  - On document load, reads every page's size (`page.getViewport({ scale: 1 })`) and
    lays out correctly sized placeholders, so the scrollbar is right before anything is
    drawn.
  - Draws only pages within the viewport ± about 2 viewport heights
    (`pagesToRender`). It releases the canvases of pages further away (sets width and
    height to 0) to cap memory on large sets.
  - After a zoom settles (about 150ms debounce), re-renders visible pages at the new
    size so text stays sharp. In between, it CSS-scales the existing canvas.
  - Cancels in-flight `RenderTask`s for pages that leave the render window, and all of
    them on unmount.
  - Pins via `CommentPin`. Pin-drop via `onCommentPlace`.
  - Reports the current page upward (`onCurrentPageChange`), and exposes
    `scrollToPage(page, behavior)`.
- `components/viewers/pdf/PageArrows.tsx`: the two floating buttons (props:
  `canPrev`, `canNext`, `disabled`, `onPrev`, `onNext`).

Changed:

- `components/viewers/PDFKonvaViewer.tsx`:
  - Adds `sidebarOpen` (from `readStoredMode`) and `suspendedForSession`, and derives the
    mode via `effectiveMode`.
  - New header layout (toggle + counter left, zoom right). The old header arrows are
    removed.
  - Body = `[PdfSidebar?] [PdfScrollView | existing stage container + PageArrows]`.
  - Zoom controls dispatch to whichever view is active. In scroll mode they drive the
    scroll view's zoom; in single-page mode, the existing `adjustZoom` / `resetZoom`.
  - Watches `annotating` to set or clear `suspendedForSession` and restore the scroll
    position afterwards.
  - Keyboard ←/→ handler (single-page mode only).
  - The loaded `pdfDoc` is shared with the sidebar and the scroll view, so the file is
    fetched and parsed once.
  - `currentPage` remains the one source of truth for both modes. `onPageChange` and
    `getCurrentPage()` keep working unchanged.

### Data flow

```
pdfjs.getDocument(url) ─► pdfDoc (PDFKonvaViewer state)
                             ├─► PdfSidebar      (thumbnails)          ─► click ─► scrollToPage
                             ├─► PdfScrollView   (scroll mode)         ─► onCurrentPageChange ─► currentPage
                             └─► Konva stage     (single-page mode)    ◄─ currentPage (arrows/keys set it)
currentPage ─► header counter, sidebar highlight, onPageChange(prop), getCurrentPage(handle)
annotating(prop) ─► suspendedForSession ─► effectiveMode
```

### Error handling

- Document load failure: unchanged (spinner stops, `onReady` fires).
- A single page failing to render (in the scroll view or as a thumbnail): that slot
  shows a grey box reading "Couldn't render page N". Other pages are unaffected. The
  error is logged with `console.error`.
- A cancelled render (`RenderingCancelledException`) is expected and is not logged as an
  error.
- Storage unavailable: falls back to single-page, and toggling still works for the
  session.

## Testing

- **Unit:** `scripts/tests/pdfViewMode.test.mjs` covering every export of
  `lib/pdf/viewMode.ts`:
  - stored-mode parsing, including a storage that throws and garbage values;
  - the 1-page and suspended overrides;
  - most-visible page, including ties and a viewport between pages;
  - fit-width with mixed page sizes;
  - zoom anchoring keeping the point under the cursor fixed;
  - the render window.

  This follows the repo's `node --test` import rules (no `@/` alias in tested lib
  modules).
- **Static:** `npx tsc --noEmit`, lint, `npm run build`.
- **Browser** (local, with the `/api/home` stub setup from memory). On a multi-page PDF:
  1. Opens single-page on first visit. Arrows show correctly on the first, middle and
     last page. ←/→ work.
  2. Toggle → sidebar with thumbnails. The column scrolls, and the counter and highlight
     follow.
  3. Clicking the thumbnail for page 5 scrolls there.
  4. Ctrl+wheel zooms around the cursor. `Fit` restores fit-width. The text is sharp
     after zooming.
  5. Tag tool: drop a pin on page 3 in scroll mode. It lands on page 3 at the clicked
     spot, and shows in the right place in single-page mode too.
  6. Start a markup session from scroll mode → it switches to single-page on that
     page. Cancel → it is back in scroll mode at the same page.
  7. Reload → the remembered mode is restored.
  8. A 1-page PDF: no toggle, no arrows.
  9. At 375px wide the sidebar is a drawer.
  10. A DWG/DXF-converted drawing opens and behaves the same.

## Risks

- **Pin parity between views:** the canvas pins (Konva) and scroll pins (`CommentPin`)
  are different code. Both are fed by the same `buildTagNumbers` and `paletteForComment`,
  but sizes and colours must be checked side by side in the browser pass.
- **Very large sets (100+ sheets):** reading every page's size on load is one
  `getPage` per page. That is acceptable for pdf.js, but it needs a check on the largest
  real drawing set available.
- **Auto-switch timing:** restoring the scroll position after a session needs the
  column laid out first. Restore after the scroll view reports that its layout is
  ready, not on mount.
