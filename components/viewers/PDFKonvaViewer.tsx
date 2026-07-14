'use client';

import { useState, useEffect, useRef, useCallback, useImperativeHandle, type Ref } from 'react';
import { Stage, Layer, Image as KonvaImage, Text, Circle, Group } from 'react-konva';
import type Konva from 'konva';
import { pdfjs } from 'react-pdf';
import type { Comment } from '@/lib/types';
import { useAnnotationObjects, type AnnTool } from '@/components/markup/useAnnotationObjects';
import AnnotationObjects from '@/components/markup/AnnotationObjects';

type ToolType = 'pointer' | 'comment' | 'freehand' | 'line' | 'arrow' | 'rect' | 'text' | 'eraser';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export interface PDFKonvaViewerHandle {
  captureSnapshot: () => string | null;
  getCurrentPage: () => number;
  clearDrawings: () => void;
  hasObjects: () => boolean;
}

interface PDFKonvaViewerProps {
  url: string;
  fileId: string;
  activeTool: ToolType;
  color: string;
  strokeWidth: number;
  onCommentPlace: (x: number, y: number, pageNumber: number) => void;
  tagging?: boolean;
  annotating?: boolean;
  comments: Comment[];
  activeCommentId: string | null;
  onCommentPinClick: (comment: Comment) => void;
  // Imperative handle passed as a prop (next/dynamic drops `ref`, so we cannot use forwardRef here)
  handleRef?: Ref<PDFKonvaViewerHandle>;
  // Id of the not-yet-posted tag being placed, rendered as a distinct preview pin
  pendingCommentId?: string | null;
}

