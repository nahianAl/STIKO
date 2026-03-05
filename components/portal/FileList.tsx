'use client';

import React from 'react';

interface FileRecord {
  id: string;
  versionId: string;
  filename: string;
  storageKey: string;
  fileSize: number;
  fileType: string;
  createdAt: string;
}

interface FileListProps {
  files: FileRecord[];
  selectedFileId: string | null;
  onSelectFile: (fileId: string) => void;
}

function getFileIcon(fileType: string, filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (fileType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
    return 'image';
  }
  if (fileType.startsWith('video/') || ['mp4', 'mov', 'webm', 'avi'].includes(ext)) {
    return 'video';
  }
  if (fileType === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }
  if (['glb', 'gltf'].includes(ext)) {
    return '3d';
  }
  return 'file';
}

function FileIcon({ type }: { type: string }) {
  switch (type) {
    case 'image':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    case 'video':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      );
    case 'pdf':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
    case '3d':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      );
    default:
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
  }
}

export default function FileList({
  files,
  selectedFileId,
  onSelectFile,
}: FileListProps) {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-200 bg-gray-50 overflow-x-auto">
      {files.map((file) => {
        const isSelected = file.id === selectedFileId;
        const iconType = getFileIcon(file.fileType, file.filename);
        return (
          <button
            key={file.id}
            onClick={() => onSelectFile(file.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors duration-150 ${
              isSelected
                ? 'bg-white text-blue-700 shadow-sm border border-gray-200'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <FileIcon type={iconType} />
            <span className="max-w-[140px] truncate">{file.filename}</span>
          </button>
        );
      })}
    </div>
  );
}
