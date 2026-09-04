'use client';

import React, { useEffect } from 'react';

/**
 * The drawer from 02 / 2e. It is anchored INSIDE the app shell (top/right/bottom
 * 12px) rather than to the viewport edge, so the shell's gutter is preserved and
 * the package stays visibly mounted behind it.
 *
 * Stacking: 02 originally put the scrim at z-5 and the drawer at z-6, on the
 * rule that the content underneath carries no positive z-index. That rule did
 * not survive contact with the review viewport, whose floating controls sit at
 * z-20 and z-50 — they need to clear the viewer canvas, so they punched
 * straight through the scrim and painted over the drawer's own footer.
 *
 * A drawer is a modal surface and belongs in the modal tier, where its peer
 * Modal (z-60/61) already sits. It is one step below Modal, so a confirm opened
 * from inside a drawer still wins, and above every page-level layer (the
 * highest is the sticky Header at z-50).
 */
export default function Drawer({
  isOpen,
  onClose,
  title,
  subtitle,
  footer,
  width = 452,
  closeOnEscape = true,
  anchor = 'shell-right',
  offsetLeft = 0,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
  width?: number;
  /** Where the panel sits.
   *
   *  'shell-right' (the default, and what 2e specified) pins it to the shell's
   *  right gutter and runs the full window height.
   *
   *  'inline' positions it inside the nearest positioned ancestor instead, so
   *  it can sit beside a panel and match that panel's height exactly rather
   *  than starting above it at the window's edge. The scrim stays fixed to the
   *  viewport either way — a modal surface should not leave the header
   *  clickable behind it. */
  anchor?: 'shell-right' | 'inline';
  /** Distance from the positioned ancestor's left edge. Only read when
   *  `anchor` is 'inline'; the caller owns the arithmetic because only it
   *  knows the width of whatever the drawer is sitting beside. */
  offsetLeft?: number;
  /** Set to false while a confirm dialog is open above this drawer. Drawer and
   *  Modal both listen for Escape on `document`, and the drawer's listener is
   *  registered first (it mounts first) and so runs first — one Escape press
   *  would otherwise close the confirm *and* the drawer beneath it. Defaults
   *  to true so existing consumers are unaffected. */
  closeOnEscape?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!closeOnEscape) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, closeOnEscape]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="stiko-scrim fixed inset-0 z-[58]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`z-[59] flex flex-col overflow-hidden rounded-sheet bg-white shadow-stiko-drawer ${
          anchor === 'inline'
            ? 'absolute top-0 max-h-full'
            : 'fixed bottom-3 right-3 top-3'
        }`}
        style={anchor === 'inline' ? { width, left: offsetLeft } : { width }}
      >
        <header className="flex items-start justify-between border-b border-stiko-border px-[22px] py-[18px]">
          <div>
            <h2 className="text-[17px] font-extrabold text-stiko-ink">{title}</h2>
            {subtitle && (
              <p className="mt-[2px] text-[12.5px] text-stiko-muted">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-lg p-1 text-stiko-muted transition hover:bg-stiko-app hover:text-stiko-ink"
          >
            <svg
              className="h-[18px] w-[18px]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
            >
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* Anchored inline the panel is content-sized, so the body must NOT
            claim the leftover space — `flex-1` would leave a white gap under a
            short version, which is the whole point of sizing to content. It
            keeps `min-h-0` so it can still shrink and scroll once the panel
            reaches the row's height. Pinned to the shell it fills as before. */}
        <div
          className={`overflow-y-auto px-[22px] py-5 ${
            anchor === 'inline' ? 'min-h-0' : 'flex-1'
          }`}
        >
          {children}
        </div>

        {footer && (
          <footer className="flex items-center justify-between gap-2 border-t border-stiko-border px-[22px] py-[14px]">
            {footer}
          </footer>
        )}
      </aside>
    </>
  );
}
