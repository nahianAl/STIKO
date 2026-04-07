'use client';

import { useState, useEffect, useRef } from 'react';
import { FileRecord, STEP_EXTENSIONS } from '@/lib/types';
import ImageViewer, { type ContentTransform } from './ImageViewer';
import VideoViewer from './VideoViewer';
import dynamic from 'next/dynamic';

const PDFViewer = dynamic(() => import('./PDFViewer'), { ssr: false });
import ModelViewer from './ModelViewer';
import type { WorldPin, PinScreenPosition } from './ModelViewer';

export type { WorldPin, PinScreenPosition };
export type { ContentTransform };

interface ViewerContainerProps {
  file: FileRecord;
  frozen?: boolean;
  commentToolActive?: boolean;
  onSceneClick?: (worldPoint: { x: number; y: number; z: number }, screenPercent: { x: number; y: number }) => void;
  worldPins?: WorldPin[];
  onPinPositionsUpdate?: (positions: Map<string, PinScreenPosition>) => void;
  onTransformChange?: (transform: ContentTransform) => void;
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
const PDF_EXTENSIONS = ['.pdf'];
const MODEL_EXTENSIONS = ['.glb', '.gltf'];

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx === -1) return '';
  return filename.slice(idx).toLowerCase();
}

export default function ViewerContainer({ file, frozen, commentToolActive, onSceneClick, worldPins, onPinPositionsUpdate, onTransformChange }: ViewerContainerProps) {
  const ext = getExtension(file.filename);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [conversionStatus, setConversionStatus] = useState(file.conversionStatus);
  const [convertedStorageKey, setConvertedStorageKey] = useState(file.convertedStorageKey);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll for conversion status if the file is being converted
  useEffect(() => {
    if (!STEP_EXTENSIONS.includes(ext)) return;
    if (conversionStatus === 'completed' || conversionStatus === 'failed') return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/files/${file.id}/conversion-status`);
        if (res.ok) {
          const data = await res.json();
          setConversionStatus(data.conversionStatus);
          if (data.convertedStorageKey) {
            setConvertedStorageKey(data.convertedStorageKey);
          }
          if (data.conversionStatus === 'completed' || data.conversionStatus === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        }
      } catch {
        // Ignore poll errors, retry on next interval
      }
    };

    poll();
    pollRef.current = setInterval(poll, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [file.id, ext, conversionStatus]);

  // Fetch presigned URL
  useEffect(() => {
    setUrl(null);
    setError(false);

    // For STEP files, use the converted key once ready
    if (STEP_EXTENSIONS.includes(ext)) {
      if (conversionStatus !== 'completed' || !convertedStorageKey) return;
      fetch(`/api/files/url?key=${encodeURIComponent(convertedStorageKey)}`)
        .then(res => {
          if (!res.ok) throw new Error('Failed to get file URL');
          return res.json();
        })
        .then(data => setUrl(data.url))
        .catch(() => setError(true));
      return;
    }

    // For all other files, use the original storage key
    fetch(`/api/files/url?key=${encodeURIComponent(file.storageKey)}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to get file URL');
        return res.json();
      })
      .then(data => setUrl(data.url))
      .catch(() => setError(true));
  }, [file.storageKey, ext, conversionStatus, convertedStorageKey]);

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-red-500">Failed to load file</p>
      </div>
    );
  }

  // STEP file conversion states
  if (STEP_EXTENSIONS.includes(ext)) {
    if (conversionStatus === 'pending' || conversionStatus === 'processing') {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <p className="text-sm text-gray-600">Converting 3D model...</p>
          <p className="text-xs text-gray-400">This may take a minute</p>
        </div>
      );
    }
    if (conversionStatus === 'failed') {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3">
          <svg className="h-10 w-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <p className="text-sm text-red-600">3D model conversion failed</p>
          <button
            onClick={() => {
              fetch('/api/conversions/retry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileId: file.id }),
              }).then(() => setConversionStatus('processing'));
            }}
            className="text-xs text-blue-600 hover:underline"
          >
            Retry conversion
          </button>
        </div>
      );
    }
    // completed — render ModelViewer with converted GLB
    if (url) {
      return <ModelViewer url={url} commentToolActive={commentToolActive} onSceneClick={onSceneClick} worldPins={worldPins} onPinPositionsUpdate={onPinPositionsUpdate} />;
    }
    return (
      <div className="flex h-full w-full items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
      </div>
    );
  }

  if (IMAGE_EXTENSIONS.includes(ext)) return <ImageViewer url={url} onTransformChange={onTransformChange} />;
  if (VIDEO_EXTENSIONS.includes(ext)) return <VideoViewer url={url} frozen={frozen} />;
  if (PDF_EXTENSIONS.includes(ext)) return <PDFViewer url={url} />;
  if (MODEL_EXTENSIONS.includes(ext)) return <ModelViewer url={url} commentToolActive={commentToolActive} onSceneClick={onSceneClick} worldPins={worldPins} onPinPositionsUpdate={onPinPositionsUpdate} />;

  return (
    <div className="flex h-full w-full items-center justify-center">
      <p className="text-gray-500">
        Unsupported file type: <span className="font-mono">{ext || 'unknown'}</span>
      </p>
    </div>
  );
}
