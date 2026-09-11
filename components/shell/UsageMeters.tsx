'use client';

import React from 'react';
import { Meter } from '@/components/ui/Meter';
import { SectionLabel, SkeletonBar } from '@/components/ui/Primitives';
import { usageFraction } from '@/lib/plans';
import { formatBytes } from '@/lib/design';

export interface UsagePayload {
  plan: {
    id: string;
    label: string;
    storageBytes: number;
    maxProjects: number | null;
  };
  storage: {
    projectBytes: number;
    trashBytes: number;
    totalBytes: number;
  };
  projects: {
    count: number;
    max: number | null;
  };
}

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
  const projectShare = usageFraction(storage.projectBytes, plan.storageBytes) ?? 0;
  const trashShare = usageFraction(storage.trashBytes, plan.storageBytes) ?? 0;

  const storageSegments = overStorage
    ? [{ key: 'over', fraction: 1, color: OVER_COLOR }]
    : [
        { key: 'projects', fraction: projectShare, color: PROJECT_COLOR },
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
          <Legend color={PROJECT_COLOR}>
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
          alarm ? 'text-[#FF6B6B]' : 'text-stiko-secondary'
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
