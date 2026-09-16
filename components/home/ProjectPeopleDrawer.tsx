'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Drawer from '@/components/ui/Drawer';
import Button from '@/components/ui/Button';
import { Avatar, Note, RoleTag } from '@/components/ui/Primitives';
import { AddPeopleModal } from '@/components/people/AddPeopleModal';
import { TeamMatrix } from '@/components/people/TeamMatrix';
import { DangerCard } from '@/components/settings/SettingsShell';
import { DestructiveConfirm } from '@/components/settings/DestructiveConfirm';
import { useToast } from '@/components/ui/Toast';
import type { ProjectGroup } from '@/lib/home';
import type { PackageCard } from '@/lib/queries';
import type { ProjectPackage, ProjectOverview } from '@/lib/projectOverview';

/**
 * `AddPeopleModal.packages` wants the richer `ProjectPackage` shape (the one
 * `/api/projects/[id]/overview` returns), but this drawer only has the flat
 * `PackageCard[]` from `/api/home` (via `ProjectGroup.packages`). PackageCard
 * carries no `publishedAt` and its `people`/`pending` entries are thinner than
 * `ProjectPerson` / the pending-invite shape.
 *
 * Rather than widen PackageCard to fit, this maps every field the two share
 * and fills the rest with honest empty values. AddPeopleModal only actually
 * reads `id`, `name`, `people.length` and `versionNumber` off each package —
 * the unused fields exist solely so this satisfies ProjectPackage's shape.
 *
 * It stays as a fallback for the window before the overview fetch lands; once
 * it has, `overview.packages` is the real thing and is preferred.
 */
function toAddPeoplePackages(packages: PackageCard[]): ProjectPackage[] {
  return packages.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    tag: pkg.tag,
    versionNumber: pkg.versionNumber,
    changelog: pkg.changelog,
    // Not carried by PackageCard, and unread by AddPeopleModal.
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
    // PackageCard has no separate pending-invite list (only a per-person
    // `pending` flag), and AddPeopleModal never reads `pkg.pending`.
    pending: [],
  }));
}

/**
 * Everything about a project that is not its packages.
 *
 * The people list is read-only: roles in Stiko are per-package
 * (participants.portal_id), so a project-level role is DERIVED, never stored,
 * and editing here would mean either a migration or a project-level write that
 * silently fans out across per-package grants. Actual changes route to the
 * access matrix below, which edits the (person × package) cell directly.
 *
 * The matrix, the AI-summaries switch and the delete control all used to live
 * on /project/[id]. That page is gone — one of the stated reasons for the
 * dashboard redesign was not having to leave the list — so they live here now,
 * behind the overview fetch they need.
 */
