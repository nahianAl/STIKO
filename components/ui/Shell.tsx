'use client';

import React from 'react';
import Link from 'next/link';

/**
 * The app shell (02): full viewport, #F6F8FE field, 12px padding, 12px gaps.
 * Top bar, then content.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col gap-3 bg-stiko-app p-3">
      {children}
    </div>
  );
}

/**
 * The Stiko mark: two leaves, blue over orange, on no background. `size` is
 * its height; the mark is taller than it is wide (47.5 : 86), so the width
 * follows from it. Decorative wherever it appears — the wordmark or the page
 * title beside it already says "Stiko".
 */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      viewBox="26.25 7 47.5 86"
      width={(size * 47.5) / 86}
      height={size}
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M71 8 H50 A21 21 0 0 0 50 50 C77.3 50 73.52 19.55 71 8 Z" fill="#5680E6" />
      <path d="M29 92 H50 A21 21 0 0 0 50 50 C22.7 50 26.48 80.45 29 92 Z" fill="#EF6C22" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="text-[18px] font-extrabold tracking-title text-stiko-ink">
      Stiko
    </span>
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav className="flex min-w-0 items-center gap-[6px] text-[13px]">
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <React.Fragment key={`${c.label}-${i}`}>
            {i > 0 && <span className="text-stiko-crumb">›</span>}
            {isLast || !c.href ? (
              <span
                className={
                  isLast
                    ? 'truncate font-semibold text-stiko-ink'
                    : 'truncate text-stiko-muted'
                }
              >
                {c.label}
              </span>
            ) : (
              <Link
                href={c.href}
                className="truncate text-stiko-muted hover:text-stiko-ink"
              >
                {c.label}
              </Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

/**
 * The 52px floating top bar. Everything on the right is conditional — see 03;
 * the caller decides what has been earned and passes only that.
 */
export function TopBar({
  crumbs,
  left,
  right,
}: {
  crumbs?: Crumb[];
  left?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between gap-4 rounded-panel bg-white px-[18px] shadow-stiko-panel">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" className="flex shrink-0 items-center gap-[9px]">
          <LogoMark />
          <Wordmark />
        </Link>
        {crumbs && crumbs.length > 0 && (
          <>
            <span className="text-stiko-crumb">›</span>
            <Breadcrumbs crumbs={crumbs} />
          </>
        )}
        {left}
      </div>
      <div className="flex shrink-0 items-center gap-[10px]">{right}</div>
    </header>
  );
}

/** A centred content column, as every non-review screen uses. */
export function Column({
  width,
  className = '',
  children,
}: {
  width: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        className={`mx-auto w-full px-1 py-6 ${className}`}
        style={{ maxWidth: width }}
      >
        {children}
      </div>
    </div>
  );
}
