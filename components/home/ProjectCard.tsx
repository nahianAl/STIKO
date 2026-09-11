'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AvatarStack } from '@/components/ui/Primitives';
import { CardPackageRow } from '@/components/home/CardPackageRow';
import { roleLabel } from '@/lib/roles';
import type { ProjectGroup } from '@/lib/home';

/**
 * One project, owning its packages.
 *
 * Grows with its package count and never stretches to match a taller sibling —
 * `items-start` on the grid does that, not anything here.
 */
export default function ProjectCard({
  group,
  onOpenPeople,
}: {
  group: ProjectGroup;
  onOpenPeople: (projectId: string) => void;
}) {
  const router = useRouter();
  const { project, packages, packageCount, openComments, people } = group;

  const byline = project.ownedByMe
    ? 'Created by you'
    : `Created by ${project.createdByName ?? 'someone else'}`;

  // `myRole` is display-only everywhere else, but `coordinator` is the
  // exception: participants.role is CHECK-constrained to
  // viewer|commenter|uploader, so a `coordinator` value can only have come
  // from a project_members row, which makes it a genuine project-level grant.
  const canManage = project.ownedByMe || project.myRole === 'coordinator';

  return (
    <section
      className="overflow-hidden rounded-panel border border-stiko-sheet bg-white shadow-stiko-card"
      style={{ flex: '1 1 420px', minWidth: 0 }}
    >
      <header className="flex items-start justify-between gap-3 px-4 pb-[13px] pt-[15px]">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {canManage ? (
              <Link
                href={`/project/${project.id}`}
                className="truncate text-[16px] font-extrabold tracking-heading text-stiko-ink transition duration-150 hover:text-stiko-primary"
              >
                {project.name}
              </Link>
            ) : (
              <span className="truncate text-[16px] font-extrabold tracking-heading text-stiko-ink">
                {project.name}
              </span>
            )}
            <OwnershipChip
              ownedByMe={project.ownedByMe}
              myRole={project.myRole}
            />
          </div>
          <p className="mt-1 truncate text-[11.5px] text-stiko-muted">
            {byline} · {people.length}{' '}
            {people.length === 1 ? 'person' : 'people'}
          </p>
        </div>

        {people.length > 0 && (
          <button
            type="button"
            title="Manage people"
            onClick={() => onOpenPeople(project.id)}
            className="flex shrink-0 items-center rounded-pill border-[1.5px] border-transparent py-[3px] pl-[11px] pr-[6px] transition duration-150 hover:border-stiko-border-strong hover:bg-stiko-app"
          >
            <AvatarStack people={people} size={26} />
          </button>
        )}
      </header>

      <div className="flex flex-col gap-[6px] border-t border-stiko-border p-[10px]">
        <div className="flex items-center justify-between px-1 pb-[2px]">
          <span className="text-[10px] font-bold uppercase tracking-label text-stiko-faint">
            {packageCount === 1 ? '1 package' : `${packageCount} packages`}
          </span>
          <span className="text-[10.5px] font-bold text-stiko-muted">
            {openComments === 0
              ? 'Nothing open'
              : `${openComments} open ${openComments === 1 ? 'comment' : 'comments'}`}
          </span>
        </div>

        {packages.map((pkg) => (
          <CardPackageRow key={pkg.id} pkg={pkg} />
        ))}

        {canManage && (
          <button
            type="button"
            onClick={() => router.push(`/new?project=${project.id}`)}
            className="flex w-full items-center justify-center gap-[6px] rounded-[11px] border-[1.5px] border-dashed border-stiko-border-strong p-2 text-[11.5px] font-bold text-stiko-muted transition duration-150 hover:border-stiko-primary hover:text-stiko-primary"
          >
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.8}
              strokeLinecap="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add a package
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Issue #2. Solid for owner, outlined for invited — 01's rule: solid pills are
 * facts about YOU, outlined chips are facts about the work, and ownership is
 * personal.
 */
function OwnershipChip({
  ownedByMe,
  myRole,
}: {
  ownedByMe: boolean;
  myRole: string | null;
}) {
  if (ownedByMe) {
    return (
      <span
        className="shrink-0 whitespace-nowrap rounded-pill border-[1.5px] border-transparent bg-note-purple px-2 py-[3px] text-[9.5px] font-extrabold uppercase text-note-purple-text"
        style={{ letterSpacing: '0.04em' }}
      >
        Owner
      </span>
    );
  }

  const label = myRole ? `Invited · ${roleLabel(myRole)}` : 'Invited';
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-pill border-[1.5px] border-stiko-chip-grey bg-white px-2 py-[3px] text-[9.5px] font-extrabold uppercase text-stiko-muted"
      style={{ letterSpacing: '0.04em' }}
    >
      {label}
    </span>
  );
}
