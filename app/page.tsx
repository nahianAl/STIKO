'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { Column, Shell, TopBar } from '@/components/ui/Shell';
import { AvatarStack, SkeletonBar } from '@/components/ui/Primitives';
import { PackageRow } from '@/components/home/PackageRow';
import NotificationTray, {
  type NotificationRow,
} from '@/components/shell/NotificationTray';
import AvatarMenu from '@/components/shell/AvatarMenu';
import CommandPalette from '@/components/shell/CommandPalette';
import { DISCLOSURE, type DisclosureState } from '@/lib/disclosure';
import { relativeTime } from '@/lib/design';
import type { PackageCard } from '@/lib/queries';
import { useSession } from 'next-auth/react';

export default function Home() {
  const router = useRouter();
  const { data: session } = useSession();

  const [packages, setPackages] = useState<PackageCard[]>([]);
  const [disclosure, setDisclosure] = useState<DisclosureState | null>(null);
  const [isGuestOnly, setIsGuestOnly] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [homeRes, notifRes] = await Promise.all([
        fetch('/api/home'),
        fetch('/api/notifications'),
      ]);
      if (homeRes.ok) {
        const data = await homeRes.json();
        setPackages(data.packages);
        setDisclosure(data.disclosure);
        setIsGuestOnly(data.isGuestOnly);
      }
      if (notifRes.ok) setNotifications(await notifRes.json());
    } catch (err) {
      console.error('Failed to load home', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const newPackage = () => router.push('/new');

  if (loading || !disclosure) {
    return <HomeSkeleton />;
  }

  // 03: everything on the right of the top bar is earned.
  const showSearch = DISCLOSURE.showSearch(disclosure);
  const showBell = DISCLOSURE.showNotifications(disclosure);
  const groupByProject = DISCLOSURE.groupByProject(disclosure);
  const showTags = groupByProject;
  const showStatus = DISCLOSURE.showStatusChips(disclosure);

  const needsYou = packages.filter(
    (p) => p.mentions > 0 || (p.versionNumber != null && !p.seenLatest)
  );

  const topBarRight = (
    <>
      {showSearch && (
        <button
          onClick={() => {
            // The palette owns search; the field is its affordance.
            document.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'k', metaKey: true })
            );
          }}
          className="hidden items-center gap-2 rounded-[10px] bg-stiko-app px-3 py-[7px] text-[12.5px] text-stiko-faint transition hover:text-stiko-muted md:flex"
          style={{ width: 260 }}
        >
          <svg
            className="h-[15px] w-[15px]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
          >
            <path d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
          Search packages, files, comments
        </button>
      )}
      {showBell && (
        <NotificationTray notifications={notifications} onChanged={load} />
      )}
      {/* 3m: a guest home has no "New package" in the primary slot. */}
      {!isGuestOnly && <Button onClick={newPackage}>New package</Button>}
      <AvatarMenu />
    </>
  );

  // 3e — first run. No packages at all.
  if (packages.length === 0) {
    const firstName = (session?.user?.name ?? '').split(' ')[0];
    return (
      <Shell>
        <TopBar right={<AvatarMenu />} />
        <Column width={900}>
          <EmptyState
            size="lg"
            heading={`Welcome to Stiko${firstName ? `, ${firstName}` : ''}`}
            description="Drop a set of drawings, invite the people who need to see them, and every comment lands as a note pinned exactly where it belongs."
            actionLabel="Send your first drawings for review"
            onAction={newPackage}
            explainers={[
              {
                title: 'Drop your files',
                body: 'Drawings, models, PDFs. Folders keep their structure.',
              },
              {
                title: 'Invite reviewers',
                body: 'They get an email and land straight on the file.',
              },
              {
                title: 'Collect the notes',
                body: 'Every comment stays pinned where it belongs.',
              },
            ]}
          />
          <p className="mt-8 text-center text-[12.5px] text-stiko-faint">
            Waiting on an invite instead? It&apos;ll arrive by email — nothing to
            set up here.
          </p>
        </Column>
        <CommandPalette packages={packages} onNewPackage={newPackage} />
      </Shell>
    );
  }

  // 3m — guest home. Commenters and uploaders across several clients.
  if (isGuestOnly) {
    return (
      <Shell>
        <TopBar right={topBarRight} />
        <Column width={880}>
          <h1 className="text-[26px] font-extrabold tracking-title text-stiko-ink">
            Your reviews
          </h1>
          <p className="mt-1 text-[13px] text-stiko-muted">
            Packages you&apos;ve been invited to. You&apos;ll get an email
            whenever a new version lands.
          </p>

          <div className="mt-6 flex flex-col gap-3">
            {packages.map((p) => (
              <PackageRow
                key={p.id}
                pkg={p}
                showTag={showTags}
                showStatus={showStatus}
              />
            ))}
          </div>

          <div className="mt-8 flex items-center justify-between rounded-panel bg-white px-5 py-4 shadow-stiko-panel">
            <span className="text-[13px] text-stiko-secondary">
              Need to send drawings of your own?
            </span>
            <Button variant="secondary" onClick={newPackage}>
              New package
            </Button>
          </div>
        </Column>
        <CommandPalette packages={packages} onNewPackage={newPackage} />
      </Shell>
    );
  }

  // 5a — the floor. One package, flat list, no projects.
  if (!groupByProject) {
    return (
      <Shell>
        <TopBar right={topBarRight} />
        <Column width={720}>
          <h1 className="text-[24px] font-extrabold tracking-title text-stiko-ink">
            Your packages
          </h1>
          <div className="mt-5 flex flex-col gap-3">
            {packages.map((p) => (
              <PackageRow
                key={p.id}
                pkg={p}
                showTag={false}
                showStatus={showStatus}
                primary
              />
            ))}
          </div>

          <button
            onClick={newPackage}
            className="mt-4 w-full rounded-panel border-2 border-dashed border-stiko-dashed bg-stiko-app px-5 py-7 text-center transition hover:border-stiko-primary"
          >
            <p className="text-[13.5px] font-bold text-stiko-ink">
              Drop files to start another package
            </p>
            <p className="mt-1 text-[12.5px] text-stiko-muted">
              Group them into projects later, when you have a few.
            </p>
          </button>
        </Column>
        <CommandPalette packages={packages} onNewPackage={newPackage} />
      </Shell>
    );
  }

  // 5b / 2f — populated. Grouping, inbox and the rest have all been earned.
  const byProject = new Map<string, PackageCard[]>();
  for (const p of packages) {
    byProject.set(p.projectId, [...(byProject.get(p.projectId) ?? []), p]);
  }

  return (
    <Shell>
      <TopBar right={topBarRight} />
      <Column width={1120}>
        {/* 03: never render an empty "Needs you". */}
        {needsYou.length > 0 && (
          <section className="mb-8">
            <div className="mb-3 flex items-center gap-[10px]">
              <h2 className="text-[17px] font-extrabold text-stiko-ink">
                Needs you
              </h2>
              <span
                className="rounded-pill px-2 py-[3px] text-[11px] font-extrabold"
                style={{ background: '#FFE2E2', color: '#B23A52' }}
              >
                {needsYou.length}
              </span>
            </div>
            <div className="flex flex-col gap-[10px]">
              {needsYou.map((p) => (
                <NeedsYouRow key={p.id} pkg={p} />
              ))}
            </div>
          </section>
        )}

        {Array.from(byProject.entries()).map(([projectId, pkgs]) => (
          <section key={projectId} className="mb-8">
            <div className="mb-3 flex items-center justify-between">
              <button
                onClick={() => router.push(`/project/${projectId}`)}
                className="text-[17px] font-extrabold text-stiko-ink hover:text-stiko-primary"
              >
                {pkgs[0].projectName}
              </button>
              <span className="text-[12.5px] text-stiko-muted">
                {pkgs.length} package{pkgs.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {pkgs.map((p) => (
                <PackageRow
                  key={p.id}
                  pkg={p}
                  showTag={showTags}
                  showStatus={showStatus}
                />
              ))}
            </div>
          </section>
        ))}
      </Column>
      <CommandPalette packages={packages} onNewPackage={newPackage} />
    </Shell>
  );
}

