'use client';

import { useState, useRef, useEffect } from 'react';
import { MARKUP_COLORS, isPresetColor, sameColor } from '@/lib/markup/colors';
import ColorPickerPopover from './ColorPickerPopover';
import { BAR, SUB_BAR, slot, LABEL } from './toolbarStyles';
import type { AnnotationObjectType, MeasureTool, ToolType } from './useAnnotationObjects';
import { LENGTH_UNITS, type LengthUnit } from '@/lib/measure/units';
import type { ScaleSource } from '@/lib/measure/calibration';

interface DrawingToolsProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  color: string;
  onColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (w: number) => void;
  tagging: boolean;
  onToggleTagging: () => void;
  onInsertImage: () => void;
  /** Distance from the top of the viewport, in px. Raised for viewers that put a strip of
   *  their own up there (the PDF page/zoom nav) so the bar never lands on it. */
  offsetTop?: number;
  /** Type of the currently selected markup object, or null. The stroke picker reads this to
   *  decide whether it is presenting stroke weights or text sizes — there is no other way for
   *  the toolbar to know what kind of object a width would be applied to. */
  selectionType?: AnnotationObjectType | null;
  /** The unit measurements are read in on this file. */
  measureUnit: LengthUnit;
  onMeasureUnitChange: (unit: LengthUnit) => void;
  /**
   * Whether this file has a usable scale. 'unknown' disables Linear — a length with no scale is
   * a pixel count, not a dimension. Angular is never gated: angles are scale-invariant, so
   * calibration does not affect them.
   */
  scaleSource: ScaleSource;
  /** False for roles that may not calibrate, and during an attachment session (no file to store on). */
  canCalibrate: boolean;
  /**
   * False hides the Measure button outright. Video and unsupported types have no stable
   * intrinsic space — a moving frame cannot be calibrated meaningfully — so the honest
   * presentation is no button at all rather than a permanently disabled one.
   */
  measureAvailable: boolean;
}

/* Icons. currentColor throughout and one nominal box, but sized optically rather than
   literally: the solid glyphs are drawn a shade smaller and the hairline ones a shade
   larger, which is what makes them read as the same weight across the row. */

const ICON = { width: 18, height: 18 } as const;
const px = (n: number) => ({ width: n, height: n } as const);

const CommentPinIcon = (
  <svg {...px(17)} viewBox="0 0 24 24" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M4 5C4 4.44772 4.44772 4 5 4H11.1716C11.4368 4 11.6911 4.10536 11.8787 4.29289L19.8787 12.2929C20.2692 12.6834 20.2692 13.3166 19.8787 13.7071L13.7071 19.8787C13.3166 20.2692 12.6834 20.2692 12.2929 19.8787L4.29289 11.8787C4.10536 11.6911 4 11.4368 4 11.1716V5ZM5 2C3.34315 2 2 3.34315 2 5L2 11.1716C2 11.9672 2.31607 12.7303 2.87868 13.2929L10.8787 21.2929C12.0503 22.4645 13.9497 22.4645 15.1213 21.2929L21.2929 15.1213C22.4645 13.9497 22.4645 12.0503 21.2929 10.8787L13.2929 2.87868C12.7303 2.31607 11.9672 2 11.1716 2H5ZM8 10C9.10457 10 10 9.10457 10 8C10 6.89543 9.10457 6 8 6C6.89543 6 6 6.89543 6 8C6 9.10457 6.89543 10 8 10Z" />
  </svg>
);

const PointerIcon = (
  <svg {...px(17)} viewBox="0 0 16 16" fill="currentColor">
    <path d="M3 1l10 7-4.5 1L6 13.5z" />
  </svg>
);

