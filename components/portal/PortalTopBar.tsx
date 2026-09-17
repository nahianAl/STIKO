'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { LogoMark, Wordmark } from '@/components/ui/Shell';
import { WhoCanSeeThis } from './WhoCanSeeThis';
import ShareModal from './ShareModal';

interface Project { id: string; name: string; createdAt: string }
interface Portal { id: string; projectId: string; name: string; createdAt: string }

interface AccessInfo {
  package: { linkAccess: boolean };
  access: {
    canUpload: boolean;
    canManagePeople: boolean;
    isProjectMember: boolean;
  };
  people: { id: string; name: string; company: string | null; role: string }[];
  notVisibleTo: { id: string; name: string }[];
}

/**
 * The review-view top bar (06).
 *
 * Right side: the avatar stack — which is also the trigger for "Who can see
 * this" (4d) — then Share.
 *
 * "Submit new version" used to live here too. It is now only in the version
 * sidebar, next to the versions it creates. One entry point, not two.
 */
export default function PortalTopBar({
  project,
  portal,
  portalId,
  refreshKey,
}: {
  project: Project | null;
  portal: Portal | null;
  portalId: string;
  /**
   * Bumped by the page when the change feed reports the roster moved. Without
   * it the effect below is keyed on an id that never changes while the portal
   * is open, so someone accepting an invite would stay missing from the avatar
   * stack and from "Who can see this" until a manual refresh — the page's own
   * `participants` state only feeds the uploader-only notify list. Same idiom
   * as CommentsPanel's `refreshKey`.
   */
  refreshKey?: number;
}) {
  const [info, setInfo] = useState<AccessInfo | null>(null);
  const [showShare, setShowShare] = useState(false);

  useEffect(() => {
    fetch(`/api/portals/${portalId}/access`)
      .then((r) => (r.ok ? r.json() : null))
      // A failed re-fetch must not blank a roster already on screen: `info`
      // null hides the avatar stack and the Share button outright. Only the
      // first load has nothing to lose, and it starts null anyway.
      .then((next) => setInfo((prev) => next ?? prev))
      .catch(() => {});
  }, [portalId, refreshKey]);

  return (
    <header className="flex h-[52px] flex-shrink-0 items-center justify-between rounded-panel bg-white px-[18px] shadow-stiko-panel">
      <div className="flex min-w-0 items-center gap-[14px]">
        <Link href="/" className="flex shrink-0 items-center gap-[9px]">
          <LogoMark />
          <Wordmark />
        </Link>
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          {project?.name && (
            <>
              {/* Context, not a destination. There is no project page to open
                  any more — the dashboard's own list is where a project
                  expands — and a guest could never open one anyway (01:
                  guests cannot see the project or its other packages). */}
              <span className="truncate text-stiko-muted">{project.name}</span>
              <span className="text-stiko-crumb">›</span>
            </>
          )}
          <span className="truncate font-semibold text-stiko-ink">
            {portal?.name ?? 'Loading…'}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {info && (
          <WhoCanSeeThis
            packageName={portal?.name ?? 'this package'}
            people={info.people}
            notVisibleTo={info.notVisibleTo}
            linkAccess={info.package.linkAccess}
            canManage={info.access.canManagePeople}
            portalId={portalId}
          />
        )}

        {info?.access.canManagePeople && (
          <Button variant="secondary" onClick={() => setShowShare(true)}>
            <span className="flex items-center gap-[6px]">
              <svg
                className="h-[13px] w-[13px]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="M8.59 13.51l6.83 3.98M15.41 6.51L8.59 10.49" />
              </svg>
              Share
            </span>
          </Button>
        )}

      </div>

      <ShareModal
        isOpen={showShare}
        onClose={() => setShowShare(false)}
        portalId={portalId}
      />
    </header>
  );
}
