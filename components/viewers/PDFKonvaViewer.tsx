'use client';

import { useState, useEffect, useRef, useCallback, useImperativeHandle, type Ref } from 'react';
import { Stage, Layer, Rect, Image as KonvaImage, Text, Circle, Group } from 'react-konva';
import type Konva from 'konva';
import { pdfjs } from 'react-pdf';
import type { Comment } from '@/lib/types';
import { buildTagNumbers } from '@/lib/tagNumbers';
import { useAnnotationObjects, type AnnTool, type MarkupSelection, type ToolType } from '@/components/markup/useAnnotationObjects';
import AnnotationObjects from '@/components/markup/AnnotationObjects';
import CanvasTextEditor from '@/components/markup/CanvasTextEditor';
import { fontSizeForStrokeWidth, wrapWidthForContent, isBlank } from '@/lib/markup/text';
import { paletteForComment } from '@/lib/commentColors';
import { ERASER_CURSOR } from '@/lib/cursors';
import { matteRectForStage, PDF_MATTE } from '@/lib/markup/matte';
import { sweepPoints } from '@/lib/markup/eraseSweep';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export interface PDFKonvaViewerHandle {
  captureSnapshot: () => string | null;
  getCurrentPage: () => number;
  clearDrawings: () => void;
  hasObjects: () => boolean;
  insertImage: (file: File) => void;
  applyStyleToSelection: (patch: { color?: string; strokeWidth?: number }) => void;
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
  onObjectCreated?: () => void;
  onSelectionChange?: (selection: MarkupSelection | null) => void;
  /**
   * Fired ONCE, when the first page has rendered or the document failed to
   * load. Deliberately not re-fired on page changes: the viewport's loading
   * indicator means "this file is not on screen yet", and paging through a
   * document that is already open is not that.
   */
  onReady?: () => void;
}

