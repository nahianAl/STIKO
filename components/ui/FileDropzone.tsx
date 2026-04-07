'use client';

import React, { useRef, useState, useCallback } from 'react';

export interface FileWithPath {
  file: File;
  path: string; // relative path including filename, e.g. "MyFolder/part1.glb" or "render.png"
}

interface FileDropzoneProps {
  files: FileWithPath[];
  onFilesChange: (files: FileWithPath[]) => void;
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

export default function FileDropzone({ files, onFilesChange }: FileDropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const addFiles = useCallback(
    (newFiles: FileWithPath[]) => {
      onFilesChange([...files, ...newFiles]);
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
    const updated = files.filter((_, i) => i !== index);
    onFilesChange(updated);
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
        className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors duration-150 ${
          isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 bg-gray-50 hover:border-gray-400'
        }`}
      >
        <svg
          className="mx-auto h-10 w-10 text-gray-400 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="text-sm text-gray-600 mb-1">
          Drag and drop files or folders here, or click to browse files
        </p>
        <p className="text-xs text-gray-400 mb-2">
          Supports images, videos, PDFs, and 3D files
        </p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            folderInputRef.current?.click();
          }}
          className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
        >
          or select a folder
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
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

      {files.length > 0 && (
        <div className="mt-4 space-y-1">
          {groupedFiles.map((group) => (
            <div key={group.folder ?? '__root__'}>
              {group.folder && (
                <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  {group.folder}/
                </div>
              )}
              {group.items.map(({ entry, index }) => {
                const displayName = group.folder
                  ? entry.path.slice(entry.path.indexOf('/') + 1)
                  : entry.file.name;
                return (
                  <div
                    key={`${entry.path}-${index}`}
                    className={`flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2 ${
                      group.folder ? 'ml-6' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <svg
                        className="h-4 w-4 text-gray-400 flex-shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      <div className="min-w-0">
                        <p className="text-sm text-gray-900 truncate">{displayName}</p>
                        <p className="text-xs text-gray-400">{formatFileSize(entry.file.size)}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeFile(index)}
                      className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 ml-2"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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
