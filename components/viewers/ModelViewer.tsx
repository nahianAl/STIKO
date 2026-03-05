'use client';

import dynamic from 'next/dynamic';

const ModelViewerInner = dynamic(() => import('./ModelViewerInner'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <p className="text-gray-500">Loading 3D model...</p>
    </div>
  ),
});

interface ModelViewerProps {
  url: string;
}

export default function ModelViewer({ url }: ModelViewerProps) {
  return <ModelViewerInner url={url} />;
}
