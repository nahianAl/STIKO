'use client';

import React, { useRef, useState, useCallback } from 'react';
import { FileChip } from './Primitives';
import {
  ACCEPT_ATTRIBUTE,
  extensionOf,
  partitionBySupport,
} from '@/lib/fileFormats';

export interface FileWithPath {
  file: File;
  path: string; // relative path including filename, e.g. "MyFolder/part1.glb" or "render.png"
}

interface FileDropzoneProps {
  files: FileWithPath[];
  onFilesChange: (files: FileWithPath[]) => void;
  title?: string;
  hint?: string;
  /** Compact padding for the version drawer (2e). */
  compact?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Recursively read all files from a directory entry
async function readDirectoryEntries(entry: FileSystemDirectoryEntry): Promise<FileWithPath[]> {
  const results: FileWithPath[] = [];

  const readEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));

  const getFile = (fileEntry: FileSystemFileEntry): Promise<File> =>
    new Promise((resolve, reject) => fileEntry.file(resolve, reject));

  const processEntry = async (e: FileSystemEntry, basePath: string) => {
    if (e.isFile) {
      const file = await getFile(e as FileSystemFileEntry);
      const path = basePath ? `${basePath}/${e.name}` : e.name;
      results.push({ file, path });
    } else if (e.isDirectory) {
      const dirReader = (e as FileSystemDirectoryEntry).createReader();
      const dirPath = basePath ? `${basePath}/${e.name}` : e.name;
      let entries: FileSystemEntry[] = [];
      // readEntries may return partial results; keep reading until empty
      let batch: FileSystemEntry[];
      do {
        batch = await readEntries(dirReader);
        entries = entries.concat(batch);
      } while (batch.length > 0);
      for (const child of entries) {
        await processEntry(child, dirPath);
      }
    }
  };

  const dirReader = entry.createReader();
  let entries: FileSystemEntry[] = [];
  let batch: FileSystemEntry[];
  do {
    batch = await readEntries(dirReader);
    entries = entries.concat(batch);
  } while (batch.length > 0);

  for (const child of entries) {
    await processEntry(child, entry.name);
  }

  return results;
}

