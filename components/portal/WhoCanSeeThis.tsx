'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Popover, { PopoverFooter } from '@/components/ui/Popover';
import { Avatar, AvatarStack, ROLE_TEXT_COLOR } from '@/components/ui/Primitives';

/**
 * 4d — "Who can see this".
 *
 * A popover, not a page, triggered by the avatar stack in the package top bar.
 *
 * Naming who *cannot* see it is the entire value. A list of people with access
 * doesn't answer the question the coordinator is actually asking, which is
 * "have I leaked the consultant's markup to the client?"
 *
 * Always available at every package size — the one coordination affordance
 * exempt from progressive disclosure, because it is one click and it is the
 * coordinator's professional liability.
 */
export function WhoCanSeeThis({
  packageName,
  people,
  notVisibleTo,
  linkAccess,
  canManage,
  portalId,
}: {
  packageName: string;
  people: {
    id: string;
    name: string;
    company: string | null;
    role: string;
  }[];
  /** People on the project who do NOT have access to this package. */
  notVisibleTo: { id: string; name: string }[];
  linkAccess: boolean;
  canManage: boolean;
  portalId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-pill px-2 py-1 transition hover:bg-stiko-app"
        aria-label={`Who can see ${packageName}`}
      >
        <AvatarStack people={people} size={26} max={4} />
        <span className="text-[12.5px] font-semibold text-stiko-secondary">
          {people.length} {people.length === 1 ? 'person' : 'people'}
        </span>
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

      <Popover isOpen={open} onClose={() => setOpen(false)} width={380}>
        <div className="px-4 pb-3 pt-4">
          <h3 className="text-[14px] font-extrabold text-stiko-ink">
            Who can see {packageName}
          </h3>
          <p className="mt-[3px] text-[12px] text-stiko-muted">
            Everything here — files, versions and every comment.
          </p>
        </div>

        <div className="max-h-[280px] overflow-y-auto border-t border-stiko-border px-2 py-2">
          {people.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-[10px] px-2 py-[8px]"
            >
              <Avatar id={p.id} name={p.name} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-bold text-stiko-ink">
                  {p.name}
                </div>
                {p.company && (
                  <div className="truncate text-[11px] text-stiko-muted">
                    {p.company}
                  </div>
                )}
              </div>
              <span
                className="shrink-0 text-[11px] font-bold capitalize"
                style={{ color: ROLE_TEXT_COLOR[p.role] ?? '#8A90A6' }}
              >
                {p.role}
              </span>
            </div>
          ))}
        </div>

        {/* The reassurance strip — the reason this popover exists. */}
        {notVisibleTo.length > 0 && (
          <div
            className="flex gap-[10px] border-t border-stiko-border px-4 py-3"
            style={{ background: '#EDFFDA' }}
          >
            <svg
              className="mt-[2px] h-4 w-4 shrink-0"
              style={{ color: '#4B7A28' }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <div className="text-[12px] leading-[1.5]" style={{ color: '#4B7A28' }}>
              <b>Not visible to</b>{' '}
              {notVisibleTo.map((p) => p.name).join(', ')}
            </div>
          </div>
        )}

        <PopoverFooter>
          {canManage ? (
            <Link href={`/portal/${portalId}/settings/people`} className="font-bold">
              Manage people
            </Link>
          ) : (
            <span className="text-stiko-faint">Invite-only</span>
          )}
          <span className="text-stiko-faint">
            {linkAccess ? 'Anyone with the link' : 'Private package'}
          </span>
        </PopoverFooter>
      </Popover>
    </div>
  );
}
