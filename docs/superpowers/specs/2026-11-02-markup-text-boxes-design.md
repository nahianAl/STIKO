# Markup text boxes: Figma-style text with optional fill and border

Date: 2026-11-02
Branch: `feature/markup-text-boxes` (off `main` at 6dfbce0)
Status: design approved in conversation

## Problem

Markup text is hard to use. A click makes a box at a fixed 40% of the page width, and you can't
drag out a width. Font size hides behind the stroke-width chip, which offers 3 sizes. The resize
handles scale the font, and nothing changes the box width. Editing needs Pointer plus a
double-click. Text is always bold Arial, with no alignment, fill or border.

## Decisions (user)

- **Direction:** Figma-style text editing plus an optional background fill and border, so a text
  can be a callout box (Miro / Google Slides). No sticky notes.
- **Controls:** a floating bar just above the selected or edited text box. The main toolbar's
  colour picker still sets the text colour.

## Behaviour

### Creating (Text tool)

- **Click:** an **auto-width** box with no wrapping, which grows as you type. Enter adds a line.
- **Drag** (more than 4 screen px): a **fixed-width** box, as wide as the drag. Text wraps inside
  it and the height always fits the content.
- The tool returns to Pointer afterwards (unchanged). The editor is focused immediately and
  must be typeable straight away.
- **Defaults:** 20 px, bold on, italic off, left-aligned, no fill, no border, the current
  markup colour.

### Editing

- **Opening existing text:**
  - double-click it with the Pointer;
  - click it with the Text tool, which edits it instead of making a new one;
  - press Enter while exactly one text is selected and nothing is being typed.

  The caret lands at the end of the text.
- **Finishing:** Esc, Ctrl/⌘+Enter, or a click outside the editor and the floating bar. The text
  stays **selected** afterwards. Empty text is discarded on finish (unchanged).
- **While typing:** the box shows a solid accent (`#5B60FF`) 1px frame instead of today's
  dashed outline, and the floating bar stays visible. Typed text must line up exactly with the
  finished Konva text, with no jump on commit, including for padding, alignment, italic and
  fill.

### Resizing (Transformer, when the selection is exactly one text)

- **Middle-left / middle-right handles:** change the box **width**, keeping the font size. The
  text reflows, and an auto-width box becomes fixed-width.
- **Corner handles:** scale the **font size** proportionally (keepRatio). The width scales with
  it and the new font size is baked in (as `bakeTextTransform` does today).
- **Top and bottom handles:** hidden, because height always fits the content.
- **Rotation:** unchanged.
- **Mixed or multi selections:** keep the current group behaviour (an even group scale). Text in
  a group still bakes its scale into the font size.

### Floating text bar

Shown when the selection is one or more texts and nothing else, or while a text is being edited.
It sits above the top edge of the selection's bounding box on screen, centred, and is clamped
inside the viewer. If there is no room above, it drops below. It is hidden during a drag or
transform.

| Control | Behaviour |
|---|---|
| Font size | A number input plus a dropdown of 12, 14, 16, 20, 24, 32, 48 and 64. Input is clamped to 6–400. ⌘/Ctrl+Shift+> and < step to the next or previous preset. |
| **B** / *I* | Toggle bold / italic. |
| Align | Left / centre / right. |
| Fill | None, plus 6 soft swatches: white `#FFFFFF`, yellow `#FFF4B8`, red `#FFE0E0`, blue `#DDE8FF`, green `#DDF5E3`, grey `#EEEEEE`. |
| Border | Toggle. It is 1.5px in the text colour. |

- The bar applies to every selected text, or to the text being edited.
- Clicking the bar never finishes editing, and never starts a selection box or a draw.
- With a fill or border, the text has 8px padding inside the box. Without either, it has no
  padding, so plain text sits exactly where it was typed.
- **The main toolbar:** while the selection is text only, the stroke-width picker is hidden. It
  no longer doubles as a text-size control. The colour picker still applies the text colour, and
  `applyStyleToSelection` with a `color` still works. A `strokeWidth` patch no longer changes a
  text's font size.

### Unchanged

Multi-select (box and Shift), the eraser, snapshots (fill and border are drawn on the Konva stage,
so they appear in captures), measurements, and the PDF/AnnotationCanvas split all stay as they
are. Markup objects are session-only, so no stored data needs migrating.

## Architecture

- **Data:** `AnnotationObject` gains these text fields:
  - `bold: boolean`, `italic: boolean`;
  - `align: 'left' | 'center' | 'right'`;
  - `fill: string`, where `''` means none;
  - `border: boolean`;
  - `autoWidth: boolean`.

  `fontSize` and `width` are kept. `width` is the wrap width for a fixed box and is ignored
  while `autoWidth` is set. Non-text objects carry the defaults.
- **Pure helpers (`lib/markup/text.ts`, unit-tested):**
  - `TEXT_PADDING`, `FONT_SIZE_PRESETS`, `DEFAULT_TEXT_STYLE`;
  - `textPadding(obj)`, which is 8 with a fill or border and 0 otherwise;
  - `stepFontSize(size, dir)`, which moves to the next or previous preset;
  - `clampFontSize(n)`;
  - `isTextDrag(box, minScreenPx)`;
  - `scaledTextOnCorner(fontSize, width, scale)`;
  - `widthOnSideDrag(width, scaleX)`.

  These must stay free of React and Konva.
- **Rendering:** a text object renders as a Konva `Group`, which carries the object id, position,
  rotation, scale and drag/transform handlers. Inside it, an optional `Rect` (fill and border)
  sits behind a `Text`. The `Text` carries the padding, alignment, `fontStyle` (bold/italic) and
  `width` (or none when auto-width). Multi-select hit-testing keeps working through
  `getClientRect`. The text hit area covers the box when it has a fill or border, and the glyphs
  otherwise.
- **Editor:** `CanvasTextEditor` gains `padding`, `align`, `bold`, `italic`, `fill`, `border` and
  `autoWidth`, and mirrors the Konva text exactly. In auto-width mode it grows without wrapping.
- **Floating bar:** a new `components/markup/TextStyleBar.tsx`. It is pure DOM, positioned by the
  surface from the selection's screen rect. It is rendered by both surfaces next to
  `CanvasTextEditor`, and `CanvasTextEditor`'s outside-click finish treats it as inside.
- **Model actions** in `useAnnotationObjects`:
  - `updateTextStyle(ids, patch)`, for size, bold, italic, align, fill and border;
  - `setTextWidth(id, width)`, which also clears `autoWidth`.

  `applyStyle`'s strokeWidth→fontSize coupling for text is removed.
- **Toolbar:** `DrawingTools` hides the stroke-width picker when `selectionType === 'text'`.
  Nothing in `app/portal/[id]/page.tsx` needs to change, beyond what already flows through
  `onSelectionChange` / `selectionType`.

## Testing

- **Unit:** the new helpers in `lib/markup/text.ts`.
- **Static:** tsc, lint, tests, build.
- **Browser:** production build plus a throwaway harness, on both surfaces:
  - click-create auto-width, typeable immediately, grows without wrapping;
  - drag-create a fixed width that wraps;
  - side handle reflows, corner scales the font;
  - the three ways to re-open, and the three ways to finish;
  - bar controls change the canvas and the snapshot (fill and border visible in `captureSnapshot`);
  - no visual jump between editing and committed text (compare the textarea and Konva text bounding rects);
  - the stroke picker is hidden for text;
  - multi-select and the eraser still work.
