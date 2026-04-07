'use client';

import { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Use the CDN worker for pdf.js
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  url: string;
}

export default function PDFViewer({ url }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setCurrentPage(1);
  }, []);

  return (
    <div className="flex h-full w-full flex-col">
      {/* PDF toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="px-2 py-0.5 rounded text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-xs text-gray-600">
            {currentPage} / {numPages || '...'}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
            disabled={currentPage >= numPages}
            className="px-2 py-0.5 rounded text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40"
          >
            Next
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
            className="px-2 py-0.5 rounded text-xs text-gray-600 hover:bg-gray-100"
          >
            -
          </button>
          <span className="text-xs text-gray-600 w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale((s) => Math.min(3, s + 0.25))}
            className="px-2 py-0.5 rounded text-xs text-gray-600 hover:bg-gray-100"
          >
            +
          </button>
          <button
            onClick={() => setScale(1)}
            className="px-2 py-0.5 rounded text-xs text-gray-500 hover:bg-gray-100 ml-1"
          >
            Reset
          </button>
        </div>
      </div>

      {/* PDF content - scrollable */}
      <div className="flex-1 overflow-auto flex justify-center bg-gray-200 p-4">
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="flex items-center justify-center py-20">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
          }
          error={
            <div className="flex items-center justify-center py-20">
              <p className="text-sm text-red-500">Failed to load PDF</p>
            </div>
          }
        >
          <Page
            pageNumber={currentPage}
            scale={scale}
            renderTextLayer={true}
            renderAnnotationLayer={true}
          />
        </Document>
      </div>
    </div>
  );
}
