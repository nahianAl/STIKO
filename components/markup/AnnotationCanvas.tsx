'use client';

import { useEffect, useRef, useState, useImperativeHandle, type Ref } from 'react';
import { Stage, Layer, Rect, Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import { useAnnotationObjects, type AnnTool } from './useAnnotationObjects';
import AnnotationObjects from './AnnotationObjects';
import CanvasTextEditor from './CanvasTextEditor';
import { fontSizeForStrokeWidth, wrapWidthForContent, isBlank } from '@/lib/markup/text';
import { ERASER_CURSOR } from '@/lib/cursors';
import { CANVAS_MATTE } from '@/lib/markup/matte';

export interface AnnotationCanvasHandle {
  /**
   * With no argument (or `{ native: false }`), captures the whole stage at a
   * fixed pixelRatio — correct for the ordinary viewer-snapshot session, whose
   * background already fills the stage.
   *
   * With `{ native: true }` and a background image present, crops the capture
   * to the fitted background region and restores the image's own resolution —
   * used when Done is about to replace a picked attachment, so the result
   * isn't letterboxed and resampled to the stage's aspect ratio.
   */
  captureSnapshot: (opts?: { native?: boolean }) => string | null;
  clear: () => void;
  hasObjects: () => boolean;
  insertImage: (file: File) => void;
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
  // The text object currently open for editing. The object itself already exists in `ann` —
  // this is only which one the editor is bound to.
  const [editingId, setEditingId] = useState<string | null>(null);

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

  // Delete/Backspace removes the selected object (unless typing in the text editor).
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

  // Fit the background image within the stage, centered (letterbox), so the drawn snapshot
  // matches what was on screen. Computed once here (rather than separately in the render body
  // and in captureSnapshot below) so the two can't drift apart.
  const bgFit = (() => {
    if (!bgImage || !size.width || !size.height) return null;
    const scale = Math.min(size.width / bgImage.width, size.height / bgImage.height);
    const w = bgImage.width * scale;
    const h = bgImage.height * scale;
    return { x: (size.width - w) / 2, y: (size.height - h) / 2, width: w, height: h };
  })();

  useImperativeHandle(handleRef, () => ({
    captureSnapshot: (opts) => {
      const stage = stageRef.current;
      if (!stage) return null;
      // A capture while the editor is open would otherwise lose that object: its Konva node is
      // hidden (`visible={editingId !== obj.id}`) so the textarea can stand in for it, and
      // `setEditingId(null)` is a React state update that will not have been applied by the
      // time toDataURL runs on the next line. Un-hide the node directly instead.
      if (editingId) (stage.findOne(`#${editingId}`) as Konva.Node | undefined)?.visible(true);
      setEditingId(null);
      stage.find('Transformer').forEach((t) => (t as Konva.Transformer).nodes([]));
      stage.draw();
      let url: string;
      if (opts?.native && bgImage && bgFit && bgFit.width > 0 && bgFit.height > 0) {
        // Crop to the fitted background box and pick a pixelRatio that maps its width
        // back to the source image's natural width, so the capture comes out at the
        // attachment's own resolution instead of the whole (letterboxed) stage.
        const pixelRatio = bgImage.width / bgFit.width;
        url = stage.toDataURL({
          x: bgFit.x,
          y: bgFit.y,
          width: bgFit.width,
          height: bgFit.height,
          pixelRatio,
          mimeType: 'image/jpeg',
          quality: 0.88,
        });
      } else {
        url = stage.toDataURL({ pixelRatio: 2, mimeType: 'image/jpeg', quality: 0.88 });
      }
      ann.setSelectedId(null);
      return url;
    },
    clear: () => { setEditingId(null); ann.clear(); },
    hasObjects: () => ann.hasObjects(),
    insertImage: (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const src = reader.result as string;
        const im = new window.Image();
        im.onload = () => {
          const maxW = size.width * 0.5;
          const maxH = size.height * 0.5;
          const scale = Math.min(maxW / im.width, maxH / im.height, 1);
          const w = im.width * scale;
          const h = im.height * scale;
          ann.addImage({ x: (size.width - w) / 2, y: (size.height - h) / 2 }, src, w, h);
        };
        im.src = src;
      };
      reader.readAsDataURL(file);
    },
  }));

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const p = stage.getPointerPosition();
    if (!p) return;
    if (activeTool === 'text') {
      const id = ann.addText(p, {
        text: '',
        color,
        fontSize: fontSizeForStrokeWidth(strokeWidth),
        // The fitted background region, not the stage: the wrap width must not depend on how
        // much matte happens to surround the snapshot.
        width: wrapWidthForContent(bgFit ? bgFit.width : size.width),
      });
      setEditingId(id);
      // Return to the pointer immediately. Otherwise the click that commits this box would also
      // start another one, since the text tool would still be armed.
      onObjectCreated?.();
      return;
    }
    if (activeTool === 'pointer') { if (e.target === stage) ann.setSelectedId(null); return; }
    if (activeTool === 'eraser') return;
    ann.startDraw(activeTool, p, color, strokeWidth);
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const p = e.target.getStage()?.getPointerPosition();
    if (p) ann.moveDraw(activeTool, p);
  };

  const editingObj = editingId ? ann.objects.find((o) => o.id === editingId) ?? null : null;

  /** Blank in, nothing out — an empty box is a mis-click, not an object. */
  const commitText = () => {
    if (editingObj && isBlank(editingObj.text)) {
      ann.deleteObject(editingObj.id);
    }
    setEditingId(null);
  };

  const cursor = activeTool === 'pointer' ? 'default' : activeTool === 'eraser' ? ERASER_CURSOR : 'crosshair';

  // What is captured must be what was on screen, so the container matches the in-stage matte
  // rather than contrasting with it. With no snapshot, stay transparent and let the live
  // viewer (which the portal keeps visible in that case) show through.
  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ cursor, background: backgroundDataUrl ? CANVAS_MATTE : 'transparent' }}
    >
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
            {/* Inside the stage, not on the container: toDataURL reads the stage, and JPEG has no
                alpha, so any pixel this rect does not cover is encoded black. */}
            {backgroundDataUrl && <Rect x={0} y={0} width={size.width} height={size.height} fill={CANVAS_MATTE} />}
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
              editingId={editingId}
              onEditText={setEditingId}
              onBakeText={ann.bakeTextTransform}
            />
          </Layer>
        </Stage>
      )}

      {editingObj && (
        <CanvasTextEditor
          // The stage is untransformed here, so object space is screen space.
          x={editingObj.x}
          y={editingObj.y}
          scale={1}
          color={editingObj.color}
          fontSize={editingObj.fontSize}
          wrapWidth={editingObj.width}
          value={editingObj.text}
          onChange={(t) => ann.updateText(editingObj.id, t)}
          onCommit={commitText}
        />
      )}
    </div>
  );
}
