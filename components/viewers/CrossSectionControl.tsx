'use client';

import { SECTION_AXES, type CrossSection, type SectionAxis } from '@/lib/crossSection';
import ViewportToolButton from './ViewportToolButton';
import { SliceIcon } from './viewportToolIcons';

/**
 * Cross-section control: a toggle button that opens an axis picker, a slider and a flip button.
 *
 * `section` is null when the model is not sectioned. Enabling restores `lastSection` rather
 * than re-defaulting, so a cut you have just positioned survives toggling the tool off and
 * on. The caller owns that memory — this component holds no state of its own.
 */
export default function CrossSectionControl({
  section,
  lastSection,
  onChange,
}: {
  section: CrossSection | null;
  /** Restored when the tool is switched back on, so a positioned cut is not thrown away. */
  lastSection: CrossSection;
  onChange: (section: CrossSection | null) => void;
}) {
  const active = section !== null;

  const axisSlot = (selected: boolean) =>
    `h-6 w-6 rounded-[8px] text-[11px] font-semibold uppercase transition-colors ${
      selected ? 'bg-stiko-tint text-stiko-primary' : 'text-stiko-muted hover:bg-stiko-tint'
    }`;

  return (
    <div className="relative flex">
      {section && (
        // Absolute, not in flow: the panel is far wider than the 34px button, and in flow it
        // would widen this flex item and shove the move/rotate buttons along with it.
        // Right-aligned because this is the leftmost of the three — anchored left it would
        // run out past them and off the edge of the viewport.
        <div className="absolute bottom-full right-0 mb-2 flex items-center gap-1 rounded-panel bg-white shadow-stiko-sheet border border-stiko-border h-9 px-1.5">
          {SECTION_AXES.map((axis: SectionAxis) => (
            <button
              key={axis}
              type="button"
              onClick={() => onChange({ ...section, axis })}
              aria-pressed={section.axis === axis}
              className={axisSlot(section.axis === axis)}
            >
              {axis}
            </button>
          ))}

          <input
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={section.offset}
            onChange={(e) => onChange({ ...section, offset: Number(e.target.value) })}
            aria-label="Cross-section position"
            className="w-24 accent-stiko-primary"
          />

          <button
            type="button"
            title="Flip which half is kept"
            aria-label="Flip which half is kept"
            aria-pressed={section.flipped}
            onClick={() => onChange({ ...section, flipped: !section.flipped })}
            className={`flex h-6 w-6 items-center justify-center rounded-[8px] transition-colors ${
              section.flipped ? 'bg-stiko-tint text-stiko-primary' : 'text-stiko-muted hover:bg-stiko-tint'
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </button>
        </div>
      )}

      <ViewportToolButton
        label="Cross-section"
        active={active}
        onClick={() => onChange(active ? null : lastSection)}
      >
        {SliceIcon}
      </ViewportToolButton>
    </div>
  );
}
