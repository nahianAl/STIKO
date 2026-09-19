'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import EmptyState from '@/components/ui/EmptyState';
import { Column, Shell, TopBar } from '@/components/ui/Shell';
import { ProjectListRow } from '@/components/home/ProjectListRow';
import { ProjectListHeader } from '@/components/home/ProjectListHeader';
import NewProjectModal from '@/components/home/NewProjectModal';
import ProjectPanel from '@/components/home/ProjectPanel';
import TrashPanel from '@/components/home/TrashPanel';
import { HomeError, HomeSkeleton } from '@/components/home/HomeStates';
import type { NotificationRow } from '@/components/shell/NotificationTray';
import ActivityRail from '@/components/home/ActivityRail';
import ProjectSummaryPanel from '@/components/home/ProjectSummaryPanel';
import RailToggle from '@/components/shell/RailToggle';
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
 * Owner home. Two states: first run, and the project list.
 *
 * The list covers every populated case — one package or fifty, owned or
 * invited. Packages stay hidden until their project is selected, which is what
 * keeps the screen readable at five packages per project and above; the card
 * grid that preceded this listed every package inline and did not.
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
  // The ⤢ control on each row opens the same panel, landing on the
  // cross-package view instead of the avatar stack's people view. Separate
  // state rather than a shared id + view pair: only one of the two is ever
  // non-null at a time (nothing opens both at once), and closing the panel
  // clears both together below.
  const [managePanelProjectId, setManagePanelProjectId] = useState<
    string | null
  >(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [hasTrash, setHasTrash] = useState(false);

  const [expanded, setExpanded] = useState<string | null>(null);
  // The last non-null selection, so the summary panel keeps its content for
  // the whole close animation instead of flashing empty on the way down.
  const [lastId, setLastId] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);

  // Read from localStorage in an effect, never as the initial state: this
  // component is still server-rendered, and a value the server cannot see
  // would make the first client render disagree with the HTML.
  useEffect(() => {
    const stored = window.localStorage.getItem('stiko.railOpen');
    if (stored !== null) setRailOpen(stored === 'true');
  }, []);

  const toggleRail = useCallback(() => {
    setRailOpen((v) => {
      window.localStorage.setItem('stiko.railOpen', String(!v));
      return !v;
    });
  }, []);

  const toggleProject = useCallback((id: string) => {
    setExpanded((current) => (current === id ? null : id));
    setLastId(id);
    // Forced open, never forced closed: otherwise the summary panel would
    // animate open behind a hidden rail. The user's own choice to hide the
    // rail is never overridden in the other direction.
    setRailOpen(true);
    window.localStorage.setItem('stiko.railOpen', 'true');
  }, []);

  // Two entry points share one ProjectPanel instance (see panelProjectId /
  // panelView below). Each clears the other's id on open, not just on close —
  // without that, opening one while the other is still set from a previous
  // open (never closed, just superseded) would leave both non-null and the
  // people-takes-precedence merge below would show the wrong view.
  const openPeoplePanel = useCallback((id: string) => {
    setManagePanelProjectId(null);
    setPeoplePanelProjectId(id);
  }, []);
  const openManagePanel = useCallback((id: string) => {
    setPeoplePanelProjectId(null);
    setManagePanelProjectId(id);
  }, []);

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

  // The first-run screen is also where you land after deleting your only
  // project, so the trash cannot simply be absent from it — that would strand
  // 28 days of recoverable content behind no door at all. But a real
  // first-run user's trash is empty and the button there is pure noise, so
  // the screen asks before offering it. Scoped to the branch that renders
  // that screen: the populated dashboard never pays for this call.
  const dashboardIsEmpty =
    !loading && packages.length === 0 && projects.length === 0;

  useEffect(() => {
    if (!dashboardIsEmpty) return;
    let cancelled = false;
    fetch('/api/trash')
      .then((res) => (res.ok ? res.json() : []))
      .then((body) => {
        if (!cancelled) setHasTrash(Array.isArray(body) && body.length > 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dashboardIsEmpty]);

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
          className="hidden items-center gap-2 whitespace-nowrap rounded-[10px] bg-stiko-app px-3 py-[7px] text-[12.5px] text-stiko-faint transition duration-150 hover:text-stiko-muted md:flex"
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
        <RailToggle
          open={railOpen}
          hasUnread={notifications.some((n) => !n.readAt)}
          onToggle={toggleRail}
        />
      )}
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

        {/* Absent for a real first run — see the dashboardIsEmpty effect
            above. It reappears only if this screen is the aftermath of
            deleting everything, which is the one case where the trash has
            something in it and no other door. */}
        {hasTrash && <TrashButton onClick={() => setTrashOpen(true)} />}
        <TrashPanel
          isOpen={trashOpen}
          onClose={() => setTrashOpen(false)}
          onRestored={load}
        />
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

  const summaryGroup = groups.find((g) => g.project.id === lastId) ?? null;

  // Whichever entry point was used last — the avatar stack (people) or the
  // row's ⤢ control (manage) — wins; the other is always null at that point,
  // since opening either sets the other back to null via the shared onClose.
  const panelProjectId = peoplePanelProjectId ?? managePanelProjectId;
  const panelView: 'everyone' | 'packages' =
    peoplePanelProjectId !== null ? 'everyone' : 'packages';

  return (
    <Shell>
      <TopBar right={topBarRight} />

      {/* Clicking the page background deselects. Everything that would be
          closing the thing you just clicked inside of — the expansion panel,
          the rail, the header's own controls — stops the event itself. */}
      <div
        onClick={() => setExpanded(null)}
        className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-1 lg:flex-row lg:gap-3 lg:overflow-visible"
      >
        {/* flex-none (not flex-1) below lg: this is a flex column here, and
            the rail is shrink-0 with a content-driven height — once the rail's
            content is taller than this row (a handful of notifications is
            enough on a phone), flex-1's flex-basis:0% has nothing to grow into
            and the column collapses to 0px, rendering the list UNDER the rail
            instead of above it. flex-none makes this column size to its own
            content. lg:flex-1 restores fill-remaining-space once the layout is
            a row. */}
        <div className="min-h-0 flex-none lg:flex-1 lg:overflow-y-auto lg:pr-2">
          <div className="flex flex-wrap items-end justify-between gap-4 px-[2px] pb-4 pt-5">
            <div>
              {/* Title and count share a baseline rather than stacking: the
                  count is an attribute of the title, not a second heading, and
                  side by side it reads as one line instead of two. */}
              <div className="flex flex-wrap items-baseline gap-3">
                <h1 className="text-[20px] font-extrabold tracking-title text-stiko-ink">
                  Your projects
                </h1>
                <p className="text-[12.5px] text-stiko-muted">{subline}</p>
              </div>
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

            <div
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-[6px]"
            >
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

          {/* overflow-x on the container with min-w on every child: below
              805px the list scrolls sideways rather than crushing the project
              name. Every child carries box-border too — a mixed box model here
              drifts the columns out of alignment and stops the row dividers
              short of the row edge once scrolled. */}
          <div className="overflow-x-auto overflow-y-hidden rounded-panel border border-stiko-sheet bg-white shadow-stiko-panel">
            <ProjectListHeader />
            {visible.map((group) => (
              <ProjectListRow
                key={group.project.id}
                group={group}
                expanded={expanded === group.project.id}
                onToggle={toggleProject}
                onOpenPeople={openPeoplePanel}
                onOpenPanel={openManagePanel}
              />
            ))}
          </div>

          {/* Clearance for the fixed trash button, which floats over this
              column's bottom-left corner. Without it the last project row
              sits under the button at the end of the scroll. */}
          <div className="h-16 shrink-0" />
        </div>

        {notifications.length > 0 && (
          <ActivityRail
            notifications={notifications}
            packages={visiblePackages}
            railOpen={railOpen}
            onChanged={load}
            onCollapse={toggleRail}
            summary={
              <ProjectSummaryPanel
                group={summaryGroup}
                open={expanded !== null}
                onClose={() => setExpanded(null)}
              />
            }
          />
        )}
      </div>

      <NewProjectModal
        isOpen={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={load}
      />
      <ProjectPanel
        group={groups.find((g) => g.project.id === panelProjectId) ?? null}
        isOpen={panelProjectId !== null}
        onClose={() => {
          setPeoplePanelProjectId(null);
          setManagePanelProjectId(null);
        }}
        onChanged={load}
        initialView={panelView}
      />
      <TrashButton onClick={() => setTrashOpen(true)} />
      <TrashPanel
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        onRestored={load}
      />
      <CommandPalette packages={packages} onNewPackage={newPackage} />
    </Shell>
  );
}

/**
 * The trash door — pinned to the bottom-left corner of the window.
 *
 * Fixed rather than in the flow under the list: the list is as long as the
 * user's projects make it, and a control that scrolls out of reach is one
 * they have to go hunting for. `bottom-3 left-3` lands it on the shell's own
 * 12px gutter (Shell is `p-3`), so it reads as part of the frame.
 *
 * `fixed` resolves against the viewport here because nothing above it carries
 * a transform, filter or will-change — Shell is a plain flex column. Putting
 * one on an ancestor later would silently re-anchor this button to it.
 *
 * z-30 is chosen, not inherited: above everything the dashboard itself
 * paints, and below Drawer (z-58/59) so the trash panel's own scrim covers
 * this button once it is open rather than leaving it floating on top of the
 * thing it just opened.
 *
 * Rendered by this file and nowhere else — the trash belongs to the projects
 * dashboard, so it never follows the user into a portal, a settings page or
 * the review viewport.
 */
function TrashButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      // The page root deselects on background click. Without this the click
      // opens the panel and then bubbles up and clears `expanded` in the same
      // React batch — the same trap ProjectListRow documents. Harmless on the
      // first-run branch, which has no such handler.
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title="Deleted projects and packages"
      className="fixed bottom-3 left-3 z-30 flex items-center gap-2 rounded-[10px] border border-stiko-sheet bg-white px-[13px] py-2 text-[12.5px] font-bold text-stiko-secondary shadow-stiko-lift transition duration-150 hover:text-stiko-ink hover:shadow-stiko-sheet focus:outline-none focus-visible:shadow-stiko-focus"
    >
      <svg
        className="h-[13px] w-[13px]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
      </svg>
      Trash
    </button>
  );
}
