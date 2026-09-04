'use client';

import React, { useState, useMemo } from 'react';
import { getFileChip } from '@/lib/fileChips';
import { SkeletonBar } from '@/components/ui/Primitives';
import type { FileRecord, Version } from '@/lib/types';

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
  /** Opens the version detail drawer. Required, not optional: every role can
   *  open it, and the controls inside it gate themselves individually. */
  onOpenVersionDetails: (version: Version) => void;
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
}: {
  folder: FolderNode;
  selectedFileId: string | null;
  onSelectFile: (fileId: string) => void;
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
            />
          ))}
          {folder.children.map((child) => (
            <FolderItem
              key={child.path}
              folder={child}
              selectedFileId={selectedFileId}
              onSelectFile={onSelectFile}
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
}: {
  file: FileRecord;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const chip = getFileChip(file.filename, file.fileType);
  return (
    <button
      onClick={onSelect}
      className="group flex w-full items-center gap-2.5 py-1 text-left"
    >
      <span className="text-[9px] font-extrabold px-[7px] py-[2px] rounded-full flex-shrink-0" style={{ background: chip.bg, color: chip.text }}>
        {chip.label}
      </span>
      <span className={`truncate text-[13px] ${isSelected ? 'font-semibold text-stiko-ink' : 'font-medium text-stiko-secondary group-hover:text-stiko-ink'}`}>
        {file.filename}
      </span>
    </button>
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
  onOpenVersionDetails,
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
            <p className="text-[13px] text-stiko-faint py-2">
              {onSubmitVersion
                ? 'Submit your first version to get started'
                : 'Nothing in this package has been shared with you yet'}
            </p>
          )
        ) : (
          versions.map((version) => {
            const isSelected = version.id === selectedVersionId;
            const isCurrent = version.versionNumber === maxVersion;
            return (
              <div key={version.id}>
                {/* A div with two sibling buttons, not a button containing a
                    button: nesting is invalid HTML and the two click targets
                    would fight. The card still selects the version and expands
                    its files; the icon opens the detail drawer. */}
                <div
                  className={`flex items-center gap-3 rounded-[12px] pr-2 transition-colors ${isSelected ? 'bg-stiko-primary/20' : 'bg-stiko-primary/[0.08] hover:bg-stiko-primary/[0.14]'}`}
                >
                  <button
                    onClick={() => onSelectVersion(version.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
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
                  </button>

                  {/* Always visible, not hover-revealed: this is now the only
                      route to the version's files, changelog and Brief. */}
                  <button
                    onClick={() => onOpenVersionDetails(version)}
                    aria-label={`Open version ${version.versionNumber} details`}
                    title={`Version ${version.versionNumber} details`}
                    className="flex-shrink-0 rounded-[8px] p-1.5 text-stiko-primary transition hover:bg-stiko-primary/20 focus:outline-none focus-visible:shadow-stiko-focus"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5v4m0-4h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                    </svg>
                  </button>
                </div>

                {/* Selected version's files (bare rows) + folders (filled bars), indented beneath */}
                {isSelected && (
                  <div className="mt-2 mb-1 pl-3 flex flex-col gap-1">
                    {files.length === 0 ? (
                      <p className="text-[12px] text-stiko-faint px-1 py-1">No files in this version</p>
                    ) : (
                      <>
                        {tree.rootFiles.map((file) => (
                          <FileItem key={file.id} file={file} isSelected={file.id === selectedFileId} onSelect={() => onSelectFile(file.id)} />
                        ))}
                        {tree.folders.map((folder) => (
                          <FolderItem key={folder.path} folder={folder} selectedFileId={selectedFileId} onSelectFile={onSelectFile} />
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
