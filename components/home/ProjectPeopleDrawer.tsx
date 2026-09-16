'use client';

import { useState } from 'react';
import Link from 'next/link';
import Drawer from '@/components/ui/Drawer';
import Button from '@/components/ui/Button';
import { Avatar, Note, RoleTag } from '@/components/ui/Primitives';
import { AddPeopleModal } from '@/components/people/AddPeopleModal';
import type { ProjectGroup } from '@/lib/home';
import type { PackageCard } from '@/lib/queries';
import type { ProjectPackage } from '@/lib/projectOverview';

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
 * Project people, read-only.
 *
 * Roles in Stiko are per-package (participants.portal_id), so what this shows
 * is a DERIVED summary: each person's highest role across the packages this
 * viewer can see. Editing here would mean either a migration or a project-level
 * write that silently fans out across per-package grants, so every actual
 * change routes to the per-package surfaces instead.
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
  const [addOpen, setAddOpen] = useState(false);
  if (!group) return null;

  const { project, people, packages } = group;
  // A guest can neither invite nor open the matrix — /api/projects/[id]/overview
  // is member-gated and would 403. `myRole === 'coordinator'` is safe here
  // because participants.role is CHECK-constrained to viewer|commenter|uploader,
  // so `coordinator` can only come from a project_members row.
  const canManage = project.ownedByMe || project.myRole === 'coordinator';

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
        width={390}
        closeOnEscape={!addOpen}
        footer={
          canManage ? (
            <div className="flex items-center gap-2">
              {/* Access in this product is granted per package, so with no
                  packages there is nowhere for "Add people" to send someone —
                  the modal it opens would show an empty list and a permanently
                  disabled send button. */}
              {packages.length > 0 && (
                <Button fullWidth onClick={() => setAddOpen(true)}>
                  Add people
                </Button>
              )}
              <Link
                href={`/project/${project.id}`}
                className={`shrink-0 rounded-[10px] border-[1.5px] border-stiko-border-strong px-[14px] py-2 text-center text-[12.5px] font-bold text-stiko-secondary transition duration-150 hover:bg-stiko-app ${
                  packages.length === 0 ? 'w-full' : ''
                }`}
              >
                Access matrix
              </Link>
            </div>
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
            access on the package itself, or in the access matrix.
          </Note>
        </div>
      </Drawer>

      {canManage && (
        <AddPeopleModal
          isOpen={addOpen}
          onClose={() => setAddOpen(false)}
          projectName={project.name}
          packages={toAddPeoplePackages(packages)}
          onDone={onChanged}
        />
      )}
    </>
  );
}
