'use client';

import React from 'react';
import Link from 'next/link';
import { Shell, TopBar, type Crumb } from '@/components/ui/Shell';
import AvatarMenu from '@/components/shell/AvatarMenu';
import { SectionLabel } from '@/components/ui/Primitives';
import Button from '@/components/ui/Button';

/**
 * One settings pattern serves every scope (08): a 216px nav rail, a single
 * column of cards, and destructive actions quarantined in their own bordered
 * card at the bottom.
 */
export function SettingsShell({
  crumbs,
  railLabel,
  items,
  active,
  children,
}: {
  crumbs?: Crumb[];
  railLabel: string;
  items: { key: string; label: string; href: string }[];
  active: string;
  children: React.ReactNode;
}) {
  return (
    <Shell>
      <TopBar crumbs={crumbs} right={<AvatarMenu />} />

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[216px_1fr]">
        <nav className="h-fit rounded-panel bg-white px-3 py-4 shadow-stiko-panel">
          <SectionLabel className="px-3 pb-2">{railLabel}</SectionLabel>
          <div className="flex flex-col gap-1">
            {items.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={`rounded-[10px] px-3 py-[10px] text-[13.5px] transition ${
                  active === item.key
                    ? 'bg-stiko-tint font-bold !text-stiko-ink'
                    : 'font-semibold !text-stiko-secondary hover:bg-stiko-app hover:!text-stiko-ink'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>

        <div className="min-h-0 overflow-y-auto">
          <div className="flex flex-col gap-3 pb-6">{children}</div>
        </div>
      </div>
    </Shell>
  );
}

export function SettingsCard({
  heading,
  description,
  actions,
  children,
}: {
  heading: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-panel bg-white px-6 py-[22px] shadow-stiko-panel">
      <h2 className="text-[17px] font-extrabold text-stiko-ink">{heading}</h2>
      {description && (
        <p className="mt-1 text-[12.5px] text-stiko-muted">{description}</p>
      )}
      {children && <div className="mt-5 flex flex-col gap-[18px]">{children}</div>}
      {actions && (
        <div className="mt-6 flex items-center justify-end gap-2">{actions}</div>
      )}
    </section>
  );
}

/**
 * The danger card. One panel, 3px red left border, destructive actions
 * quarantined away from everything routine.
 */
export function DangerCard({
  rows,
}: {
  rows: {
    title: string;
    description: string;
    actionLabel: string;
    onAction: () => void;
    variant?: 'secondary' | 'danger';
  }[];
}) {
  return (
    <section
      className="rounded-panel bg-white shadow-stiko-panel"
      style={{ borderLeft: '3px solid #FF6B6B' }}
    >
      {rows.map((row, i) => (
        <div
          key={row.title}
          className={`flex flex-wrap items-center justify-between gap-3 px-6 py-5 ${
            i > 0 ? 'border-t border-stiko-border' : ''
          }`}
        >
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-extrabold text-stiko-ink">
              {row.title}
            </h3>
            <p className="mt-1 text-[12.5px] leading-[1.5] text-stiko-muted">
              {row.description}
            </p>
          </div>
          <Button
            variant={row.variant ?? 'danger'}
            onClick={row.onAction}
            className="shrink-0"
          >
            {row.actionLabel}
          </Button>
        </div>
      ))}
    </section>
  );
}
