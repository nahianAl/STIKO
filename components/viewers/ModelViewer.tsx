'use client';

import dynamic from 'next/dynamic';
import type { ModelViewerInnerProps } from './ModelViewerInner';

// No `loading` fallback on purpose. The viewport already shows one indicator,
// held up until the model has actually been measured, and this chunk download
// is the first moment of that same wait — a second, differently-worded state
// underneath it just reads as the first one ending early.
const ModelViewerInner = dynamic(() => import('./ModelViewerInner'), {
  ssr: false,
});

export type { WorldPin, PinScreenPosition, ModelViewerHandle } from './ModelViewerInner';

export default function ModelViewer(props: ModelViewerInnerProps) {
  return <ModelViewerInner {...props} />;
}