function PDFKonvaViewer(
    { url, activeTool, color, strokeWidth, onCommentPlace, tagging = false, annotating = false, comments, activeCommentId, onCommentPinClick, handleRef, pendingCommentId, onObjectCreated, onSelectionChange, onReady }: PDFKonvaViewerProps
  ) {
    // PDF state
    const [pdfDoc, setPdfDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
    const [pageImage, setPageImage] = useState<HTMLImageElement | null>(null);
    const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
    const [numPages, setNumPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [loading, setLoading] = useState(true);
    // onReady is a one-shot, and announceReady must be stable: the effects that
    // call it also load the document and render the page, so anything that
    // changed its identity would re-run those. Holding the callback in a ref
    // keeps the dependency list honest instead of silenced — a caller that
    // passes an inline arrow cannot make this refetch the PDF every render.
    const readyFired = useRef(false);
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const announceReady = useCallback(() => {
      if (readyFired.current) return;
      readyFired.current = true;
      onReadyRef.current?.();
    }, []);

    // Container sizing
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

    // Konva stage
    const stageRef = useRef<Konva.Stage>(null);
    const [stageScale, setStageScale] = useState(1);
    const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

    // Shared Konva annotation object model (select/move/scale/rotate/erase)
    const ann = useAnnotationObjects();
    // The text object currently open for editing. The object itself already exists in `ann` —
    // this is only which one the editor is bound to.
    const [editingId, setEditingId] = useState<string | null>(null);

    // Eraser drag state. Refs, not state: this changes on every pointer move and nothing
    // renders from it.
    const erasingRef = useRef(false);
    const lastErasePointRef = useRef<{ x: number; y: number } | null>(null);

    /**
     * Delete whatever object is under `p`. NOTE: container coordinates, not page coordinates
     * — getIntersection walks the stage's hit graph, which already accounts for the zoom and
     * pan that getPageCoords otherwise divides out.
     */
    const eraseAt = useCallback((stage: Konva.Stage, p: { x: number; y: number }) => {
      const id = stage.getIntersection(p)?.id();
      if (id) ann.deleteObject(id);
    }, [ann]);

    const stopErasing = useCallback(() => {
      erasingRef.current = false;
      lastErasePointRef.current = null;
    }, []);

    // Selection-vs-tool contract: clear the selection when the active tool changes to a
    // non-pointer tool, so Transformer handles don't linger over a previously selected object
    // while a draw/eraser tool is active.
    useEffect(() => {
      if (activeTool !== 'pointer') ann.setSelectedId(null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTool]);

    // Delete/Backspace removes the selected annotation object during a session (not while typing).
    useEffect(() => {
      if (!annotating) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        const el = document.activeElement as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        if (ann.selectedId) { e.preventDefault(); ann.deleteObject(ann.selectedId); }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [annotating, ann.selectedId, ann.deleteObject]);

    // Depend on the FIELDS, never on `sel` itself: `selectedObject` is derived with `find`, so it
    // is a fresh object every render. Depending on its identity would fire this effect on every
    // render, push state up to the portal page, and re-render forever.
    //
    // The same loop exists from the other end: `onSelectionChange` is in this dependency array,
    // so the caller MUST pass a `useCallback`-stable reference. An inline arrow function there
    // re-subscribes this effect on every render and reintroduces exactly the same cycle.
    const sel = ann.selectedObject;
    const selType = sel?.type ?? null;
    const selColor = sel?.color ?? null;
    const selStroke = sel?.strokeWidth ?? null;
    useEffect(() => {
      onSelectionChange?.(
        selType !== null && selColor !== null && selStroke !== null
          ? { type: selType, color: selColor, strokeWidth: selStroke }
          : null
      );
    }, [selType, selColor, selStroke, onSelectionChange]);

    // Ref handle (attached to the `handleRef` prop, not React `ref` — see note on props)
    useImperativeHandle(handleRef, () => ({
      captureSnapshot: () => {
        const stage = stageRef.current;
        if (!stage) return null;
        // See Task 10 Step 5: the edited object's node is hidden, and setEditingId is a state
        // update that will not have applied by the time toDataURL runs below.
        if (editingId) (stage.findOne(`#${editingId}`) as Konva.Node | undefined)?.visible(true);
        setEditingId(null);
        stage.find('Transformer').forEach((t) => (t as Konva.Transformer).nodes([]));
        stage.draw();
        const url = stage.toDataURL({ pixelRatio: 2, mimeType: 'image/jpeg', quality: 0.88 });
        ann.setSelectedId(null);
        return url;
      },
      getCurrentPage: () => currentPage,
      clearDrawings: () => { setEditingId(null); ann.clear(); },
      hasObjects: () => ann.hasObjects(),
      insertImage: (file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
          const src = reader.result as string;
          const im = new window.Image();
          im.onload = () => {
            const maxW = pageSize.width * 0.5;
            const maxH = pageSize.height * 0.5;
            const scale = Math.min(maxW / im.width, maxH / im.height, 1);
            const w = im.width * scale;
            const h = im.height * scale;
            ann.addImage({ x: (pageSize.width - w) / 2, y: (pageSize.height - h) / 2 }, src, w, h);
          };
          im.src = src;
        };
        reader.readAsDataURL(file);
      },
      applyStyleToSelection: (patch) => {
        if (ann.selectedId) ann.applyStyle(ann.selectedId, patch);
      },
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
          // Without this the document-level failure left `loading` true for
          // ever: the spinner spun on a PDF that was never going to arrive, and
          // nothing downstream could tell the difference between "still coming"
          // and "gave up".
          if (!cancelled) {
            setLoading(false);
            announceReady();
          }
        }
      };
      loadDoc();
      return () => { cancelled = true; };
    }, [url, announceReady]);

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
            announceReady();
          };
        } catch (err) {
          console.error('Failed to render page:', err);
          if (!cancelled) {
            setLoading(false);
            announceReady();
          }
        }
      };
      renderPage();
      return () => { cancelled = true; };
    }, [pdfDoc, currentPage, announceReady]);

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

    const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      if (!stage) return;
      const coords = getPageCoords(stage);
      if (!coords) return;

      if (tagging) { const pct = toPercent(coords.x, coords.y); onCommentPlace(pct.x, pct.y, currentPage); return; }

      if (!annotating) return; // live view: pointer pans (handled by Stage draggable)

      if (activeTool === 'text') {
        const wrapWidth = wrapWidthForContent(pageSize.width);
        const x = Math.max(0, Math.min(coords.x, pageSize.width - wrapWidth));
        const id = ann.addText({ x, y: coords.y }, {
          text: '',
          color,
          fontSize: fontSizeForStrokeWidth(strokeWidth),
          // The page's own width, not the stage's: the stage width changes with the zoom, and a
          // zoom-dependent wrap would reflow committed text on every scroll.
          width: wrapWidth,
        });
        setEditingId(id);
        onObjectCreated?.();
        return;
      }
      if (activeTool === 'pointer') { if (e.target === stage) ann.setSelectedId(null); return; }
      if (activeTool === 'eraser') {
        const p = stage.getPointerPosition();
        if (!p) return;
        erasingRef.current = true;
        lastErasePointRef.current = p;
        eraseAt(stage, p);
        return;
      }
      ann.startDraw(activeTool as AnnTool, coords, color, strokeWidth);
    }, [tagging, annotating, activeTool, getPageCoords, toPercent, onCommentPlace, currentPage, color, strokeWidth, ann, pageSize.width, onObjectCreated, eraseAt]);

    const handleStageMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!annotating) return;
      const stage = e.target.getStage();
      if (!stage) return;
      if (activeTool === 'eraser') {
        // A mouseup this stage never received — focus lost mid-press (Cmd-Tab, Mission
        // Control, an OS dialog) and the button released elsewhere — leaves erasingRef armed
        // forever, since onMouseUp/onMouseLeave are the only other places that clear it.
        // buttons === 0 means the press has already ended, so disarm before it turns
        // ordinary mouse movement into silent deletion.
        if (e.evt.buttons === 0) { stopErasing(); return; }
        if (!erasingRef.current) return;
        const p = stage.getPointerPosition();
        if (!p) return;
        for (const pt of sweepPoints(lastErasePointRef.current, p)) eraseAt(stage, pt);
        lastErasePointRef.current = p;
        return;
      }
      const coords = getPageCoords(stage);
      if (coords) ann.moveDraw(activeTool as AnnTool, coords, e.evt.shiftKey);
    }, [annotating, activeTool, getPageCoords, ann, eraseAt, stopErasing]);

    const editingObj = editingId ? ann.objects.find((o) => o.id === editingId) ?? null : null;

    const commitText = useCallback(() => {
      const obj = editingId ? ann.objects.find((o) => o.id === editingId) : null;
      if (obj && isBlank(obj.text)) ann.deleteObject(obj.id);
      setEditingId(null);
    }, [editingId, ann]);

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
    // File-wide tag numbers so a pin's number matches the comment list across all pages.
    const tagNumbers = buildTagNumbers(comments);

    const cursorStyle = tagging ? 'crosshair' : (annotating && activeTool !== 'pointer' && activeTool !== 'eraser') ? 'crosshair' : annotating && activeTool === 'eraser' ? ERASER_CURSOR : activeTool === 'pointer' && !annotating ? 'grab' : 'default';

    // The zoom and pan live on the Stage, so every layer inherits them — the fill has to be
    // expressed in page space or it scrolls away from the viewport with the page.
    const matte = matteRectForStage({ stagePos, stageScale, containerSize });

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
              onMouseUp={() => { stopErasing(); if (ann.endDraw()) onObjectCreated?.(); }}
              onMouseLeave={() => { stopErasing(); if (ann.endDraw()) onObjectCreated?.(); }}
            >
              {/* PDF Background */}
              <Layer>
                <Rect x={matte.x} y={matte.y} width={matte.width} height={matte.height} fill={PDF_MATTE} listening={false} />
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
                  editingId={editingId}
                  onEditText={setEditingId}
                  onBakeText={ann.bakeTextTransform}
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
                  const pal = paletteForComment(comment);
                  if (isPending) {
                    return (
                      <Group key={comment.id} x={pos.x} y={pos.y} listening={false}>
                        <Circle radius={pinRadius * 1.7} fill={pal.accent} opacity={0.25} />
                        <Circle
                          radius={pinRadius}
                          fill={pal.swatch}
                          stroke="#fff"
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
                        fill={pal.swatch}
                        stroke={isActive ? pal.accent : '#fff'}
                        strokeWidth={2 / stageScale}
                        shadowColor="black"
                        shadowBlur={4 / stageScale}
                        shadowOpacity={0.3}
                      />
                      <Text
                        text={String(tagNumbers.get(comment.id) ?? idx + 1)}
                        fontSize={fontSize}
                        fill={pal.dark}
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

          {editingObj && (
            <CanvasTextEditor
              // Keyed by the object — see the note on the same line in AnnotationCanvas. The
              // exposed path is CREATE, not re-edit: React 18 batches the commit of the open
              // editor and the creation of the new object into one task, so `editingId` can
              // jump between ids with no null render in between.
              key={editingObj.id}
              // Page space -> screen space. The Stage carries the zoom and the pan, so the
              // overlay has to apply them by hand to sit on top of the node it stands in for.
              x={editingObj.x * stageScale + stagePos.x}
              y={editingObj.y * stageScale + stagePos.y}
              scale={stageScale}
              color={editingObj.color}
              fontSize={editingObj.fontSize}
              wrapWidth={editingObj.width}
              value={editingObj.text}
              onChange={(t) => ann.updateText(editingObj.id, t)}
              onCommit={commitText}
            />
          )}
        </div>
      </div>
    );
}

export default PDFKonvaViewer;
