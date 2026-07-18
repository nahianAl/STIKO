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
}

const SHAPE_TOOLS: { id: ToolType; label: string; icon: React.ReactNode }[] = [
  {
    id: 'line',
    label: 'Line',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="2" y1="14" x2="14" y2="2" />
      </svg>
    ),
  },
  {
    id: 'arrow',
    label: 'Arrow',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="2" y1="14" x2="14" y2="2" />
        <polyline points="8,2 14,2 14,8" />
      </svg>
    ),
  },
  {
    id: 'rect',
    label: 'Rectangle',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="12" height="10" />
      </svg>
    ),
  },
];

const STANDALONE_TOOLS: { id: ToolType; label: string; icon: React.ReactNode }[] = [
  {
    id: 'pointer',
    label: 'Pointer',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M3 1l10 7-4.5 1L6 13.5z" />
      </svg>
    ),
  },
  {
    id: 'freehand',
    label: 'Freehand',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M3 17c3-3 5-8 9-8s4 5 9 2" />
      </svg>
    ),
  },
  {
    id: 'text',
    label: 'Text',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 3h12v2.5h-1.5V4.5h-4V12h1.5v1.5h-5V12H6.5V4.5h-4V5.5H1V3z" />
      </svg>
    ),
  },
  {
    id: 'eraser',
    label: 'Eraser',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 20H7L3 16a2 2 0 0 1 0-3l9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8" />
        <line x1="8" y1="9" x2="15" y2="16" />
      </svg>
    ),
  },
];

const STROKE_PRESETS = [
  { value: 2, label: 'Thin' },
  { value: 4, label: 'Medium' },
  { value: 6, label: 'Thick' },
];

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return { open, setOpen, ref };
}

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
}: DrawingToolsProps) {
  const strokes = useDropdown();

  // A flat, single-select tool row. Pointer/Freehand/Text/Eraser + inline Line/Arrow/Rect.
  const TOOL_ORDER: { id: ToolType; label: string; icon: React.ReactNode }[] = [
    STANDALONE_TOOLS[0], // pointer
    STANDALONE_TOOLS[1], // freehand
    ...SHAPE_TOOLS,      // line, arrow, rect
    STANDALONE_TOOLS[2], // text
    STANDALONE_TOOLS[3], // eraser
  ];

  const slot = (active: boolean) =>
    `w-9 h-9 rounded-[10px] flex items-center justify-center transition-colors ${
      active ? 'bg-stiko-tint text-stiko-primary' : 'text-stiko-muted hover:bg-stiko-tint'
    }`;

  return (
    <div className="h-[52px] flex-shrink-0 bg-white rounded-panel shadow-stiko-panel flex items-center justify-center">
      <div className="flex items-center gap-[3px]">
        {/* Pin (comment tag) */}
        <button title="Comment pin" onClick={onToggleTagging} className={slot(tagging)}>
          <span className="w-[13px] h-[13px] rounded-[4px_4px_4px_0] border-2 border-current" />
        </button>

        {/* Tools */}
        {TOOL_ORDER.map((tool) => (
          <button
            key={tool.id}
            title={tool.label}
            onClick={() => onToolChange(activeTool === tool.id ? 'pointer' : tool.id)}
            className={slot(activeTool === tool.id)}
          >
            {tool.icon}
          </button>
        ))}

        {/* Insert image (action, not a mode) */}
        <button title="Insert image" onClick={onInsertImage} className={slot(false)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </button>

        {/* Stroke width (compact popover) */}
        <div ref={strokes.ref} className="relative">
          <button title="Stroke width" onClick={() => strokes.setOpen(!strokes.open)} className={slot(false)}>
            <svg width="16" height="16" viewBox="0 0 16 16"><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" /></svg>
          </button>
          {strokes.open && (
            <div className="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-lg border border-stiko-border py-1.5 px-2 z-50 flex flex-col gap-1">
              {STROKE_PRESETS.map((s) => (
                <button
                  key={s.value}
                  title={s.label}
                  onClick={() => { onStrokeWidthChange(s.value); strokes.setOpen(false); }}
                  className={`flex items-center justify-center w-20 h-6 rounded-lg transition-colors ${strokeWidth === s.value ? 'bg-stiko-tint text-stiko-primary' : 'text-stiko-muted hover:bg-stiko-subtle'}`}
                >
                  <svg width="32" height="12" viewBox="0 0 32 12"><line x1="2" y1="6" x2="30" y2="6" stroke="currentColor" strokeWidth={s.value} strokeLinecap="round" /></svg>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-[22px] bg-stiko-divider mx-[6px]" />

        {/* Pastel swatches — sets pin color (pastel) + markup stroke (saturated accent) */}
        <div className="flex items-center gap-[6px]">
          {PALETTE.map((p) => {
            const selected = color === p.accent;
            return (
              <button
                key={p.name}
                title={p.name}
                onClick={() => onColorChange(p.accent)}
                className="w-[18px] h-[18px] rounded-md transition-transform hover:scale-105"
                style={{ background: p.swatch, boxShadow: selected ? '0 0 0 2px #fff, 0 0 0 3.5px #5B60FF' : undefined }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
