'use client';

import { useRouter } from 'next/navigation';
import { StatusChip } from '@/components/ui/Primitives';
import { STATUS_ACCENT } from '@/lib/status';
import { relativeTime } from '@/lib/design';
import type { PackageCard } from '@/lib/queries';

/**
 * A package INSIDE its project card.
 *
 * Inset on the card's white, with the status accent on its left edge — the
 * whole point of the redesign is that a package reads as a child of a project,
 * not as its peer.
 */
export function CardPackageRow({ pkg }: { pkg: PackageCard }) {
  const router = useRouter();

  const meta =
    pkg.versionNumber == null
      ? 'No files yet — add some'
      : [
          `V${pkg.versionNumber}`,
          pkg.changelog ? `"${pkg.changelog}"` : null,
          pkg.updatedAt ? relativeTime(pkg.updatedAt) : null,
        ]
          .filter(Boolean)
          .join(' · ');

  const count =
    pkg.openComments > 0
      ? `${pkg.openComments} open`
      : pkg.fileCount > 0
        ? `${pkg.fileCount} files`
        : 'empty';

  return (
    <button
      onClick={() => router.push(`/portal/${pkg.id}`)}
      className="flex w-full items-center justify-between gap-[10px] rounded-[11px] bg-stiko-app px-3 py-[10px] text-left transition duration-150 hover:bg-stiko-tint"
      style={{ borderLeft: `3px solid ${STATUS_ACCENT[pkg.status]}` }}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-bold text-stiko-ink">
            {pkg.name}
          </span>
          <span className="shrink-0">
            <StatusChip status={pkg.status} />
          </span>
        </span>
        <span className="mt-[3px] block truncate text-[11px] text-stiko-muted">
          {meta}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-[10px]">
        <span
          className="text-[11px] font-extrabold"
          style={{ color: pkg.openComments > 0 ? '#B23A52' : '#8A90A6' }}
        >
          {count}
        </span>
        <svg
          className="h-[13px] w-[13px] text-stiko-ghost"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </span>
    </button>
  );
}
