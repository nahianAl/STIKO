'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { flattenParts, type PartNode } from '@/lib/model/partTree';
import ColorPickerPopover from '@/components/markup/ColorPickerPopover';

/**
 * The model's parts, as a pill that opens a list upward.
 *
 * Collapsed by default and built to match FocalLengthControl beside it: opens upward because
 * the row it sits in is anchored items-end, and closes on an outside pointerdown or Escape.
 *
 * The eye is available to everyone — hiding a part is a way of LOOKING at a model, session
 * only, exactly as a cross-section plane's pose is. The colour pill writes to the server and
 * is inert without canColor; the route enforces that independently.
 */

/** Above this many rows the list scrolls rather than grows. Search is the way through. */
const MAX_VISIBLE_ROWS = 10;
const ROW_HEIGHT = 32;
/** Rows rendered above and below the viewport, so a fast scroll never shows blank space. */
const OVERSCAN = 5;

interface Row {
  part: PartNode;
  depth: number;
}

/** Depth-first rows, skipping the children of collapsed branches. */
function visibleRows(parts: PartNode[], collapsed: Set<string>, depth = 0): Row[] {
  const out: Row[] = [];
  for (const part of parts) {
    out.push({ part, depth });
    if (part.children.length > 0 && !collapsed.has(part.key)) {
      out.push(...visibleRows(part.children, collapsed, depth + 1));
    }
  }
  return out;
}

