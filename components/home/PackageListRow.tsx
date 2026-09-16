'use client';

import { useRouter } from 'next/navigation';
import { AttentionPill, StatusChip } from '@/components/ui/Primitives';
import { STATUS_ACCENT } from '@/lib/status';
import { relativeTime } from '@/lib/design';
import { packageAttention } from '@/lib/home';
import type { PackageCard } from '@/lib/queries';

/**
 * A package inside its project's expansion.
 *
 * Single row of fixed-width cells rather than the two stacked lines the old
 * card used: inside an expansion the package's siblings are directly above and
 * below it, so the eye scans a column and the columns have to line up.
 */
export function PackageListRow({ pkg }: { pkg: PackageCard }) {
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

  const attention = packageAttention(pkg);

  return (
    <button
      onClick={() => router.push(`/portal/${pkg.id}`)}
      className="stiko-motion stiko-row-in flex items-center gap-3 rounded-[10px] bg-white px-3 py-[11px] text-left shadow-stiko-panel transition-[transform,box-shadow] duration-[160ms] ease-[cubic-bezier(.34,1.3,.64,1)] hover:translate-x-[3px] hover:shadow-stiko-lift"
      style={{ borderLeft: `3px solid ${STATUS_ACCENT[pkg.status]}` }}
    >
      <span
        className="truncate text-[13px] font-bold text-stiko-ink"
        style={{ flex: '1 1 200px', minWidth: 170 }}
      >
        {pkg.name}
      </span>

      <span className="w-[200px] shrink-0 truncate text-[11px] text-stiko-muted">
        {meta}
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

      <span
        className="w-[62px] shrink-0 text-right text-[11px] font-extrabold"
        style={{ color: pkg.openComments > 0 ? '#B23A52' : '#8A90A6' }}
      >
        {count}
      </span>

      <svg
        className="h-[13px] w-[13px] shrink-0 text-stiko-ghost"
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
  );
}
