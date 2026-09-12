'use client';

import { useRouter } from 'next/navigation';
import { AttentionPill, StatusChip } from '@/components/ui/Primitives';
import { STATUS_ACCENT } from '@/lib/status';
import { relativeTime } from '@/lib/design';
import { needsYou } from '@/lib/home';
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
        ? `${pkg.fileCount} ${pkg.fileCount === 1 ? 'file' : 'files'}`
        : 'empty';

  // Tied to the same predicate the header subline counts with, so the row and
  // the count can never disagree. Solid pill because 01's rule is that solid
  // means a fact about YOU; the outlined StatusChip beside it is a fact about
  // the work.
  const attention = !needsYou(pkg)
    ? null
    : pkg.mentions > 0
      ? {
          label: `${pkg.mentions} mention${pkg.mentions === 1 ? '' : 's'}`,
          bg: '#FFE2E2',
          fg: '#B23A52',
        }
      : { label: 'New version', bg: '#FFFCCE', fg: '#7A5E00' };

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
          {pkg.versionNumber != null && (
            <span className="shrink-0">
              <StatusChip status={pkg.status} />
            </span>
          )}
          {attention && (
            <span className="shrink-0">
              <AttentionPill
                label={attention.label}
                bg={attention.bg}
                fg={attention.fg}
              />
            </span>
          )}
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
