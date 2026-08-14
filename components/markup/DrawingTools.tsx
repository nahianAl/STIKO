'use client';

import { useState, useRef, useEffect } from 'react';
import { PALETTE } from '@/lib/commentColors';

type ToolType = 'pointer' | 'comment' | 'freehand' | 'line' | 'arrow' | 'rect' | 'text' | 'eraser';

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
];

const STROKE_PRESETS = [
  { value: 2, label: 'Thin' },
  { value: 4, label: 'Medium' },
  { value: 6, label: 'Thick' },
];

/** Bar and sub-bar share these, so a sub-toolbar is visually the main toolbar cut short. */
const BAR =
  'flex items-center gap-[4px] h-[46px] px-[6px] rounded-sheet bg-white border border-stiko-border shadow-stiko-panel';

/** Hung off the button that opened it, clear of the bar's bottom edge. */
const SUB_BAR = 'absolute top-full mt-[13px] left-1/2 -translate-x-1/2';

/**
 * Every slot in the bar: a tinted chip with a light grey edge that lifts off the bar on
 * hover. The scale is on the button and the label on the wrapper, so growing the chip never
 * drags the tooltip with it.
 */
const SLOT_BASE =
  'relative flex h-[34px] w-[34px] items-center justify-center rounded-[11px] border transition-all duration-150 hover:scale-[1.12] hover:z-10 hover:shadow-[0_5px_12px_-3px_rgba(28,32,48,0.22)]';

const slot = (active: boolean) =>
  `${SLOT_BASE} ${
    active
      ? 'border-stiko-primary-light bg-stiko-tint text-stiko-primary'
      : 'border-stiko-divider bg-[#F8EDFC]/60 text-stiko-secondary hover:bg-[#F8EDFC] hover:border-stiko-border-strong'
  }`;

const LABEL =
  'pointer-events-none absolute left-1/2 top-full z-50 mt-[9px] -translate-x-1/2 whitespace-nowrap rounded-[7px] bg-stiko-ink px-2 py-[3px] text-[11px] font-medium leading-none tracking-heading text-white opacity-0 shadow-stiko-sheet transition-opacity duration-100 group-hover:opacity-100';

/**
 * A single slot plus its hover label. Labels hang below the slot, which is the only side
 * with room — the bar sits near the top edge of the viewport. That is also where a sub-bar
 * opens, so `hideLabel` mutes the whole main row while one is open rather than letting a
 * tooltip land on it.
 */
function ToolButton({
  label,
  active,
  onClick,
  hideLabel,
  expanded,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  hideLabel?: boolean;
  expanded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative flex">
      <button
        aria-label={label}
        aria-pressed={expanded === undefined ? active : undefined}
        aria-expanded={expanded}
        onClick={onClick}
        className={slot(active)}
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
}: DrawingToolsProps) {
  // Only ever one sub-bar open — two stacked panels under one short bar reads as a mess.
  const [menu, setMenu] = useState<'shapes' | 'stroke' | null>(null);
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

        {/* Stroke width */}
        <div className="relative flex">
          <ToolButton
            label="Stroke width"
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
                {STROKE_PRESETS.map((s) => (
                  <ToolButton
                    key={s.value}
                    label={s.label}
                    active={strokeWidth === s.value}
                    onClick={() => { onStrokeWidthChange(s.value); setMenu(null); }}
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18">
                      <line x1="2" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth={s.value} strokeLinecap="round" />
                    </svg>
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

        {/* Pastel swatches — sets pin colour (pastel) + markup stroke (saturated accent).
            No hover label: the chip is its own label, and a tooltip per colour would be five
            tooltips fighting over the same strip of viewport. */}
        <div className="flex items-center gap-[6px] pr-[2px]">
          {PALETTE.map((p) => {
            const selected = color === p.accent;
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
      </div>
    </div>
  );
}
