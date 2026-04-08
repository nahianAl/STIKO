'use client';

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Arrow, Rect, Text, Circle, Group } from 'react-konva';
import type Konva from 'konva';
import { pdfjs } from 'react-pdf';
import type { Comment, Markup } from '@/lib/types';

type ToolType = 'pointer' | 'comment' | 'freehand' | 'line' | 'arrow' | 'rect' | 'text';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export interface PDFKonvaViewerHandle {
  captureSnapshot: () => string | null;
  getCurrentPage: () => number;
}

interface PDFKonvaViewerProps {
  url: string;
  fileId: string;
  activeTool: ToolType;
  color: string;
  strokeWidth: number;
  onCommentPlace: (x: number, y: number, pageNumber: number) => void;
  comments: Comment[];
  activeCommentId: string | null;
  onCommentPinClick: (comment: Comment) => void;
}

interface DrawingState {
  isDrawing: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  points: number[]; // flat [x1, y1, x2, y2, ...] in page-space pixels
}

const PDFKonvaViewer = forwardRef<PDFKonvaViewerHandle, PDFKonvaViewerProps>(
  function PDFKonvaViewer(
    { url, fileId, activeTool, color, strokeWidth, onCommentPlace, comments, activeCommentId, onCommentPinClick },
    ref
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

    // Drawing state
    const [drawing, setDrawing] = useState<DrawingState>({
      isDrawing: false,
      startX: 0, startY: 0,
      currentX: 0, currentY: 0,
      points: [],
    });

    // Stored markups for current page
    const [markups, setMarkups] = useState<Markup[]>([]);

    // Text tool popup
    const [textPopup, setTextPopup] = useState<{ x: number; y: number; screenX: number; screenY: number } | null>(null);
    const [textInput, setTextInput] = useState('');

    // Ref handle
    useImperativeHandle(ref, () => ({
      captureSnapshot: () => {
        const stage = stageRef.current;
        if (!stage) return null;
        return stage.toDataURL({ pixelRatio: 1, mimeType: 'image/jpeg', quality: 0.88 });
      },
      getCurrentPage: () => currentPage,
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

    // Fetch markups for current page
    const fetchMarkups = useCallback(async () => {
      if (!fileId) return;
      try {
        const res = await fetch(`/api/markups?fileId=${fileId}&pageNumber=${currentPage}`);
        if (res.ok) setMarkups(await res.json());
      } catch (err) {
        console.error('Failed to fetch markups:', err);
      }
    }, [fileId, currentPage]);

    useEffect(() => {
      fetchMarkups();
    }, [fetchMarkups]);

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

    // Save markup
    const saveMarkup = useCallback(async (type: Markup['type'], data: unknown) => {
      try {
        await fetch('/api/markups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileId,
            type,
            data,
            style: { color, strokeWidth },
            pageNumber: currentPage,
          }),
        });
        await fetchMarkups();
      } catch (err) {
        console.error('Failed to save markup:', err);
      }
    }, [fileId, color, strokeWidth, currentPage, fetchMarkups]);

    // Text submit
    const handleTextSubmit = useCallback(() => {
      if (!textPopup || !textInput.trim()) {
        setTextPopup(null);
        setTextInput('');
        return;
      }
      const pct = toPercent(textPopup.x, textPopup.y);
      saveMarkup('text', { x: pct.x, y: pct.y, text: textInput.trim() });
      setTextPopup(null);
      setTextInput('');
    }, [textPopup, textInput, toPercent, saveMarkup]);

    // Mouse handlers
    const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
      if (activeTool === 'pointer') return;
      const stage = e.target.getStage();
      if (!stage) return;
      const coords = getPageCoords(stage);
      if (!coords) return;

      if (activeTool === 'comment') {
        const pct = toPercent(coords.x, coords.y);
        onCommentPlace(pct.x, pct.y, currentPage);
        return;
      }

      if (activeTool === 'text') {
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        setTextPopup({ x: coords.x, y: coords.y, screenX: pointer.x, screenY: pointer.y });
        setTextInput('');
        return;
      }

      setDrawing({
        isDrawing: true,
        startX: coords.x,
        startY: coords.y,
        currentX: coords.x,
        currentY: coords.y,
        points: [coords.x, coords.y],
      });
    }, [activeTool, getPageCoords, toPercent, onCommentPlace, currentPage]);

    const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!drawing.isDrawing) return;
      const stage = e.target.getStage();
      if (!stage) return;
      const coords = getPageCoords(stage);
      if (!coords) return;

      setDrawing(prev => ({
        ...prev,
        currentX: coords.x,
        currentY: coords.y,
        points: activeTool === 'freehand'
          ? [...prev.points, coords.x, coords.y]
          : prev.points,
      }));
    }, [drawing.isDrawing, getPageCoords, activeTool]);

    const handleMouseUp = useCallback(() => {
      if (!drawing.isDrawing) return;
      const { startX, startY, currentX, currentY, points } = drawing;

      switch (activeTool) {
        case 'freehand':
          if (points.length > 2) {
            // Convert flat points to percent array
            const pctPoints: { x: number; y: number }[] = [];
            for (let i = 0; i < points.length; i += 2) {
              pctPoints.push(toPercent(points[i], points[i + 1]));
            }
            saveMarkup('freehand', { points: pctPoints });
          }
          break;
        case 'line': {
          const p1 = toPercent(startX, startY);
          const p2 = toPercent(currentX, currentY);
          saveMarkup('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
          break;
        }
        case 'arrow': {
          const a1 = toPercent(startX, startY);
          const a2 = toPercent(currentX, currentY);
          saveMarkup('arrow', { x1: a1.x, y1: a1.y, x2: a2.x, y2: a2.y });
          break;
        }
        case 'rect': {
          const rx = Math.min(startX, currentX);
          const ry = Math.min(startY, currentY);
          const rw = Math.abs(currentX - startX);
          const rh = Math.abs(currentY - startY);
          if (rw > 2 && rh > 2) {
            const rp1 = toPercent(rx, ry);
            const rp2 = toPercent(rx + rw, ry + rh);
            saveMarkup('rect', {
              x: rp1.x, y: rp1.y,
              width: rp2.x - rp1.x, height: rp2.y - rp1.y,
            });
          }
          break;
        }
      }

      setDrawing({
        isDrawing: false,
        startX: 0, startY: 0,
        currentX: 0, currentY: 0,
        points: [],
      });
    }, [drawing, activeTool, toPercent, saveMarkup]);

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

    // Render stored markup as Konva elements
    const renderStoredMarkup = (markup: Markup) => {
      const { type, data, style: mStyle, id } = markup;
      const sw = (mStyle.strokeWidth || 4) / stageScale;

      switch (type) {
        case 'freehand': {
          const pts = data.points as { x: number; y: number }[];
          if (!pts || pts.length < 2) return null;
          const flatPts = pts.flatMap(p => {
            const px = fromPercent(p.x, p.y);
            return [px.x, px.y];
          });
          return (
            <Line
              key={id}
              points={flatPts}
              stroke={mStyle.color}
              strokeWidth={sw}
              lineCap="round"
              lineJoin="round"
              tension={0.5}
              listening={false}
            />
          );
        }
        case 'line': {
          const p1 = fromPercent(data.x1 as number, data.y1 as number);
          const p2 = fromPercent(data.x2 as number, data.y2 as number);
          return (
            <Line
              key={id}
              points={[p1.x, p1.y, p2.x, p2.y]}
              stroke={mStyle.color}
              strokeWidth={sw}
              lineCap="round"
              listening={false}
            />
          );
        }
        case 'arrow': {
          const a1 = fromPercent(data.x1 as number, data.y1 as number);
          const a2 = fromPercent(data.x2 as number, data.y2 as number);
          return (
            <Arrow
              key={id}
              points={[a1.x, a1.y, a2.x, a2.y]}
              stroke={mStyle.color}
              fill={mStyle.color}
              strokeWidth={sw}
              pointerLength={10 / stageScale}
              pointerWidth={8 / stageScale}
              listening={false}
            />
          );
        }
        case 'rect': {
          const rp = fromPercent(data.x as number, data.y as number);
          const rp2 = fromPercent(
            (data.x as number) + (data.width as number),
            (data.y as number) + (data.height as number)
          );
          return (
            <Rect
              key={id}
              x={rp.x}
              y={rp.y}
              width={rp2.x - rp.x}
              height={rp2.y - rp.y}
              stroke={mStyle.color}
              strokeWidth={sw}
              listening={false}
            />
          );
        }
        case 'text': {
          const tp = fromPercent(data.x as number, data.y as number);
          return (
            <Text
              key={id}
              x={tp.x}
              y={tp.y}
              text={data.text as string}
              fill={mStyle.color}
              fontSize={(mStyle.strokeWidth * 4) / stageScale}
              fontFamily="sans-serif"
              fontStyle="bold"
              listening={false}
            />
          );
        }
        default:
          return null;
      }
    };

    // Render drawing preview
    const renderPreview = () => {
      if (!drawing.isDrawing) return null;
      const { startX, startY, currentX, currentY, points } = drawing;
      const sw = strokeWidth / stageScale;

      switch (activeTool) {
        case 'freehand':
          return (
            <Line
              points={points}
              stroke={color}
              strokeWidth={sw}
              lineCap="round"
              lineJoin="round"
              tension={0.5}
              listening={false}
            />
          );
        case 'line':
          return (
            <Line
              points={[startX, startY, currentX, currentY]}
              stroke={color}
              strokeWidth={sw}
              lineCap="round"
              listening={false}
            />
          );
        case 'arrow':
          return (
            <Arrow
              points={[startX, startY, currentX, currentY]}
              stroke={color}
              fill={color}
              strokeWidth={sw}
              pointerLength={10 / stageScale}
              pointerWidth={8 / stageScale}
              listening={false}
            />
          );
        case 'rect':
          return (
            <Rect
              x={Math.min(startX, currentX)}
              y={Math.min(startY, currentY)}
              width={Math.abs(currentX - startX)}
              height={Math.abs(currentY - startY)}
              stroke={color}
              strokeWidth={sw}
              listening={false}
            />
          );
        default:
          return null;
      }
    };

    // Comment pins for current page
    const pageComments = comments.filter(c =>
      c.pageNumber === currentPage && c.xPosition !== null && c.yPosition !== null
    );

    const isInteractive = activeTool !== 'pointer';
    const cursorStyle = activeTool === 'pointer'
      ? 'grab'
      : activeTool === 'comment'
        ? 'crosshair'
        : 'crosshair';

    return (
      <div className="flex h-full w-full flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-white border-b border-gray-200 flex-shrink-0">
          {/* Page navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
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
              disabled={currentPage >= numPages}
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
              draggable={activeTool === 'pointer'}
              onWheel={handleWheel}
              onMouseDown={isInteractive ? handleMouseDown : undefined}
              onMouseMove={isInteractive ? handleMouseMove : undefined}
              onMouseUp={isInteractive ? handleMouseUp : undefined}
              onMouseLeave={isInteractive ? handleMouseUp : undefined}
            >
              {/* PDF Background */}
              <Layer>
                {pageImage && (
                  <KonvaImage image={pageImage} width={pageSize.width} height={pageSize.height} listening={false} />
                )}
              </Layer>

              {/* Stored Annotations */}
              <Layer>
                {markups.map(m => renderStoredMarkup(m))}
              </Layer>

              {/* Drawing Preview */}
              <Layer>
                {renderPreview()}
              </Layer>

              {/* Comment Pins */}
              <Layer>
                {pageComments.map((comment, idx) => {
                  const pos = fromPercent(comment.xPosition!, comment.yPosition!);
                  const isActive = activeCommentId === comment.id;
                  const pinRadius = 12 / stageScale;
                  const fontSize = 10 / stageScale;
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
              style={{
                left: Math.min(textPopup.screenX, containerSize.width - 200),
                top: Math.min(textPopup.screenY, containerSize.height - 80),
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <input
                type="text"
                autoFocus
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Type text..."
                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                style={{ minWidth: 150 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleTextSubmit();
                  }
                  if (e.key === 'Escape') {
                    setTextPopup(null);
                    setTextInput('');
                  }
                }}
              />
              <div className="flex justify-end gap-1.5 mt-1.5">
                <button
                  onClick={() => { setTextPopup(null); setTextInput(''); }}
                  className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleTextSubmit}
                  disabled={!textInput.trim()}
                  className="px-2.5 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);

export default PDFKonvaViewer;
