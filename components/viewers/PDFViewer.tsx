'use client';

interface PDFViewerProps {
  url: string;
}

export default function PDFViewer({ url }: PDFViewerProps) {
  return (
    <iframe
      src={url}
      className="h-full w-full border-0"
      title="PDF Viewer"
    />
  );
}
