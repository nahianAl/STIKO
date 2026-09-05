'use client';

import { useState, useEffect } from 'react';
import { FileRecord } from '@/lib/types';
import type { Comment } from '@/lib/types';
import type { ObjectTransform } from '@/lib/objectTransform';
import type { PlaneId, SectionSlots } from '@/lib/crossSection';
import type { PartNode } from '@/lib/model/partTree';
import type { MarkupSelection, ToolType } from '@/components/markup/useAnnotationObjects';
import ImageViewer, { type ContentTransform } from './ImageViewer';
import VideoViewer from './VideoViewer';
import dynamic from 'next/dynamic';

const PDFKonvaViewer = dynamic(() => import('./PDFKonvaViewer'), { ssr: false });
import type { PDFKonvaViewerHandle } from './PDFKonvaViewer';
import ModelViewer from './ModelViewer';
import type { WorldPin, PinScreenPosition, ModelViewerHandle } from './ModelViewer';
import ModelErrorBoundary from './ModelErrorBoundary';

export type { WorldPin, PinScreenPosition };
export type { ContentTransform };
export type { PDFKonvaViewerHandle };
export type { ModelViewerHandle };

interface ViewerContainerProps {
  file: FileRecord;
  frozen?: boolean;
  commentToolActive?: boolean;
  onSceneClick?: (worldPoint: { x: number; y: number; z: number }, screenPercent: { x: number; y: number }) => void;
  worldPins?: WorldPin[];
  onPinPositionsUpdate?: (positions: Map<string, PinScreenPosition>) => void;
  onTransformChange?: (transform: ContentTransform) => void;
  transform?: ObjectTransform;
  transformMode?: 'translate' | 'rotate' | null;
  onTransformCommit?: (transform: ObjectTransform) => void;
  focalLength?: number;
  sectionSlots?: SectionSlots;
  selectedPlane?: PlaneId | null;
  onSelectPlane?: (id: PlaneId | null) => void;
  // Per-part colour props. Required, matching ModelViewerInner: a caller that forgets one of
  // these should fail to build rather than silently ship a viewer with no colouring opinion.
  partColors: Record<string, string>;
  hiddenParts: string[];
  highlightedPart: string | null;
  onPartsLoaded: (parts: PartNode[], authored: boolean, baseColors: Map<string, string>) => void;
  onPartPick: (key: string) => void;
  // PDF annotation props
  activeTool?: ToolType;
  tagging?: boolean;
  annotating?: boolean;
  color?: string;
  strokeWidth?: number;
  fileId?: string;
  onCommentPlace?: (x: number, y: number, pageNumber: number) => void;
  comments?: Comment[];
  activeCommentId?: string | null;
  onCommentPinClick?: (comment: Comment) => void;
  pdfViewerRef?: React.Ref<PDFKonvaViewerHandle>;
  modelViewerRef?: React.Ref<ModelViewerHandle>;
  pendingCommentId?: string | null;
  /**
   * Fired once this file is actually on screen — decoded, rendered, measured —
   * or once it definitively cannot be. The page holds ONE loading indicator up
   * until then. Every branch below must report it; a branch that forgets leaves
   * the indicator covering content that has already arrived.
   */
  onReady?: () => void;
  onObjectCreated?: () => void;
  onSelectionChange?: (selection: MarkupSelection | null) => void;
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
  activeTool, tagging, annotating, color, strokeWidth, fileId, onCommentPlace, comments, activeCommentId, onCommentPinClick, pdfViewerRef, modelViewerRef, pendingCommentId, onObjectCreated, onSelectionChange, transform, transformMode, onTransformCommit, focalLength, sectionSlots, selectedPlane, onSelectPlane, onReady,
  partColors, hiddenParts, highlightedPart, onPartsLoaded, onPartPick,
}: ViewerContainerProps) {
  const ext = getExtension(file.filename);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  // The optimized copy is what the viewer wants whenever one exists; downloads elsewhere
  // still serve file.storageKey, so an uploader always gets their own file back untouched.
  //
  // This branches on convertedStorageKey alone and never on conversionStatus: a
  // client-optimized GLB leaves conversion_status NULL, because that column means "a
  // CloudConvert job reached this state" and nothing else.
  const viewerKey = file.convertedStorageKey ?? file.storageKey;

  // Fetch presigned URL
  useEffect(() => {
    setUrl(null);
    setError(false);

    fetch(`/api/files/url?key=${encodeURIComponent(viewerKey)}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to get file URL');
        return res.json();
      })
      .then(data => setUrl(data.url))
      .catch(() => setError(true));
  }, [viewerKey]);

  // Two dead ends that no viewer will ever report on: we could not get a URL,
  // or nothing here can open this format. Both are finished states, so release
  // the indicator — otherwise it covers the very message explaining why there
  // is nothing to see.
  const isViewable =
    IMAGE_EXTENSIONS.includes(ext) ||
    VIDEO_EXTENSIONS.includes(ext) ||
    PDF_EXTENSIONS.includes(ext) ||
    MODEL_EXTENSIONS.includes(ext);
  useEffect(() => {
    if (error || !isViewable) onReady?.();
  }, [error, isViewable, onReady]);

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-red-500">Failed to load file</p>
      </div>
    );
  }

  // Nothing is rendered while the presigned URL is in flight. This used to be a
  // second, smaller cube: the page's indicator ended, this one started, and the
  // handover read as the animation stopping short. The page's one covers it.
  if (!url) return null;

  if (IMAGE_EXTENSIONS.includes(ext)) return <ImageViewer url={url} onTransformChange={onTransformChange} onReady={onReady} />;
  if (VIDEO_EXTENSIONS.includes(ext)) return <VideoViewer url={url} frozen={frozen} onReady={onReady} />;
  if (PDF_EXTENSIONS.includes(ext)) {
    return (
      <PDFKonvaViewer
        handleRef={pdfViewerRef}
        url={url}
        fileId={fileId || file.id}
        activeTool={activeTool ?? 'pointer'}
        tagging={tagging}
        annotating={annotating}
        color={color ?? '#ef4444'}
        strokeWidth={strokeWidth ?? 4}
        onCommentPlace={onCommentPlace ?? (() => {})}
        comments={comments ?? []}
        activeCommentId={activeCommentId ?? null}
        onCommentPinClick={onCommentPinClick ?? (() => {})}
        pendingCommentId={pendingCommentId}
        onObjectCreated={onObjectCreated}
        onSelectionChange={onSelectionChange}
        onReady={onReady}
      />
    );
  }
  if (MODEL_EXTENSIONS.includes(ext)) {
    return (
      // key={viewerKey}: forces a remount on file switch instead of relying on
      // the `!url` gate above to unmount the failed boundary first — a future
      // refactor (e.g. keeping the last frame visible while loading) could drop
      // that gate silently. It also closes the single-frame window where stale
      // fallback content could otherwise show before the url-fetch effect fires.
      <ModelErrorBoundary key={viewerKey} onReady={onReady}>
        <ModelViewer
          url={url}
          commentToolActive={commentToolActive}
          onSceneClick={onSceneClick}
          worldPins={worldPins}
          onPinPositionsUpdate={onPinPositionsUpdate}
          handleRef={modelViewerRef}
          transform={transform}
          transformMode={transformMode}
          onTransformCommit={onTransformCommit}
          focalLength={focalLength}
          sectionSlots={sectionSlots}
          selectedPlane={selectedPlane}
          onSelectPlane={onSelectPlane}
          onReady={onReady}
          partColors={partColors}
          hiddenParts={hiddenParts}
          highlightedPart={highlightedPart}
          onPartsLoaded={onPartsLoaded}
          onPartPick={onPartPick}
        />
      </ModelErrorBoundary>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <p className="text-gray-500">
        Unsupported file type: <span className="font-mono">{ext || 'unknown'}</span>
      </p>
    </div>
  );
}
