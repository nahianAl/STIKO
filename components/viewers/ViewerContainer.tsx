'use client';

import { useState, useEffect } from 'react';
import { FileRecord } from '@/lib/types';
import type { Comment } from '@/lib/types';
import ImageViewer, { type ContentTransform } from './ImageViewer';
import VideoViewer from './VideoViewer';
import dynamic from 'next/dynamic';

const PDFKonvaViewer = dynamic(() => import('./PDFKonvaViewer'), { ssr: false });
import type { PDFKonvaViewerHandle } from './PDFKonvaViewer';
import ModelViewer from './ModelViewer';
import type { WorldPin, PinScreenPosition } from './ModelViewer';

export type { WorldPin, PinScreenPosition };
export type { ContentTransform };
export type { PDFKonvaViewerHandle };

type ToolType = 'pointer' | 'comment' | 'freehand' | 'line' | 'arrow' | 'rect' | 'text';

interface ViewerContainerProps {
  file: FileRecord;
  frozen?: boolean;
  commentToolActive?: boolean;
  onSceneClick?: (worldPoint: { x: number; y: number; z: number }, screenPercent: { x: number; y: number }) => void;
  worldPins?: WorldPin[];
  onPinPositionsUpdate?: (positions: Map<string, PinScreenPosition>) => void;
  onTransformChange?: (transform: ContentTransform) => void;
  // PDF annotation props
  activeTool?: ToolType;
  color?: string;
  strokeWidth?: number;
  fileId?: string;
  onCommentPlace?: (x: number, y: number, pageNumber: number) => void;
  comments?: Comment[];
  activeCommentId?: string | null;
  onCommentPinClick?: (comment: Comment) => void;
  pdfViewerRef?: React.Ref<PDFKonvaViewerHandle>;
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
const PDF_EXTENSIONS = ['.pdf'];
const MODEL_EXTENSIONS = ['.glb', '.gltf', '.obj', '.stl', '.3ds', '.ply', '.dae', '.step', '.stp'];

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx === -1) return '';
  return filename.slice(idx).toLowerCase();
}

export default function ViewerContainer({
  file, frozen, commentToolActive, onSceneClick, worldPins, onPinPositionsUpdate, onTransformChange,
  activeTool, color, strokeWidth, fileId, onCommentPlace, comments, activeCommentId, onCommentPinClick, pdfViewerRef,
}: ViewerContainerProps) {
  const ext = getExtension(file.filename);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  // Fetch presigned URL
  useEffect(() => {
    setUrl(null);
    setError(false);

    fetch(`/api/files/url?key=${encodeURIComponent(file.storageKey)}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to get file URL');
        return res.json();
      })
      .then(data => setUrl(data.url))
      .catch(() => setError(true));
  }, [file.storageKey]);

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-red-500">Failed to load file</p>
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
  if (PDF_EXTENSIONS.includes(ext)) {
    return (
      <PDFKonvaViewer
        ref={pdfViewerRef}
        url={url}
        fileId={fileId || file.id}
        activeTool={activeTool ?? 'pointer'}
        color={color ?? '#ef4444'}
        strokeWidth={strokeWidth ?? 4}
        onCommentPlace={onCommentPlace ?? (() => {})}
        comments={comments ?? []}
        activeCommentId={activeCommentId ?? null}
        onCommentPinClick={onCommentPinClick ?? (() => {})}
      />
    );
  }
  if (MODEL_EXTENSIONS.includes(ext)) return <ModelViewer url={url} commentToolActive={commentToolActive} onSceneClick={onSceneClick} worldPins={worldPins} onPinPositionsUpdate={onPinPositionsUpdate} />;

  return (
    <div className="flex h-full w-full items-center justify-center">
      <p className="text-gray-500">
        Unsupported file type: <span className="font-mono">{ext || 'unknown'}</span>
      </p>
    </div>
  );
}
