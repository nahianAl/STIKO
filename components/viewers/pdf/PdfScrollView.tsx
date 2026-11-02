'use client';

import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Comment } from '@/lib/types';
import CommentPin from '@/components/markup/CommentPin';
import { paletteForComment } from '@/lib/commentColors';
import { buildTagNumbers } from '@/lib/tagNumbers';
import {
  anchoredScroll,
  clampZoom,
  fitWidthScale,
  layoutPages,
  mostVisiblePage,
  pagesToRender,
  scrollTopForPage,
  type PageSize,
} from '@/lib/pdf/viewMode';
import { isRenderCancelled, releaseCanvas, renderPageToCanvas, type PageRenderJob } from '@/lib/pdf/pageRender';

const GAP = 16; // CSS px between pages
const PADDING = 24; // CSS px around the column
const SETTLE_MS = 150; // redraw sharp this long after the last zoom change
const NO_COMMENTS: Comment[] = [];

export interface PdfScrollViewHandle {
  scrollToPage: (page: number, behavior?: ScrollBehavior) => void;
  /** Add `delta` to the zoom (the single-page buttons' additive step), anchored on the viewport centre. */
  zoomStep: (delta: number) => void;
  fitWidth: () => void;
}

interface PdfScrollViewProps {
  pdfDoc: PDFDocumentProxy;
  pageSizes: PageSize[];
  /** Read once at mount. */
  initialPage: number;
  comments: Comment[];
  activeCommentId: string | null;
  pendingCommentId?: string | null;
  onCommentPinClick: (comment: Comment) => void;
  tagging: boolean;
  onCommentPlace: (x: number, y: number, pageNumber: number) => void;
  onCurrentPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
  /** Once, when the first page has been drawn (drives the viewer's onReady). */
  onFirstPageDrawn: () => void;
  handleRef?: Ref<PdfScrollViewHandle>;
}

