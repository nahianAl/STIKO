'use client';

import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/ui/Primitives';
import { activityAccent, groupActivity, homeStats } from '@/lib/home';
import { relativeTime } from '@/lib/design';
import type { NotificationRow } from '@/components/shell/NotificationTray';
import type { PackageCard } from '@/lib/queries';

const BADGE_COLOR: Record<string, { bg: string; fg: string }> = {
  MENTION: { bg: '#FFE2E2', fg: '#B23A52' },
  ACTION: { bg: '#FFE2E2', fg: '#B23A52' },
  NEW: { bg: '#FFFCCE', fg: '#7A5E00' },
};

/**
 * Panel B — one chronological feed for everything, replacing the standalone
 * "Needs you" block that was the screen's biggest source of vertical dead
 * space. It absorbs whatever height the summary panel above it leaves, so the
 * two move together when a project is selected.
 *
 * Fed by `notifications`, which only carries what was addressed to this viewer.
 * The title overstates that knowingly — see the design spec.
 */
export default function ActivityFeedPanel({
  notifications,
  packages,
  onChanged,
  onCollapse,
}: {
  notifications: NotificationRow[];
  /** The FILTERED package set — the stat tiles must match the page subline. */
  packages: PackageCard[];
  onChanged: () => void;
  onCollapse: () => void;
}) {
  const router = useRouter();
  const stats = homeStats(packages);
  const groups = groupActivity(notifications);
  const hasUnread = notifications.some((n) => !n.readAt);

  const open = async (row: NotificationRow) => {
    if (!row.readAt) {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      }).catch(() => {});
      onChanged();
    }
    router.push(row.href);
  };

  const markAll = async () => {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
    onChanged();
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel bg-white shadow-stiko-panel">
      <div className="flex shrink-0 items-center justify-between gap-[10px] border-b border-stiko-border px-4 py-[14px]">
        <div className="min-w-0">
          <h2 className="text-[15px] font-extrabold text-stiko-ink">Activity</h2>
          <p className="mt-[2px] text-[11.5px] text-stiko-muted">
            Everything, newest first
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasUnread && (
            <button
              onClick={markAll}
              className="text-[11.5px] font-bold text-stiko-primary transition duration-150"
            >
              Mark all read
            </button>
          )}
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Hide activity"
            className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-stiko-app text-stiko-muted transition duration-150 hover:bg-stiko-idle hover:text-stiko-ink"
          >
            <svg
              className="h-[13px] w-[13px]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-2 px-3 pb-[6px] pt-3">
        <StatTile value={stats.needsYou} label="need you" color="#B23A52" />
        <StatTile value={stats.openComments} label="open comments" color="#1C2030" />
        <StatTile value={stats.inReview} label="in review" color="#7A5E00" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[14px] pt-[6px]">
        {groups.map((group) => (
          <div key={group.label} className="pt-[10px]">
            <div className="px-1 pb-[6px] text-[10px] font-bold uppercase tracking-label text-stiko-faint">
              {group.label}
            </div>
            <div className="flex flex-col gap-1">
              {group.items.map((row) => {
                const accent = activityAccent(row.type);
                const badge = accent.badge ? BADGE_COLOR[accent.badge] : null;
                const meta = [
                  row.projectName,
                  row.packageName,
                  relativeTime(row.createdAt),
                ]
                  .filter(Boolean)
                  .join(' · ');

                return (
                  <button
                    key={row.id}
                    onClick={() => open(row)}
                    className="flex items-start gap-[10px] rounded-[11px] px-[10px] py-[9px] text-left transition duration-150 hover:bg-stiko-tint"
                    style={{
                      background: accent.bg ?? 'transparent',
                      // Transparent rather than absent, so text baselines line
                      // up across accented and plain rows.
                      borderLeft: `3px solid ${accent.border ?? 'transparent'}`,
                    }}
                  >
                    <Avatar
                      id={row.actorId ?? row.id}
                      name={row.actorName ?? 'Someone'}
                      size={28}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] leading-[1.45] text-stiko-ink">
                        {row.title}
                      </span>
                      <span className="mt-[2px] block truncate text-[10.5px] text-stiko-faint">
                        {meta}
                      </span>
                    </span>
                    {badge && (
                      <span
                        className="shrink-0 rounded-pill px-[7px] py-[2px] text-[9px] font-extrabold uppercase"
                        style={{ background: badge.bg, color: badge.fg }}
                      >
                        {accent.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatTile({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div className="rounded-inset bg-stiko-app px-[11px] py-[10px]">
      <div className="text-[19px] font-extrabold leading-none" style={{ color }}>
        {value}
      </div>
      <div
        className="mt-1 text-[10.5px] text-stiko-muted"
        style={{ lineHeight: 1.3 }}
      >
        {label}
      </div>
    </div>
  );
}
