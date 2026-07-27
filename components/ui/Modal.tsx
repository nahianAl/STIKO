'use client';

import React, { useEffect, useRef } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Footer actions, right-aligned above a #F1F1F4 border. */
  footer?: React.ReactNode;
  width?: number;
  children: React.ReactNode;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  footer,
  width = 470,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Trap focus: a modal that lets Tab wander behind the scrim is a
      // keyboard dead end.
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="stiko-scrim fixed inset-0" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-[61] max-h-full w-full overflow-y-auto rounded-sheet bg-white shadow-stiko-modal"
        style={{ maxWidth: width }}
      >
        <div className="flex items-start justify-between px-[22px] pb-[18px] pt-[20px]">
          <div>
            <h2 className="text-[17px] font-extrabold text-stiko-ink">{title}</h2>
            {subtitle && (
              <p className="mt-[3px] text-[12.5px] text-stiko-muted">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-lg p-1 text-stiko-muted transition hover:bg-stiko-app hover:text-stiko-ink"
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
        </div>

        <div className="px-[22px] pb-5">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-stiko-border px-[22px] py-[14px]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
