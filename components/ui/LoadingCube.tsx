/**
 * The brand loading indicator: a cube tumbling in Stiko primary.
 *
 * Replaces the ad-hoc `border-blue-600` rings in the review view — that blue
 * was never in the palette. The home and project screens keep their skeletons;
 * "match the shape of the real content, no spinners" was a deliberate call
 * there and this does not overturn it.
 *
 * The 3D transforms live in app/globals.css as .stiko-cube.
 */
import type { CSSProperties } from 'react';

export default function LoadingCube({
  size = 44,
  label = 'Loading…',
}: {
  size?: number;
  /** Announced to screen readers. Say what is loading when you know. */
  label?: string;
}) {
  return (
    <div role="status" aria-live="polite">
      <div
        className="stiko-cube"
        // A spinning box conveys nothing on its own, so the visible element is
        // hidden from the accessibility tree and the label carries the meaning.
        aria-hidden="true"
        style={{ '--cube-size': `${size}px` } as CSSProperties}
      >
        <div />
        <div />
        <div />
        <div />
        <div />
        <div />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