export default function ProjectPeopleDrawer({
  group,
  isOpen,
  onClose,
  onChanged,
}: {
  group: ProjectGroup | null;
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // The last value the server confirmed, so a failed save can roll the switch
  // back to the truth rather than to whatever it was mid-flight.
  const confirmedAi = useRef(true);
  const [retained, setRetained] = useState<ProjectGroup | null>(group);

  useEffect(() => {
    if (group) setRetained(group);
  }, [group]);

  const projectId = group?.project.id ?? null;
  // A guest can neither invite nor open the matrix — /api/projects/[id]/overview
  // is member-gated and would 404. `myRole === 'coordinator'` is safe here
  // because participants.role is CHECK-constrained to viewer|commenter|uploader,
  // so `coordinator` can only come from a project_members row.
  const canManage = Boolean(
    group && (group.project.ownedByMe || group.project.myRole === 'coordinator')
  );

  useEffect(() => {
    if (!isOpen || !projectId || !canManage) return;
    setOverview(null);
    setAiError(null);

    fetch(`/api/projects/${projectId}/overview`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: ProjectOverview | null) => body && setOverview(body))
      .catch(() => {});

    fetch(`/api/projects/${projectId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body && typeof body.aiSummariesEnabled === 'boolean') {
          setAiEnabled(body.aiSummariesEnabled);
          confirmedAi.current = body.aiSummariesEnabled;
        }
      })
      .catch(() => {});
  }, [isOpen, projectId, canManage]);

  // Only the project OWNER sees the AI switch or the delete control — 14 gates
  // these stricter than project membership.
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
    // An expired session is 302'd to /login by middleware and fetch follows it,
    // handing back 200 HTML — res.ok alone would report a deletion that never
    // happened and leave the project still listed.
    if (res.redirected) {
      toast('Your session has expired. Sign in and try again.');
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast(body.error ?? 'Could not delete this project');
      return;
    }
    setConfirmDelete(false);
    onClose();
    onChanged();
  };

  // The caller derives `group` by looking up the selected id, so it goes null
  // the instant the drawer is dismissed — which would unmount Drawer before
  // Drawer's own exit animation has a frame to run in. Holding the last
  // non-null group keeps the contents on screen for exactly as long as the
  // slide-out takes. Same reason ProjectSummaryPanel keeps a `lastId`.
  const shown = group ?? retained;
  if (!shown) return null;

  const { project, people, packages } = shown;

  const subtitle = project.ownedByMe
    ? `You own this project · ${people.length} ${people.length === 1 ? 'person' : 'people'}`
    : `Created by ${project.createdByName ?? 'someone else'} · ${people.length} ${people.length === 1 ? 'person' : 'people'}`;

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title={project.name}
        subtitle={subtitle}
        width={520}
        closeOnEscape={!addOpen && !confirmDelete}
        footer={
          // Access is granted per package, so with no packages there is nowhere
          // for "Add people" to send someone — the modal it opens would show an
          // empty list and a permanently disabled send button.
          canManage && packages.length > 0 ? (
            <Button fullWidth onClick={() => setAddOpen(true)}>
              Add people
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-[2px]">
          {people.map((person) => (
            <div
              key={person.id}
              className="flex items-center justify-between gap-[10px] rounded-[11px] px-[10px] py-[9px] transition duration-150 hover:bg-stiko-app"
            >
              <div className="flex min-w-0 items-center gap-[10px]">
                <Avatar id={person.id} name={person.name} size={32} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold text-stiko-ink">
                    {person.name}
                  </div>
                  <div className="truncate text-[11px] text-stiko-muted">
                    On {person.packageCount}{' '}
                    {person.packageCount === 1 ? 'package' : 'packages'}
                  </div>
                </div>
              </div>
              <RoleTag role={person.role} />
            </div>
          ))}

          {people.length === 0 && (
            <p className="px-[10px] py-4 text-[12.5px] text-stiko-muted">
              Nobody else is on this project&apos;s packages yet.
              {packages.length === 0 &&
                ' People are invited to packages, so this project needs one first.'}
            </p>
          )}

          {/* The handoff's copy described an editable panel. This one is
              read-only by decision, because a project-level role is derived
              rather than stored, so the note has to say where roles actually
              live instead of describing an edit that cannot happen here. */}
          <Note className="mt-3">
            Roles are set per package, so this shows each person&apos;s
            strongest role across the packages you can see. Change someone&apos;s
            access on the package itself, or in the access matrix below.
          </Note>

          {/* Below lives everything the project page used to hold. Access is
              granted per package, so the matrix is the only place a
              coordinator can see the whole (person × package) grid — which is
              how they avoid showing the client the consultant's markup. With
              one package there is no grid to draw: the package's own people
              screen says the same thing. */}
          {canManage && overview && overview.packages.length >= 2 && (
            <div className="mt-6 border-t border-stiko-border pt-5">
              <TeamMatrix
                members={overview.members}
                packages={overview.packages}
                onChanged={onChanged}
                onAddPeople={() => setAddOpen(true)}
              />
            </div>
          )}

          {isOwner && (
            <div className="mt-6 border-t border-stiko-border pt-5">
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

          {/* Gated on totalPackageCount, not the visible list: an archived
              package is deliberately hidden from that list while its versions,
              files, comments and S3 objects all still exist, so
              "packages.length === 0" is not "nothing to lose". This only
              avoids offering a control that would fail — the server enforces
              the real guarantee and refuses with 409 if any portal exists. */}
          {isOwner && overview?.totalPackageCount === 0 && (
            <div className="mt-6">
              <DangerCard
                rows={[
                  {
                    title: 'Delete project',
                    description:
                      'Permanently removes this project. This cannot be undone.',
                    actionLabel: 'Delete',
                    onAction: () => setConfirmDelete(true),
                  },
                ]}
              />
            </div>
          )}
        </div>
      </Drawer>

      {canManage && (
        <AddPeopleModal
          isOpen={addOpen}
          onClose={() => setAddOpen(false)}
          projectName={project.name}
          packages={overview?.packages ?? toAddPeoplePackages(packages)}
          onDone={onChanged}
        />
      )}

      <DestructiveConfirm
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteProject}
        title={`Delete ${project.name}?`}
        name={project.name}
        consequence="This permanently removes the project. This cannot be undone."
        inventory={[]}
        confirmLabel="Delete project"
      />
    </>
  );
}
