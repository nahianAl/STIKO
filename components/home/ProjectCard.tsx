'use client';

import { AvatarStack } from '@/components/ui/Primitives';
import { RoleChip } from '@/components/home/RoleChip';
import { packagesLabel, type ProjectGroup } from '@/lib/home';

/**
 * One project on the dashboard grid.
 *
 * Deliberately sparse — name, role, people, package count, manage. Everything
 * about the packages themselves lives in the Packages panel the card opens,
 * which is what keeps every card the same size at five packages as at one.
 *
 * Structure note, because the obvious version is invalid HTML: the whole card
 * is one click target, but the avatar stack and the manage control are buttons
 * of their own, and a button inside a button does not nest — browsers hoist
 * the inner one out and the click targets come apart. So the toggle is an
 * absolutely-positioned button filling the card, the content sits above it in
 * a pointer-events-none layer, and only the two inner buttons re-enable
 * pointer events. Hover lives on the card itself, so it covers all of it.
 *
 * `data-glide` opts the card into useGridGlide, which slides it to its new
 * cell when the grid's column count changes.
 */
export function ProjectCard({
  group,
  selected,
  onToggle,
  onOpenPeople,
  onOpenPanel,
}: {
  group: ProjectGroup;
  selected: boolean;
  onToggle: (id: string) => void;
  onOpenPeople: (id: string) => void;
  onOpenPanel: (id: string) => void;
}) {
  const { project, packageCount, people } = group;

  return (
    <div
      data-glide={project.id}
      // 1px → 2px border with 18px → 17px padding: the padding pays for the
      // thicker border, so nothing inside moves by a pixel on hover or select.
      className={`relative flex min-h-[176px] flex-col rounded-[20px] bg-white transition-[box-shadow,border-color,padding,border-width] duration-[320ms] ease-[cubic-bezier(.32,.72,0,1)] ${
        selected
          ? 'border-2 border-stiko-card-line-hot p-[17px] shadow-stiko-card-selected'
          : 'border border-stiko-card-line p-[18px] shadow-stiko-card-rest hover:border-2 hover:border-stiko-card-line-hot hover:p-[17px] hover:shadow-stiko-card-hover'
      }`}
    >
      <button
        type="button"
        // stopPropagation is load-bearing, not defensive: the page root
        // deselects on background click, so without it this click selects
        // and then bubbles up and deselects in the same React batch.
        onClick={(e) => {
          e.stopPropagation();
          onToggle(project.id);
        }}
        aria-pressed={selected}
        aria-label={`Show packages in ${project.name}`}
        className="absolute inset-0 h-full w-full rounded-[18px] focus:outline-none focus-visible:shadow-stiko-focus"
      />

      <div className="pointer-events-none relative flex flex-1 flex-col">
        <h3
          className="break-words text-[17px] font-extrabold leading-[1.25] tracking-title text-stiko-ink"
          style={{ textWrap: 'pretty' }}
        >
          {project.name}
        </h3>

        <div className="flex items-center gap-2 pt-[10px]">
          <RoleChip ownedByMe={project.ownedByMe} myRole={project.myRole} />
        </div>

        {/* Pushes the footer down, so every card in a row ends level. */}
        <div className="flex-1" />

        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {people.length > 0 && (
              <button
                type="button"
                title="People on this project"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenPeople(project.id);
                }}
                className="pointer-events-auto flex rounded-pill focus:outline-none focus-visible:shadow-stiko-focus"
              >
                <AvatarStack people={people} size={26} />
              </button>
            )}
            <div className="mt-[10px] text-[12px] font-bold text-stiko-secondary">
              {packagesLabel(packageCount)}
            </div>
          </div>

          <button
            type="button"
            // Same trap as the toggle: without stopPropagation the page root's
            // background-click handler deselects in the same batch.
            onClick={(e) => {
              e.stopPropagation();
              onOpenPanel(project.id);
            }}
            aria-label={`Manage ${project.name}`}
            title="Manage"
            className="pointer-events-auto flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] border border-stiko-manage-line bg-white text-stiko-secondary transition-[color,border-color] duration-300 ease-[cubic-bezier(.32,.72,0,1)] hover:border-stiko-card-line hover:text-stiko-primary focus:outline-none focus-visible:shadow-stiko-focus"
          >
            <svg
              className="h-[14px] w-[14px]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
