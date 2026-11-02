'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { scrollTopToReveal, type PageSize } from '@/lib/pdf/viewMode';
import { isRenderCancelled, releaseCanvas, renderPageToCanvas, type PageRenderJob } from '@/lib/pdf/pageRender';

const THUMB_WIDTH = 140; // CSS px; the sidebar is 180px wide with 20px padding each side

interface PdfSidebarProps {
  pdfDoc: PDFDocumentProxy;
  pageSizes: PageSize[];
  currentPage: number;
  onSelectPage: (page: number) => void;
  /** Phone width only: the scrim behind the drawer was tapped. */
  onClose: () => void;
}

export default function PdfSidebar({ pdfDoc, pageSizes, currentPage, onSelectPage, onClose }: PdfSidebarProps) {
  // State, not a ref: thumbnails need the element as their IntersectionObserver root.
  const [list, setList] = useState<HTMLElement | null>(null);

  // Keep the current page's thumbnail in view, but only when it has left the view, so a hand
  // scroll of the list is never fought.
  useEffect(() => {
    if (!list) return;
    const item = list.querySelector<HTMLElement>(`[data-thumb="${currentPage}"]`);
    if (!item) return;
    const next = scrollTopToReveal(item.offsetTop - 8, item.offsetTop + item.offsetHeight + 8, list.scrollTop, list.clientHeight);
    if (next !== null) list.scrollTo({ top: next, behavior: 'smooth' });
  }, [list, currentPage]);

  return (
    <>
      {/* Phone width: the sidebar is a drawer over the page; tapping outside closes it. */}
      <div className="absolute inset-0 z-20 bg-black/30 md:hidden" onClick={onClose} aria-hidden="true" />
      <nav
        ref={setList}
        aria-label="Pages"
        className="absolute inset-y-0 left-0 z-30 w-[180px] flex-shrink-0 overflow-y-auto border-r border-gray-200 bg-white px-5 py-4 shadow-lg md:relative md:inset-auto md:z-auto md:shadow-none"
      >
        <ol className="flex flex-col gap-4">
          {pageSizes.map((size, i) => (
            <Thumbnail
              key={i + 1}
              pdfDoc={pdfDoc}
              page={i + 1}
              size={size}
              active={i + 1 === currentPage}
              root={list}
              onSelect={onSelectPage}
            />
          ))}
        </ol>
      </nav>
    </>
  );
}

interface ThumbnailProps {
  pdfDoc: PDFDocumentProxy;
  page: number;
  size: PageSize;
  active: boolean;
  root: HTMLElement | null;
  onSelect: (page: number) => void;
}

const Thumbnail = memo(function Thumbnail({ pdfDoc, page, size, active, root, onSelect }: ThumbnailProps) {
  const itemRef = useRef<HTMLLIElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  // Draw once the thumbnail comes near the visible part of the list; keep it afterwards (small).
  useEffect(() => {
    const el = itemRef.current;
    if (!el || !root || visible) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { root, rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root, visible]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!visible || !canvas) return;
    let cancelled = false;
    let job: PageRenderJob | null = null;
    pdfDoc
      .getPage(page)
      .then((pg) => {
        if (cancelled) return;
        job = renderPageToCanvas(pg, canvas, THUMB_WIDTH, window.devicePixelRatio || 1);
        return job.promise;
      })
      .catch((err) => {
        if (cancelled || isRenderCancelled(err)) return;
        console.error(`Failed to render the thumbnail of PDF page ${page}:`, err);
        setFailed(true);
      });
    return () => {
      cancelled = true;
      job?.cancel();
    };
  }, [visible, pdfDoc, page]);

  useEffect(() => {
    const c = canvasRef.current;
    return () => releaseCanvas(c);
  }, []);

  const height = Math.round((THUMB_WIDTH * size.height) / size.width);

  return (
    <li ref={itemRef} data-thumb={page}>
      <button
        type="button"
        onClick={() => onSelect(page)}
        aria-label={`Page ${page}`}
        aria-current={active ? 'page' : undefined}
        className="group flex w-full flex-col items-center gap-1.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5B60FF]"
      >
        <span
          className={`relative block overflow-hidden rounded-sm bg-white shadow-sm transition ${active ? 'ring-2 ring-[#5B60FF]' : 'ring-1 ring-black/10 group-hover:ring-gray-400'}`}
          style={{ width: THUMB_WIDTH, height }}
        >
          <canvas ref={canvasRef} className="block h-full w-full" />
          {failed && (
            <span className="absolute inset-0 flex items-center justify-center bg-gray-200 px-2 text-center text-[11px] text-gray-500">
              Couldn&apos;t render page {page}
            </span>
          )}
        </span>
        <span className={`text-xs ${active ? 'font-semibold text-[#5B60FF]' : 'text-gray-500'}`}>{page}</span>
      </button>
    </li>
  );
});