export default function FileDropzone({
  files,
  onFilesChange,
  title = 'Drop drawings, models or PDFs',
  hint = 'Folders keep their structure · PDF, DWG, DXF, GLB, STEP, OBJ, STL, images, video',
  compact = false,
}: FileDropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Names refused by the last add, shown until the next one. Drag-drop, the
  // file picker and the folder picker all funnel through addFiles, so this is
  // the only gate the feature needs.
  const [rejected, setRejected] = useState<string[]>([]);

  const addFiles = useCallback(
    (newFiles: FileWithPath[]) => {
      const { accepted, rejected: refused } = partitionBySupport(
        newFiles,
        (f) => f.file.name
      );
      setRejected(refused.map((f) => f.file.name));
      if (accepted.length > 0) onFilesChange([...files, ...accepted]);
    },
    [files, onFilesChange]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files).map((f) => ({
        file: f,
        path: f.name,
      }));
      addFiles(newFiles);
      e.target.value = '';
    }
  };

  const handleFolderInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files)
        .filter((f) => !f.name.startsWith('.')) // skip hidden files
        .map((f) => ({
          file: f,
          path: f.webkitRelativePath || f.name,
        }));
      addFiles(newFiles);
      e.target.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const items = e.dataTransfer.items;
    if (!items) {
      // Fallback: no items API, treat as flat files
      const newFiles = Array.from(e.dataTransfer.files).map((f) => ({
        file: f,
        path: f.name,
      }));
      addFiles(newFiles);
      return;
    }

    const allFiles: FileWithPath[] = [];
    const entries: FileSystemEntry[] = [];

    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }

    for (const entry of entries) {
      if (entry.isDirectory) {
        const dirFiles = await readDirectoryEntries(entry as FileSystemDirectoryEntry);
        allFiles.push(...dirFiles);
      } else if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject)
        );
        allFiles.push({ file, path: file.name });
      }
    }

    if (allFiles.length > 0) {
      addFiles(allFiles);
    }
  };

  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  };

  // Group files by top-level folder for display
  const groupedFiles: { folder: string | null; items: { entry: FileWithPath; index: number }[] }[] = [];
  const folderMap = new Map<string | null, { entry: FileWithPath; index: number }[]>();

  files.forEach((entry, index) => {
    const parts = entry.path.split('/');
    const folder = parts.length > 1 ? parts[0] : null;
    if (!folderMap.has(folder)) folderMap.set(folder, []);
    folderMap.get(folder)!.push({ entry, index });
  });

  // Root files first, then folders alphabetically
  if (folderMap.has(null)) {
    groupedFiles.push({ folder: null, items: folderMap.get(null)! });
  }
  for (const [folder, items] of Array.from(folderMap.entries()).sort()) {
    if (folder !== null) groupedFiles.push({ folder, items });
  }

  return (
    <div>
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`cursor-pointer rounded-panel border-2 border-dashed text-center transition duration-150 ${
          compact ? 'px-5 py-5' : 'px-5 py-[30px]'
        } ${
          isDragging
            ? 'border-stiko-primary bg-stiko-tint'
            : 'border-stiko-dashed bg-stiko-app hover:border-stiko-primary'
        }`}
      >
        <span className="mx-auto mb-3 flex h-[46px] w-[46px] items-center justify-center rounded-panel bg-white shadow-stiko-panel">
          <svg
            className="h-[19px] w-[19px] text-stiko-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
          </svg>
        </span>
        <p className="text-[15px] font-bold text-stiko-ink">{title}</p>
        <p className="mt-[3px] text-[12.5px] text-stiko-muted">{hint}</p>
        <div className="mt-2 flex items-center justify-center gap-3 text-[12.5px] font-bold">
          <span className="text-stiko-primary">or browse files</span>
          <span className="text-stiko-crumb">·</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              folderInputRef.current?.click();
            }}
            className="text-stiko-primary hover:text-stiko-primary-hover"
          >
            select a folder
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          onChange={handleFileInput}
          className="hidden"
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is not in React types
          webkitdirectory=""
          onChange={handleFolderInput}
          className="hidden"
        />
      </div>

      {rejected.length > 0 && (
        <div
          role="alert"
          className="mt-3 rounded-[10px] px-[13px] py-[11px] text-[12.5px]"
          style={{ background: '#FFE2E2', color: '#B23A52' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold">
                {rejected.length === 1
                  ? "1 file can't be added"
                  : `${rejected.length} files can't be added`}
              </p>
              <p className="mt-[3px] leading-[1.5]">
                Stiko can&apos;t open{' '}
                {rejected.length === 1 ? "this format" : "these formats"} yet.
                Everything else was added.
              </p>
              <ul className="mt-[6px] flex flex-col gap-[2px]">
                {rejected.slice(0, 5).map((name, i) => (
                  <li key={`${name}-${i}`} className="truncate font-medium">
                    {name}
                    <span className="ml-1 opacity-70">
                      ({extensionOf(name) ? `.${extensionOf(name)}` : "no extension"})
                    </span>
                  </li>
                ))}
                {rejected.length > 5 && (
                  <li className="opacity-70">+{rejected.length - 5} more</li>
                )}
              </ul>
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={(e) => {
                e.stopPropagation();
                setRejected([]);
              }}
              className="shrink-0 opacity-60 transition hover:opacity-100"
            >
              <svg
                className="h-[15px] w-[15px]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
              >
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {groupedFiles.map((group) => (
            <div key={group.folder ?? '__root__'} className="flex flex-col gap-1">
              {group.folder && (
                <div className="flex items-center gap-[6px] px-1 pt-1 text-[11.5px] font-bold text-stiko-muted">
                  <svg
                    className="h-[14px] w-[14px]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                  >
                    <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  {group.folder}
                </div>
              )}
              {group.items.map(({ entry, index }) => {
                const displayName = group.folder
                  ? entry.path.slice(entry.path.indexOf('/') + 1)
                  : entry.file.name;
                return (
                  <div
                    key={`${entry.path}-${index}`}
                    className={`flex items-center justify-between gap-3 rounded-[10px] bg-stiko-app px-3 py-[9px] ${
                      group.folder ? 'ml-4' : ''
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-[10px]">
                      <FileChip filename={entry.file.name} />
                      <span className="truncate text-[12.5px] font-bold text-stiko-ink">
                        {displayName}
                      </span>
                      <span className="shrink-0 text-[11px] text-stiko-faint">
                        {formatFileSize(entry.file.size)}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${displayName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(index);
                      }}
                      className="shrink-0 text-stiko-faint transition hover:text-[#B23A52]"
                    >
                      <svg
                        className="h-[15px] w-[15px]"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.2}
                        strokeLinecap="round"
                      >
                        <path d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
