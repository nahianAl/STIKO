'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Popover, { PopoverFooter } from '@/components/ui/Popover';
import { Avatar, SectionLabel } from '@/components/ui/Primitives';
import { relativeTime } from '@/lib/design';

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  excerpt: string | null;
  href: string;
  createdAt: string;
  readAt: string | null;
  portalId: string | null;
  packageName: string | null;
  actorId: string | null;
  actorName: string | null;
}

/**
 * The notification tray (3i). Grouped by package, then an "Earlier" group.
 * Every row deep-links to the exact object.
 */
export default function NotificationTray({
  notifications,
  onChanged,
}: {
  notifications: NotificationRow[];
  onChanged: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => !n.readAt).length;

  const markAllRead = async () => {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    onChanged();
  };

  const openRow = async (row: NotificationRow) => {
    setOpen(false);
    if (!row.readAt) {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      });
      onChanged();
    }
    router.push(row.href);
  };

  // Recent notifications group under their package; anything older than a day
  // falls into "Earlier" so the tray doesn't become a wall of package headings.
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const recent = notifications.filter(
    (n) => now - new Date(n.createdAt).getTime() < DAY
  );
  const earlier = notifications.filter(
    (n) => now - new Date(n.createdAt).getTime() >= DAY
  );

  const byPackage = new Map<string, NotificationRow[]>();
  for (const n of recent) {
    const key = n.packageName ?? 'Stiko';
    byPackage.set(key, [...(byPackage.get(key) ?? []), n]);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-[10px] text-stiko-muted transition hover:bg-stiko-app hover:text-stiko-ink"
      >
        <svg
          className="h-[17px] w-[17px]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute right-[7px] top-[7px] h-[7px] w-[7px] rounded-full bg-[#FF6B6B] ring-2 ring-white" />
        )}
      </button>

      <Popover isOpen={open} onClose={() => setOpen(false)} width={420} scrim>
        <div className="flex items-center justify-between border-b border-stiko-border px-4 py-[14px]">
          <h3 className="text-[15px] font-extrabold text-stiko-ink">
            Notifications
          </h3>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="text-[11.5px] font-bold text-stiko-primary hover:text-stiko-primary-hover"
            >
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-stiko-muted">
              You&apos;re up to date.
            </p>
          ) : (
            <>
              {Array.from(byPackage.entries()).map(([name, rows]) => (
                <div key={name} className="px-2 pt-3">
                  <SectionLabel className="px-2 pb-1">{name}</SectionLabel>
                  {rows.map((n) => (
                    <Row key={n.id} row={n} onOpen={() => openRow(n)} />
                  ))}
                </div>
              ))}
              {earlier.length > 0 && (
                <div className="px-2 pt-3">
                  <SectionLabel className="px-2 pb-1">Earlier</SectionLabel>
                  {earlier.map((n) => (
                    <Row key={n.id} row={n} onOpen={() => openRow(n)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <PopoverFooter>
          <a href="/settings/notifications" className="font-bold">
            Notification settings
          </a>
          <span className="text-stiko-faint">Also sent by email</span>
        </PopoverFooter>
      </Popover>
    </div>
  );
}

function Row({ row, onOpen }: { row: NotificationRow; onOpen: () => void }) {
  const unread = !row.readAt;
  return (
    <button
      onClick={onOpen}
      className={`mb-1 flex w-full items-start gap-3 rounded-[10px] px-2 py-[10px] text-left transition ${
        unread ? 'bg-stiko-app' : 'hover:bg-stiko-app'
      }`}
      style={{
        borderLeft: `3px solid ${unread ? '#5B60FF' : 'transparent'}`,
      }}
    >
      <Avatar
        id={row.actorId ?? row.id}
        name={row.actorName ?? 'Stiko'}
        size={30}
      />
      <span className="min-w-0 flex-1">
        <span
          className={`block text-[12.5px] leading-[1.45] ${
            unread ? 'text-stiko-ink' : 'text-stiko-secondary'
          }`}
        >
          {row.title}
        </span>
        {row.excerpt && (
          <span className="mt-[2px] block truncate text-[11.5px] text-stiko-muted">
            “{row.excerpt}”
          </span>
        )}
        <span className="mt-[2px] block text-[10.5px] text-stiko-faint">
          {relativeTime(row.createdAt)}
        </span>
      </span>
    </button>
  );
}
