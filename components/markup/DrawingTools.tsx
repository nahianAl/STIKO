'use client';

import { useState, useRef, useEffect } from 'react';

type ToolType = 'pointer' | 'comment' | 'freehand' | 'line' | 'arrow' | 'rect' | 'text';

interface DrawingToolsProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  color: string;
  onColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (w: number) => void;
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
    id: 'comment',
    label: 'Comment',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
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
];

const COLOR_PRESETS = [
  { value: '#ef4444', label: 'Red' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#22c55e', label: 'Green' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#f97316', label: 'Orange' },
  { value: '#000000', label: 'Black' },
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
}: DrawingToolsProps) {
  const shapes = useDropdown();
  const colors = useDropdown();
  const strokes = useDropdown();

  const shapeToolIds = SHAPE_TOOLS.map((t) => t.id);
  const isShapeActive = shapeToolIds.includes(activeTool);
  const activeShapeTool = SHAPE_TOOLS.find((t) => t.id === activeTool) ?? SHAPE_TOOLS[0];

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-white border-b border-gray-200 flex-shrink-0">
      {/* Standalone tool buttons */}
      <div className="flex items-center gap-1">
        {STANDALONE_TOOLS.map((tool) => (
          <button
            key={tool.id}
            title={tool.label}
            onClick={() => onToolChange(tool.id)}
            className={`
              p-1.5 rounded transition-colors
              ${activeTool === tool.id
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}
            `}
          >
            {tool.icon}
          </button>
        ))}

        {/* Shapes dropdown */}
        <div ref={shapes.ref} className="relative">
          <button
            title="Shapes"
            onClick={() => shapes.setOpen(!shapes.open)}
            className={`
              flex items-center gap-1 p-1.5 rounded transition-colors
              ${isShapeActive
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}
            `}
          >
            {activeShapeTool.icon}
            <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="ml-0.5 opacity-60">
              <path d="M1 2.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {shapes.open && (
            <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[120px]">
              {SHAPE_TOOLS.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => {
                    onToolChange(tool.id);
                    shapes.setOpen(false);
                  }}
                  className={`
                    w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors
                    ${activeTool === tool.id
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-50'}
                  `}
                >
                  {tool.icon}
                  <span>{tool.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-gray-200" />

      {/* Color picker dropdown */}
      <div ref={colors.ref} className="relative">
        <button
          title="Color"
          onClick={() => colors.setOpen(!colors.open)}
          className="flex items-center gap-1.5 p-1.5 rounded transition-colors text-gray-500 hover:bg-gray-100"
        >
          <div
            className="w-4 h-4 rounded-full border border-gray-300"
            style={{ backgroundColor: color }}
          />
          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="opacity-60">
            <path d="M1 2.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {colors.open && (
          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 p-2 z-50">
            <div className="grid grid-cols-3 gap-1.5">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c.value}
                  title={c.label}
                  onClick={() => {
                    onColorChange(c.value);
                    colors.setOpen(false);
                  }}
                  className={`
                    w-6 h-6 rounded-full border-2 transition-transform hover:scale-110
                    ${color === c.value ? 'border-gray-800 scale-110' : 'border-transparent'}
                  `}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-gray-200" />

      {/* Stroke width dropdown */}
      <div ref={strokes.ref} className="relative">
        <button
          title="Stroke width"
          onClick={() => strokes.setOpen(!strokes.open)}
          className="flex items-center gap-1.5 p-1.5 rounded transition-colors text-gray-500 hover:bg-gray-100"
        >
          <svg width="16" height="16" viewBox="0 0 16 16">
            <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
          </svg>
          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="opacity-60">
            <path d="M1 2.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {strokes.open && (
          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1.5 px-2 z-50 flex flex-col gap-1">
            {STROKE_PRESETS.map((s) => (
              <button
                key={s.value}
                title={s.label}
                onClick={() => {
                  onStrokeWidthChange(s.value);
                  strokes.setOpen(false);
                }}
                className={`
                  flex items-center justify-center w-20 h-6 rounded transition-colors
                  ${strokeWidth === s.value
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-500 hover:bg-gray-50'}
                `}
              >
                <svg width="32" height="12" viewBox="0 0 32 12">
                  <line x1="2" y1="6" x2="30" y2="6" stroke="currentColor" strokeWidth={s.value} strokeLinecap="round" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
