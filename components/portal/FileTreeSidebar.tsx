'use client';

import React, { useState, useMemo } from 'react';
import { getFileChip } from '@/lib/fileChips';
import { SkeletonBar } from '@/components/ui/Primitives';

interface Version {
  id: string;
  portalId: string;
  versionNumber: number;
  createdAt: string;
  publishedAt: string | null;
  canDelete?: boolean;
  fileCount?: number;
  commentCount?: number;
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
  uploadedBy: string | null;
  /** Server's verdict on whether this caller may delete it. Never re-derived client-side. */
  canDelete?: boolean;
}

interface FileTreeSidebarProps {
  versions: Version[];
  /** version id -> AI-generated one-line headline, when a brief exists for it. */
  headlines?: Record<string, string>;
  selectedVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
  files: FileRecord[];
  selectedFileId: string | null;
  onSelectFile: (fileId: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Opens the new-version drawer (2e). Absent when the viewer can't upload. */
  onSubmitVersion?: () => void;
  /** True while versions are still being fetched — shows skeleton placeholders instead of the empty state. */
  loading?: boolean;
  /** Absent when the viewer may not delete anything — the row then renders no control. */
  onDeleteFile?: (file: FileRecord) => void;
  onDeleteVersion?: (version: Version) => void;
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
  onDeleteFile,
}: {
  folder: FolderNode;
  selectedFileId: string | null;
  onSelectFile: (fileId: string) => void;
  onDeleteFile?: (file: FileRecord) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      {/* Folder = a filled bar, distinct from the periwinkle version bars and the bare file rows */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[13px] font-semibold text-stiko-secondary bg-stiko-idle hover:bg-[#E7E8EF] transition-colors"
      >
        <svg className="h-4 w-4 text-stiko-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span className="flex-1 truncate text-left">{folder.name}</span>
        <svg className={`h-3.5 w-3.5 text-stiko-muted flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {expanded && (
        <div className="mt-1 pl-3 flex flex-col gap-1">
          {folder.files.map((file) => (
            <FileItem
              key={file.id}
              file={file}
              isSelected={file.id === selectedFileId}
              onSelect={() => onSelectFile(file.id)}
              onDelete={onDeleteFile}
            />
          ))}
          {folder.children.map((child) => (
            <FolderItem
              key={child.path}
              folder={child}
              selectedFileId={selectedFileId}
              onSelectFile={onSelectFile}
              onDeleteFile={onDeleteFile}
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
  onDelete,
}: {
  file: FileRecord;
  isSelected: boolean;
  onSelect: () => void;
  onDelete?: (file: FileRecord) => void;
}) {
  const chip = getFileChip(file.filename, file.fileType);
  // A div, not a button: the delete control is a sibling of the select control,
  // because a button inside a button is invalid and the two clicks would fight.
  return (
    <div className="group flex w-full items-center gap-2.5 py-1">
      <button
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <span className="text-[9px] font-extrabold px-[7px] py-[2px] rounded-full flex-shrink-0" style={{ background: chip.bg, color: chip.text }}>
          {chip.label}
        </span>
        <span className={`truncate text-[13px] ${isSelected ? 'font-semibold text-stiko-ink' : 'font-medium text-stiko-secondary group-hover:text-stiko-ink'}`}>
          {file.filename}
        </span>
      </button>

      {onDelete && file.canDelete && (
        <button
          onClick={() => onDelete(file)}
          aria-label={`Delete ${file.filename}`}
          title={`Delete ${file.filename}`}
          className="flex-shrink-0 rounded p-1 text-stiko-faint opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default function FileTreeSidebar({
  versions,
  headlines,
  selectedVersionId,
  onSelectVersion,
  files,
  selectedFileId,
  onSelectFile,
  collapsed,
  onToggleCollapse,
  onSubmitVersion,
  loading,
  onDeleteFile,
  onDeleteVersion,
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

      {/* Versions — each card is a filled bar that expands to its own files/folders */}
      <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto">
        {versions.length === 0 ? (
          loading ? (
            <div className="flex flex-col gap-2">
              <SkeletonBar height={44} />
              <SkeletonBar height={44} secondary />
            </div>
          ) : (
            <p className="text-[13px] text-stiko-faint py-2">Submit your first version to get started</p>
          )
        ) : (
          versions.map((version) => {
            const isSelected = version.id === selectedVersionId;
            const isCurrent = version.versionNumber === maxVersion;
            return (
              <div key={version.id}>
                <div className="group relative">
                  <button
                    onClick={() => onSelectVersion(version.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-[12px] text-left transition-colors ${isSelected ? 'bg-stiko-primary/20' : 'bg-stiko-primary/[0.08] hover:bg-stiko-primary/[0.14]'}`}
                  >
                    <span
                      className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 text-[13px] font-extrabold"
                      style={isCurrent
                        ? { background: 'linear-gradient(135deg, #8094F5, #5B60FF)', color: '#fff' }
                        : { background: '#FFFFFF', color: '#5A6076' }}
                    >
                      V{version.versionNumber}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className={`block text-[14px] truncate ${isCurrent ? 'font-bold text-stiko-ink' : 'font-semibold text-stiko-ink'}`}>
                        {isCurrent ? 'Current' : `Version ${version.versionNumber}`}
                      </span>
                      <span className="block text-[11px] text-stiko-muted">{formatDate(version.createdAt)}</span>
                      {headlines?.[version.id] && (
                        <span className="mt-0.5 block truncate text-xs font-normal text-gray-500">
                          {headlines[version.id]}
                        </span>
                      )}
                    </span>
                    <svg
                      className={`h-4 w-4 flex-shrink-0 transition-transform text-stiko-primary ${isSelected ? 'rotate-90' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>

                  {onDeleteVersion && version.canDelete && (
                    <button
                      onClick={() => onDeleteVersion(version)}
                      aria-label={`Delete version ${version.versionNumber}`}
                      title={`Delete version ${version.versionNumber}`}
                      className="absolute right-9 top-1/2 -translate-y-1/2 rounded p-1 text-stiko-faint opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Selected version's files (bare rows) + folders (filled bars), indented beneath */}
                {isSelected && (
                  <div className="mt-2 mb-1 pl-3 flex flex-col gap-1">
                    {files.length === 0 ? (
                      <p className="text-[12px] text-stiko-faint px-1 py-1">No files in this version</p>
                    ) : (
                      <>
                        {tree.rootFiles.map((file) => (
                          <FileItem key={file.id} file={file} isSelected={file.id === selectedFileId} onSelect={() => onSelectFile(file.id)} onDelete={onDeleteFile} />
                        ))}
                        {tree.folders.map((folder) => (
                          <FolderItem key={folder.path} folder={folder} selectedFileId={selectedFileId} onSelectFile={onSelectFile} onDeleteFile={onDeleteFile} />
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

      {/* Opens the drawer (2e) rather than navigating — the package stays
          mounted behind it, so no zoom or scroll is lost. */}
      {onSubmitVersion && (
        <button
          onClick={onSubmitVersion}
          className="flex-shrink-0 flex items-center justify-center gap-2 text-white font-bold text-[13px] py-2.5 rounded-[11px] shadow-stiko-primary transition-[filter] hover:brightness-[0.97]"
          style={{ background: 'linear-gradient(135deg, #8094F5, #5B60FF)' }}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Submit new version
        </button>
      )}
    </div>
  );
}
