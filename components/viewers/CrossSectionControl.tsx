'use client';

import ViewportToolButton from './ViewportToolButton';
import { SliceIcon } from './viewportToolIcons';

/**
 * The cross-section master toggle.
 *
 * On opens the tool and reveals the Planes panel beside it; off discards every plane and
 * every cut and returns the model to its whole shape. It is the ONLY control that removes a
 * cut — the numbered buttons in the panel hide plane widgets, they do not un-cut.
 *
 * Deliberately holds no state and renders no panel of its own: the panel is a sibling in the
 * viewport's tool row, not a popover anchored to this button.
 */
export default function CrossSectionControl({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <ViewportToolButton label="Cross-section" active={active} onClick={onToggle}>
      {SliceIcon}
    </ViewportToolButton>
  );
}
