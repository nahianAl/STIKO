'use client';

export type TransformMode = 'translate' | 'rotate' | null;

/**
 * Move / rotate the object itself, as a pill in the bottom-right of the 3D viewport.
 *
 * Sits opposite the focal-length control on the same baseline, in the corner the view gizmo
 * vacated. Like that control it is ordinary DOM rather than 3D, so it never lands in an
 * annotation snapshot and needs no exclusion from the clean-frame render.
 *
 * The caller decides whether this may be shown at all — it renders only for a 3D file and a
 * role that may transform. Nothing here re-checks that; the server is the authority.
 */
export default function TransformTools({
  mode,
  onModeChange,
}: {
  mode: TransformMode;
  onModeChange: (mode: TransformMode) => void;
}) {
  // Clicking the active tool turns it off, so the pill is never a trap with no way back to
  // plain orbiting.
  const toggle = (next: Exclude<TransformMode, null>) =>
    onModeChange(mode === next ? null : next);

  const slot = (active: boolean) =>
    `flex h-6 w-6 items-center justify-center rounded-[8px] transition-colors ${
      active ? 'bg-stiko-tint text-stiko-primary' : 'text-stiko-muted hover:bg-stiko-tint'
    }`;

  return (
    <div className="absolute bottom-3 right-3 z-20 select-none">
      <div className="flex items-center gap-1 rounded-panel bg-white shadow-stiko-panel border border-stiko-border h-8 px-1">
        <button
          title="Move object"
          aria-label="Move object"
          aria-pressed={mode === 'translate'}
          onClick={() => toggle('translate')}
          className={slot(mode === 'translate')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v20M2 12h20" />
            <path d="M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3" />
          </svg>
        </button>

        <button
          title="Rotate object"
          aria-label="Rotate object"
          aria-pressed={mode === 'rotate'}
          onClick={() => toggle('rotate')}
          className={slot(mode === 'rotate')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
