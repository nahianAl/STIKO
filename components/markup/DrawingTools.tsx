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
   larger, which is what makes them read as the same weight in a row this small. */

const ICON = { width: 15, height: 15 } as const;
const px = (n: number) => ({ width: n, height: n } as const);

const CommentPinIcon = (
  <svg {...px(14)} viewBox="0 0 24 24" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M4 5C4 4.44772 4.44772 4 5 4H11.1716C11.4368 4 11.6911 4.10536 11.8787 4.29289L19.8787 12.2929C20.2692 12.6834 20.2692 13.3166 19.8787 13.7071L13.7071 19.8787C13.3166 20.2692 12.6834 20.2692 12.2929 19.8787L4.29289 11.8787C4.10536 11.6911 4 11.4368 4 11.1716V5ZM5 2C3.34315 2 2 3.34315 2 5L2 11.1716C2 11.9672 2.31607 12.7303 2.87868 13.2929L10.8787 21.2929C12.0503 22.4645 13.9497 22.4645 15.1213 21.2929L21.2929 15.1213C22.4645 13.9497 22.4645 12.0503 21.2929 10.8787L13.2929 2.87868C12.7303 2.31607 11.9672 2 11.1716 2H5ZM8 10C9.10457 10 10 9.10457 10 8C10 6.89543 9.10457 6 8 6C6.89543 6 6 6.89543 6 8C6 9.10457 6.89543 10 8 10Z" />
  </svg>
);

const PointerIcon = (
  <svg {...px(14)} viewBox="0 0 16 16" fill="currentColor">
    <path d="M3 1l10 7-4.5 1L6 13.5z" />
  </svg>
);

const FreehandIcon = (
  <svg {...px(17)} viewBox="0 0 24 24" fill="currentColor">
    <path d="M23 14.25A3.88 3.88 0 0 0 19.25 10C16.314 10 15 12.763 15 15.5a6.493 6.493 0 0 0 .95 3.516 7.005 7.005 0 0 1-4.905-1.566A3.255 3.255 0 0 1 10 15a9.084 9.084 0 0 1 1.555-3.894A8.31 8.31 0 0 0 13 7.5 2.276 2.276 0 0 0 10.5 5c-.919 0-1.795 1.072-2.81 2.314C6.714 8.511 5.498 10 4.5 10 3.684 10 2 9.51 2 8c0-1.848 2.703-4.028 4.002-5.076l.266-.215-.632-.775-.262.212C3.845 3.379 1 5.675 1 8c0 2.07 2.047 3 3.5 3 1.473 0 2.797-1.622 3.965-3.053C9.174 7.08 10.055 6 10.5 6c1.038 0 1.5.463 1.5 1.5a7.868 7.868 0 0 1-1.313 3.11A9.681 9.681 0 0 0 9 15a4.275 4.275 0 0 0 1.357 3.176A8.438 8.438 0 0 0 16.5 20c.072 0 .144-.001.215-.003a11.08 11.08 0 0 0 6.326 2.871l.167-.986a11.16 11.16 0 0 1-5.178-2.024A5.937 5.937 0 0 0 23 14.25zm-7 1.25c0-2.24 1.005-4.5 3.25-4.5.951 0 2.75.68 2.75 3.25a5.033 5.033 0 0 1-4.857 4.722A5.396 5.396 0 0 1 16 15.5z" />
  </svg>
);

const ShapesIcon = (
  <svg {...px(16)} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11.5" cy="11.5" r="8.5" />
    <polyline points="20,13 29,13 29,29 13,29 13,20" />
  </svg>
);

const StrokeWidthIcon = (
  <svg {...px(13)} viewBox="0 0 20 20" fill="currentColor">
    <path d="M0 0h20v5H0V0zm0 7h20v4H0V7zm0 6h20v3H0v-3zm0 5h20v2H0v-2z" />
  </svg>
);

