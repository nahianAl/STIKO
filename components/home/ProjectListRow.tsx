'use client';

import { useRouter } from 'next/navigation';
import { AvatarStack, AttentionPill } from '@/components/ui/Primitives';
import { PackageListRow } from '@/components/home/PackageListRow';
import { projectAttention } from '@/lib/home';
import { roleLabel } from '@/lib/roles';
import type { ProjectGroup } from '@/lib/home';

/**
 * One project in the list.
 *
 * Structure note, because the obvious version is invalid HTML: the whole row
 * reads as one click target, but the People cell holds its own button (the
 * people drawer). A button inside a button does not nest — browsers hoist the
 * inner one out and the click targets come apart. So the toggle is an
 * absolutely-positioned button filling the row, the cells sit above it in a
 * pointer-events-none layer, and only the People cell re-enables pointer
 * events for its own button. Hover lives on the wrapper so it still covers the
 * whole row.
 */
export function ProjectListRow({
  group,
  expanded,
  onToggle,
  onOpenPeople,
}: {
  group: ProjectGroup;
  expanded: boolean;
  onToggle: (id: string) => void;
  onOpenPeople: (id: string) => void;
}) {
  const router = useRouter();
  const { project, packages, packageCount, openComments, people } = group;

  const attention = projectAttention(packages);

  // `myRole === 'coordinator'` is safe as a permission signal because
  // participants.role is CHECK-constrained to viewer|commenter|uploader, so
  // coordinator can only have come from a project_members row.
  const canManage = project.ownedByMe || project.myRole === 'coordinator';

  return (
    <div className="box-border min-w-[760px] border-b border-stiko-border">
      <div
        className={`group relative transition-colors duration-[160ms] ${
          expanded ? 'bg-stiko-app' : 'bg-white hover:bg-stiko-app'
        }`}
      >
        <button
          type="button"
          onClick={() => onToggle(project.id)}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`}
          className="absolute inset-0 h-full w-full"
        />

        <div className="pointer-events-none relative flex items-center gap-3 px-[14px] py-[13px]">
          <svg
            className="h-[13px] w-[13px] shrink-0 text-stiko-muted transition-transform duration-[220ms] ease-[cubic-bezier(.4,0,.2,1)]"
            style={{ transform: `rotate(${expanded ? 90 : 0}deg)` }}
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
            className="flex items-center gap-2"
            style={{ flex: '1 1 340px', minWidth: 300 }}
          >
            <span
              className="truncate text-[14px] font-extrabold tracking-heading text-stiko-ink"
              style={{ flex: '1 1 auto', minWidth: 120 }}
            >
              {project.name}
            </span>
            <RoleChip ownedByMe={project.ownedByMe} myRole={project.myRole} />
          </span>

          <span className="w-[84px] shrink-0 text-right text-[11.5px] font-bold text-stiko-secondary">
            {packageCount === 1 ? '1 package' : `${packageCount} packages`}
          </span>

          <span className="flex w-[200px] shrink-0 items-center justify-end gap-2">
            {attention && (
              <AttentionPill
                label={attention.label}
                bg={attention.bg}
                fg={attention.fg}
              />
            )}
            <span
              className="whitespace-nowrap text-[11.5px] font-bold"
              style={{ color: openComments > 0 ? '#B23A52' : '#8A90A6' }}
            >
              {openComments === 0
                ? 'Nothing open'
                : `${openComments} open ${openComments === 1 ? 'comment' : 'comments'}`}
            </span>
          </span>

          <span className="flex w-[96px] shrink-0 justify-end">
            {people.length > 0 && (
              <button
                type="button"
                title="People on this project"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenPeople(project.id);
                }}
                className="pointer-events-auto rounded-pill"
              >
                <AvatarStack people={people} size={24} />
              </button>
            )}
          </span>
        </div>
      </div>

      {expanded && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="stiko-panel-in flex flex-col gap-[6px] bg-stiko-wash pb-[14px] pl-[34px] pr-[14px] pt-[10px]"
        >
          {packages.map((pkg) => (
            <PackageListRow key={pkg.id} pkg={pkg} />
          ))}

          {packages.length === 0 && (
            <p className="px-1 py-2 text-[11.5px] text-stiko-muted">
              No packages in this project yet.
            </p>
          )}

          {canManage && (
            <button
              type="button"
              onClick={() => router.push(`/new?project=${project.id}`)}
              className="flex w-full items-center justify-center gap-[6px] rounded-[10px] border-[1.5px] border-dashed border-stiko-border-strong p-[10px] text-[11.5px] font-bold text-stiko-muted transition-[border-color,color] duration-150 hover:border-stiko-primary hover:text-stiko-primary"
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
      )}
    </div>
  );
}

/** Solid for owner, outlined for invited — solid pills are facts about YOU. */
function RoleChip({
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

  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-pill border-[1.5px] border-stiko-chip-grey bg-white px-2 py-[3px] text-[9.5px] font-extrabold uppercase text-stiko-muted"
      style={{ letterSpacing: '0.04em' }}
    >
      {myRole ? `Invited · ${roleLabel(myRole)}` : 'Invited'}
    </span>
  );
}
