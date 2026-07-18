'use client';

import { useEffect, useRef, useState, useImperativeHandle, type Ref } from 'react';
import { Stage, Layer, Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import { useAnnotationObjects, type AnnTool } from './useAnnotationObjects';
import AnnotationObjects from './AnnotationObjects';
import { ERASER_CURSOR } from '@/lib/cursors';

export interface AnnotationCanvasHandle {
  captureSnapshot: () => string | null;
  clear: () => void;
  hasObjects: () => boolean;
}

interface AnnotationCanvasProps {
  backgroundDataUrl: string | null;
  activeTool: AnnTool;
  color: string;
  strokeWidth: number;
  handleRef?: Ref<AnnotationCanvasHandle>;
  onObjectCreated?: () => void;
}

export default function AnnotationCanvas({ backgroundDataUrl, activeTool, color, strokeWidth, handleRef, onObjectCreated }: AnnotationCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [textPopup, setTextPopup] = useState<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState('');

  const ann = useAnnotationObjects();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!backgroundDataUrl) { setBgImage(null); return; }
    const img = new window.Image();
    img.onload = () => setBgImage(img);
    img.src = backgroundDataUrl;
  }, [backgroundDataUrl]);

  // Selection-vs-tool contract: clear the selection when the active tool changes to a
  // non-pointer tool, so Transformer handles don't linger over a previously selected object
  // while a draw/eraser tool is active.
  useEffect(() => {
    if (activeTool !== 'pointer') ann.setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, ann.setSelectedId]);

  // Delete/Backspace removes the selected object (unless typing in the text popup).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (ann.selectedId) { e.preventDefault(); ann.deleteObject(ann.selectedId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ann.selectedId, ann.deleteObject]);

  useImperativeHandle(handleRef, () => ({
    captureSnapshot: () => {
      const stage = stageRef.current;
      if (!stage) return null;
      stage.find('Transformer').forEach((t) => (t as Konva.Transformer).nodes([]));
      stage.draw();
      const url = stage.toDataURL({ pixelRatio: 2, mimeType: 'image/jpeg', quality: 0.88 });
      ann.setSelectedId(null);
      return url;
    },
    clear: () => ann.clear(),
    hasObjects: () => ann.hasObjects(),
  }));

  // Fit the background image within the stage, centered (letterbox), so the drawn snapshot matches what was on screen.
  const bgFit = (() => {
    if (!bgImage || !size.width || !size.height) return null;
    const scale = Math.min(size.width / bgImage.width, size.height / bgImage.height);
    const w = bgImage.width * scale;
    const h = bgImage.height * scale;
    return { x: (size.width - w) / 2, y: (size.height - h) / 2, width: w, height: h };
  })();

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const p = stage.getPointerPosition();
    if (!p) return;
    if (activeTool === 'text') { setTextPopup({ x: p.x, y: p.y }); setTextInput(''); return; }
    if (activeTool === 'pointer') { if (e.target === stage) ann.setSelectedId(null); return; }
    if (activeTool === 'eraser') return;
    ann.startDraw(activeTool, p, color, strokeWidth);
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const p = e.target.getStage()?.getPointerPosition();
    if (p) ann.moveDraw(activeTool, p);
  };

  const submitText = () => {
    if (textPopup && textInput.trim()) {
      const id = ann.addText(textPopup, textInput, color, strokeWidth);
      if (id) onObjectCreated?.();
    }
    setTextPopup(null); setTextInput('');
  };

  const cursor = activeTool === 'pointer' ? 'default' : activeTool === 'eraser' ? ERASER_CURSOR : 'crosshair';

  return (
    <div ref={containerRef} className="absolute inset-0 bg-gray-900" style={{ cursor }}>
      {size.width > 0 && size.height > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={() => { if (ann.endDraw()) onObjectCreated?.(); }}
          onMouseLeave={() => { if (ann.endDraw()) onObjectCreated?.(); }}
        >
          <Layer listening={false}>
            {bgImage && bgFit && <KonvaImage image={bgImage} x={bgFit.x} y={bgFit.y} width={bgFit.width} height={bgFit.height} />}
          </Layer>
          <Layer>
            <AnnotationObjects
              objects={ann.objects}
              draft={ann.draft}
              selectedId={ann.selectedId}
              activeTool={activeTool}
              onSelect={ann.setSelectedId}
              onErase={ann.deleteObject}
              onChange={ann.updateObject}
            />
          </Layer>
        </Stage>
      )}

      {textPopup && (
        <div
          className="absolute z-30 bg-white rounded-lg shadow-lg border border-gray-200 p-2"
          style={{ left: Math.min(textPopup.x, size.width - 200), top: Math.min(textPopup.y, size.height - 80) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            autoFocus
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Type text..."
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500"
            style={{ minWidth: 150 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitText(); }
              if (e.key === 'Escape') { setTextPopup(null); setTextInput(''); }
            }}
          />
          <div className="flex justify-end gap-1.5 mt-1.5">
            <button onClick={() => { setTextPopup(null); setTextInput(''); }} className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
            <button onClick={submitText} disabled={!textInput.trim()} className="px-2.5 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">Add</button>
          </div>
        </div>
      )}
    </div>
  );
}
