'use client';

import React from 'react';
import Button from './Button';
import { StickyNotes } from './Primitives';
import { NOTES } from '@/lib/design';

/**
 * 02: an empty state is never a bare button. Always a sticky-note motif, then a
 * heading that explains what the container is FOR, then one primary action, and
 * optionally three numbered explainer cards.
 */
export default function EmptyState({
  heading,
  description,
  actionLabel,
  onAction,
  secondary,
  explainers,
  notes,
  /** Larger CTA + type for the first-run screen (3e). */
  size = 'md',
}: {
  heading: string;
  description?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  secondary?: React.ReactNode;
  explainers?: { title: string; body: string }[];
  notes?: React.ComponentProps<typeof StickyNotes>['notes'];
  size?: 'md' | 'lg';
}) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <StickyNotes notes={notes} />

      <h2
        className={`mt-7 font-extrabold text-stiko-ink ${
          size === 'lg'
            ? 'text-[30px] tracking-[-0.025em]'
            : 'text-[19px] tracking-heading'
        }`}
      >
        {heading}
      </h2>

      {description && (
        <p className="mt-[10px] max-w-[520px] text-[13px] leading-[1.6] text-stiko-muted">
          {description}
        </p>
      )}

      {actionLabel && onAction && (
        <div className="mt-6">
          <Button size={size === 'lg' ? 'lg' : 'md'} onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      )}

      {secondary && <div className="mt-4">{secondary}</div>}

      {explainers && explainers.length > 0 && (
        <div className="mt-9 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
          {explainers.map((e, i) => {
            const swatch = [NOTES.blue, NOTES.red, NOTES.yellow][i % 3];
            return (
              <div
                key={e.title}
                className="rounded-panel bg-white p-[18px] text-left shadow-stiko-panel"
              >
                <span
                  className="inline-flex h-7 w-7 items-center justify-center rounded-[9px] text-[12px] font-extrabold"
                  style={{ background: swatch.pastel, color: swatch.text }}
                >
                  {i + 1}
                </span>
                <h3 className="mt-3 text-[13.5px] font-extrabold text-stiko-ink">
                  {e.title}
                </h3>
                <p className="mt-1 text-[12.5px] leading-[1.5] text-stiko-muted">
                  {e.body}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
