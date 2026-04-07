'use client';

import dynamic from 'next/dynamic';
import type { ModelViewerInnerProps } from './ModelViewerInner';

const ModelViewerInner = dynamic(() => import('./ModelViewerInner'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <p className="text-gray-500">Loading 3D model...</p>
    </div>
  ),
});

export type { WorldPin, PinScreenPosition } from './ModelViewerInner';

export default function ModelViewer(props: ModelViewerInnerProps) {
  return <ModelViewerInner {...props} />;
}
