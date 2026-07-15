'use client';

import React, { useState, useMemo } from 'react';
import { getFileChip } from '@/lib/fileChips';

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
  collapsed?: boolean;
  onToggleCollapse?: () => void;
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
        className="w-full flex items-center gap-1.5 px-[11px] py-[9px] rounded-[10px] text-[13px] font-medium text-stiko-secondary hover:bg-stiko-subtle transition-colors"
        style={{ paddingLeft: `${11 + depth * 14}px` }}
      >
        <svg className={`h-3 w-3 text-stiko-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-[9px] font-extrabold px-[6px] py-[4px] rounded-md flex-shrink-0" style={{ background: '#EFEFF4', color: '#5A6076' }}>DIR</span>
        <span className="truncate">{folder.name}</span>
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
  const chip = getFileChip(file.filename, file.fileType);
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-[10px] px-[11px] py-[9px] rounded-[10px] text-left transition-colors ${isSelected ? 'bg-stiko-subtle' : 'hover:bg-stiko-subtle'}`}
      style={{ paddingLeft: `${11 + depth * 14}px` }}
    >
      <span className="text-[9px] font-extrabold px-[6px] py-[4px] rounded-md flex-shrink-0" style={{ background: chip.bg, color: chip.text }}>
        {chip.label}
      </span>
      <span className={`truncate text-[13px] ${isSelected ? 'font-bold text-stiko-ink' : 'font-medium text-stiko-secondary'}`}>
        {file.filename}
      </span>
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
  collapsed,
  onToggleCollapse,
}: FileTreeSidebarProps) {
  const tree = useMemo(() => buildFolderTree(files), [files]);
  const maxVersion = versions.reduce((m, v) => Math.max(m, v.versionNumber), 0);

  // Collapsed state: narrow strip with toggle + version count
  if (collapsed) {
    return (
      <div className="flex flex-col items-center h-full bg-white rounded-panel shadow-stiko-panel py-3 px-1">
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg hover:bg-stiko-subtle transition-colors text-stiko-muted"
          title="Expand versions"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <div className="mt-3 flex flex-col items-center gap-1">
          <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          {versions.length > 0 && (
            <span className="text-xs font-medium text-gray-500">{versions.length}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-panel shadow-stiko-panel p-[18px_14px] gap-5 overflow-hidden">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-stiko-faint">Versions</span>
        {onToggleCollapse && (
          <button onClick={onToggleCollapse} title="Collapse" className="p-1 rounded-lg text-stiko-faint hover:bg-stiko-subtle transition-colors">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
        )}
      </div>

      {/* Versions — each card expands to its own folders/files when selected */}
      <div className="flex flex-col gap-[5px] flex-1 min-h-0 overflow-y-auto">
        {versions.length === 0 ? (
          <p className="text-[13px] text-stiko-faint py-2">Submit your first version to get started</p>
        ) : (
          versions.map((version) => {
            const isSelected = version.id === selectedVersionId;
            const isCurrent = version.versionNumber === maxVersion;
            return (
              <div key={version.id}>
                <button
                  onClick={() => onSelectVersion(version.id)}
                  className={`w-full flex items-center gap-[10px] px-3 py-[10px] rounded-[11px] text-left transition-colors ${isSelected ? 'bg-stiko-tint' : 'hover:bg-stiko-subtle'}`}
                >
                  <span
                    className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center flex-shrink-0 text-[12px] font-extrabold"
                    style={isCurrent
                      ? { background: 'linear-gradient(135deg, #8094F5, #5B60FF)', color: '#fff' }
                      : { background: '#EFEFF4', color: '#5A6076' }}
                  >
                    V{version.versionNumber}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-[13px] truncate ${isCurrent ? 'font-bold text-stiko-ink' : 'font-semibold text-stiko-secondary'}`}>
                      {isCurrent ? 'Current' : `Version ${version.versionNumber}`}
                    </span>
                    <span className="block text-[11px] text-stiko-muted">{formatDate(version.createdAt)}</span>
                  </span>
                  <svg
                    className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${isSelected ? 'rotate-90 text-stiko-primary' : 'text-stiko-muted'}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {/* Nested folders/files for the selected version */}
                {isSelected && (
                  <div className="mt-1 mb-1 pl-1 flex flex-col gap-1">
                    {files.length === 0 ? (
                      <p className="text-[12px] text-stiko-faint px-3 py-1">No files in this version</p>
                    ) : (
                      <>
                        {tree.folders.map((folder) => (
                          <FolderItem key={folder.path} folder={folder} selectedFileId={selectedFileId} onSelectFile={onSelectFile} depth={0} />
                        ))}
                        {tree.rootFiles.map((file) => (
                          <FileItem key={file.id} file={file} isSelected={file.id === selectedFileId} onSelect={() => onSelectFile(file.id)} depth={0} />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
