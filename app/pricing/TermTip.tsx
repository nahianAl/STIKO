'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { GLOSSARY, type Term } from './content';

/**
 * A small "?" that explains a word (project, package, submission).
 *
 * Opens on hover and on keyboard focus, and toggles on tap, since touch screens
 * have no hover. The text is always in the DOM for screen readers via
 * aria-describedby; only its visibility changes.
 */
export default function TermTip({ term, dark = false }: { term: Term; dark?: boolean }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  // Horizontal nudge that keeps the bubble 12px inside the viewport: a "?" at
  // the end of a long line on a phone would otherwise push it off the edge.
  const [shift, setShift] = useState(0);
  const id = useId();
  const { title, body } = GLOSSARY[term];
  const open = hover || pinned;

  useLayoutEffect(() => {
    if (!open || !tipRef.current) return;
    // Measured with the current nudge applied, so take it back out first.
    const r = tipRef.current.getBoundingClientRect();
    const left = r.left - shift;
    const right = r.right - shift;
    const margin = 12;
    const vw = document.documentElement.clientWidth;
    let dx = 0;
    if (left < margin) dx = margin - left;
    else if (right > vw - margin) dx = vw - margin - right;
    setShift(dx);
    // `shift` is read, not a trigger: re-measuring on its own change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinned(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pinned]);

  return (
    <span
      ref={ref}
      className="relative ml-[6px] inline-flex align-middle"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        aria-label={`What is a ${title.toLowerCase()}?`}
        aria-describedby={id}
        aria-expanded={open}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onClick={() => setPinned((p) => !p)}
        className={`grid h-[17px] w-[17px] place-items-center rounded-full text-[10.5px] font-extrabold leading-none transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8094F5] ${
          dark
            ? 'bg-white/15 text-white/80 hover:bg-white/25 hover:text-white'
            : 'bg-[#EEF1FB] text-[#4247D6] hover:bg-[#E2E7F8]'
        }`}
      >
        ?
      </button>
      <span
        ref={tipRef}
        id={id}
        role="tooltip"
        style={{ marginLeft: shift }}
        className={`pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-30 w-[240px] max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-[12px] bg-stiko-ink px-[14px] py-3 text-left text-[12.5px] font-medium normal-case leading-[1.5] tracking-normal text-white/85 shadow-[0_16px_40px_-14px_rgba(28,32,48,0.55)] transition-[opacity,transform] duration-150 ${
          open ? 'translate-y-0 opacity-100' : 'invisible translate-y-1 opacity-0'
        }`}
      >
        <span className="mb-[3px] block text-[12.5px] font-extrabold text-white">{title}</span>
        {body}
      </span>
    </span>
  );
}
