'use client';

import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  url: string;
}

export default function PDFViewer({ url }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
    setLoading(false);
  }

  function onDocumentLoadError(err: Error) {
    setError(err.message || 'Failed to load PDF');
    setLoading(false);
  }

  const goToPrevPage = () => setPageNumber((p) => Math.max(1, p - 1));
  const goToNextPage = () => setPageNumber((p) => Math.min(numPages, p + 1));
  const zoomIn = () => setScale((s) => Math.min(3, s + 0.25));
  const zoomOut = () => setScale((s) => Math.max(0.25, s - 0.25));

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-red-500">Error loading PDF: {error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center">
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2">
        <button
          onClick={goToPrevPage}
          disabled={pageNumber <= 1}
          className="rounded bg-gray-100 px-2 py-1 text-sm disabled:opacity-40 hover:bg-gray-200"
        >
          Previous
        </button>
        <span className="text-sm">
          Page {pageNumber} of {numPages}
        </span>
        <button
          onClick={goToNextPage}
          disabled={pageNumber >= numPages}
          className="rounded bg-gray-100 px-2 py-1 text-sm disabled:opacity-40 hover:bg-gray-200"
        >
          Next
        </button>
        <span className="mx-2 text-gray-300">|</span>
        <button
          onClick={zoomOut}
          className="rounded bg-gray-100 px-2 py-1 text-sm hover:bg-gray-200"
        >
          -
        </button>
        <span className="text-sm">{Math.round(scale * 100)}%</span>
        <button
          onClick={zoomIn}
          className="rounded bg-gray-100 px-2 py-1 text-sm hover:bg-gray-200"
        >
          +
        </button>
      </div>
      <div className="flex flex-1 items-start justify-center overflow-auto p-4">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-500" />
          </div>
        )}
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading=""
        >
          <Page pageNumber={pageNumber} scale={scale} />
        </Document>
      </div>
    </div>
  );
}
