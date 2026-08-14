'use client';

import { SECTION_AXES, type CrossSection, type SectionAxis } from '@/lib/crossSection';

/**
 * Cross-section control: a toggle pill that opens an axis picker, a slider and a flip button.
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
    <div className="relative select-none">
      {section && (
        <div className="mb-1.5 flex items-center gap-1 rounded-panel bg-white shadow-stiko-sheet border border-stiko-border h-8 px-1.5">
          {SECTION_AXES.map((axis: SectionAxis) => (
            <button
              key={axis}
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

      <div className="flex items-center rounded-panel bg-white shadow-stiko-panel border border-stiko-border h-8 px-1">
        <button
          title="Cross-section"
          aria-label="Cross-section"
          aria-pressed={active}
          onClick={() => onChange(active ? null : lastSection)}
          className={`flex h-6 w-6 items-center justify-center rounded-[8px] transition-colors ${
            active ? 'bg-stiko-tint text-stiko-primary' : 'text-stiko-muted hover:bg-stiko-tint'
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8h18" />
            <path d="M5 8V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
            <path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8" strokeDasharray="3 3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
