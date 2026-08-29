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

  // The hex our HSV state currently agrees with — whichever side last moved it, us via emit()/
  // commitHex() or the parent via a `color` prop change we resynced from. Round-tripping a hex
  // back through hexToHsv would lose information for any colour hexToHsv can't represent
  // uniquely — pure black, pure white, any grey has undefined hue/saturation and hexToHsv always
  // answers 0. Dragging value down to 0 would otherwise snap the hue handle back to red the
  // instant the parent's `color` prop echoes the black we just asked for. So: a `color` change
  // that matches this ref is already reflected in our HSV state and is ignored; only a change
  // that differs from it (a swatch click, or selecting a different object) resyncs HSV from hex.
  // The ref is updated on every resync, not just on emit, so it can never go stale and mask a
  // genuine external change that happens to match an old emitted value.
  const syncedHex = useRef<string | null>(null);

  // Follow the toolbar when the colour changes from outside — a swatch click, or selecting an
  // object, which pulls that object's style into the toolbar.
  useEffect(() => {
    const normalized = normalizeHex(color);
    if (normalized && normalized === syncedHex.current) return;
    const next = hexToHsv(color);
    if (!next) return;
    setHsv(next);
    setHexDraft(normalized ?? '#000000');
    syncedHex.current = normalized ?? null;
  }, [color]);

  const emit = useCallback((next: HSV) => {
    setHsv(next);
    const hex = hsvToHex(next);
    syncedHex.current = hex;
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

  // Tracks whichever drag (square or strip) is currently live, so an unmount mid-drag (the
  // panel closes on outside click, and a click can land mid-drag) can tear it down instead of
  // leaking listeners on a detached node.
  const activeDragRef = useRef<(() => void) | null>(null);

  useEffect(() => () => activeDragRef.current?.(), []);

  const startDrag = (
    ref: React.RefObject<HTMLDivElement>,
    toHsv: (f: { x: number; y: number }) => HSV
  ) => (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    // A previous drag should already have cleaned itself up via pointerup/cancel, but a
    // defensive teardown costs nothing if one is somehow still live.
    activeDragRef.current?.();
    // Pointer capture, so a drag that leaves the small square keeps tracking rather than
    // stopping dead at the edge.
    el.setPointerCapture(e.pointerId);
    emit(toHsv(fractionIn(el, e)));
    const move = (ev: PointerEvent) => emit(toHsv(fractionIn(el, ev)));
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('lostpointercapture', end);
      activeDragRef.current = null;
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    // Canonical "capture is over" signal — fires even when capture is released implicitly,
    // e.g. the element is removed from the DOM while the pointer is still down (the panel
    // unmounts mid-drag when a click lands outside it).
    el.addEventListener('lostpointercapture', end);
    activeDragRef.current = end;
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
    syncedHex.current = parsed;
    setHexDraft(parsed);
    onChange(parsed);
  };

  const pureHue = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  // Small keyboard nudges so the square and the strip are usable without a pointer. Shift
  // steps ten times further, matching the usual convention for slider-like controls.
  const step = (big: boolean) => (big ? 10 : 1);

  const onSvKeyDown = (e: React.KeyboardEvent) => {
    const d = step(e.shiftKey) / 100;
    if (e.key === 'ArrowLeft') { e.preventDefault(); emit({ ...hsv, s: Math.max(0, hsv.s - d) }); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); emit({ ...hsv, s: Math.min(1, hsv.s + d) }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); emit({ ...hsv, v: Math.min(1, hsv.v + d) }); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); emit({ ...hsv, v: Math.max(0, hsv.v - d) }); }
  };

  const onHueKeyDown = (e: React.KeyboardEvent) => {
    const d = step(e.shiftKey);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); emit({ ...hsv, h: ((hsv.h - d) % 360 + 360) % 360 }); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); emit({ ...hsv, h: (hsv.h + d) % 360 }); }
  };

  return (
    <div className="w-[188px] rounded-sheet bg-white border border-stiko-border shadow-stiko-panel p-[10px]">
      {/* Saturation (left to right) over value (top to bottom), on the current hue. */}
      <div
        ref={svRef}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.v * 100)}
        aria-valuetext={`saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        onPointerDown={startDrag(svRef, (f) => ({ h: hsv.h, s: f.x, v: 1 - f.y }))}
        onKeyDown={onSvKeyDown}
        className="relative h-[112px] w-full rounded-[9px] border border-stiko-divider cursor-crosshair touch-none outline-none focus-visible:ring-2 focus-visible:ring-stiko-primary-light"
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
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={startDrag(hueRef, (f) => ({ h: f.x * 360, s: hsv.s, v: hsv.v }))}
        onKeyDown={onHueKeyDown}
        className="relative mt-[10px] h-[12px] w-full rounded-full border border-stiko-divider cursor-ew-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-stiko-primary-light"
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
            // Redundant belt-and-braces: the app's global Delete/Backspace handler already
            // ignores events targeting INPUT/TEXTAREA/contentEditable elements, so this input
            // would never trigger it even without stopping propagation. Kept anyway so this
            // component doesn't depend on that guard's continued existence.
            e.stopPropagation();
          }}
          className="h-[28px] w-full min-w-0 rounded-[8px] border border-stiko-divider bg-white px-[8px] text-[12px] text-stiko-ink outline-none focus:border-stiko-primary-light"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
