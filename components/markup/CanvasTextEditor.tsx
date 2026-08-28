'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TEXT_FONT_FAMILY } from '@/lib/markup/text';

// An empty box still needs somewhere to put the caret.
const MIN_EDITOR_WIDTH = 24;

/**
 * A borderless textarea sitting exactly where the Konva text node is, so markup text is typed
 * where it will land rather than in a popup somewhere else.
 *
 * Konva has no text input primitive, and rendering a caret onto the canvas would mean
 * reimplementing caret movement, selection, wrapping, clipboard and IME composition. Overlaying
 * a real form control gets all of that from the browser. The cost is that the overlay has to
 * mirror the stage transform, which is what `scale` is for — 1 on the unscaled AnnotationCanvas,
 * the current zoom on PDFKonvaViewer.
 *
 * The marquee is drawn with `outline`, not `border`: outlines sit outside the box model, so the
 * dashed edge cannot shift the text by a pixel relative to the Konva node it is standing in for.
 */
export default function CanvasTextEditor({
  x,
  y,
  scale,
  color,
  fontSize,
  wrapWidth,
  value,
  onChange,
  onCommit,
}: {
  x: number;
  y: number;
  scale: number;
  color: string;
  fontSize: number;
  wrapWidth: number;
  value: string;
  onChange: (text: string) => void;
  onCommit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Hidden span used only to measure the widest rendered line — never shown, never focusable.
  const mirrorRef = useRef<HTMLSpanElement>(null);
  // Measured display width. Starts at wrapWidth * scale so the first paint (before the
  // measuring effect runs) matches the old, unconditional sizing rather than flashing at
  // MIN_EDITOR_WIDTH.
  const [editorWidth, setEditorWidth] = useState(() => wrapWidth * scale);

  // Commit stays in a ref so the listeners below can be bound once, on mount. Re-binding a
  // document-level pointerdown handler on every keystroke risks the handler that closes the
  // editor being attached during the very click that is supposed to close it.
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  // Focus with the caret at the end — the re-edit path opens on existing text, and landing the
  // caret at the start there would make appending feel broken.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Grow to fit. Height is reset to auto first, or scrollHeight only ever ratchets upward and
  // the box never shrinks back when text is deleted.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, fontSize, wrapWidth, scale]);

  // Measure the widest line with a hidden mirror span, so the box hugs the text instead of
  // being born at full wrap width. Safe by construction: the measured width is always at
  // least as wide as the longest rendered line (mirror uses the exact same font metrics) and
  // is capped at wrapWidth * scale — the width the committed Konva node wraps at. So the
  // textarea never wraps earlier than the Konva node would, and once the cap is hit both wrap
  // at exactly the same width. The committed text can therefore never reflow relative to what
  // was on screen while editing.
  useLayoutEffect(() => {
    const mirror = mirrorRef.current;
    if (!mirror) return;
    let widest = 0;
    for (const line of value.split('\n')) {
      mirror.textContent = line;
      widest = Math.max(widest, mirror.offsetWidth);
    }
    // +2 is caret room, so the caret itself doesn't sit flush against the wrap edge.
    setEditorWidth(Math.min(wrapWidth * scale, Math.max(MIN_EDITOR_WIDTH, widest + 2)));
  }, [value, fontSize, wrapWidth, scale]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) commitRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        commitRef.current();
      }
    };
    // Capture phase: the surface's own stage handlers must not act on the click that closed the
    // editor before the editor has seen it.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const displayFontSize = fontSize * scale;

  return (
    <>
      {/* Hidden mirror used only to measure the widest line, so the box can hug the text
          instead of being born at the full wrap width. Same font metrics as the textarea —
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
          fontWeight: 'bold',
          fontSize: displayFontSize,
          lineHeight: 1,
        }}
      />
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Enter inserts a newline. Nothing here commits — that is clicking away or Escape.
        onKeyDown={(e) => e.stopPropagation()}
        spellCheck={false}
        className="absolute z-40 resize-none overflow-hidden"
        style={{
          left: x,
          top: y,
          width: editorWidth,
          color,
          // Matched to the Konva Text node: same family, same weight, lineHeight 1, no padding.
          // Any divergence here and the text jumps at the moment it is committed.
          fontFamily: TEXT_FONT_FAMILY,
          fontWeight: 'bold',
          fontSize: displayFontSize,
          lineHeight: 1,
          padding: 0,
          margin: 0,
          border: 'none',
          background: 'rgba(255,255,255,0.10)',
          outline: `1px dashed ${color}`,
          outlineOffset: 3,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
        }}
      />
    </>
  );
}
