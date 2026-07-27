'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import Popover from '@/components/ui/Popover';
import { Avatar } from '@/components/ui/Primitives';

/**
 * The account menu (gap #9 — there was no sign-out anywhere in the product).
 */
export default function AvatarMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  const name = session?.user?.name ?? session?.user?.email ?? '?';
  const id = session?.user?.id ?? 'me';

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

      <Popover isOpen={open} onClose={() => setOpen(false)} width={240}>
        <div className="flex items-center gap-3 px-4 py-[14px]">
          <Avatar id={id} name={name} size={34} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-bold text-stiko-ink">
              {session?.user?.name ?? 'You'}
            </div>
            <div className="truncate text-[11.5px] text-stiko-muted">
              {session?.user?.email}
            </div>
          </div>
        </div>

        <div className="border-t border-stiko-border p-2">
          <MenuLink href="/settings/account" onClick={() => setOpen(false)}>
            Account settings
          </MenuLink>
          <MenuLink href="/settings/notifications" onClick={() => setOpen(false)}>
            Notifications
          </MenuLink>
        </div>

        <div className="border-t border-stiko-border p-2">
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
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
