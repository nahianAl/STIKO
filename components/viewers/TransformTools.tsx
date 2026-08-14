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
 * The caller decides whether these may be shown at all — they render only for a 3D file and a
 * role that may transform. Nothing here re-checks that; the server is the authority.
 */
export default function TransformTools({
  mode,
  onModeChange,
}: {
  mode: TransformMode;
  onModeChange: (mode: TransformMode) => void;
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
        onClick={() => toggle('translate')}
      >
        {MoveIcon}
      </ViewportToolButton>

      <ViewportToolButton
        label="Rotate"
        active={mode === 'rotate'}
        onClick={() => toggle('rotate')}
      >
        {RotateIcon}
      </ViewportToolButton>
    </>
  );
}
