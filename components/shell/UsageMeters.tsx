'use client';

import React from 'react';
import { Meter } from '@/components/ui/Meter';
import { SectionLabel, SkeletonBar } from '@/components/ui/Primitives';
import { usageFraction } from '@/lib/plans';
import { formatBytes } from '@/lib/design';
import type { AccountUsage } from '@/lib/queries';

// Type-only import, so this erases at compile time and does not pull
// @/lib/db (or the query itself) into the client bundle. Re-exported under
// the old name — an alias, not a hand-copy — so the wire shape and the
// server's AccountUsage can never drift apart the way they used to.
export type UsagePayload = AccountUsage;

/** Projects segment. */
const PROJECT_COLOR = '#5B60FF'; // stiko.primary
/** Trash segment — deliberately quiet; it is zero until trash ships. */
const TRASH_COLOR = '#A2A7B8'; // stiko.faint
/**
 * Over quota. The palette has no amber fill token, and this is the colour the
 * failed-upload bar already uses, so an over-limit bar reads the same way.
 */
const OVER_COLOR = '#FF6B6B'; // note.red-accent

/**
 * Raw bytes/storageBytes ratio, deliberately not clamped to 0–1 here — see
 * the comment at the call site for how the two segments get normalized
 * together before reaching Meter. Mirrors usageFraction()'s handling of
 * degenerate input: a non-finite or non-positive `bytes` is bad input, not a
 * legitimately empty segment, so it's floored to 0; a non-finite or
 * non-positive `storageBytes` (division by zero, a sign flip, or a broken
 * limit) can't produce a real ratio, so any positive usage against it is
 * treated as completely full (1) rather than empty — otherwise the bar would
 * render blank while its over-quota alarm fires. A non-finite division
 * result (e.g. overflow) is likewise floored to 0 rather than left to
 * poison the segment.
 */
function storageRatio(bytes: number, storageBytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  if (!Number.isFinite(storageBytes) || storageBytes <= 0) return 1;
  const ratio = bytes / storageBytes;
  return Number.isFinite(ratio) ? ratio : 0;
}

/**
 * Storage and project usage, as shown in the account menu.
 *
 * Takes its data rather than fetching it, so the same block can be dropped on
 * a settings page later without change.
 */
export default function UsageMeters({
  usage,
  failed = false,
}: {
  usage: UsagePayload | null;
  failed?: boolean;
}) {
  // A failure must never render as "still loading" — that leaves a skeleton on
  // screen forever with the real cause invisible.
  if (failed) {
    return (
      <div className="px-4 py-3 text-[11.5px] text-stiko-faint">
        Usage unavailable
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="space-y-3 px-4 py-3">
        <SkeletonBar width="100%" height={6} />
        <SkeletonBar width="100%" height={6} />
      </div>
    );
  }

  const { plan, storage, projects } = usage;

  const overStorage = storage.totalBytes > plan.storageBytes;
  // Meter clamps each segment to 0–1 *before* summing and renormalizing, so
  // handing it a raw ratio that individually exceeds 1 would clamp that
  // segment down first and distort the split against the other one — not
  // what we want when the true byte proportion is known right here. So the
  // normalizing happens in this component instead: compute the true
  // (possibly >1) ratios, and if together they overflow the track, scale
  // both down by the same factor so each is individually ≤ 1 and they sum to
  // exactly 1. That preserves the real projects/trash byte proportion all
  // the way to Meter, whose own per-segment clamp is then a no-op.
  const rawProjectShare = storageRatio(storage.projectBytes, plan.storageBytes);
  const rawTrashShare = storageRatio(storage.trashBytes, plan.storageBytes);
  const shareSum = rawProjectShare + rawTrashShare;
  const shareScale = shareSum > 1 ? 1 / shareSum : 1;
  const projectShare = rawProjectShare * shareScale;
  const trashShare = rawTrashShare * shareScale;

  // Same variable feeds both the bar segment and the legend dot below, so the
  // two can never disagree about what colour "Projects" is drawn in.
  const projectColor = overStorage ? OVER_COLOR : PROJECT_COLOR;

  const storageSegments = [
    { key: 'projects', fraction: projectShare, color: projectColor },
    { key: 'trash', fraction: trashShare, color: TRASH_COLOR },
  ];

  const projectFraction = usageFraction(projects.count, projects.max);
  const overProjects = projects.max !== null && projects.count > projects.max;

  return (
    <div className="space-y-3 px-4 py-3">
      <div>
        <Row
          left="Storage"
          right={`${formatBytes(storage.totalBytes)} / ${formatBytes(plan.storageBytes)}`}
          alarm={overStorage}
        />
        <div className="mt-[6px]">
          <Meter
            segments={storageSegments}
            label={`${formatBytes(storage.totalBytes)} of ${formatBytes(plan.storageBytes)} used`}
          />
        </div>
        <div className="mt-[6px] flex items-center gap-3 text-[11px] text-stiko-muted">
          <Legend color={projectColor}>
            Projects {formatBytes(storage.projectBytes)}
          </Legend>
          <Legend color={TRASH_COLOR}>
            Trash {formatBytes(storage.trashBytes)}
          </Legend>
        </div>
      </div>

      <div>
        <Row
          left="Projects"
          right={
            projects.max === null
              ? String(projects.count)
              : `${projects.count} of ${projects.max}`
          }
          alarm={overProjects}
        />
        {/* An unlimited plan gets no bar — a bar with no denominator is
            meaningless, so the count stands on its own. */}
        {projectFraction !== null && (
          <div className="mt-[6px]">
            <Meter
              segments={[
                {
                  key: 'projects',
                  fraction: projectFraction,
                  color: overProjects ? OVER_COLOR : PROJECT_COLOR,
                },
              ]}
              label={`${projects.count} of ${projects.max} projects used`}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  left,
  right,
  alarm,
}: {
  left: string;
  right: string;
  alarm: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <SectionLabel>{left}</SectionLabel>
      <span
        className={`text-[11.5px] font-semibold ${
          alarm ? 'text-note-red-accent' : 'text-stiko-secondary' // #FF6B6B
        }`}
      >
        {right}
      </span>
    </div>
  );
}

function Legend({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-[5px]">
      <span
        className="inline-block h-[7px] w-[7px] rounded-full"
        style={{ background: color }}
      />
      {children}
    </span>
  );
}
