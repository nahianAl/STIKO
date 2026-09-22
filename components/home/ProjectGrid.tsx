'use client';

import { useRef } from 'react';
import { ProjectCard } from '@/components/home/ProjectCard';
import { useGridGlide } from '@/components/home/useGridGlide';
import type { ProjectGroup } from '@/lib/home';

/**
 * The project cards.
 *
 * Its own component, not markup inside app/page.tsx, because useGridGlide has
 * to run in whatever mounts the grid element: the page renders a skeleton
 * first, so an effect on the page would run before the grid exists and, with
 * a stable ref as its only dependency, never run again.
 *
 * From lg up a card is ONE fixed size and never changes shape. The side
 * panels animate this column's width, and 1fr tracks would stretch every card
 * on every frame of that; fixed 220px tracks mean the panels only ever change
 * how many cards fit in a row, and useGridGlide slides the cards into their
 * new cells. The leftover width stays empty at the end of the row.
 * `min(…, 100%)` only matters if the column is ever narrower than one card:
 * the card shrinks to fit rather than overflowing.
 *
 * `items-start` keeps a card at its own height (min 176px). Stretching to the
 * row would make a card's height depend on whichever neighbours a reflow
 * happens to put beside it — a shape change on every panel toggle for any
 * row holding a long, three-line name.
 *
 * Below lg the panels never resize the grid (the Packages panel is an
 * overlay and the rail stacks underneath), so the tracks stay fluid there:
 * a phone gets a full-width card instead of a 220px one beside empty space.
 *
 * `relative` makes this the cards' offsetParent, which useGridGlide measures
 * against.
 */
export function ProjectGrid({
  groups,
  selectedId,
  onToggle,
  onOpenPeople,
  onOpenPanel,
}: {
  groups: ProjectGroup[];
  selectedId: string | null;
  onToggle: (id: string) => void;
  onOpenPeople: (id: string) => void;
  onOpenPanel: (id: string) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  useGridGlide(gridRef);

  return (
    <div
      ref={gridRef}
      className="relative grid shrink-0 grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] items-start gap-[22px] px-1 pt-1 lg:grid-cols-[repeat(auto-fill,min(220px,100%))]"
    >
      {groups.map((group) => (
        <ProjectCard
          key={group.project.id}
          group={group}
          selected={selectedId === group.project.id}
          onToggle={onToggle}
          onOpenPeople={onOpenPeople}
          onOpenPanel={onOpenPanel}
        />
      ))}
    </div>
  );
}