const FreehandIcon = (
  <svg {...px(20)} viewBox="0 0 24 24" fill="currentColor">
    <path d="M23 14.25A3.88 3.88 0 0 0 19.25 10C16.314 10 15 12.763 15 15.5a6.493 6.493 0 0 0 .95 3.516 7.005 7.005 0 0 1-4.905-1.566A3.255 3.255 0 0 1 10 15a9.084 9.084 0 0 1 1.555-3.894A8.31 8.31 0 0 0 13 7.5 2.276 2.276 0 0 0 10.5 5c-.919 0-1.795 1.072-2.81 2.314C6.714 8.511 5.498 10 4.5 10 3.684 10 2 9.51 2 8c0-1.848 2.703-4.028 4.002-5.076l.266-.215-.632-.775-.262.212C3.845 3.379 1 5.675 1 8c0 2.07 2.047 3 3.5 3 1.473 0 2.797-1.622 3.965-3.053C9.174 7.08 10.055 6 10.5 6c1.038 0 1.5.463 1.5 1.5a7.868 7.868 0 0 1-1.313 3.11A9.681 9.681 0 0 0 9 15a4.275 4.275 0 0 0 1.357 3.176A8.438 8.438 0 0 0 16.5 20c.072 0 .144-.001.215-.003a11.08 11.08 0 0 0 6.326 2.871l.167-.986a11.16 11.16 0 0 1-5.178-2.024A5.937 5.937 0 0 0 23 14.25zm-7 1.25c0-2.24 1.005-4.5 3.25-4.5.951 0 2.75.68 2.75 3.25a5.033 5.033 0 0 1-4.857 4.722A5.396 5.396 0 0 1 16 15.5z" />
  </svg>
);

const ShapesIcon = (
  <svg {...px(19)} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11.5" cy="11.5" r="8.5" />
    <polyline points="20,13 29,13 29,29 13,29 13,20" />
  </svg>
);

