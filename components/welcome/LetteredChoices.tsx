'use client';

import React from 'react';
import { letterFor } from '@/lib/kyc/wizard';

export interface Choice {
  id: string;
  label: string;
  helper?: string;
}

/**
 * One question's answers as lettered rows (A, B, C…): a radiogroup whose rows
 * are role="radio" buttons. Pressing the row's letter on the keyboard picks it
 * (the page handles the key); Tab reaches every row.
 */
export default function LetteredChoices({
  labelledBy,
  options,
  value,
  onChange,
  columns,
  renderAfter,
}: {
  /** id of the heading that asks the question. */
  labelledBy: string;
  options: Choice[];
  value: string;
  onChange: (id: string) => void;
  columns: 1 | 2;
  /** Extra content directly under one row, e.g. the "Other" text input. */
  renderAfter?: (id: string) => React.ReactNode;
}) {
  const dense = columns === 2;

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className={dense ? 'grid grid-cols-1 gap-[7px] min-[360px]:grid-cols-2' : 'flex flex-col gap-2'}
    >
      {options.map((o, i) => {
        const selected = o.id === value;
        const after = renderAfter?.(o.id);
        return (
          <div key={o.id} className="min-w-0">
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.id)}
              className={`flex w-full scroll-mb-28 items-center rounded-[12px] border-[1.5px] text-left outline-none transition focus-visible:border-stiko-primary focus-visible:ring-2 focus-visible:ring-stiko-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-stiko-app ${
                dense ? 'h-full gap-[10px] px-3 py-[9px]' : 'gap-3 px-[14px] py-[11px]'
              } ${
                selected
                  ? 'border-stiko-primary bg-stiko-tint'
                  : 'border-stiko-divider bg-white hover:border-stiko-card-line'
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex shrink-0 items-center justify-center rounded-[6px] border-[1.5px] font-extrabold transition ${
                  dense ? 'h-5 w-5 text-[10.5px]' : 'h-[22px] w-[22px] text-[11px]'
                } ${
                  selected
                    ? 'border-stiko-primary bg-stiko-primary text-white'
                    : 'border-stiko-border-strong text-stiko-muted'
                }`}
              >
                {letterFor(i)}
              </span>
              <span className="min-w-0">
                <span className={`block font-bold text-stiko-ink ${dense ? 'text-[13px]' : 'text-[13.5px]'}`}>
                  {o.label}
                </span>
                {o.helper && <span className="block text-[11.5px] text-stiko-muted">{o.helper}</span>}
              </span>
            </button>
            {after}
          </div>
        );
      })}
    </div>
  );
}
