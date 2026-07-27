'use client';

import React from 'react';
import Button from '@/components/ui/Button';
import { Avatar, StatusChip, TagChip } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { relativeTime } from '@/lib/design';
import type { ProjectPackage, ProjectPerson } from '@/app/project/[id]/page';

/**
 * 4b — "Waiting on". Chasing five consultants was the coordinator's real job
 * and had no screen.
 *
 * The verb is **Remind**, never "nudge". The view is **Waiting on**, never
 * "who's blocking".
 */

type PersonState = 'not_opened' | 'viewed_silent' | 'commented';

const STATE_STYLE: Record<
  PersonState,
  { bg: string; fg: string; label: (p: ProjectPerson) => string }
> = {
  not_opened: {
    bg: '#FFE2E2',
    fg: '#8B4453',
    label: () => 'Not opened',
  },
  viewed_silent: {
    bg: '#FFFCCE',
    fg: '#7A6520',
    label: (p) =>
      p.viewedAt ? `Viewed, no comment · ${relativeTime(p.viewedAt)}` : 'Viewed, no comment',
  },
  commented: {
    bg: '#EDFFDA',
    fg: '#4B7A28',
    label: (p) =>
      p.lastCommentAt ? `Commented · ${relativeTime(p.lastCommentAt)}` : 'Commented',
  },
};

function stateOf(person: ProjectPerson): PersonState {
  if (person.commentCount > 0 || person.verdict) return 'commented';
  if (person.viewedAt) return 'viewed_silent';
  return 'not_opened';
}

export function WaitingOn({ packages }: { packages: ProjectPackage[] }) {
  const { toast } = useToast();

  const published = packages.filter((p) => p.versionNumber != null);

  const notOpened = published.flatMap((p) =>
    p.people.filter((person) => stateOf(person) === 'not_opened')
  ).length;

  const awaitingReply = published.reduce((n, p) => n + p.openComments, 0);

  const settled = published.filter(
    (p) => p.status === 'approved' && p.openComments === 0
  ).length;

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard
          accent="#FF6B6B"
          value={notOpened}
          label={`${notOpened === 1 ? 'person hasn’t' : 'people haven’t'} opened the current version`}
        />
        <SummaryCard
          accent="#FFCF2E"
          value={awaitingReply}
          label={`comment${awaitingReply === 1 ? '' : 's'} awaiting your reply`}
        />
        <SummaryCard
          accent="#7BC24A"
          value={settled}
          label={`package${settled === 1 ? '' : 's'} approved, nothing outstanding`}
        />
      </div>

      {published.map((pkg) => {
        const outstanding = pkg.people.filter(
          (p) => stateOf(p) !== 'commented'
        );

        // Nothing outstanding collapses to a single row.
        if (outstanding.length === 0) {
          return (
            <div
              key={pkg.id}
              className="flex items-center justify-between gap-3 rounded-panel bg-white px-5 py-4 shadow-stiko-panel"
              style={{ borderLeft: '3px solid #7BC24A' }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-[15px] font-extrabold text-stiko-ink">
                  {pkg.name}
                </h3>
                {pkg.tag && <TagChip tag={pkg.tag} />}
                <span className="text-[12.5px] text-stiko-muted">
                  everyone has weighed in
                </span>
              </div>
              <StatusChip status={pkg.status} />
            </div>
          );
        }

        const accent =
          outstanding.some((p) => stateOf(p) === 'not_opened')
            ? '#FF6B6B'
            : '#FFCF2E';

        return (
          <div
            key={pkg.id}
            className="rounded-panel bg-white p-5 shadow-stiko-panel"
            style={{ borderLeft: `3px solid ${accent}` }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-[15px] font-extrabold text-stiko-ink">
                  {pkg.name}
                </h3>
                {pkg.tag && <TagChip tag={pkg.tag} />}
                <span className="text-[12.5px] text-stiko-muted">
                  V{pkg.versionNumber}
                  {pkg.publishedAt
                    ? ` · sent ${new Date(pkg.publishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
                    : ''}
                </span>
              </div>
              <Button
                variant="secondary"
                onClick={() =>
                  toast(
                    `Reminder sent to ${outstanding.length} ${outstanding.length === 1 ? 'person' : 'people'}`
                  )
                }
              >
                Remind {outstanding.length}{' '}
                {outstanding.length === 1 ? 'person' : 'people'}
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {pkg.people.map((person) => {
                const state = stateOf(person);
                const style = STATE_STYLE[state];
                return (
                  <div
                    key={person.id}
                    className="flex items-center gap-[10px] rounded-[10px] px-[11px] py-[9px]"
                    style={{ background: style.bg }}
                  >
                    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-white text-[9px] font-extrabold">
                      <Avatar id={person.id} name={person.name} size={26} />
                    </span>
                    <span className="min-w-0">
                      <span
                        className="block truncate text-[12px] font-bold"
                        style={{ color: style.fg }}
                      >
                        {person.name}
                      </span>
                      <span
                        className="block truncate text-[11px]"
                        style={{ color: style.fg, opacity: 0.85 }}
                      >
                        {style.label(person)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>

            {pkg.pending.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stiko-border pt-3">
                {pkg.pending.map((p) => (
                  <div
                    key={p.email}
                    className="flex items-center gap-2 text-[12px] text-stiko-muted"
                  >
                    <span>
                      <b className="text-stiko-ink">{p.email}</b>&apos;s invite is
                      unaccepted
                    </span>
                    <button
                      onClick={() => toast('Invitation resent')}
                      className="font-bold text-stiko-primary hover:text-stiko-primary-hover"
                    >
                      Resend invite
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SummaryCard({
  accent,
  value,
  label,
}: {
  accent: string;
  value: number;
  label: string;
}) {
  return (
    <div
      className="rounded-panel bg-white px-5 py-4 shadow-stiko-panel"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <div className="text-[24px] font-extrabold text-stiko-ink">{value}</div>
      <div className="mt-[2px] text-[12.5px] leading-[1.4] text-stiko-secondary">
        {label}
      </div>
    </div>
  );
}
