'use client';

import { FileRecord } from '@/lib/types';
import ImageViewer from './ImageViewer';
import VideoViewer from './VideoViewer';
import dynamic from 'next/dynamic';

const PDFViewer = dynamic(() => import('./PDFViewer'), { ssr: false });
import ModelViewer from './ModelViewer';

interface ViewerContainerProps {
  file: FileRecord;
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

export default function ViewerContainer({ file }: ViewerContainerProps) {
  const ext = getExtension(file.filename);
  const url = `/${file.storageKey}`;

  if (IMAGE_EXTENSIONS.includes(ext)) {
    return <ImageViewer url={url} />;
  }

  if (VIDEO_EXTENSIONS.includes(ext)) {
    return <VideoViewer url={url} />;
  }

  if (PDF_EXTENSIONS.includes(ext)) {
    return <PDFViewer url={url} />;
  }

  if (MODEL_EXTENSIONS.includes(ext)) {
    return <ModelViewer url={url} />;
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <p className="text-gray-500">
        Unsupported file type: <span className="font-mono">{ext || 'unknown'}</span>
      </p>
    </div>
  );
}
