'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { Column, Shell, TopBar } from '@/components/ui/Shell';
import ProjectCard from '@/components/home/ProjectCard';
import NewProjectModal from '@/components/home/NewProjectModal';
import ProjectPeopleDrawer from '@/components/home/ProjectPeopleDrawer';
import { HomeError, HomeSkeleton } from '@/components/home/HomeStates';
import NotificationTray, {
  type NotificationRow,
} from '@/components/shell/NotificationTray';
import ActivityRail from '@/components/home/ActivityRail';
import AvatarMenu from '@/components/shell/AvatarMenu';
import CommandPalette from '@/components/shell/CommandPalette';
import { DISCLOSURE, type DisclosureState } from '@/lib/disclosure';
import {
  filterGroups,
  groupProjects,
  needsYou,
  showFilterRow,
  type HomeFilter,
} from '@/lib/home';
import type { PackageCard, ProjectSummary } from '@/lib/queries';
import { useSession } from 'next-auth/react';

/**
 * Owner home. Two states: first run, and the project grid.
 *
 * The grid covers every populated case — one package or fifty, owned or
 * invited. The old guest-only screen and the flat one-package floor are gone:
 * an "Invited · Commenter" card says more than a separate screen did.
 */
export default function Home() {
  const router = useRouter();
  const { data: session } = useSession();

  const [packages, setPackages] = useState<PackageCard[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [disclosure, setDisclosure] = useState<DisclosureState | null>(null);
  const [isGuestOnly, setIsGuestOnly] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<HomeFilter>('all');
  const [peoplePanelProjectId, setPeoplePanelProjectId] = useState<string | null>(
    null
  );
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [homeRes, notifRes] = await Promise.all([
        fetch('/api/home'),
        fetch('/api/notifications'),
      ]);

      if (!homeRes.ok) {
        // A failure must never render as "still loading". Without this the
        // skeleton stays on screen forever and the real cause is invisible.
        const body = await homeRes.json().catch(() => ({}));
        setError(
          homeRes.status === 401
            ? 'Your session has expired.'
            : (body.error ?? `Couldn’t load your packages (${homeRes.status}).`)
        );
        return;
      }

      const data = await homeRes.json();
      setPackages(data.packages);
      setProjects(data.projects ?? []);
      setDisclosure(data.disclosure);
      setIsGuestOnly(data.isGuestOnly);

      // Notifications are supporting detail; losing them must not take the
      // whole screen down.
      if (notifRes.ok) setNotifications(await notifRes.json());
    } catch (err) {
      console.error('Failed to load home', err);
      setError('Couldn’t reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(
    () => groupProjects(packages, projects),
    [packages, projects]
  );
  const visible = useMemo(() => {
    // The pills unmount when there is nothing to filter; without this the last
    // selection would keep filtering a grid the user can no longer unfilter.
    const active = showFilterRow(groups) ? filter : 'all';
    return filterGroups(groups, active);
  }, [groups, filter]);

  const newPackage = () => router.push('/new');

  if (loading) return <HomeSkeleton />;

  // Anything that isn't "still loading" gets a real answer, never the skeleton.
  if (error || !disclosure) return <HomeError message={error} onRetry={load} />;

  // 03: everything on the right of the top bar is earned.
  const showSearch = DISCLOSURE.showSearch(disclosure);
  const showBell = DISCLOSURE.showNotifications(disclosure);

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
          className="hidden items-center gap-2 rounded-[10px] bg-stiko-app px-3 py-[7px] text-[12.5px] text-stiko-faint transition duration-150 hover:text-stiko-muted md:flex"
          style={{ width: 240 }}
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
      <Button onClick={newPackage}>New package</Button>
      <AvatarMenu />
    </>
  );

  // 3e — first run. Nothing at all to show.
  if (packages.length === 0 && projects.length === 0) {
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

  const visiblePackages = visible.flatMap((g) => g.packages);
  const needsYouCount = visiblePackages.filter(needsYou).length;
  const subline = [
    `${visible.length} ${visible.length === 1 ? 'project' : 'projects'}`,
    `${visiblePackages.length} ${visiblePackages.length === 1 ? 'package' : 'packages'}`,
    needsYouCount > 0 ? `${needsYouCount} need you` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Shell>
      <TopBar right={topBarRight} />

      <div className="flex min-h-0 flex-1 flex-col gap-6 px-1 lg:flex-row">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-wrap items-end justify-between gap-4 px-[2px] pb-3 pt-[2px]">
            <div>
              <h1 className="text-[20px] font-extrabold tracking-title text-stiko-ink">
                Your projects
              </h1>
              <p className="mt-[3px] text-[12.5px] text-stiko-muted">
                {subline}
              </p>
              {/* The only place in the product that states this contract to an
                  invited-only user: they never publish, so the sole signal
                  that a new version exists is the email that goes out when
                  one is pushed. */}
              {isGuestOnly && (
                <p className="mt-[3px] text-[12.5px] text-stiko-muted">
                  You&apos;ll get an email whenever a new version lands.
                </p>
              )}
            </div>

            <div className="flex items-center gap-[6px]">
              {showFilterRow(groups) && (
                <>
                  {(
                    [
                      ['all', 'All'],
                      ['owned', 'Owned by me'],
                      ['shared', 'Shared with me'],
                    ] as [HomeFilter, string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setFilter(key)}
                      className={`rounded-[9px] border-[1.5px] px-[11px] py-[6px] text-[12px] font-bold transition duration-150 ${
                        filter === key
                          ? 'border-stiko-border-strong bg-white text-stiko-ink'
                          : 'border-transparent bg-transparent text-stiko-muted hover:text-stiko-ink'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <span
                    className="bg-stiko-divider"
                    style={{ width: 1, height: 20, margin: '0 4px' }}
                  />
                </>
              )}

              <button
                onClick={() => setNewProjectOpen(true)}
                className="flex items-center gap-[6px] rounded-[10px] bg-gradient-to-br from-[#8094F5] to-[#5B60FF] px-[14px] py-2 text-[12.5px] font-bold text-white shadow-stiko-primary transition duration-150 hover:brightness-[1.04]"
              >
                <svg
                  className="h-[13px] w-[13px]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.8}
                  strokeLinecap="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New project
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-3 pb-4">
            {visible.map((group) => (
              <ProjectCard
                key={group.project.id}
                group={group}
                onOpenPeople={setPeoplePanelProjectId}
              />
            ))}
          </div>
        </div>

        {notifications.length > 0 && (
          <div className="w-full shrink-0 lg:h-full lg:w-auto">
            <ActivityRail
              notifications={notifications}
              packages={packages}
              onChanged={load}
            />
          </div>
        )}
      </div>

      <NewProjectModal
        isOpen={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={load}
      />
      <ProjectPeopleDrawer
        group={groups.find((g) => g.project.id === peoplePanelProjectId) ?? null}
        isOpen={peoplePanelProjectId !== null}
        onClose={() => setPeoplePanelProjectId(null)}
        onChanged={load}
      />
      <CommandPalette packages={packages} onNewPackage={newPackage} />
    </Shell>
  );
}
