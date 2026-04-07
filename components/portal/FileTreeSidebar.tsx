'use client';

import React, { useState, useMemo } from 'react';

interface Version {
  id: string;
  portalId: string;
  versionNumber: number;
  createdAt: string;
}

interface FileRecord {
  id: string;
  versionId: string;
  filename: string;
  storageKey: string;
  fileSize: number;
  fileType: string;
  createdAt: string;
  conversionStatus: 'pending' | 'processing' | 'completed' | 'failed' | null;
  convertedStorageKey: string | null;
  conversionJobId: string | null;
  folderPath: string | null;
}

interface FileTreeSidebarProps {
  versions: Version[];
  selectedVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
  files: FileRecord[];
  selectedFileId: string | null;
  onSelectFile: (fileId: string) => void;
}

interface FolderNode {
  name: string;
  path: string;
  files: FileRecord[];
  children: FolderNode[];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getFileIcon(fileType: string, filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (fileType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'image';
  if (fileType.startsWith('video/') || ['mp4', 'mov', 'webm', 'avi'].includes(ext)) return 'video';
  if (fileType === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['glb', 'gltf', 'step', 'stp'].includes(ext)) return '3d';
  return 'file';
}

function FileIcon({ type, className }: { type: string; className?: string }) {
  const cls = className || 'h-4 w-4';
  switch (type) {
    case 'image':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    case 'video':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      );
    case 'pdf':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
    case '3d':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      );
    default:
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
  }
}

function buildFolderTree(files: FileRecord[]): { rootFiles: FileRecord[]; folders: FolderNode[] } {
  const rootFiles: FileRecord[] = [];
  const folderMap = new Map<string, FileRecord[]>();

  for (const file of files) {
    const fp = file.folderPath;
    if (!fp) {
      rootFiles.push(file);
    } else {
      if (!folderMap.has(fp)) folderMap.set(fp, []);
      folderMap.get(fp)!.push(file);
    }
  }

  // Build nested folder structure from paths like "A/B/C"
  const topFolders = new Map<string, FolderNode>();

  for (const [path, folderFiles] of Array.from(folderMap.entries())) {
    const parts = path.split('/');
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      if (i === 0) {
        if (!topFolders.has(parts[0])) {
          topFolders.set(parts[0], { name: parts[0], path: parts[0], files: [], children: [] });
        }
        if (i === parts.length - 1) {
          topFolders.get(parts[0])!.files.push(...folderFiles);
        }
      } else {
        // Find parent and add child
        const parentPath = parts.slice(0, i).join('/');
        const parent = findNode(Array.from(topFolders.values()), parentPath);
        if (parent) {
          let child = parent.children.find((c) => c.path === currentPath);
          if (!child) {
            child = { name: parts[i], path: currentPath, files: [], children: [] };
            parent.children.push(child);
          }
          if (i === parts.length - 1) {
            child.files.push(...folderFiles);
          }
        }
      }
    }
  }

  return {
    rootFiles,
    folders: Array.from(topFolders.values()).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function findNode(nodes: FolderNode[], path: string): FolderNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const found = findNode(node.children, path);
    if (found) return found;
  }
  return null;
}

function FolderItem({
  folder,
  selectedFileId,
  onSelectFile,
  depth,
}: {
  folder: FolderNode;
  selectedFileId: string | null;
  onSelectFile: (fileId: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <svg
          className={`h-3 w-3 text-gray-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <svg className="h-4 w-4 text-yellow-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span className="truncate font-medium">{folder.name}</span>
      </button>
      {expanded && (
        <div>
          {folder.children.map((child) => (
            <FolderItem
              key={child.path}
              folder={child}
              selectedFileId={selectedFileId}
              onSelectFile={onSelectFile}
              depth={depth + 1}
            />
          ))}
          {folder.files.map((file) => (
            <FileItem
              key={file.id}
              file={file}
              isSelected={file.id === selectedFileId}
              onSelect={() => onSelectFile(file.id)}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FileItem({
  file,
  isSelected,
  onSelect,
  depth,
}: {
  file: FileRecord;
  isSelected: boolean;
  onSelect: () => void;
  depth: number;
}) {
  const iconType = getFileIcon(file.fileType, file.filename);
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors ${
        isSelected
          ? 'bg-blue-50 text-blue-700'
          : 'text-gray-700 hover:bg-gray-100'
      }`}
      style={{ paddingLeft: `${8 + depth * 16 + 16}px` }}
    >
      <span className={`flex-shrink-0 ${isSelected ? 'text-blue-500' : 'text-gray-400'}`}>
        <FileIcon type={iconType} className="h-3.5 w-3.5" />
      </span>
      <span className="truncate">{file.filename}</span>
    </button>
  );
}

export default function FileTreeSidebar({
  versions,
  selectedVersionId,
  onSelectVersion,
  files,
  selectedFileId,
  onSelectFile,
}: FileTreeSidebarProps) {
  const tree = useMemo(() => buildFolderTree(files), [files]);

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">Versions</h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        {versions.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8 px-4">
            Submit your first version to get started
          </p>
        ) : (
          versions.map((version) => {
            const isSelected = version.id === selectedVersionId;
            return (
              <div key={version.id}>
                {/* Version header */}
                <button
                  onClick={() => onSelectVersion(version.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${
                    isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <svg
                      className={`h-3 w-3 transition-transform flex-shrink-0 ${isSelected ? 'rotate-90 text-blue-500' : 'text-gray-400'}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className={`text-sm font-semibold ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                      V{version.versionNumber}
                    </span>
                    <span className="text-xs text-gray-400 ml-auto">
                      {formatDate(version.createdAt)}
                    </span>
                  </div>
                </button>

                {/* Expanded file tree for selected version */}
                {isSelected && files.length > 0 && (
                  <div className="py-1">
                    {tree.folders.map((folder) => (
                      <FolderItem
                        key={folder.path}
                        folder={folder}
                        selectedFileId={selectedFileId}
                        onSelectFile={onSelectFile}
                        depth={0}
                      />
                    ))}
                    {tree.rootFiles.map((file) => (
                      <FileItem
                        key={file.id}
                        file={file}
                        isSelected={file.id === selectedFileId}
                        onSelect={() => onSelectFile(file.id)}
                        depth={0}
                      />
                    ))}
                  </div>
                )}

                {isSelected && files.length === 0 && (
                  <p className="text-xs text-gray-400 px-4 py-3">No files in this version</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