export default function PartsPanel({
  parts,
  hiddenParts,
  partColors,
  effectiveColor,
  canColor,
  revealKey,
  onToggleVisibility,
  onSetColor,
  onHoverPart,
}: {
  parts: PartNode[];
  hiddenParts: string[];
  /** Explicit overrides only — what the Reset action clears. */
  partColors: Record<string, string>;
  /** What the part actually renders as: override, else auto-colour, else its own material. */
  effectiveColor: (key: string) => string;
  canColor: boolean;
  /** Set when a part is clicked in the viewport: open the panel and scroll that row into view. */
  revealKey: string | null;
  onToggleVisibility: (key: string) => void;
  onSetColor: (key: string, color: string | null) => void;
  /** `null` on mouse-out. Drives the viewport highlight. */
  onHoverPart: (key: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // A different model loaded: `parts` is memoized upstream on the loaded model, so its identity
  // changes exactly when the model does — that's the signal, rather than inventing a new prop.
  // Part keys are plain index paths ("0/2/1") and collide across models by construction, so
  // anything keyed by them from the previous model — a collapsed set, a search, an open colour
  // picker, a scroll offset — would otherwise silently keep pointing at a same-keyed node in the
  // new one. The sharpest case: `picking` staying set across a switch would leave the colour
  // popover open against a part the user never selected in the new model, so a drag or commit
  // would write that part's colour to the server. `open` is deliberately NOT reset here: a user
  // who opened the panel should not have it slam shut just because the version underneath it
  // changed.
  useEffect(() => {
    setCollapsed(new Set());
    setQuery('');
    setPicking(null);
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [parts]);

  // Same dismissal contract as FocalLengthControl, so the two pills behave identically.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape closes the picker first, then the panel — otherwise dismissing a colour choice
      // takes the whole list with it.
      if (picking) setPicking(null);
      else setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, picking]);

  const hidden = useMemo(() => new Set(hiddenParts), [hiddenParts]);

  const rows = useMemo(() => {
    if (!query.trim()) return visibleRows(parts, collapsed);
    // Search flattens: a match three levels down should be reachable without expanding its
    // ancestors first.
    const needle = query.trim().toLowerCase();
    return flattenParts(parts)
      .filter((part) => (part.name || part.key).toLowerCase().includes(needle))
      .map((part) => ({ part, depth: 0 }));
  }, [parts, collapsed, query]);

  // `rows` can shrink out from under a `scrollTop` that was measured against a longer list —
  // collapsing an ancestor branch or typing a narrowing search both do this while scrolled down.
  // `scrollTop` is state updated by `onScroll`, so it does not move synchronously when `rows`
  // shrinks; the browser will eventually clamp its own scrollbar and fire a `scroll` event that
  // catches state up, but only once the user next interacts with it. `first`/`last` below are
  // clamped independently so the window never renders blank in the meantime, but this effect
  // still corrects `scrollTop` (state and the live DOM element) proactively, so the component
  // never sits holding a scroll position the current list can't back up.
  useEffect(() => {
    const maxScrollTop = Math.max(0, rows.length * ROW_HEIGHT - MAX_VISIBLE_ROWS * ROW_HEIGHT);
    setScrollTop((prev) => {
      if (prev <= maxScrollTop) return prev;
      if (listRef.current) listRef.current.scrollTop = maxScrollTop;
      return maxScrollTop;
    });
  }, [rows.length]);

  // Clicking a part in the viewport opens the panel and scrolls to its row. This is what
  // keeps the list navigable when a file's part names are poor or absent — the model itself
  // becomes the index into the list.
  useEffect(() => {
    if (!revealKey) return;
    setOpen(true);
    setQuery('');
    // Expand every ancestor, or the row is inside a collapsed branch and cannot be scrolled to.
    setCollapsed((prev) => {
      const next = new Set(prev);
      const segments = revealKey.split('/');
      for (let i = 1; i < segments.length; i++) next.delete(segments.slice(0, i).join('/'));
      return next;
    });
  }, [revealKey]);

  // Separate effect, and after the one above: the row only exists once its ancestors are
  // expanded, so the scroll has to happen on the render that follows.
  useEffect(() => {
    if (!revealKey || !open) return;
    const index = rows.findIndex((row) => row.part.key === revealKey);
    if (index < 0) return;
    listRef.current?.scrollTo({ top: Math.max(0, (index - 2) * ROW_HEIGHT) });
  }, [revealKey, open, rows]);

  if (parts.length === 0) return null;

  // Windowed: a model can carry thousands of parts, and rendering a DOM row for each would
  // cost more than the whole render loop it sits over. Row height is fixed, so the slice is
  // arithmetic rather than measurement.
  //
  // `first` is clamped against the CURRENT `rows.length`, not just `last` — otherwise a `rows`
  // that shrinks while `scrollTop` is still large (see the effect above) computes a `first` past
  // the end of the new list, `rows.slice(first, last)` comes back empty, and the leading spacer
  // still renders at the old, larger height: the list goes blank. `maxFirst` is the largest
  // window start the current list can support, so `first` can never exceed it regardless of what
  // `scrollTop` claims — and every one of leading spacer / rendered slice / trailing spacer stays
  // in sync with `rows.length * ROW_HEIGHT`, for an empty list, a list shorter than the window, a
  // list scrolled to its very end, and a list that shrinks out from under the current scroll.
  const windowSize = MAX_VISIBLE_ROWS + OVERSCAN * 2;
  const maxFirst = Math.max(0, rows.length - windowSize);
  const first = Math.min(maxFirst, Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
  const last = Math.min(rows.length, first + windowSize);
  const windowed = rows.slice(first, last);

  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div ref={rootRef} className="relative select-none">
      {open && (
        <div className="mb-1.5 w-72 overflow-hidden rounded-panel bg-white shadow-stiko-sheet border border-stiko-border">
          {parts.length > MAX_VISIBLE_ROWS && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search parts"
              className="w-full border-b border-stiko-border px-3 py-2 text-xs outline-none placeholder:text-stiko-muted"
            />
          )}

          <div
            ref={listRef}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            onMouseLeave={() => onHoverPart(null)}
            className="overflow-y-auto"
            style={{ maxHeight: MAX_VISIBLE_ROWS * ROW_HEIGHT }}
          >
            {/* The spacers give the scrollbar the full list's height while only the window
                is actually in the DOM. */}
            <div style={{ height: first * ROW_HEIGHT }} />
            {windowed.map(({ part, depth }) => {
              const isHidden = hidden.has(part.key);
              return (
                <div
                  key={part.key}
                  onMouseEnter={() => onHoverPart(part.key)}
                  className="flex items-center gap-2 px-2 hover:bg-stiko-tint"
                  style={{ height: ROW_HEIGHT, paddingLeft: 8 + depth * 12 }}
                >
                  {part.children.length > 0 && !query.trim() ? (
                    <button
                      onClick={() => toggleCollapsed(part.key)}
                      aria-label={collapsed.has(part.key) ? 'Expand' : 'Collapse'}
                      className="w-3 shrink-0 text-[10px] text-stiko-muted"
                    >
                      {collapsed.has(part.key) ? '▸' : '▾'}
                    </button>
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}

                  <span
                    className={`flex-1 truncate text-xs ${isHidden ? 'text-stiko-muted line-through' : ''}`}
                    title={part.name || part.key}
                  >
                    {part.name || `Part ${part.key}`}
                  </span>

                  <button
                    onClick={() => onToggleVisibility(part.key)}
                    aria-label={isHidden ? `Show ${part.name || part.key}` : `Hide ${part.name || part.key}`}
                    aria-pressed={!isHidden}
                    className="shrink-0 text-stiko-muted hover:text-stiko-ink"
                  >
                    {isHidden ? ClosedEyeIcon : OpenEyeIcon}
                  </button>

                  <button
                    onClick={() => canColor && setPicking(picking === part.key ? null : part.key)}
                    disabled={!canColor}
                    aria-label={`Colour ${part.name || part.key}`}
                    className="h-4 w-6 shrink-0 rounded-full border border-stiko-border disabled:cursor-default"
                    style={{ backgroundColor: effectiveColor(part.key) }}
                  />
                </div>
              );
            })}

            <div style={{ height: Math.max(0, rows.length - last) * ROW_HEIGHT }} />

            {rows.length === 0 && (
              <div className="px-3 py-3 text-xs text-stiko-muted">No parts match “{query}”.</div>
            )}
          </div>

          {picking && canColor && (
            <div className="border-t border-stiko-border p-2">
              <ColorPickerPopover
                color={effectiveColor(picking)}
                onChange={(hex) => onSetColor(picking, hex)}
              />
              <button
                onClick={() => onSetColor(picking, null)}
                disabled={!(picking in partColors)}
                className="mt-2 w-full rounded-panel px-2 py-1 text-xs text-stiko-muted hover:bg-stiko-tint disabled:opacity-40"
              >
                Reset to original
              </button>
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs shadow-stiko-sheet border border-stiko-border"
      >
        Parts
        <span className="text-stiko-muted">{parts.length}</span>
      </button>
    </div>
  );
}

const OpenEyeIcon = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const ClosedEyeIcon = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" stroke="currentColor" strokeWidth="1.2" />
    <path d="M2 2l12 12" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);
