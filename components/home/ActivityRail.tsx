'use client';

import React from 'react';
import ActivityFeedPanel from '@/components/home/ActivityFeedPanel';
import type { NotificationRow } from '@/components/shell/NotificationTray';
import type { PackageCard } from '@/lib/queries';

/**
 * The right-hand rail: an AI summary panel stacked over the activity feed.
 *
 * The wrapper animates its width while the inner column stays a fixed 344px —
 * that is what stops the feed's contents from reflowing on every frame of the
 * open/close. Below lg the rail is a full-width block stacked under the project
 * list instead, and hiding it is a plain unmount: animating a width on a
 * stacked block animates nothing the user can see, and the fixed inner width
 * would overflow a phone.
 */
export default function ActivityRail({
  notifications,
  packages,
  railOpen,
  summary,
  onChanged,
  onCollapse,
}: {
  notifications: NotificationRow[];
  /** The FILTERED package set — the stat tiles must match the page subline. */
  packages: PackageCard[];
  railOpen: boolean;
  summary: React.ReactNode;
  onChanged: () => void;
  onCollapse: () => void;
}) {
  if (!railOpen) return null;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="stiko-motion w-full shrink-0 overflow-hidden transition-[width,opacity] duration-[340ms] ease-[cubic-bezier(.4,0,.2,1)] lg:h-full lg:w-[356px]"
    >
      <aside className="flex h-full w-full flex-col overflow-hidden lg:w-[344px]">
        {summary}
        <ActivityFeedPanel
          notifications={notifications}
          packages={packages}
          onChanged={onChanged}
          onCollapse={onCollapse}
        />
      </aside>
    </div>
  );
}
