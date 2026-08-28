'use client';

import { SECTION_PLANE_IDS, type PlaneId, type SectionSlots } from '@/lib/crossSection';

/**
 * The `Planes 1 2 3` chip, inline in the viewport's tool row immediately left of the
 * cross-section button and at the same height as it.
 *
 * A numbered button toggles its plane's VISIBILITY. Switching one on for the first time
 * starts it cutting, and switching it off again leaves the cut in place — which is the whole
 * point, since it lets the cut be seen without the plane and its gizmo in the way. That
 * produces a state the button has to make legible: unlit, but still cutting. Those carry a
 * small filled dot, so a cut model with a dark button is never a mystery.
 *
 * The flip button appears only while a plane is selected and acts on that plane. Without it
 * the only way to change which half survives is a 180-degree gizmo rotation.
 */
export default function PlanesPanel({
  slots,
  selected,
  onToggle,
  onFlip,
}: {
  slots: SectionSlots;
  selected: PlaneId | null;
  onToggle: (id: PlaneId) => void;
  onFlip: (id: PlaneId) => void;
}) {
  const slot = (id: PlaneId) => {
    const { visible, cutting } = slots[id];
    const isSelected = selected === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => onToggle(id)}
        aria-pressed={visible}
        aria-label={`Plane ${id}`}
        title={
          visible ? `Hide plane ${id} (the cut stays)` : cutting ? `Show plane ${id}` : `Add plane ${id}`
        }
        className={`relative h-6 w-6 rounded-[8px] text-[11px] font-semibold transition-colors ${
          visible
            ? 'bg-stiko-tint text-stiko-primary'
            : 'text-stiko-muted hover:bg-stiko-tint'
        } ${isSelected ? 'ring-1 ring-stiko-primary-light' : ''}`}
      >
        {id}
        {/* Hidden, but still cutting. */}
        {!visible && cutting && (
          <span className="pointer-events-none absolute bottom-[3px] left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-stiko-primary" />
        )}
      </button>
    );
  };

  return (
    <div className="flex h-[34px] items-center gap-1 rounded-[11px] border border-stiko-border bg-white pl-2.5 pr-1.5 shadow-stiko-panel">
      <span className="mr-1 text-[11px] font-semibold leading-none tracking-heading text-stiko-ink">
        Planes
      </span>

      {SECTION_PLANE_IDS.map(slot)}

      {selected !== null && (
        <button
          type="button"
          onClick={() => onFlip(selected)}
          aria-pressed={slots[selected].flipped}
          aria-label={`Flip plane ${selected}`}
          title="Flip which half is kept"
          className={`ml-0.5 flex h-6 w-6 items-center justify-center rounded-[8px] transition-colors ${
            slots[selected].flipped
              ? 'bg-stiko-tint text-stiko-primary'
              : 'text-stiko-muted hover:bg-stiko-tint'
          }`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
        </button>
      )}
    </div>
  );
}
