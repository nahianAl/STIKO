'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuthActions, useAuthSession } from '@/lib/authClient';
import Popover from '@/components/ui/Popover';
import { Avatar } from '@/components/ui/Primitives';
import UsageMeters, { type UsagePayload } from './UsageMeters';
import BillingActions, { type BillingStatusPayload } from './BillingActions';

/**
 * The account menu (gap #9 — there was no sign-out anywhere in the product).
 */
export default function AvatarMenu() {
  const { data: session } = useAuthSession();
  const { signOutTo } = useAuthActions();
  const [open, setOpen] = useState(false);

  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [usageFailed, setUsageFailed] = useState(false);
  const [billing, setBilling] = useState<BillingStatusPayload | null>(null);
  const requested = useRef(false);

  const name = session?.user?.name ?? session?.user?.email ?? '?';
  const id = session?.user?.id ?? 'me';

  // Fetched on first open, not on mount: this scans the user's files and
  // comments, and most dashboard visits never open this menu. (The dashboard's
  // PlanBanner fetches it separately on load, but only for Free owners with
  // limits on; this menu does not share that copy.) Held for the life of the
  // mount afterwards — usage does not move fast enough to refetch.
  useEffect(() => {
    if (!open || requested.current) return;
    requested.current = true;

    // Independent of usage: if billing fails, its buttons simply stay hidden.
    fetch('/api/billing/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setBilling(data))
      .catch(() => {});

    fetch('/api/me/usage')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        setUsage(data);
        // Clears a stale failure from an earlier attempt on this mount, so a
        // successful retry actually shows the meters instead of leaving the
        // "Usage unavailable" state stuck on despite fresh data having landed.
        setUsageFailed(false);
      })
      .catch((err) => {
        console.error('Failed to load usage', err);
        // Only the failure path resets this — a success still never
        // refetches. Reopening after a transient blip retries once on that
        // next open (the effect only re-runs when `open` flips), rather than
        // looping while the popover stays open.
        requested.current = false;
        setUsageFailed(true);
      });
  }, [open]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        className="flex items-center gap-1 rounded-pill p-[3px] transition hover:bg-stiko-app"
      >
        <Avatar id={id} name={name} size={30} />
        <svg
          className="h-3 w-3 text-stiko-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <Popover isOpen={open} onClose={() => setOpen(false)} width={300}>
        <div className="flex items-center gap-3 px-4 py-[14px]">
          <Avatar id={id} name={name} size={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold text-stiko-ink">
              {session?.user?.name ?? 'You'}
            </div>
            <div className="truncate text-[11.5px] text-stiko-muted">
              {session?.user?.email}
            </div>
          </div>
          {/* Only once the real plan is known — a badge that flips from Free to
              Standard a beat after opening reads as a bug. */}
          {usage && (
            <span className="shrink-0 rounded-chip bg-stiko-tint px-[7px] py-[3px] text-[10px] font-extrabold uppercase tracking-label text-stiko-primary">
              {usage.plan.label}
            </span>
          )}
        </div>

        <div className="border-t border-stiko-border">
          <UsageMeters usage={usage} failed={usageFailed} />
        </div>

        <BillingActions status={billing} />

        <div className="border-t border-stiko-border p-2">
          <MenuLink href="/settings/account" onClick={() => setOpen(false)}>
            Account settings
          </MenuLink>
          <MenuLink href="/settings/billing" onClick={() => setOpen(false)}>
            Plan & billing
          </MenuLink>
          <MenuLink href="/pricing" onClick={() => setOpen(false)}>
            Compare plans
          </MenuLink>
          <MenuLink href="/settings/notifications" onClick={() => setOpen(false)}>
            Notifications
          </MenuLink>
        </div>

        <div className="border-t border-stiko-border p-2">
          <button
            onClick={() => void signOutTo('/login')}
            className="block w-full rounded-[10px] px-3 py-[9px] text-left text-[13px] font-semibold text-stiko-secondary transition hover:bg-stiko-app hover:text-stiko-ink"
          >
            Sign out
          </button>
        </div>
      </Popover>
    </div>
  );
}

function MenuLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block rounded-[10px] px-3 py-[9px] text-[13px] font-semibold !text-stiko-secondary transition hover:bg-stiko-app hover:!text-stiko-ink"
    >
      {children}
    </Link>
  );
}