const StrokeWidthIcon = (
  <svg {...px(18)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 12H18M3 6H21M9 18H15" />
  </svg>
);

const TextIcon = (
  <svg {...px(17)} viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 3h12v2.5h-1.5V4.5h-4V12h1.5v1.5h-5V12H6.5V4.5h-4V5.5H1V3z" />
  </svg>
);

const ImageIcon = (
  <svg {...ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);

const EraserIcon = (
  <svg {...ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 20H7L3 16a2 2 0 0 1 0-3l9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8" />
    <line x1="8" y1="9" x2="15" y2="16" />
  </svg>
);

const MeasureIcon = (
  <svg {...px(19)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 15.5 15.5 2.5a1.4 1.4 0 0 1 2 0l4 4a1.4 1.4 0 0 1 0 2l-13 13a1.4 1.4 0 0 1-2 0l-4-4a1.4 1.4 0 0 1 0-2Z" />
    <path d="M7 11l2 2M10.5 7.5l2 2M14 4l2 2" />
  </svg>
);

const LinearIcon = (
  <svg {...ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <line x1="2" y1="8" x2="14" y2="8" />
    <polyline points="4.5,5.5 2,8 4.5,10.5" />
    <polyline points="11.5,5.5 14,8 11.5,10.5" />
  </svg>
);

const AngleIcon = (
  <svg {...ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3,13 13,13 3,4 3,13" />
    <path d="M7 13a4.5 4.5 0 0 0-1.4-3.2" />
  </svg>
);

const CalibrateIcon = (
  <svg {...ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <line x1="2" y1="11" x2="14" y2="11" />
    <path d="M2 8.5v2.5M6 9.5v1.5M10 9.5v1.5M14 8.5v2.5" />
    <path d="M9.5 5.5 12 3l1.5 1.5L11 7Z" />
  </svg>
);

const MEASURE_SUB_TOOLS: { id: MeasureTool; label: string; icon: React.ReactNode }[] = [
  { id: 'measure', label: 'Linear', icon: LinearIcon },
  { id: 'angle', label: 'Angle', icon: AngleIcon },
  { id: 'calibrate', label: 'Calibrate', icon: CalibrateIcon },
];

const SHAPE_TOOLS: { id: ToolType; label: string; icon: React.ReactNode }[] = [
  {
    id: 'line',
    label: 'Line',
    icon: (
      <svg {...ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="3" y1="13" x2="13" y2="3" />
      </svg>
    ),
  },
  {
    id: 'arrow',
    label: 'Arrow',
    icon: (
      <svg {...ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="13" x2="13" y2="3" />
        <polyline points="7.5,3 13,3 13,8.5" />
      </svg>
    ),
  },
  {
    id: 'rect',
    label: 'Rectangle',
    icon: (
      <svg {...ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
      </svg>
    ),
  },
  {
    id: 'ellipse',
    label: 'Ellipse',
    icon: (
      <svg {...ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        <ellipse cx="8" cy="8" rx="5.5" ry="4.5" />
      </svg>
    ),
  },
  {
    id: 'cloud',
    label: 'Cloud',
    icon: (
      <svg {...px(19)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M6 17a3.2 3.2 0 0 1 0-6.4 4.2 4.2 0 0 1 7.2-2.9A3.4 3.4 0 0 1 18.6 10a3.5 3.5 0 0 1 0 7H6Z" />
      </svg>
    ),
  },
];

/** The idle face of the custom-colour chip: two of the row's own pastels, softly blended. */
const CUSTOM_CHIP_GRADIENT = 'linear-gradient(135deg, #E4E8FD 0%, #FFDCE8 100%)';

/** PALETTE's purple `dark`. Ringing the chip in it is what stops it reading as a 7th preset. */
const CUSTOM_CHIP_BORDER = '#6B4FC4';

const STROKE_PRESETS = [
  { value: 2, label: 'Thin', textLabel: 'Small' },
  { value: 4, label: 'Medium', textLabel: 'Medium' },
  { value: 6, label: 'Thick', textLabel: 'Large' },
];

/** Glyph heights for the text-size variant of the picker, index-aligned with STROKE_PRESETS. */
const TEXT_PREVIEW_SIZES = [10, 13, 16];

/**
 * A single slot plus its hover label. Labels hang below the slot, which is the only side
 * with room — the bar sits near the top edge of the viewport. That is also where a sub-bar
 * opens, so `hideLabel` mutes the whole main row while one is open rather than letting a
 * tooltip land on it.
 */
function ToolButton({
  label, active, onClick, hideLabel, expanded, disabled, children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  hideLabel?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative flex">
      <button
        aria-label={label}
        aria-pressed={expanded === undefined ? active : undefined}
        aria-expanded={expanded}
        disabled={disabled}
        onClick={onClick}
        className={`${slot(active)} ${disabled ? 'cursor-not-allowed opacity-40 hover:scale-100 hover:shadow-none' : ''}`}
      >
        {children}
      </button>
      {!hideLabel && <span className={LABEL}>{label}</span>}
    </div>
  );
}

/**
 * The markup toolbar, floating over the top of the viewport rather than stealing a row
 * above it. Line/arrow/rect fold into a Shapes button and stroke width into a picker, so
 * the bar stays short enough to leave the file itself the room.
 */
export default function DrawingTools({
  activeTool,
  onToolChange,
  color,
  onColorChange,
  strokeWidth,
  onStrokeWidthChange,
  tagging,
  onToggleTagging,
  onInsertImage,
  offsetTop = 12,
  selectionType = null,
  measureUnit,
  onMeasureUnitChange,
  scaleSource,
  canCalibrate,
  measureAvailable,
}: DrawingToolsProps) {
  // Only ever one sub-bar open — two stacked panels under one short bar reads as a mess.
  const [menu, setMenu] = useState<'shapes' | 'stroke' | 'picker' | 'measure' | 'units' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const handleClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menu]);

  const shapeActive = SHAPE_TOOLS.some((s) => s.id === activeTool);

  // Precomputed before either is tested as a condition, rather than written inline as
  // `menu === 'measure'` / `menu === 'units'` where they're used below. The units chip nests
  // a `menu === 'units'` check inside the block `menu === 'measure'` already gates, and
  // TypeScript's aliased-condition narrowing carries an effectively-const `menu` down to a
  // single literal for the rest of a block that tests it (or a boolean alias of that test) —
  // so the second, different literal comparison reads as impossible (TS2367). Computing both
  // up front, before `menu` is narrowed by either, sidesteps that.
  const measureOpen = menu === 'measure';
  const unitsOpen = menu === 'units';

  // Picking a top-level tool dismisses whatever sub-bar was open; picking a shape leaves the
  // shapes sub-bar up so the neighbouring shapes stay one click away.
  const pickTool = (id: ToolType, label: string, icon: React.ReactNode) => (
    <ToolButton
      key={id}
      label={label}
      active={activeTool === id}
      hideLabel={menu !== null}
      onClick={() => {
        onToolChange(activeTool === id ? 'pointer' : id);
        setMenu(null);
      }}
    >
      {icon}
    </ToolButton>
  );

  // Width means font size on a text object, so the picker relabels rather than lying about it.
  const strokeIsTextSize = selectionType === 'text';

  return (
    <div
      ref={rootRef}
      className="absolute left-1/2 -translate-x-1/2 z-30 select-none"
      style={{ top: offsetTop }}
    >
      <div className={BAR}>
        {/* Comment pin — a mode of its own, not one of the drawing tools */}
        <ToolButton
          label="Comment pin"
          active={tagging}
          hideLabel={menu !== null}
          onClick={() => { onToggleTagging(); setMenu(null); }}
        >
          {CommentPinIcon}
        </ToolButton>

        {pickTool('pointer', 'Pointer', PointerIcon)}
        {pickTool('freehand', 'Freehand', FreehandIcon)}

        {/* Shapes — folds line/arrow/rect into one slot */}
        <div className="relative flex">
          <ToolButton
            label="Shapes"
            active={shapeActive || menu === 'shapes'}
            expanded={menu === 'shapes'}
            hideLabel={menu !== null}
            onClick={() => setMenu(menu === 'shapes' ? null : 'shapes')}
          >
            {ShapesIcon}
          </ToolButton>
          {menu === 'shapes' && (
            <div className={SUB_BAR}>
              <div className={BAR}>
                {SHAPE_TOOLS.map((s) => (
                  <ToolButton
                    key={s.id}
                    label={s.label}
                    active={activeTool === s.id}
                    onClick={() => onToolChange(activeTool === s.id ? 'pointer' : s.id)}
                  >
                    {s.icon}
                  </ToolButton>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Measure — linear, angular, calibrate and the unit the readings are in */}
        {measureAvailable && (
        <div className="relative flex">
          <ToolButton
            label="Measure"
            active={MEASURE_SUB_TOOLS.some((t) => t.id === activeTool) || measureOpen}
            expanded={measureOpen}
            hideLabel={menu !== null}
            onClick={() => setMenu(measureOpen ? null : 'measure')}
          >
            {MeasureIcon}
          </ToolButton>
          {measureOpen && (
            <div className={SUB_BAR}>
              <div className={BAR}>
                {MEASURE_SUB_TOOLS.map((t) => {
                  // Linear needs a scale; without one a "length" is a pixel count. Angular never
                  // does — angles are scale-invariant. Calibrate is gated by role instead.
                  const disabled =
                    (t.id === 'measure' && scaleSource === 'unknown') ||
                    (t.id === 'calibrate' && !canCalibrate);
                  const label =
                    t.id === 'measure' && scaleSource === 'unknown'
                      ? 'Calibrate this file first'
                      : t.id === 'calibrate' && !canCalibrate
                        ? 'You cannot calibrate this file'
                        : t.label;
                  return (
                    <ToolButton
                      key={t.id}
                      label={label}
                      active={activeTool === t.id}
                      disabled={disabled}
                      onClick={() => onToolChange(activeTool === t.id ? 'pointer' : t.id)}
                    >
                      {t.icon}
                    </ToolButton>
                  );
                })}

                <div className="w-px h-[24px] bg-stiko-divider mx-[6px]" />

                {/* Units — a chip showing the current unit, not a ToolButton: it opens a list
                    rather than arming a mode. Anchored right-edge to trigger, like the colour
                    picker, so it cannot clip in a narrow viewer pane. */}
                <div className="relative flex">
                  <button
                    aria-label="Measurement units"
                    aria-expanded={unitsOpen}
                    onClick={() => setMenu(unitsOpen ? 'measure' : 'units')}
                    className={`${slot(unitsOpen)} w-[44px] text-[11px] font-semibold tracking-heading`}
                  >
                    {measureUnit}
                  </button>
                  {unitsOpen && (
                    <div className="absolute top-full mt-[13px] right-0 z-50 rounded-sheet bg-white border border-stiko-border shadow-stiko-panel py-[4px]">
                      {LENGTH_UNITS.map((u) => (
                        <button
                          key={u}
                          onClick={() => { onMeasureUnitChange(u); setMenu('measure'); }}
                          aria-pressed={u === measureUnit}
                          className={`block w-[72px] px-[12px] py-[6px] text-left text-[12px] ${
                            u === measureUnit ? 'text-stiko-primary font-semibold' : 'text-stiko-secondary'
                          } hover:bg-stiko-tint`}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        )}

        {/* Stroke width */}
        <div className="relative flex">
          <ToolButton
            label={strokeIsTextSize ? 'Text size' : 'Stroke width'}
            active={menu === 'stroke'}
            expanded={menu === 'stroke'}
            hideLabel={menu !== null}
            onClick={() => setMenu(menu === 'stroke' ? null : 'stroke')}
          >
            {StrokeWidthIcon}
          </ToolButton>
          {menu === 'stroke' && (
            <div className={SUB_BAR}>
              <div className={BAR}>
                {STROKE_PRESETS.map((s, i) => (
                  <ToolButton
                    key={s.value}
                    label={strokeIsTextSize ? s.textLabel : s.label}
                    active={strokeWidth === s.value}
                    onClick={() => { onStrokeWidthChange(s.value); setMenu(null); }}
                  >
                    {strokeIsTextSize ? (
                      <svg width="18" height="18" viewBox="0 0 18 18">
                        <text
                          x="9"
                          y="9"
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={TEXT_PREVIEW_SIZES[i]}
                          fontWeight="bold"
                          fill="currentColor"
                        >
                          A
                        </text>
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 18 18">
                        <line x1="2" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth={s.value} strokeLinecap="round" />
                      </svg>
                    )}
                  </ToolButton>
                ))}
              </div>
            </div>
          )}
        </div>

        {pickTool('text', 'Text', TextIcon)}

        {/* Insert image (an action, not a mode) */}
        <ToolButton
          label="Insert image"
          active={false}
          hideLabel={menu !== null}
          onClick={() => { onInsertImage(); setMenu(null); }}
        >
          {ImageIcon}
        </ToolButton>

        {pickTool('eraser', 'Eraser', EraserIcon)}

        {/* Move / rotate live in the 3D viewport itself — see components/viewers/TransformTools. */}

        <div className="w-px h-[24px] bg-stiko-divider mx-[6px]" />

        {/* Swatches — sets the markup stroke to the entry's saturated accent. Rendered from
            MARKUP_COLORS, not PALETTE: black is a markup colour only, and adding it to the
            comment palette would recolour every existing comment's pin and avatar.
            No hover label: the chip is its own label, and a tooltip per colour would be six
            tooltips fighting over the same strip of viewport. */}
        <div className="flex items-center gap-[6px] pr-[2px]">
          {MARKUP_COLORS.map((p) => {
            const selected = sameColor(color, p.accent);
            return (
              <button
                key={p.name}
                title={p.name}
                aria-label={p.name}
                aria-pressed={selected}
                onClick={() => onColorChange(p.accent)}
                className="h-[20px] w-[20px] rounded-[7px] border border-stiko-divider transition-transform duration-150 hover:scale-[1.15]"
                style={{ background: p.swatch, boxShadow: selected ? '0 0 0 2px #fff, 0 0 0 3.5px #5B60FF' : undefined }}
              />
            );
          })}
        </div>

        {/* Custom colour — last in the row. The chip carries the gradient until a colour that
            is not one of the swatches is in play, at which point it shows that colour over the
            gradient so the current pick is visible without opening the panel. */}
        <div className="relative flex">
          <button
            aria-label="Custom colour"
            aria-expanded={menu === 'picker'}
            onClick={() => setMenu(menu === 'picker' ? null : 'picker')}
            // Round, ringed, and set apart from the swatch strip on purpose: this one opens a
            // panel rather than setting a colour, and as another rounded square in the run of
            // six it just read as a seventh preset.
            className="ml-[10px] h-[20px] w-[20px] rounded-full border-[1.5px] transition-transform duration-150 hover:scale-[1.15]"
            style={{
              background: isPresetColor(color) ? CUSTOM_CHIP_GRADIENT : color,
              borderColor: CUSTOM_CHIP_BORDER,
              boxShadow: isPresetColor(color) ? undefined : '0 0 0 2px #fff, 0 0 0 3.5px #5B60FF',
            }}
          />
          {menu === 'picker' && (
            // Not SUB_BAR: that centres under the trigger, which is the toolbar's rightmost
            // chip, and the 188px panel would hang well past the toolbar's right edge and
            // clip in a narrow viewer pane. Anchor the panel's right edge to the trigger's
            // right edge instead — same offset below the bar, but it grows leftward, staying
            // inside the toolbar's own footprint.
            <div className="absolute top-full mt-[13px] right-0">
              <ColorPickerPopover color={color} onChange={onColorChange} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
