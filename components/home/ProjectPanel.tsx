'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Drawer from '@/components/ui/Drawer';
import Button from '@/components/ui/Button';
import {
  Avatar,
  AvatarStack,
  RoleTag,
  SectionLabel,
  SkeletonBar,
} from '@/components/ui/Primitives';
import { AddPeopleModal } from '@/components/people/AddPeopleModal';
import { TeamMatrix } from '@/components/people/TeamMatrix';
import AccessEditor from '@/components/people/AccessEditor';
import { DangerCard } from '@/components/settings/SettingsShell';
import { DestructiveConfirm } from '@/components/settings/DestructiveConfirm';
import { useToast } from '@/components/ui/Toast';
import { relativeTime } from '@/lib/design';
import { projectRoster, pendingCount } from '@/lib/projectRoster';
import { ROLE_RANK } from '@/lib/roles';
import type { ProjectGroup } from '@/lib/home';
// Type-only: lib/queries.ts imports lib/db, which throws at module load
// without DATABASE_URL. A type-only import is erased, so this client
// component never pulls a database connection in. ProjectPeopleDrawer.tsx
// (the component this replaces) does the same for the same reason.
import type { PackageCard } from '@/lib/queries';
import type { ProjectOverview, ProjectPackage } from '@/lib/projectOverview';

type View = 'packages' | 'everyone';

/**
 * `/api/projects/[id]/overview` is project-member-only (a package guest has no
 * business seeing the project or its other packages), so `overview` is only
 * ever fetched for a `canManage` viewer — see the effect below. A non-manager
 * (someone who is only a participant on one of this project's packages) still
 * opens this panel from the dashboard's "people" avatar stack, so every
 * section below has to render something honest from `group.packages`
 * (PackageCard[], already scoped to what THIS viewer may see) alone.
 *
 * PackageCard carries no `createdAt`, no `publishedAt` and no pending-invite
 * list — those only exist on the richer `ProjectPackage` overview shape, which
 * is exactly why lib/projectOverview.ts added `createdAt` there for this
 * panel rather than widening PackageCard to fit. Every field this file (and
 * AddPeopleModal, which it feeds) actually reads is filled honestly here; the
 * rest is left empty rather than guessed, and callers that display `createdAt`
 * check for a non-empty string first instead of printing an epoch date.
 */
function fallbackPackage(pkg: PackageCard): ProjectPackage {
  return {
    id: pkg.id,
    name: pkg.name,
    tag: pkg.tag,
    createdAt: '',
    versionNumber: pkg.versionNumber,
    changelog: pkg.changelog,
    publishedAt: null,
    updatedByName: pkg.updatedByName,
    fileCount: pkg.fileCount,
    openComments: pkg.openComments,
    status: pkg.status,
    people: pkg.people.map((p) => ({
      id: p.id,
      name: p.name,
      email: '',
      company: null,
      role: p.role ?? '',
      verdict: null,
      viewedAt: null,
      commentCount: 0,
      lastCommentAt: null,
    })),
    // PackageCard has no separate pending-invite list — see the comment above.
    pending: [],
  };
}

interface PersonVM {
  key: string;
  name: string;
  email: string;
  role: string;
  pending: boolean;
  userId: string | null;
}

/**
 * One package's own roster, accepted then pending — the same "accepted first,
 * pending last" convention lib/projectRoster.ts documents for the whole
 * project, applied to a single package instead. Built directly from the
 * package's own `people`/`pending` arrays rather than by calling
 * `projectRoster([pkg])`: that function's pending entries key on the
 * lower-cased email (its `RosterEntry.key`/`email` are the same normalised
 * string, by design, for cross-package matching), and TeamMatrix.tsx's own
 * `roleForCell` comment explains exactly why passing that on to AccessEditor
 * is wrong — routes match email case-sensitively. Reading `pkg.pending`
 * directly keeps each invite's real stored casing intact.
 */
