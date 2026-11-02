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
    // scrollHeight is an integer; Konva's height is lines x fontSize x scale, fractional at PDF
    // zoom, and scrollHeight rounds that sum UP — by over 2px at 5 lines on a 2x PDF, enough to
    // see the fill/border's bottom edge jump on commit. So the box always uses Konva's formula,
    // lines x font size. Auto-width never wraps, so its line count is exact; fixed-width wrapping
    // is only known to the browser, so its line count is read back from scrollHeight (lineHeight
    // is 1, so each line is one font size tall and the rounding is far under half a line).
    const lines = autoWidth ? value.split('\n').length : Math.max(1, Math.round(el.scrollHeight / displayFontSize));
    const h = lines * displayFontSize;
    el.style.height = `${Math.ceil(h)}px`;
    setContentHeight(h);
  }, [value, displayFontSize, fontWeight, fontStyle, textWidth, autoWidth]);

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
      if (t instanceof HTMLCanvasElement && host?.contains(t)) {
        e.preventDefault();
        // That also cancels the focus change this press would have made. If the bar's size field
        // has focus it would keep it, and its typed-but-uncommitted size, past the end of the
        // edit. Blur it as the press would have, which commits the draft first.
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused.closest('[data-markup-text-chrome]')) focused.blur();
      }
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
