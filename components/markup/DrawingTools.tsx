'use client';

type ToolType = 'pointer' | 'comment' | 'freehand' | 'line' | 'arrow' | 'rect';

interface DrawingToolsProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  color: string;
  onColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (w: number) => void;
}

const TOOLS: { id: ToolType; label: string; icon: React.ReactNode }[] = [
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

export default function DrawingTools({
  activeTool,
  onToolChange,
  color,
  onColorChange,
  strokeWidth,
  onStrokeWidthChange,
}: DrawingToolsProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-white border-b border-gray-200 flex-shrink-0">
      {/* Tool buttons */}
      <div className="flex items-center gap-1">
        {TOOLS.map((tool) => (
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
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-gray-200" />

      {/* Color presets */}
      <div className="flex items-center gap-1">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c.value}
            title={c.label}
            onClick={() => onColorChange(c.value)}
            className={`
              w-5 h-5 rounded-full border-2 transition-transform
              ${color === c.value ? 'border-gray-800 scale-110' : 'border-transparent hover:scale-110'}
            `}
            style={{ backgroundColor: c.value }}
          />
        ))}
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-gray-200" />

      {/* Stroke width presets */}
      <div className="flex items-center gap-1">
        {STROKE_PRESETS.map((s) => (
          <button
            key={s.value}
            title={`${s.label} (${s.value}px)`}
            onClick={() => onStrokeWidthChange(s.value)}
            className={`
              px-2 py-0.5 rounded text-xs font-medium transition-colors
              ${strokeWidth === s.value
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:bg-gray-100'}
            `}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