function packagePeople(pkg: ProjectPackage): PersonVM[] {
  const rank = (role: string) =>
    ROLE_RANK[role as keyof typeof ROLE_RANK] ?? 0;
  const byRoleThenName = (a: PersonVM, b: PersonVM) =>
    rank(b.role) - rank(a.role) || a.name.localeCompare(b.name);

  const accepted: PersonVM[] = pkg.people
    .map((p) => ({
      key: p.id,
      name: p.name,
      email: p.email,
      role: p.role,
      pending: false,
      userId: p.id,
    }))
    .sort(byRoleThenName);

  const pending: PersonVM[] = pkg.pending
    .map((inv) => ({
      key: inv.email,
      name: inv.email,
      email: inv.email,
      role: inv.role,
      pending: true,
      userId: null,
    }))
    .sort(byRoleThenName);

  return [...accepted, ...pending];
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface EditingAccess {
  portalId: string;
  packageName: string;
  userId: string | null;
  email: string;
  displayName: string;
  pending: boolean;
}

interface DeleteTarget {
  id: string;
  name: string;
  fileCount: number;
  peopleCount: number;
}

/**
 * The project panel — a project's packages, everyone on them, and both
 * delete controls, in one drawer.
 *
 * This replaces ProjectPeopleDrawer, reorganised around packages rather than
 * a flat people list: that drawer could not see pending invitations at the
 * project level, and the per-package settings page it also partly replaces
 * (Task 7) can only ever see one package at a time. The overview fetch, the
 * AI-summaries toggle, the delete-project flow and the `canManage` gating are
 * lifted from ProjectPeopleDrawer verbatim — they are already correct. The
 * generation-guarded reload below is new: unlike ProjectPeopleDrawer, which
 * fetches its overview once per open and lets it go stale, this panel keeps
 * mutating (add people, edit access, delete a package) while it stays open,
 * so its overview fetch needs to be safely re-invocable — the same shape
 * TrashPanel.tsx already settled on for its own repeatedly-reloaded list.
 */
export default function ProjectPanel({
  group,
  isOpen,
  onClose,
  onChanged,
  initialView,
}: {
  group: ProjectGroup | null;
  isOpen: boolean;
  onClose: () => void;
  /** Refetch the dashboard. */
  onChanged: () => void;
  /** Land on the cross-package grid instead of the package list. */
  initialView?: View;
}) {
  const { toast } = useToast();
  const [view, setView] = useState<View>(initialView ?? 'packages');
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const confirmedAi = useRef(true);
  const [retained, setRetained] = useState<ProjectGroup | null>(group);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [addPersonPkg, setAddPersonPkg] = useState<ProjectPackage | null>(null);
  const [editingAccess, setEditingAccess] = useState<EditingAccess | null>(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [matrixSubSurfaceOpen, setMatrixSubSurfaceOpen] = useState(false);
  // Optimistic: a deleted package's row should disappear the moment its
  // DELETE resolves, not whenever the dashboard's own refetch (onChanged)
  // eventually flows a new `group` prop back down. Cleared whenever the
  // project changes so it cannot outlive the packages it was scoped to.
  const [locallyDeleted, setLocallyDeleted] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (group) setRetained(group);
  }, [group]);

  const projectId = group?.project.id ?? null;

  useEffect(() => {
    setLocallyDeleted(new Set());
  }, [projectId]);

  useEffect(() => {
    if (isOpen) setView(initialView ?? 'packages');
  }, [isOpen, initialView, projectId]);

  // A guest can neither invite nor open the overview — /api/projects/[id]/overview
  // is member-gated and would 404/403. `myRole === 'coordinator'` is safe here
  // because participants.role is CHECK-constrained to viewer|commenter|uploader,
  // so `coordinator` can only come from a project_members row.
  const canManage = Boolean(
    group && (group.project.ownedByMe || group.project.myRole === 'coordinator')
  );

  // Bumped at the start of every load, so a response can tell whether it is
  // still the latest one in flight — same shape as TrashPanel.tsx's own
  // `gen`. Needed here because, unlike ProjectPeopleDrawer's one-shot fetch,
  // this panel calls this again after every mutation it makes while it stays
  // open (see `refresh` below), so an in-flight reload from an earlier
  // mutation must not win a race against a later one.
  const gen = useRef(0);

  const loadOverview = useCallback(() => {
    if (!projectId || !canManage) return;
    const myGen = ++gen.current;
    fetch(`/api/projects/${projectId}/overview`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: ProjectOverview | null) => {
        if (myGen !== gen.current) return;
        if (body) setOverview(body);
      })
      .catch(() => {});
  }, [projectId, canManage]);

  useEffect(() => {
    if (!isOpen || !projectId || !canManage) return;
    setOverview(null);
    setAiError(null);
    loadOverview();

    fetch(`/api/projects/${projectId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body && typeof body.aiSummariesEnabled === 'boolean') {
          setAiEnabled(body.aiSummariesEnabled);
          confirmedAi.current = body.aiSummariesEnabled;
        }
      })
      .catch(() => {});
  }, [isOpen, projectId, canManage, loadOverview]);

  // Refetches both this panel's own overview AND the dashboard behind it.
  // Passed as `onChanged` to every sub-surface that can mutate access
  // (AddPeopleModal, AccessEditor, TeamMatrix), so the packages list and the
  // "not accepted" count update without needing the panel closed and reopened.
  const refresh = useCallback(() => {
    onChanged();
    loadOverview();
  }, [onChanged, loadOverview]);

  // Only the project OWNER sees the AI switch or the delete-project control —
  // stricter than `canManage`, matching DELETE /api/projects/[id] itself,
  // which checks `owner_id`, not project_members.
  const isOwner =
    overview?.members.some((m) => m.isYou && m.role === 'owner') ?? false;

  const saveAi = useCallback(
    async (next: boolean) => {
      if (aiSaving || !projectId) return;
      setAiError(null);
      setAiEnabled(next);
      setAiSaving(true);
      try {
        const res = await fetch(`/api/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aiSummariesEnabled: next }),
        });
        if (!res.ok) {
          setAiEnabled(confirmedAi.current);
          setAiError(
            `Couldn’t save that — the switch is still ${confirmedAi.current ? 'on' : 'off'}.`
          );
        } else {
          confirmedAi.current = next;
        }
      } catch {
        setAiEnabled(confirmedAi.current);
        setAiError('Couldn’t reach the server — nothing changed.');
      } finally {
        setAiSaving(false);
      }
    },
    [aiSaving, projectId]
  );

  const deleteProject = async () => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    // An expired session is 302'd to /login by middleware and fetch follows
    // it, handing back 200 HTML — res.ok alone would report a deletion that
    // never happened and leave the project still listed.
    if (res.redirected) {
      toast('Your session has expired. Sign in and try again.');
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast(body.error ?? 'Could not delete this project');
      return;
    }
    setConfirmDeleteProject(false);
    onClose();
    onChanged();
  };

  const deletePackage = async (target: DeleteTarget) => {
    const res = await fetch(`/api/portals/${target.id}`, { method: 'DELETE' });
    if (res.redirected) {
      toast('Your session has expired. Sign in and try again.');
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast(body.error ?? 'Could not delete this package');
      return;
    }
    setDeleteTarget(null);
    setLocallyDeleted((prev) => new Set(prev).add(target.id));
    toast(`${target.name} deleted`);
    refresh();
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Every sub-surface this panel can open registers its own document-level
  // Escape handler (Drawer/Modal both do), and Drawer's own listener runs
  // regardless — so without gating `closeOnEscape` on all of them, one Escape
  // press would close whichever sub-surface is open AND this whole panel
  // underneath it. `matrixSubSurfaceOpen` is TeamMatrix's own contract for
  // exactly this (its AccessEditor/AddPeopleModal), fed by `onSubSurfaceChange`
  // below; the rest are this panel's own sub-surfaces.
  const closeOnEscape =
    !addOpen &&
    !addPersonPkg &&
    !editingAccess &&
    !confirmDeleteProject &&
    !deleteTarget &&
    !matrixSubSurfaceOpen;

  // Same reasoning as ProjectPeopleDrawer's own `shown`: the caller derives
  // `group` by looking up the selected id, so it goes null the instant the
  // drawer is dismissed — which would unmount Drawer before its own exit
  // animation has a frame to run in.
  const shown = group ?? retained;
  if (!shown) return null;

  const { project } = shown;
  const packages = shown.packages.filter((p) => !locallyDeleted.has(p.id));
  const overviewById = new Map(
    (overview?.packages ?? []).map((p) => [p.id, p] as const)
  );

  const roster = projectRoster(overview?.packages ?? packages.map(fallbackPackage));
  const pending = pendingCount(roster);

  const headerParts = [
    `${packages.length} ${packages.length === 1 ? 'package' : 'packages'}`,
    `${roster.length} ${roster.length === 1 ? 'person' : 'people'}`,
  ];
  // Only ever known once the overview has loaded — ProjectSummary (what
  // `group.project` is) carries no createdAt at all, and the overview route
  // that does is project-member-only. A non-manager, or a manager whose
  // overview simply hasn't landed yet, sees the first two facts without a
  // fabricated date rather than a guessed one.
  if (overview?.project.createdAt) {
    headerParts.push(`created ${shortDate(overview.project.createdAt)}`);
  }

  const modalPackages = overview?.packages ?? packages.map(fallbackPackage);

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title={project.name}
        width={520}
        closeOnEscape={closeOnEscape}
      >
        <div className="flex flex-col gap-5">
          {/* Header block */}
          <div>
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[18px] font-extrabold text-stiko-ink">
                {project.name}
              </h2>
              <RoleTag role={project.myRole} />
            </div>
            <p className="mt-1 text-[12px] text-stiko-muted">
              {headerParts.join(' · ')}
            </p>
          </div>

          {view === 'packages' ? (
            <>
              {/* Everyone strip */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel bg-stiko-app px-4 py-[13px]">
                <div className="flex min-w-0 items-center gap-3">
                  <AvatarStack
                    people={roster.map((r) => ({
                      id: r.key,
                      name: r.name,
                      pending: r.pending,
                    }))}
                    ring="#F6F8FE"
                  />
                  {pending > 0 && (
                    <span className="shrink-0 rounded-chip bg-note-yellow px-[8px] py-[3px] text-[10.5px] font-bold text-note-yellow-text">
                      {pending} not accepted
                    </span>
                  )}
                </div>
                {/* Access is granted per package, so with no packages there is
                    nowhere for "Add people" to send someone. */}
                {canManage && packages.length > 0 && (
                  <Button size="sm" onClick={() => setAddOpen(true)}>
                    Add people
                  </Button>
                )}
              </div>

              {/* With one package there is no grid to draw — that package's
                  own row below already shows the same people. */}
              {canManage && packages.length >= 2 && (
                <button
                  type="button"
                  onClick={() => setView('everyone')}
                  className="self-start text-[12.5px] font-bold text-stiko-primary transition hover:text-stiko-primary-hover"
                >
                  See everyone across packages →
                </button>
              )}

              {/* Packages list */}
              <div>
                <SectionLabel>Packages</SectionLabel>
                <div className="mt-2 flex flex-col gap-2">
                  {packages.map((pkg) => {
                    const rich = overviewById.get(pkg.id) ?? null;
                    const isExpanded = expanded.has(pkg.id);
                    const avatarPeople = rich
                      ? packagePeople(rich).map((p) => ({
                          id: p.key,
                          name: p.name,
                          pending: p.pending,
                        }))
                      : pkg.people.map((p) => ({ id: p.id, name: p.name }));

                    const rowContent = (
                      <>
                        <svg
                          className="h-[11px] w-[11px] shrink-0 text-stiko-muted transition-transform duration-150"
                          style={{ transform: `rotate(${isExpanded ? 90 : 0}deg)` }}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.6}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                        <span
                          className="truncate text-[13px] font-bold text-stiko-ink"
                          style={{ flex: '1 1 140px', minWidth: 110 }}
                        >
                          {pkg.name}
                        </span>
                        {pkg.versionNumber != null ? (
                          <span className="shrink-0 rounded-chip bg-stiko-app px-[8px] py-[3px] text-[10.5px] font-bold text-stiko-secondary">
                            V{pkg.versionNumber}
                          </span>
                        ) : (
                          <span className="shrink-0 text-[10.5px] text-stiko-faint">
                            No files yet
                          </span>
                        )}
                        {rich?.createdAt && (
                          <span className="shrink-0 text-[11px] text-stiko-muted">
                            created {relativeTime(rich.createdAt)}
                          </span>
                        )}
                        <AvatarStack people={avatarPeople} size={22} />
                      </>
                    );

                    return (
                      <div
                        key={pkg.id}
                        className="rounded-[10px] bg-white shadow-stiko-panel"
                      >
                        {canManage ? (
                          <button
                            type="button"
                            onClick={() => toggleExpand(pkg.id)}
                            aria-expanded={isExpanded}
                            className="flex w-full items-center gap-2 px-3 py-[10px] text-left"
                          >
                            {rowContent}
                          </button>
                        ) : (
                          <div className="flex items-center gap-2 px-3 py-[10px]">
                            {rowContent}
                          </div>
                        )}

                        {/* Expansion is manage-only: it needs the overview's
                            per-package pending list, which a non-manager's
                            fetch can never carry (403), and every action
                            inside (⋯, add person, delete) 403s server-side
                            for anyone else anyway. */}
                        {canManage && isExpanded && (
                          <div className="flex flex-col gap-[2px] border-t border-stiko-border bg-stiko-app px-2 py-2">
                            {rich ? (
                              <>
                                {packagePeople(rich).map((person) => (
                                  <div
                                    key={person.key}
                                    className="flex items-center justify-between gap-2 rounded-[9px] px-2 py-[7px] transition hover:bg-white"
                                  >
                                    <div className="flex min-w-0 items-center gap-2">
                                      <Avatar
                                        id={person.key}
                                        name={person.name}
                                        size={24}
                                        pending={person.pending}
                                      />
                                      <span className="truncate text-[12.5px] font-semibold text-stiko-ink">
                                        {person.name}
                                      </span>
                                      <RoleTag role={person.role} />
                                      {person.pending && (
                                        <span className="shrink-0 rounded-chip bg-note-yellow px-[6px] py-[2px] text-[9.5px] font-bold text-note-yellow-text">
                                          Invited
                                        </span>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEditingAccess({
                                          portalId: rich.id,
                                          packageName: rich.name,
                                          userId: person.userId,
                                          email: person.email,
                                          displayName: person.name,
                                          pending: person.pending,
                                        })
                                      }
                                      aria-label={`Access for ${person.name} on ${rich.name}`}
                                      className="shrink-0 rounded-lg px-2 py-[2px] text-[15px] font-bold leading-none text-stiko-muted transition hover:bg-white hover:text-stiko-ink"
                                    >
                                      ⋯
                                    </button>
                                  </div>
                                ))}
                                {packagePeople(rich).length === 0 && (
                                  <p className="px-2 py-2 text-[11.5px] text-stiko-muted">
                                    Nobody on this package yet.
                                  </p>
                                )}

                                <div className="mt-1 flex items-center justify-between gap-2 px-1 pt-1">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setAddPersonPkg(rich)}
                                  >
                                    Add person
                                  </Button>
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() =>
                                      setDeleteTarget({
                                        id: rich.id,
                                        name: rich.name,
                                        fileCount: rich.fileCount,
                                        peopleCount: rich.people.length,
                                      })
                                    }
                                  >
                                    Delete package
                                  </Button>
                                </div>
                              </>
                            ) : (
                              <SkeletonBar height={60} />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {packages.length === 0 && (
                    <p className="px-1 py-4 text-[12.5px] text-stiko-muted">
                      No packages in this project yet.
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => setView('packages')}
                className="mb-1 self-start text-[12.5px] font-bold text-stiko-primary transition hover:text-stiko-primary-hover"
              >
                ← Back to packages
              </button>
              {overview ? (
                <TeamMatrix
                  members={overview.members}
                  packages={overview.packages}
                  onChanged={refresh}
                  onAddPeople={() => setAddOpen(true)}
                  // This panel is a `Drawer` with the default `anchor="shell-right"`
                  // — a fixed, right-anchored panel with nothing to its left (no
                  // persistent rail or sidebar, unlike VersionDetailDrawer, which
                  // sits inside app/portal/[id]/page.tsx's own 3-panel grid beside
                  // the file-tree rail and therefore has to skip past its width).
                  // TeamMatrix's nested AccessEditor resolves `left: offsetLeft`
                  // against THIS drawer's own <aside> (its nearest positioned
                  // ancestor, since `position: fixed` establishes a containing
                  // block same as `absolute`/`relative` would), and that <aside>
                  // is itself `overflow-hidden` — so 0 is not an unexamined
                  // default here, it is the value that keeps the nested editor
                  // flush inside this panel's own padded column, well within its
                  // width, exactly as this matrix's `offsetLeft` doc describes for
                  // a mount with nothing beside it. (git history shows this exact
                  // reasoning was worked out once already for TeamMatrix's
                  // now-generalised prop, before it moved to the caller in Task 4.)
                  offsetLeft={0}
                  onSubSurfaceChange={setMatrixSubSurfaceOpen}
                />
              ) : (
                <div className="mt-6 flex flex-col gap-3">
                  <SkeletonBar height={60} />
                  <SkeletonBar height={200} secondary />
                </div>
              )}
            </div>
          )}

          {isOwner && (
            <div className="border-t border-stiko-border pt-5">
              <label className="flex items-center gap-2 text-[11.5px] text-stiko-muted">
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  disabled={aiSaving}
                  onChange={(e) => saveAi(e.target.checked)}
                />
                Let Stiko summarise this project
              </label>
              {aiError && (
                <p className="mt-1 text-[11px] text-note-red-text">{aiError}</p>
              )}
            </div>
          )}

          {/* Danger strip, pinned as the last thing in the body regardless of
              which view is showing — DELETE /api/projects/[id] checks
              owner_id, not project_members, so this is `isOwner`-gated rather
              than `canManage`: a coordinator can manage packages but cannot
              delete the project out from under its owner. */}
          {isOwner && (
            <DangerCard
              rows={[
                {
                  title: 'Delete project',
                  description: `${packages.length} ${packages.length === 1 ? 'package goes' : 'packages go'} with it. Recoverable from the trash for 28 days — until then it still counts toward your storage.`,
                  actionLabel: 'Delete',
                  onAction: () => setConfirmDeleteProject(true),
                },
              ]}
            />
          )}
        </div>
      </Drawer>

      {/* Mounted only while open, not always-mounted with an empty `packages`
          array — AddPeopleModal seeds its package checklist from a
          `useState` initializer that runs once at mount, so an always-on
          instance born with nothing selected can never enable Send
          invitation once packages exist. Same fix TeamMatrix.tsx applied to
          its own em-dash invite. */}
      {addOpen && (
        <AddPeopleModal
          isOpen
          onClose={() => setAddOpen(false)}
          projectName={project.name}
          packages={modalPackages}
          onDone={refresh}
        />
      )}

      {addPersonPkg && (
        <AddPeopleModal
          isOpen
          onClose={() => setAddPersonPkg(null)}
          projectName={project.name}
          packages={[addPersonPkg]}
          onDone={refresh}
        />
      )}

      {/* offsetLeft: same conclusion as TeamMatrix's own mount above — this
          editor is opened directly by a package row here, not through
          TeamMatrix, but it resolves against the same containing block (this
          panel's own <aside>), so the same reasoning applies unchanged. */}
      {editingAccess && (
        <AccessEditor
          isOpen
          onClose={() => setEditingAccess(null)}
          portalId={editingAccess.portalId}
          packageName={editingAccess.packageName}
          userId={editingAccess.userId}
          email={editingAccess.email}
          displayName={editingAccess.displayName}
          pending={editingAccess.pending}
          canManage={canManage}
          offsetLeft={0}
          onChanged={refresh}
        />
      )}

      <DestructiveConfirm
        isOpen={confirmDeleteProject}
        onClose={() => setConfirmDeleteProject(false)}
        onConfirm={deleteProject}
        title={`Delete ${project.name}?`}
        name={project.name}
        consequence="Everyone loses access immediately, including people mid-review. The project and all its packages go to the trash and can be restored for 28 days — until then they still count toward your storage."
        inventory={[{ label: 'Packages', value: packages.length }]}
        confirmLabel="Delete project"
      />

      <DestructiveConfirm
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deletePackage(deleteTarget)}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : ''}
        name={deleteTarget?.name ?? ''}
        consequence="Everyone loses access immediately, including people mid-review. It goes to the trash and can be restored for 28 days — until then it still counts toward your storage."
        inventory={
          deleteTarget
            ? [
                { label: 'Files', value: deleteTarget.fileCount },
                {
                  label: 'People who lose access',
                  value: deleteTarget.peopleCount,
                  urgent: true,
                },
              ]
            : []
        }
        confirmLabel="Delete package"
      />
    </>
  );
}
