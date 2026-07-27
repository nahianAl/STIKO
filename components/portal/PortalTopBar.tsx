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
 * this" (4d) — then the primary "Submit new version", which opens the drawer
 * rather than navigating away (2e).
 */
export default function PortalTopBar({
  project,
  portal,
  portalId,
  canUpload,
  onSubmitVersion,
}: {
  project: Project | null;
  portal: Portal | null;
  portalId: string;
  canUpload: boolean;
  onSubmitVersion: () => void;
}) {
  const [info, setInfo] = useState<AccessInfo | null>(null);
  const [showShare, setShowShare] = useState(false);

  useEffect(() => {
    fetch(`/api/portals/${portalId}/access`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [portalId]);

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
              {/* A guest sees the project name as context but cannot open it —
                  01: guests cannot see the project or its other packages. */}
              {info?.access.isProjectMember ? (
                <Link
                  href={`/project/${project.id}`}
                  className="truncate !text-stiko-muted hover:!text-stiko-ink"
                >
                  {project.name}
                </Link>
              ) : (
                <span className="truncate text-stiko-muted">{project.name}</span>
              )}
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
            Share
          </Button>
        )}

        {canUpload && (
          <Button onClick={onSubmitVersion}>Submit new version</Button>
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