export default function PdfScrollView({
  pdfDoc, pageSizes, initialPage, comments, activeCommentId, pendingCommentId, onCommentPinClick, tagging,
  onCommentPlace, onCurrentPageChange, onScaleChange, onFirstPageDrawn, handleRef,
}: PdfScrollViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [scale, setScale] = useState<number | null>(null);
  const [renderScale, setRenderScale] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  const scaleRef = useRef<number | null>(null);
  const fitModeRef = useRef(true);
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);
  const initialPageRef = useRef(initialPage);

  // Parent callbacks through refs, so memoised pages never re-render for a new function identity.
  const cbs = useRef({ onCommentPinClick, onCommentPlace, onCurrentPageChange, onScaleChange, onFirstPageDrawn });
  cbs.current = { onCommentPinClick, onCommentPlace, onCurrentPageChange, onScaleChange, onFirstPageDrawn };
  const handlePinClick = useCallback((c: Comment) => cbs.current.onCommentPinClick(c), []);
  const handlePlace = useCallback((x: number, y: number, p: number) => cbs.current.onCommentPlace(x, y, p), []);
  const firstDrawnRef = useRef(false);
  const handleDrawn = useCallback(() => {
    if (firstDrawnRef.current) return;
    firstDrawnRef.current = true;
    cbs.current.onFirstPageDrawn();
  }, []);

  // Viewport size. clientWidth excludes the scrollbar, which is what fit-width must fill.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Change the zoom, keeping the content under (anchorX, anchorY) — viewport coords — in place. */
  const applyScale = useCallback((next: number, anchorX: number, anchorY: number) => {
    const el = scrollRef.current;
    const clamped = clampZoom(next);
    const prev = scaleRef.current;
    scaleRef.current = clamped;
    if (prev === null || !el) {
      setScale(clamped);
      return;
    }
    if (clamped === prev) return;
    const from = pendingScrollRef.current ?? { left: el.scrollLeft, top: el.scrollTop };
    const s = anchoredScroll({
      before: layoutPages(pageSizes, prev, GAP, PADDING),
      after: layoutPages(pageSizes, clamped, GAP, PADDING),
      ratio: clamped / prev,
      scrollLeft: from.left,
      scrollTop: from.top,
      pointerX: anchorX,
      pointerY: anchorY,
      viewportWidth: el.clientWidth,
    });
    pendingScrollRef.current = { left: s.scrollLeft, top: s.scrollTop };
    setScale(clamped);
  }, [pageSizes]);

  // Fit-width on first measure, and again on resize until the user zooms by hand.
  useEffect(() => {
    if (!viewport.width || !fitModeRef.current) return;
    applyScale(fitWidthScale(pageSizes, viewport.width, PADDING), 0, 0);
  }, [viewport.width, pageSizes, applyScale]);

  // Ctrl/⌘ + wheel, and trackpad pinch (which browsers send as ctrl+wheel), zoom on the cursor.
  // Native listener because React's onWheel is passive and cannot preventDefault the page zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const current = scaleRef.current;
      if (current === null) return;
      const rect = el.getBoundingClientRect();
      const factor = Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY * 0.01)));
      fitModeRef.current = false;
      applyScale(current * factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyScale]);

  // Report the zoom for the header's percentage.
  useEffect(() => {
    if (scale !== null) cbs.current.onScaleChange(scale);
  }, [scale]);

  // Pages are drawn at `renderScale`: the zoom, settled. In between, CSS stretches the old bitmap.
  useEffect(() => {
    if (scale === null) return;
    setRenderScale((prev) => (prev === null ? scale : prev));
    const t = setTimeout(() => setRenderScale(scale), SETTLE_MS);
    return () => clearTimeout(t);
  }, [scale]);

  const layout = useMemo(() => (scale === null ? null : layoutPages(pageSizes, scale, GAP, PADDING)), [pageSizes, scale]);

  // After a layout change: the first time, jump to the initial page; afterwards apply a pending
  // zoom-anchored scroll. Layout effect, so it lands before paint and the page never jumps visibly.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !layout) return;
    if (!ready) {
      el.scrollTop = scrollTopForPage(layout, initialPageRef.current, GAP);
      setScrollTop(el.scrollTop);
      setReady(true);
      return;
    }
    const p = pendingScrollRef.current;
    if (!p) return;
    pendingScrollRef.current = null;
    el.scrollLeft = p.left;
    el.scrollTop = p.top;
    setScrollTop(el.scrollTop);
  }, [layout, ready]);

  // Scroll position, at most once per frame.
  const rafRef = useRef(0);
  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = scrollRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const currentPage = useMemo(() => {
    if (!layout || !ready || !viewport.height) return null;
    const end = scrollTop > 0 && scrollTop + viewport.height >= layout.contentHeight - 2;
    return mostVisiblePage(layout.pages, scrollTop, scrollTop + viewport.height, end);
  }, [layout, ready, scrollTop, viewport.height]);

  useEffect(() => {
    if (currentPage !== null) cbs.current.onCurrentPageChange(currentPage);
  }, [currentPage]);

  // Draw only pages within about two screens; the rest release their pixels.
  const renderSet = useMemo(
    () => (layout && ready ? pagesToRender(layout.pages, scrollTop, scrollTop + viewport.height, viewport.height * 2) : new Set<number>()),
    [layout, ready, scrollTop, viewport.height],
  );

  const commentsByPage = useMemo(() => {
    const m = new Map<number, Comment[]>();
    for (const c of comments) {
      if (c.pageNumber === null || c.xPosition === null || c.yPosition === null) continue;
      const list = m.get(c.pageNumber);
      if (list) list.push(c);
      else m.set(c.pageNumber, [c]);
    }
    return m;
  }, [comments]);
  const tagNumbers = useMemo(() => buildTagNumbers(comments), [comments]);

  useImperativeHandle(handleRef, () => ({
    scrollToPage: (page, behavior = 'smooth') => {
      const el = scrollRef.current;
      const s = scaleRef.current;
      if (!el || s === null) return;
      el.scrollTo({ top: scrollTopForPage(layoutPages(pageSizes, s, GAP, PADDING), page, GAP), behavior });
    },
    zoomStep: (delta) => {
      const el = scrollRef.current;
      const s = scaleRef.current;
      if (!el || s === null) return;
      fitModeRef.current = false;
      applyScale(s + delta, el.clientWidth / 2, el.clientHeight / 2);
    },
    fitWidth: () => {
      const el = scrollRef.current;
      if (!el) return;
      fitModeRef.current = true;
      applyScale(fitWidthScale(pageSizes, el.clientWidth, PADDING), el.clientWidth / 2, el.clientHeight / 2);
    },
  }), [pageSizes, applyScale]);

  const drawScale = renderScale ?? scale ?? 1;
  const colWidth = layout ? Math.max(layout.contentWidth, viewport.width) : 0;

  return (
    <div ref={scrollRef} onScroll={onScroll} className="relative min-w-0 flex-1 overflow-auto bg-gray-100">
      {!layout ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
        </div>
      ) : (
        <div className="relative" style={{ width: colWidth, height: layout.contentHeight }}>
          {layout.pages.map((p) => (
            <ScrollPage
              key={p.page}
              pdfDoc={pdfDoc}
              page={p.page}
              top={p.top}
              left={(colWidth - p.width) / 2}
              width={p.width}
              height={p.height}
              shouldRender={renderSet.has(p.page)}
              renderWidth={pageSizes[p.page - 1].width * drawScale}
              comments={commentsByPage.get(p.page) ?? NO_COMMENTS}
              tagNumbers={tagNumbers}
              activeCommentId={activeCommentId}
              pendingCommentId={pendingCommentId ?? null}
              tagging={tagging}
              onPinClick={handlePinClick}
              onPlace={handlePlace}
              onDrawn={handleDrawn}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ScrollPageProps {
  pdfDoc: PDFDocumentProxy;
  page: number;
  top: number;
  left: number;
  width: number;
  height: number;
  shouldRender: boolean;
  /** CSS px width to draw the bitmap at (the settled zoom); `width` is the live on-screen width. */
  renderWidth: number;
  comments: Comment[];
  tagNumbers: Map<string, number>;
  activeCommentId: string | null;
  pendingCommentId: string | null;
  tagging: boolean;
  onPinClick: (c: Comment) => void;
  onPlace: (x: number, y: number, page: number) => void;
  onDrawn: () => void;
}

const ScrollPage = memo(function ScrollPage({
  pdfDoc, page, top, left, width, height, shouldRender, renderWidth, comments, tagNumbers, activeCommentId,
  pendingCommentId, tagging, onPinClick, onPlace, onDrawn,
}: ScrollPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!shouldRender) {
      releaseCanvas(canvas);
      return;
    }
    let cancelled = false;
    let job: PageRenderJob | null = null;
    pdfDoc
      .getPage(page)
      .then((pg) => {
        if (cancelled) return;
        job = renderPageToCanvas(pg, canvas, renderWidth, window.devicePixelRatio || 1);
        return job.promise.then(() => {
          if (cancelled) return;
          setFailed(false);
          onDrawn();
        });
      })
      .catch((err) => {
        if (cancelled || isRenderCancelled(err)) return;
        console.error(`Failed to render PDF page ${page}:`, err);
        setFailed(true);
      });
    return () => {
      cancelled = true;
      job?.cancel();
    };
  }, [pdfDoc, page, shouldRender, renderWidth, onDrawn]);

  useEffect(() => {
    const c = canvasRef.current;
    return () => releaseCanvas(c);
  }, []);

  return (
    <div
      className="absolute bg-white shadow-sm ring-1 ring-black/5"
      style={{ top, left, width, height, cursor: tagging ? 'crosshair' : undefined }}
      data-page={page}
      onClick={
        tagging
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onPlace(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100, page);
            }
          : undefined
      }
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-200 text-sm text-gray-500">
          Couldn&apos;t render page {page}
        </div>
      )}
      {comments.map((c, idx) => {
        const pal = paletteForComment(c);
        return (
          <CommentPin
            key={c.id}
            index={tagNumbers.get(c.id) ?? idx + 1}
            x={c.xPosition!}
            y={c.yPosition!}
            isActive={activeCommentId === c.id}
            isPending={c.id === pendingCommentId}
            fill={pal.swatch}
            textColor={pal.dark}
            onClick={() => onPinClick(c)}
          />
        );
      })}
    </div>
  );
});
