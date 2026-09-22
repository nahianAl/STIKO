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
 * `auto-fill`, not `auto-fit`: auto-fit collapses empty tracks, so a lone
 * project's card would stretch across the whole column. The `min(220px,100%)`
 * floor is what lets the grid fall to one column, instead of overflowing, when
 * both side columns are open. `relative` makes this the cards' offsetParent,
 * which useGridGlide measures against.
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
      className="relative grid shrink-0 gap-[22px] px-1 pt-1"
      style={{
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))',
      }}
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
