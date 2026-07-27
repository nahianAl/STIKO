'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import {
  AttentionPill,
  AvatarStack,
  StatusChip,
  TagChip,
} from '@/components/ui/Primitives';
import { STATUS_ACCENT } from '@/lib/status';
import { deriveAttention } from '@/lib/status';
import { relativeTime } from '@/lib/design';
import type { PackageCard } from '@/lib/queries';

/**
 * A package row (5b / 2g / 3m). Carries signal, not just a name and a date —
 * gap #6. The 3px left border is keyed to objective status; the pill on the
 * right is personal.
 */
export function PackageRow({
  pkg,
  showTag,
  showStatus,
  showRole,
  primary = false,
}: {
  pkg: PackageCard;
  showTag: boolean;
  showStatus: boolean;
  showRole?: string;
  /** The package that needs attention gets the primary button. */
  primary?: boolean;
}) {
  const router = useRouter();
  const attention = deriveAttention({
    mentions: pkg.mentions,
    needsYou: 0,
    hasUnseenVersion: pkg.versionNumber != null && !pkg.seenLatest,
  });

  const open = () => router.push(`/portal/${pkg.id}`);

  return (
    <div
      className="flex items-center justify-between gap-4 rounded-[13px] bg-white px-[20px] py-[18px] shadow-stiko-panel transition hover:shadow-[0_2px_8px_rgba(28,32,48,0.08)]"
      style={{ borderLeft: `3px solid ${STATUS_ACCENT[pkg.status]}` }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-[15.5px] font-extrabold text-stiko-ink">
            {pkg.name}
          </h3>
          {showTag && pkg.tag && <TagChip tag={pkg.tag} />}
          {showStatus && <StatusChip status={pkg.status} />}
          {showRole && <TagChip tag={showRole} />}
        </div>

        <p className="mt-[5px] truncate text-[12.5px] text-stiko-muted">
          {pkg.versionNumber != null ? (
            <>
              V{pkg.versionNumber}
              {pkg.changelog ? ` · “${pkg.changelog}”` : ''}
              {pkg.updatedAt ? ` · updated ${relativeTime(pkg.updatedAt)}` : ''}
              {pkg.updatedByName ? ` by ${pkg.updatedByName}` : ''}
            </>
          ) : (
            'No files yet'
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-5">
        {pkg.versionNumber != null ? (
          <>
            <Stat
              value={pkg.openComments}
              label="open"
              urgent={pkg.openComments > 0}
            />
            <Stat value={pkg.fileCount} label="files" />
            {pkg.people.length > 0 && (
              <AvatarStack people={pkg.people} size={26} />
            )}
            <AttentionPill {...attention} />
            <Button variant={primary ? 'primary' : 'secondary'} onClick={open}>
              Open
            </Button>
          </>
        ) : (
          // 2g: a package with no version swaps the stats for the two actions
          // that would give it one.
          <>
            <Button variant="secondary" onClick={open}>
              Invite people
            </Button>
            <Button onClick={open}>Add files</Button>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  urgent = false,
}: {
  value: number;
  label: string;
  urgent?: boolean;
}) {
  return (
    <div className="text-center">
      <div
        className={`text-[17px] font-extrabold ${urgent ? 'text-[#B23A52]' : 'text-stiko-ink'}`}
      >
        {value}
      </div>
      <div className="text-[10.5px] text-stiko-faint">{label}</div>
    </div>
  );
}
