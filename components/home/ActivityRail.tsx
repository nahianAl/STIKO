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
  // Deliberately NOT unmounted when closed: an unmount cannot animate, and the
  // rail has to slide rather than vanish. Width carries the motion from lg up,
  // where it is a column; below lg it is a stacked block whose width says
  // nothing, so height carries it there instead.
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      aria-hidden={!railOpen}
      className={`stiko-motion w-full shrink-0 overflow-hidden ease-[cubic-bezier(.4,0,.2,1)] lg:h-full lg:max-h-none ${
        railOpen
          ? 'max-h-[3000px] opacity-100 lg:w-[356px]'
          : 'max-h-0 opacity-0 lg:w-0'
      }`}
      style={{
        transitionProperty: 'width, max-height, opacity, visibility',
        // visibility takes 0s, NOT the shared 340ms. It interpolates as a step
        // that lands at the END of its own duration, so a 340ms duration on top
        // of the 340ms delay would hold the rail focusable for 680ms — twice as
        // long as it is visible.
        transitionDuration: '340ms, 340ms, 340ms, 0s',
        // Held until the slide finishes, so the panel is visible on the way out
        // but leaves the tab order once it is actually gone.
        visibility: railOpen ? 'visible' : 'hidden',
        transitionDelay: railOpen ? '0s' : '0s, 0s, 0s, 340ms',
      }}
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
