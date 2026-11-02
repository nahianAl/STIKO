'use client';

import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDF_RENDER_SCALE } from '@/lib/measure/space';
import type { PageSize } from '@/lib/pdf/viewMode';

// US Letter in page pixels: the stand-in for a page whose size could not be read. Its render fails
// too and shows the per-page error box, so the exact size hardly matters.
const FALLBACK: PageSize = { width: 612 * PDF_RENDER_SCALE, height: 792 * PDF_RENDER_SCALE };

/**
 * Every page's size in page pixels (PDF points × PDF_RENDER_SCALE, the single-page stage's units),
 * or null while loading. Read once per document so the scroll column and the sidebar can lay out
 * correctly sized placeholders before anything is drawn.
 */
export function usePageSizes(pdfDoc: PDFDocumentProxy | null): PageSize[] | null {
  const [sizes, setSizes] = useState<PageSize[] | null>(null);

  useEffect(() => {
    setSizes(null);
    if (!pdfDoc) return;
    let cancelled = false;
    const numbers = Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1);
    Promise.allSettled(
      numbers.map(async (n) => {
        const vp = (await pdfDoc.getPage(n)).getViewport({ scale: PDF_RENDER_SCALE });
        return { width: vp.width, height: vp.height };
      }),
    ).then((results) => {
      if (cancelled) return;
      setSizes(
        results.map((r, i) => {
          if (r.status === 'fulfilled') return r.value;
          console.error(`Failed to read the size of PDF page ${i + 1}:`, r.reason);
          return FALLBACK;
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [pdfDoc]);

  return sizes;
}
