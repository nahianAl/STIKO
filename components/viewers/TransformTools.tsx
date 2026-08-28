'use client';

import ViewportToolButton from './ViewportToolButton';
import { MoveIcon, RotateIcon } from './viewportToolIcons';

export type TransformMode = 'translate' | 'rotate' | null;

/**
 * Move / rotate the object itself, as two free-standing buttons in the 3D viewport.
 *
 * Returns a fragment rather than a wrapper: the buttons are separate chips, and the row that
 * renders them owns the spacing so they sit at the same interval as the cross-section button
 * beside them.
 *
 * The caller decides whether these may be shown at all — they render for a 3D file when the
 * role may transform the object OR the cross-section tool is open (a plane's pose is
 * session-only, so positioning one is available to everyone). Nothing here re-checks that, and
 * nothing here decides which target — object or plane — a drag actually moves; the server
 * remains the authority on what gets persisted.
 */
export default function TransformTools({
  mode,
  onModeChange,
  disabled = false,
  disabledReason,
}: {
  mode: TransformMode;
  onModeChange: (mode: TransformMode) => void;
  /** True while the cross-section tool is open with no plane selected — nothing to move. */
  disabled?: boolean;
  disabledReason?: string;
}) {
  // Clicking the active tool turns it off, so neither is a trap with no way back to plain
  // orbiting.
  const toggle = (next: Exclude<TransformMode, null>) =>
    onModeChange(mode === next ? null : next);

  return (
    <>
      <ViewportToolButton
        label="Move"
        active={mode === 'translate'}
        disabled={disabled}
        title={disabledReason}
        onClick={() => toggle('translate')}
      >
        {MoveIcon}
      </ViewportToolButton>

      <ViewportToolButton
        label="Rotate"
        active={mode === 'rotate'}
        disabled={disabled}
        title={disabledReason}
        onClick={() => toggle('rotate')}
      >
        {RotateIcon}
      </ViewportToolButton>
    </>
  );
}