const TextIcon = (
  <svg {...px(14)} viewBox="0 0 16 16" fill="currentColor">
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
const BAR = 'flex items-center gap-[2px] h-9 px-1 rounded-panel bg-white border border-stiko-border shadow-stiko-panel';

/** Hung off the button that opened it, 8px clear of the bar's bottom edge. */
const SUB_BAR = 'absolute top-full mt-3 left-1/2 -translate-x-1/2';

const slot = (active: boolean) =>
  `flex h-7 w-7 items-center justify-center rounded-[8px] transition-colors ${
    active ? 'bg-stiko-tint text-stiko-primary' : 'text-stiko-muted hover:bg-stiko-tint'
  }`;

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
  const pickTool = (id: ToolType) => {
    onToolChange(activeTool === id ? 'pointer' : id);
    setMenu(null);
  };

  const toolButton = (id: ToolType, label: string, icon: React.ReactNode) => (
    <button
      key={id}
      title={label}
      aria-label={label}
      aria-pressed={activeTool === id}
      onClick={() => pickTool(id)}
      className={slot(activeTool === id)}
    >
      {icon}
    </button>
  );

  return (
    <div
      ref={rootRef}
      className="absolute left-1/2 -translate-x-1/2 z-30 select-none"
      style={{ top: offsetTop }}
    >
      <div className={BAR}>
        {/* Comment pin — a mode of its own, not one of the drawing tools */}
        <button
          title="Comment pin"
          aria-label="Comment pin"
          aria-pressed={tagging}
          onClick={() => { onToggleTagging(); setMenu(null); }}
          className={slot(tagging)}
        >
          {CommentPinIcon}
        </button>

        {toolButton('pointer', 'Pointer', PointerIcon)}
        {toolButton('freehand', 'Freehand', FreehandIcon)}

        {/* Shapes — folds line/arrow/rect into one slot */}
        <div className="relative">
          <button
            title="Shapes"
            aria-label="Shapes"
            aria-expanded={menu === 'shapes'}
            onClick={() => setMenu(menu === 'shapes' ? null : 'shapes')}
            className={slot(shapeActive || menu === 'shapes')}
          >
            {ShapesIcon}
          </button>
          {menu === 'shapes' && (
            <div className={SUB_BAR}>
              <div className={BAR}>
                {SHAPE_TOOLS.map((s) => (
                  <button
                    key={s.id}
                    title={s.label}
                    aria-label={s.label}
                    aria-pressed={activeTool === s.id}
                    onClick={() => onToolChange(activeTool === s.id ? 'pointer' : s.id)}
                    className={slot(activeTool === s.id)}
                  >
                    {s.icon}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Stroke width */}
        <div className="relative">
          <button
            title="Stroke width"
            aria-label="Stroke width"
            aria-expanded={menu === 'stroke'}
            onClick={() => setMenu(menu === 'stroke' ? null : 'stroke')}
            className={slot(menu === 'stroke')}
          >
            {StrokeWidthIcon}
          </button>
          {menu === 'stroke' && (
            <div className={SUB_BAR}>
              <div className={BAR}>
                {STROKE_PRESETS.map((s) => (
                  <button
                    key={s.value}
                    title={s.label}
                    aria-label={s.label}
                    aria-pressed={strokeWidth === s.value}
                    onClick={() => { onStrokeWidthChange(s.value); setMenu(null); }}
                    className={slot(strokeWidth === s.value)}
                  >
                    <svg width="15" height="15" viewBox="0 0 16 16">
                      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth={s.value} strokeLinecap="round" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {toolButton('text', 'Text', TextIcon)}

        {/* Insert image (an action, not a mode) */}
        <button
          title="Insert image"
          aria-label="Insert image"
          onClick={() => { onInsertImage(); setMenu(null); }}
          className={slot(false)}
        >
          {ImageIcon}
        </button>

        {toolButton('eraser', 'Eraser', EraserIcon)}

        {/* Move / rotate live in the 3D viewport itself — see components/viewers/TransformTools. */}

        <div className="w-px h-[18px] bg-stiko-divider mx-[5px]" />

        {/* Pastel swatches — sets pin colour (pastel) + markup stroke (saturated accent) */}
        <div className="flex items-center gap-[5px] pr-[3px]">
          {PALETTE.map((p) => {
            const selected = color === p.accent;
            return (
              <button
                key={p.name}
                title={p.name}
                aria-label={p.name}
                aria-pressed={selected}
                onClick={() => onColorChange(p.accent)}
                className="w-[15px] h-[15px] rounded-[5px] transition-transform hover:scale-110"
                style={{ background: p.swatch, boxShadow: selected ? '0 0 0 2px #fff, 0 0 0 3.5px #5B60FF' : undefined }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
