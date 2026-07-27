'use client';

import React, { useEffect, useRef } from 'react';

/**
 * Anchored popover (02). Used for "Who can see this" (4d) and the notification
 * tray (3i). Closes on Escape and on a click outside.
 */
export default function Popover({
  isOpen,
  onClose,
  width = 380,
  align = 'right',
  /** 3i sits over a light scrim; 4d does not. */
  scrim = false,
  className = '',
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  width?: number;
  align?: 'left' | 'right';
  scrim?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };

    document.addEventListener('keydown', onKey);
    // Deferred so the click that opened the popover doesn't immediately close it.
    const id = setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {scrim && <div className="stiko-scrim-tray fixed inset-0 z-[4]" aria-hidden />}
      <div
        ref={ref}
        role="dialog"
        className={`absolute z-[7] mt-2 overflow-hidden rounded-sheet bg-white shadow-stiko-popover ${
          align === 'right' ? 'right-0' : 'left-0'
        } ${className}`}
        style={{ width }}
      >
        {children}
      </div>
    </>
  );
}

/** A full-width tinted footer strip, as several popovers carry. */
export function PopoverFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-t border-stiko-border bg-stiko-app px-4 py-[11px] text-[11.5px]">
      {children}
    </div>
  );
}