/** A "Needs you" row — 2f. The left border carries the event's accent. */
function NeedsYouRow({ pkg }: { pkg: PackageCard }) {
  const router = useRouter();
  const isMention = pkg.mentions > 0;
  const accent = isMention ? '#FF6B6B' : '#FFCF2E';

  return (
    <button
      onClick={() => router.push(`/portal/${pkg.id}`)}
      className="flex w-full items-center justify-between gap-4 rounded-[13px] bg-white px-[17px] py-[14px] text-left shadow-stiko-panel transition hover:shadow-[0_2px_8px_rgba(28,32,48,0.08)]"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {isMention ? (
          <AvatarStack people={pkg.people.slice(0, 1)} size={30} />
        ) : (
          <span
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] text-[11px] font-extrabold"
            style={{ background: '#FFFCCE', color: '#7A5E00' }}
          >
            V{pkg.versionNumber}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-[13px] text-stiko-ink">
            {isMention ? (
              <>
                You were mentioned in <b>{pkg.name}</b>
              </>
            ) : (
              <>
                <b>Version {pkg.versionNumber}</b> published in{' '}
                <b>{pkg.name}</b>
              </>
            )}
          </p>
          <p className="mt-[2px] truncate text-[11.5px] text-stiko-muted">
            {pkg.changelog ? `“${pkg.changelog}” · ` : ''}
            {pkg.projectName}
            {pkg.updatedAt ? ` · ${relativeTime(pkg.updatedAt)}` : ''}
          </p>
        </div>
      </div>
      <span className="shrink-0 text-[12.5px] font-bold text-stiko-primary">
        {isMention ? 'Reply' : 'Review'}
      </span>
    </button>
  );
}

/** 3g — a skeleton in the shape of the answer. No spinners. */
function HomeSkeleton() {
  return (
    <Shell>
      <div className="flex h-[52px] shrink-0 items-center justify-between rounded-panel bg-white px-[18px] shadow-stiko-panel">
        <SkeletonBar width={120} height={14} />
        <SkeletonBar width={90} height={14} secondary />
      </div>
      <Column width={1120}>
        <SkeletonBar width={180} height={20} />
        <div className="mt-5 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-[13px] bg-white px-5 py-[18px] shadow-stiko-panel"
            >
              <div className="flex flex-col gap-2">
                <SkeletonBar width={220} height={14} />
                <SkeletonBar width={300} height={11} secondary />
              </div>
              <SkeletonBar width={80} height={30} secondary />
            </div>
          ))}
        </div>
      </Column>
    </Shell>
  );
}
