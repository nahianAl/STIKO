'use client';

// THROWAWAY. Deleted in Task 14 of docs/superpowers/plans/2026-08-27-portal-markup-enhancements.md.
// Mounts the markup surface with a synthetic background so the annotation session can be driven
// without a database, an S3 bucket or an uploaded file.

import { useEffect, useRef, useState } from 'react';
import AnnotationCanvas, { type AnnotationCanvasHandle } from '@/components/markup/AnnotationCanvas';
import DrawingTools from '@/components/markup/DrawingTools';
import type { AnnTool } from '@/components/markup/useAnnotationObjects';

type ToolType = 'pointer' | 'comment' | 'freehand' | 'line' | 'arrow' | 'rect' | 'text' | 'eraser';

/** A deliberately non-square, dark-ish background: dark proves text legibility, non-square
 *  proves the matte, and the grid makes any letterbox seam obvious. */
function makeBackground(width: number, height: number): string {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, '#2b3350');
  g.addColorStop(1, '#6f7fa8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 0; y <= height; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px Arial';
  ctx.fillText(`${width} x ${height} background`, 24, 48);
  return c.toDataURL('image/jpeg', 0.92);
}

export default function MarkupHarnessPage() {
  const [bg, setBg] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolType>('pointer');
  const [color, setColor] = useState('#FF6B6B');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [captured, setCaptured] = useState<string | null>(null);
  const surface = useRef<AnnotationCanvasHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // 1200x700 is a different aspect ratio from the viewport below, which forces a letterbox on
  // purpose — that is the band that has to come out light grey instead of black.
  useEffect(() => { setBg(makeBackground(1200, 700)); }, []);

  return (
    <div className="h-screen flex flex-col gap-3 bg-stiko-app p-3">
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) surface.current?.insertImage(f);
        }}
      />

      <div className="relative flex-1 overflow-hidden rounded-panel bg-white shadow-stiko-panel">
        <AnnotationCanvas
          backgroundDataUrl={bg}
          activeTool={activeTool as AnnTool}
          color={color}
          strokeWidth={strokeWidth}
          handleRef={surface}
          onObjectCreated={() => setActiveTool('pointer')}
        />
        <DrawingTools
          activeTool={activeTool}
          onToolChange={setActiveTool}
          color={color}
          onColorChange={setColor}
          strokeWidth={strokeWidth}
          onStrokeWidthChange={setStrokeWidth}
          tagging={false}
          onToggleTagging={() => {}}
          onInsertImage={() => fileInput.current?.click()}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setCaptured(surface.current?.captureSnapshot() ?? null)}
          className="rounded-chip bg-stiko-primary px-3 py-1.5 text-sm text-white"
        >
          Capture (whole stage)
        </button>
        <button
          onClick={() => setCaptured(surface.current?.captureSnapshot({ native: true }) ?? null)}
          className="rounded-chip border border-stiko-border-strong px-3 py-1.5 text-sm text-stiko-ink"
        >
          Capture (native crop)
        </button>
        <button
          onClick={() => { surface.current?.clear(); setCaptured(null); }}
          className="rounded-chip border border-stiko-border-strong px-3 py-1.5 text-sm text-stiko-ink"
        >
          Clear
        </button>
        <span className="text-sm text-stiko-secondary">
          tool: {activeTool} · colour: {color} · stroke: {strokeWidth}
        </span>
      </div>

      {/* The capture on black. Any transparent pixel that JPEG flattened shows up here. */}
      {captured && (
        <div className="h-64 flex-shrink-0 overflow-hidden rounded-panel bg-black p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={captured} alt="capture" className="h-full w-full object-contain" />
        </div>
      )}
    </div>
  );
}