function PDFKonvaViewer(
    { url, activeTool, color, strokeWidth, onCommentPlace, tagging = false, annotating = false, comments, activeCommentId, onCommentPinClick, handleRef, pendingCommentId }: PDFKonvaViewerProps
  ) {
    // PDF state
    const [pdfDoc, setPdfDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
    const [pageImage, setPageImage] = useState<HTMLImageElement | null>(null);
    const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
    const [numPages, setNumPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [loading, setLoading] = useState(true);

    // Container sizing
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

    // Konva stage
    const stageRef = useRef<Konva.Stage>(null);
    const [stageScale, setStageScale] = useState(1);
    const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

    // Shared Konva annotation object model (select/move/scale/rotate/erase)
    const ann = useAnnotationObjects();

    // Selection-vs-tool contract: clear the selection when the active tool changes to a
    // non-pointer tool, so Transformer handles don't linger over a previously selected object
    // while a draw/eraser tool is active.
    useEffect(() => {
      if (activeTool !== 'pointer') ann.setSelectedId(null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTool]);

    // Ref handle (attached to the `handleRef` prop, not React `ref` — see note on props)
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
      getCurrentPage: () => currentPage,
      clearDrawings: () => ann.clear(),
      hasObjects: () => ann.hasObjects(),
    }));

    // Load PDF document
    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      const loadDoc = async () => {
        try {
          const doc = await pdfjs.getDocument(url).promise;
          if (cancelled) return;
          setPdfDoc(doc);
          setNumPages(doc.numPages);
        } catch (err) {
          console.error('Failed to load PDF:', err);
        }
      };
      loadDoc();
      return () => { cancelled = true; };
    }, [url]);

    // Render current page to image
    useEffect(() => {
      if (!pdfDoc) return;
      let cancelled = false;
      setLoading(true);

      const renderPage = async () => {
        try {
          const page = await pdfDoc.getPage(currentPage);
          const viewport = page.getViewport({ scale: 2 });

          const offscreen = document.createElement('canvas');
          offscreen.width = viewport.width;
          offscreen.height = viewport.height;
          const ctx = offscreen.getContext('2d')!;

          await page.render({ canvasContext: ctx, viewport, canvas: offscreen } as never).promise;
          if (cancelled) return;

          const img = new window.Image();
          img.src = offscreen.toDataURL();
          img.onload = () => {
            if (cancelled) return;
            setPageImage(img);
            setPageSize({ width: viewport.width, height: viewport.height });
            setLoading(false);
          };
        } catch (err) {
          console.error('Failed to render page:', err);
          if (!cancelled) setLoading(false);
        }
      };
      renderPage();
      return () => { cancelled = true; };
    }, [pdfDoc, currentPage]);

    // Fit page to container when page or container changes
    useEffect(() => {
      if (!pageSize.width || !pageSize.height || !containerSize.width || !containerSize.height) return;
      const scaleX = containerSize.width / pageSize.width;
      const scaleY = containerSize.height / pageSize.height;
      const fitScale = Math.min(scaleX, scaleY, 1);
      setStageScale(fitScale);
      setStagePos({
        x: (containerSize.width - pageSize.width * fitScale) / 2,
        y: (containerSize.height - pageSize.height * fitScale) / 2,
      });
    }, [pageSize, containerSize]);

    // Container resize observer
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const observer = new ResizeObserver(([entry]) => {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      });
      observer.observe(container);
      return () => observer.disconnect();
    }, []);

    // Coordinate helpers
    const getPageCoords = useCallback((stage: Konva.Stage): { x: number; y: number } | null => {
      const pointer = stage.getPointerPosition();
      if (!pointer) return null;
      return {
        x: (pointer.x - stagePos.x) / stageScale,
        y: (pointer.y - stagePos.y) / stageScale,
      };
    }, [stagePos, stageScale]);

    const toPercent = useCallback((px: number, py: number) => ({
      x: (px / pageSize.width) * 100,
      y: (py / pageSize.height) * 100,
    }), [pageSize]);

    const fromPercent = useCallback((xPct: number, yPct: number) => ({
      x: (xPct / 100) * pageSize.width,
      y: (yPct / 100) * pageSize.height,
    }), [pageSize]);

    // Text tool popup (page-space point for the object + raw screen point for positioning the input)
    const [textPopup, setTextPopup] = useState<{ px: number; py: number; sx: number; sy: number } | null>(null);
    const [textInput, setTextInput] = useState('');

    const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      if (!stage) return;
      const coords = getPageCoords(stage);
      if (!coords) return;

      if (tagging) { const pct = toPercent(coords.x, coords.y); onCommentPlace(pct.x, pct.y, currentPage); return; }

      if (!annotating) return; // live view: pointer pans (handled by Stage draggable)

      if (activeTool === 'text') {
        const ptr = stage.getPointerPosition();
        setTextPopup({ px: coords.x, py: coords.y, sx: ptr?.x ?? 0, sy: ptr?.y ?? 0 });
        setTextInput('');
        return;
      }
      if (activeTool === 'pointer') { if (e.target === stage) ann.setSelectedId(null); return; }
      if (activeTool === 'eraser') return;
      ann.startDraw(activeTool as AnnTool, coords, color, strokeWidth);
    }, [tagging, annotating, activeTool, getPageCoords, toPercent, onCommentPlace, currentPage, color, strokeWidth, ann]);

    const handleStageMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!annotating) return;
      const stage = e.target.getStage();
      if (!stage) return;
      const coords = getPageCoords(stage);
      if (coords) ann.moveDraw(activeTool as AnnTool, coords);
    }, [annotating, activeTool, getPageCoords, ann]);

    const submitText = useCallback(() => {
      if (textPopup && textInput.trim()) ann.addText({ x: textPopup.px, y: textPopup.py }, textInput, color, strokeWidth);
      setTextPopup(null); setTextInput('');
    }, [textPopup, textInput, color, strokeWidth, ann]);

    // Wheel zoom
    const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = e.target.getStage();
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const oldScale = stageScale;
      const direction = e.evt.deltaY > 0 ? -1 : 1;
      const newScale = Math.max(0.25, Math.min(5, oldScale * (1 + direction * 0.1)));

      const mousePointTo = {
        x: (pointer.x - stagePos.x) / oldScale,
        y: (pointer.y - stagePos.y) / oldScale,
      };

      setStageScale(newScale);
      setStagePos({
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      });
    }, [stageScale, stagePos]);

    // Zoom controls
    const adjustZoom = useCallback((delta: number) => {
      const newScale = Math.max(0.25, Math.min(5, stageScale + delta));
      const centerX = containerSize.width / 2;
      const centerY = containerSize.height / 2;
      const mousePointTo = {
        x: (centerX - stagePos.x) / stageScale,
        y: (centerY - stagePos.y) / stageScale,
      };
      setStageScale(newScale);
      setStagePos({
        x: centerX - mousePointTo.x * newScale,
        y: centerY - mousePointTo.y * newScale,
      });
    }, [stageScale, stagePos, containerSize]);

    const resetZoom = useCallback(() => {
      if (!pageSize.width || !pageSize.height || !containerSize.width || !containerSize.height) return;
      const scaleX = containerSize.width / pageSize.width;
      const scaleY = containerSize.height / pageSize.height;
      const fitScale = Math.min(scaleX, scaleY, 1);
      setStageScale(fitScale);
      setStagePos({
        x: (containerSize.width - pageSize.width * fitScale) / 2,
        y: (containerSize.height - pageSize.height * fitScale) / 2,
      });
    }, [pageSize, containerSize]);

    // Comment pins for current page
    const pageComments = comments.filter(c =>
      c.pageNumber === currentPage && c.xPosition !== null && c.yPosition !== null
    );

    const cursorStyle = tagging ? 'crosshair' : (annotating && activeTool !== 'pointer' && activeTool !== 'eraser') ? 'crosshair' : annotating && activeTool === 'eraser' ? 'not-allowed' : activeTool === 'pointer' && !annotating ? 'grab' : 'default';

    return (
      <div className="flex h-full w-full flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-white border-b border-gray-200 flex-shrink-0">
          {/* Page navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1 || annotating}
              className="rounded px-2 py-0.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm text-gray-600 min-w-[60px] text-center">
              {currentPage} / {numPages || '...'}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
              disabled={currentPage >= numPages || annotating}
              className="rounded px-2 py-0.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => adjustZoom(-0.25)}
              className="rounded px-2 py-0.5 text-sm text-gray-700 hover:bg-gray-100"
            >
              −
            </button>
            <span className="text-sm text-gray-600 min-w-[50px] text-center">
              {Math.round(stageScale * 100)}%
            </span>
            <button
              onClick={() => adjustZoom(0.25)}
              className="rounded px-2 py-0.5 text-sm text-gray-700 hover:bg-gray-100"
            >
              +
            </button>
            <button
              onClick={resetZoom}
              className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 ml-1"
            >
              Fit
            </button>
          </div>
        </div>

        {/* Canvas container */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden bg-gray-100 relative"
          style={{ cursor: cursorStyle }}
        >
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
            </div>
          )}

          {containerSize.width > 0 && containerSize.height > 0 && (
            <Stage
              ref={stageRef}
              width={containerSize.width}
              height={containerSize.height}
              scaleX={stageScale}
              scaleY={stageScale}
              x={stagePos.x}
              y={stagePos.y}
              draggable={activeTool === 'pointer' && !annotating && !tagging}
              onWheel={handleWheel}
              onMouseDown={handleStageMouseDown}
              onMouseMove={handleStageMouseMove}
              onMouseUp={() => ann.endDraw()}
              onMouseLeave={() => ann.endDraw()}
            >
              {/* PDF Background */}
              <Layer>
                {pageImage && (
                  <KonvaImage image={pageImage} width={pageSize.width} height={pageSize.height} listening={false} />
                )}
              </Layer>

              {/* Annotations (shared Konva objects) */}
              <Layer>
                <AnnotationObjects
                  objects={ann.objects}
                  draft={ann.draft}
                  selectedId={ann.selectedId}
                  activeTool={activeTool as AnnTool}
                  onSelect={ann.setSelectedId}
                  onErase={ann.deleteObject}
                  onChange={ann.updateObject}
                />
              </Layer>

              {/* Comment Pins */}
              <Layer>
                {pageComments.map((comment, idx) => {
                  const pos = fromPercent(comment.xPosition!, comment.yPosition!);
                  const isActive = activeCommentId === comment.id;
                  const isPending = comment.id === pendingCommentId;
                  const pinRadius = 12 / stageScale;
                  const fontSize = 10 / stageScale;
                  if (isPending) {
                    return (
                      <Group key={comment.id} x={pos.x} y={pos.y} listening={false}>
                        <Circle radius={pinRadius * 1.7} fill="#3b82f6" opacity={0.25} />
                        <Circle
                          radius={pinRadius}
                          fill="#2563eb"
                          stroke="white"
                          strokeWidth={2 / stageScale}
                          shadowColor="black"
                          shadowBlur={4 / stageScale}
                          shadowOpacity={0.3}
                        />
                      </Group>
                    );
                  }
                  return (
                    <Group
                      key={comment.id}
                      x={pos.x}
                      y={pos.y}
                      onClick={() => onCommentPinClick(comment)}
                      onTap={() => onCommentPinClick(comment)}
                    >
                      <Circle
                        radius={pinRadius}
                        fill={isActive ? '#2563eb' : '#6b7280'}
                        stroke="white"
                        strokeWidth={2 / stageScale}
                        shadowColor="black"
                        shadowBlur={4 / stageScale}
                        shadowOpacity={0.3}
                      />
                      <Text
                        text={String(idx + 1)}
                        fontSize={fontSize}
                        fill="white"
                        fontStyle="bold"
                        width={pinRadius * 2}
                        height={pinRadius * 2}
                        offsetX={pinRadius}
                        offsetY={pinRadius}
                        align="center"
                        verticalAlign="middle"
                        listening={false}
                      />
                    </Group>
                  );
                })}
              </Layer>
            </Stage>
          )}

          {/* Text tool input popup */}
          {textPopup && (
            <div
              className="absolute z-30 bg-white rounded-lg shadow-lg border border-gray-200 p-2"
              style={{ left: Math.min(textPopup.sx, containerSize.width - 200), top: Math.min(textPopup.sy, containerSize.height - 80) }}
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
      </div>
    );
}

export default PDFKonvaViewer;
