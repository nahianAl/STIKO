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
import { isRenderCancelled, releaseCanvas, renderPageRegion, renderPageToCanvas, type PageRenderJob } from '@/lib/pdf/pageRender';
import { intersectRect, needsDetail, snapOutward, type Rect } from '@/lib/pdf/detailTile';

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
  /** Once, when the first page has settled — drawn or failed (drives the viewer's onReady). */
  onFirstPageDrawn: () => void;
  handleRef?: Ref<PdfScrollViewHandle>;
}

export default function PdfScrollView({
  pdfDoc, pageSizes, initialPage, comments, activeCommentId, pendingCommentId, onCommentPinClick, tagging,
  onCommentPlace, onCurrentPageChange, onScaleChange, onFirstPageDrawn, handleRef,
}: PdfScrollViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  // scrollTop is stamped with the scale it was measured at: after a zoom commit `layout` is new while
  // the position is still the old one until the layout effect applies the pending scroll.
  const [scrollPos, setScrollPos] = useState<{ top: number; scale: number | null }>({ top: 0, scale: null });
  const scrollTop = scrollPos.top;
  const [scale, setScale] = useState<number | null>(null);
  const [renderScale, setRenderScale] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  const scaleRef = useRef<number | null>(null);
  const fitModeRef = useRef(true);
  const committedScaleRef = useRef<number | null>(null);
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
    // Back at the zoom already on screen (e.g. pinch jitter 5 → 4.5 → 5 in one frame): React will
    // skip the render, so nothing would consume a pending scroll — and none is needed.
    if (clamped === committedScaleRef.current) {
      pendingScrollRef.current = null;
      setScale(clamped);
      return;
    }
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

  useLayoutEffect(() => {
    committedScaleRef.current = scale;
  }, [scale]);

  const layout = useMemo(() => (scale === null ? null : layoutPages(pageSizes, scale, GAP, PADDING)), [pageSizes, scale]);

  // After a layout change: the first time, jump to the initial page; afterwards apply a pending
  // zoom-anchored scroll. Layout effect, so it lands before paint and the page never jumps visibly.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !layout) return;
    if (!ready) {
      el.scrollTop = scrollTopForPage(layout, initialPageRef.current, GAP);
      setScrollPos({ top: el.scrollTop, scale });
      setReady(true);
      return;
    }
    const p = pendingScrollRef.current;
    if (!p) {
      // No pending scroll after a scale change: re-stamp, or currentPage would stay null.
      setScrollPos((prev) => (prev.scale === scale ? prev : { top: el.scrollTop, scale }));
      return;
    }
    pendingScrollRef.current = null;
    el.scrollLeft = p.left;
    el.scrollTop = p.top;
    setScrollPos({ top: el.scrollTop, scale });
  }, [layout, ready, scale]);

  // Scroll position, at most once per frame.
  const rafRef = useRef(0);
  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = scrollRef.current;
      if (el) setScrollPos({ top: el.scrollTop, scale: committedScaleRef.current });
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const currentPage = useMemo(() => {
    if (!layout || !ready || !viewport.height || scrollPos.scale !== scale) return null;
    const end = scrollTop > 0 && scrollTop + viewport.height >= layout.contentHeight - 2;
    return mostVisiblePage(layout.pages, scrollTop, scrollTop + viewport.height, end);
  }, [layout, ready, scrollTop, scrollPos.scale, scale, viewport.height]);

  useEffect(() => {
    if (currentPage !== null) cbs.current.onCurrentPageChange(currentPage);
  }, [currentPage]);

  // Draw only pages within about two screens; the rest release their pixels.
  const renderSet = useMemo(
    () => (layout && ready ? pagesToRender(layout.pages, scrollTop, scrollTop + viewport.height, viewport.height * 2) : new Set<number>()),
    [layout, ready, scrollTop, viewport.height],
  );

  const colWidth = layout ? Math.max(layout.contentWidth, viewport.width) : 0;

  // The viewport, SETTLE_MS after the last scroll or zoom, stamped with the zoom it was measured at.
  // Drives the per-page detail render; a stamp from another zoom is ignored until it re-settles.
  const [settledView, setSettledView] = useState<{ rect: Rect; scale: number } | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !ready || scale === null) return;
    const t = setTimeout(() => {
      setSettledView({ rect: { x: el.scrollLeft, y: el.scrollTop, width: el.clientWidth, height: el.clientHeight }, scale });
    }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [scrollPos, scale, viewport, ready]);

  // Each page's on-screen part at the settled zoom, in page-local CSS px. Deliberately not tied to
  // the render window: that Set is rebuilt on every scroll frame, which would hand every page a new
  // Rect each frame (breaking ScrollPage's memo and restarting its detail render mid-scroll). Here the
  // Rects keep their identity until the view re-settles; ScrollPage ignores its region when the page
  // is outside the render window.
  const visibleRegions = useMemo(() => {
    const m = new Map<number, Rect>();
    if (!layout || !settledView || settledView.scale !== scale) return m;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const p of layout.pages) {
      const left = (colWidth - p.width) / 2;
      const pageRect = { x: left, y: p.top, width: p.width, height: p.height };
      const vis = intersectRect(settledView.rect, pageRect);
      if (!vis) continue;
      // Snap in scroll-content coordinates (the screen's pixel grid — the page's own `left` can be
      // fractional, so snapping page-locally would misalign it), clamp back onto the page so a snapped
      // tile never paints past the page edge, and only then go page-local.
      const snapped = intersectRect(snapOutward(vis, dpr), pageRect);
      if (snapped) m.set(p.page, { x: snapped.x - left, y: snapped.y - p.top, width: snapped.width, height: snapped.height });
    }
    return m;
  }, [layout, settledView, scale, colWidth]);

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

  return (
    <div ref={scrollRef} onScroll={onScroll} style={{ scrollbarGutter: 'stable' }} className="relative isolate min-w-0 flex-1 overflow-auto bg-gray-100">
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
              visibleRegion={visibleRegions.get(p.page) ?? null}
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
  /** This page's on-screen part, page-local CSS px at the current zoom; null when off screen or not settled. */
  visibleRegion: Rect | null;
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
  pdfDoc, page, top, left, width, height, shouldRender, renderWidth, visibleRegion, comments, tagNumbers,
  activeCommentId, pendingCommentId, tagging, onPinClick, onPlace, onDrawn,
}: ScrollPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const detailRef = useRef<HTMLCanvasElement>(null);
  // The base bitmap last drawn: its width in device px (what needsDetail compares against the on-screen
  // width) and the CSS width it was drawn for, so a bitmap from an earlier zoom is never mistaken for
  // the current one.
  const [baseWidth, setBaseWidth] = useState(0);
  const [baseFor, setBaseFor] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!shouldRender) {
      releaseCanvas(canvas);
      setBaseWidth(0);
      setBaseFor(0);
      return;
    }
    let cancelled = false;
    let job: PageRenderJob | null = null;
    setFailed(false);
    pdfDoc
      .getPage(page)
      .then((pg) => {
        if (cancelled) return;
        job = renderPageToCanvas(pg, canvas, renderWidth, Math.min(window.devicePixelRatio || 1, 2));
        return job.promise.then(() => {
          if (cancelled) return;
          setBaseWidth(canvas.width);
          setBaseFor(renderWidth);
          onDrawn();
        });
      })
      .catch((err) => {
        if (cancelled || isRenderCancelled(err)) return;
        console.error(`Failed to render PDF page ${page}:`, err);
        setFailed(true);
        onDrawn(); // a failed first page still settles, so onReady never hangs
      });
    return () => {
      cancelled = true;
      job?.cancel();
    };
  }, [pdfDoc, page, shouldRender, renderWidth, onDrawn]);

  // Detail render: only where the base is visibly stretched (it hit the canvas cap). Positioned in
  // percentages of the page, written in the same tick the pixels land, so it stays aligned through
  // later zooms and never shows new pixels in an old box.
  useEffect(() => {
    const canvas = detailRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!shouldRender) {
      releaseCanvas(canvas);
      canvas.style.display = 'none';
      return;
    }
    // The base is still catching up with the zoom, so its bitmap says nothing about the current width
    // yet: deciding now would start a detail render the base is about to make unnecessary (competing
    // with it for the main thread). Keep whatever detail is showing; this re-runs when the base lands.
    if (Math.abs(baseFor - width) > 0.5) return;
    if (!needsDetail(baseWidth, width, dpr)) {
      releaseCanvas(canvas);
      canvas.style.display = 'none';
      return;
    }
    // Off screen or not yet settled: an existing detail canvas stays — it is percentage-positioned, so
    // it is still aligned if the page scrolls back in.
    if (!visibleRegion) return;
    const region = visibleRegion; // already snapped to the screen's pixel grid
    let cancelled = false;
    let job: PageRenderJob | null = null;
    pdfDoc
      .getPage(page)
      .then((pg) => {
        if (cancelled) return;
        job = renderPageRegion(pg, canvas, region, width, dpr);
        return job.promise.then(() => {
          if (cancelled) return;
          Object.assign(canvas.style, {
            display: 'block',
            left: `${(region.x / width) * 100}%`,
            top: `${(region.y / height) * 100}%`,
            width: `${(region.width / width) * 100}%`,
            height: `${(region.height / height) * 100}%`,
          });
        });
      })
      .catch((err) => {
        if (cancelled || isRenderCancelled(err)) return;
        console.error(`Failed to render PDF page ${page} detail:`, err);
      });
    return () => {
      cancelled = true;
      job?.cancel();
    };
  }, [pdfDoc, page, shouldRender, visibleRegion, baseWidth, baseFor, width, height]);

  useEffect(() => {
    const c = canvasRef.current;
    const d = detailRef.current;
    return () => {
      releaseCanvas(c);
      releaseCanvas(d);
    };
  }, []);

  // Free pdf.js's per-page operator lists/fonts/images when the page leaves the render window
  // (or unmounts) — not on a mere renderWidth change.
  useEffect(() => {
    if (!shouldRender) return;
    return () => {
      try {
        pdfDoc.getPage(page).then((p) => { try { p.cleanup(); } catch { /* ignore */ } }).catch(() => {});
      } catch { /* ignore */ }
    };
  }, [pdfDoc, page, shouldRender]);

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
      <canvas ref={detailRef} className="pointer-events-none absolute" style={{ display: 'none' }} />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-200 text-sm text-gray-500">
          Couldn&apos;t render page {page}
        </div>
      )}
      {comments.map((c) => {
        const n = tagNumbers.get(c.id);
        if (n === undefined) return null;
        const pal = paletteForComment(c);
        return (
          <CommentPin
            key={c.id}
            index={n}
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
