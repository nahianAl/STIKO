'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { TEXT_FONT_FAMILY } from '@/lib/markup/text';

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
        width: wrapWidth * scale,
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
  );
}
