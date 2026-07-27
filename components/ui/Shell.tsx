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

/** The Stiko mark: a rotated white sticky note on the primary gradient. */
export function LogoMark({ size = 26 }: { size?: number }) {
  const inner = Math.round(size * 0.42);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center bg-gradient-to-br from-[#8094F5] to-[#5B60FF]"
      style={{ width: size, height: size, borderRadius: size <= 30 ? 8 : 13 }}
    >
      <span
        className="block bg-white"
        style={{
          width: inner,
          height: inner,
          borderRadius: 3,
          transform: 'rotate(-10deg)',
        }}
      />
    </span>
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
