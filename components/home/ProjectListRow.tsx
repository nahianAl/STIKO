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
  onOpenPanel,
}: {
  group: ProjectGroup;
  expanded: boolean;
  onToggle: (id: string) => void;
  onOpenPeople: (id: string) => void;
  onOpenPanel: (id: string) => void;
}) {
  const router = useRouter();
  const { project, packages, packageCount, openComments, people } = group;

  const attention = projectAttention(packages);

  // `myRole === 'coordinator'` is safe as a permission signal because
  // participants.role is CHECK-constrained to viewer|commenter|uploader, so
  // coordinator can only have come from a project_members row.
  const canManage = project.ownedByMe || project.myRole === 'coordinator';

  return (
    <div className="box-border min-w-[813px] border-b border-stiko-border">
      <div
        className={`group relative transition-colors duration-[160ms] ${
          expanded ? 'bg-stiko-app' : 'bg-white hover:bg-stiko-app'
        }`}
      >
        <button
          type="button"
          // stopPropagation is load-bearing, not defensive: the page root
          // carries a deselect-on-background-click handler, so without this
          // the click sets `expanded` here and then bubbles up and clears it
          // again in the same React batch. The row would never open.
          onClick={(e) => {
            e.stopPropagation();
            onToggle(project.id);
          }}
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

          {/* People, Packages and Open travel as one block: on hover, or
              while the row is selected, they slide left together and open a
              gap in front of the ⤢ control. The control itself deliberately
              stays put — the gap exists to separate it from the data, so
              moving both would defeat it. Only this group shifts, which is
              also why the Project column (flex-grow, to its left) does not
              reflow: a transform paints, it does not lay out. */}
          <span
            className={`flex shrink-0 items-center gap-3 transition-transform duration-[180ms] ease-[cubic-bezier(.4,0,.2,1)] ${
              expanded
                ? '-translate-x-[14px]'
                : 'group-hover:-translate-x-[14px]'
            }`}
          >
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
          </span>

          <span className="flex w-8 shrink-0 justify-end">
            <button
              type="button"
              // Same trap as the People button above: this sits in the
              // pointer-events-none layer, so it needs pointer-events-auto on
              // its own cell, and stopPropagation before onOpenPanel or the
              // page root's deselect-on-background-click handler clears
              // `expanded` right back in the same React batch.
              onClick={(e) => {
                e.stopPropagation();
                onOpenPanel(project.id);
              }}
              aria-label={`Manage ${project.name}`}
              // No `title`: the hover label below carries the same word
              // without the browser tooltip's ~1s delay, and having both
              // renders "Manage" twice, one on top of the other.
              //
              // focus-visible:shadow-stiko-focus is not optional —
              // app/globals.css has no global focus ring, so without it a
              // keyboard user who tabs here has nothing to see.
              className="group/manage pointer-events-auto relative flex h-7 w-7 items-center justify-center rounded-[9px] border-[1.5px] border-transparent text-stiko-muted transition duration-150 hover:border-stiko-border-strong hover:bg-white hover:text-stiko-ink hover:shadow-stiko-panel focus:outline-none focus-visible:shadow-stiko-focus"
            >
              <svg
                className="h-[15px] w-[15px]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7" />
              </svg>

              {/* ABOVE the button, not beside it. Beside was tried and is
                  wrong: the Open column's text is right-aligned and ends
                  exactly where the label would start, so "13 open comments"
                  came out as "13 open com▮MANAGE▮". The 14px hover slide is
                  breathing room, nowhere near label-sized, and widening it
                  is not available either — the Project column's role chip
                  sits at ITS right edge, so a bigger slide drives the avatars
                  straight into "OWNER".
                  Nothing clips this: the row carries no overflow of its own,
                  and the list container in app/page.tsx (overflow-y-hidden)
                  only cuts at its OWN edges — the label rises into the row
                  above, or for the first row into the column header, both of
                  which are inside that box. */}
              <span className="pointer-events-none absolute bottom-[calc(100%+5px)] right-0 z-10 whitespace-nowrap rounded-[7px] bg-stiko-ink px-[7px] py-[3px] text-[10px] font-extrabold uppercase tracking-label text-white opacity-0 shadow-stiko-lift transition-opacity duration-150 group-hover/manage:opacity-100">
                Manage
              </span>
            </button>
          </span>
        </div>
      </div>

      {/* grid-template-rows 0fr -> 1fr animates BOTH directions without anyone
          measuring anything. `{expanded && ...}` could only ever animate the
          open: an unmount has no frames to run a transition in. The cost is
          that the packages stay mounted while collapsed, so `visibility` is
          deferred to the end of the close — it keeps them out of the tab order
          without cutting the animation short. */}
      <div
        onClick={(e) => e.stopPropagation()}
        aria-hidden={!expanded}
        className="stiko-motion grid transition-[grid-template-rows] duration-[260ms] ease-[cubic-bezier(.4,0,.2,1)]"
        style={{
          gridTemplateRows: expanded ? '1fr' : '0fr',
          visibility: expanded ? 'visible' : 'hidden',
          transitionProperty: 'grid-template-rows, visibility',
          // visibility is a 0s step — see the note in ActivityRail.
          transitionDuration: '260ms, 0s',
          transitionDelay: expanded ? '0s' : '0s, 260ms',
        }}
      >
        <div
          className={`overflow-hidden transition-opacity duration-200 ${
            expanded ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="flex flex-col gap-[6px] bg-stiko-wash pb-[14px] pl-[34px] pr-[14px] pt-[10px]">
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
        </div>
      </div>
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
