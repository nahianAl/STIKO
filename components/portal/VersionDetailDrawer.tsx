'use client';

import React from 'react';
import Drawer from '@/components/ui/Drawer';
import VersionBrief from '@/components/portal/VersionBrief';
import { SkeletonBar } from '@/components/ui/Primitives';
import { getFileChip } from '@/lib/fileChips';
import {
  changelogFallback,
  fileMetaLine,
  versionSubtitle,
} from '@/lib/versionDetail';
import type { FileRecord, Version } from '@/lib/types';

/**
 * Everything about one version, behind one icon.
 *
 * This exists so the rail can go back to being a navigator. Deleting is rare —
 * well under one percent of the time anyone spends looking at a version — and
 * its controls were attached to the rows people click constantly.
 *
 * The Brief lives here too. It summarises a whole version, but it used to
 * render inside the per-file comment panel, so the same brief was repeated
 * above every file's comments in the narrowest column on the page.
 *
 * Every control gates on a server-sent verdict. Nothing here re-derives a
 * permission: a hidden button and a 403 must never be able to disagree.
 */

const FOCUS = 'focus:outline-none focus-visible:shadow-stiko-focus';

/** Matches the rail's format, so the same file reads the same in both places. */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-[9px] text-[10px] font-extrabold uppercase tracking-label text-stiko-faint">
      {children}
    </h3>
  );
}

function FileCard({
  file,
  onSelect,
  onDelete,
  onDownload,
}: {
  file: FileRecord;
  onSelect: () => void;
  onDelete?: (file: FileRecord) => void;
  onDownload?: (file: FileRecord) => void;
}) {
  const chip = getFileChip(file.filename, file.fileType);
  const comments = file.commentCount ?? 0;

  // A div with sibling buttons, not a button wrapping buttons: nesting is
  // invalid HTML and the two click targets fight each other.
  return (
    <div className="mb-[7px] flex items-center gap-2.5 rounded-[11px] border border-stiko-border p-[9px_10px] transition-colors hover:border-stiko-divider">
      <button
        type="button"
        onClick={onSelect}
        className={`flex min-w-0 flex-1 items-center gap-2.5 text-left ${FOCUS}`}
      >
        <span
          className="flex-shrink-0 rounded-full px-[7px] py-[3px] text-[8.5px] font-extrabold"
          style={{ background: chip.bg, color: chip.text }}
        >
          {chip.label}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-bold text-stiko-ink">
            {file.filename}
          </span>
          <span className="block truncate text-[10.5px] text-stiko-muted">
            {fileMetaLine({
              uploadedByName: file.uploadedByName,
              dateLabel: formatDateTime(file.createdAt),
              fileSize: file.fileSize,
            })}
          </span>
          {file.folderPath && (
            <span className="mt-[1px] block truncate text-[10.5px] text-stiko-faint">
              {file.folderPath}
            </span>
          )}
        </span>
      </button>

      <span
        title={`${comments} comment${comments === 1 ? '' : 's'}`}
        className={`flex flex-shrink-0 items-center gap-[3px] rounded-chip px-[7px] py-[3px] text-[9.5px] font-bold ${
          comments > 0
            ? 'bg-stiko-tint text-stiko-primary'
            : 'bg-stiko-subtle text-stiko-faint'
        }`}
      >
        <svg className="h-[9px] w-[9px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path d="M21 12c0 4.4-4 8-9 8a9.9 9.9 0 01-4.3-.9L3 20l1.4-3.7A7.9 7.9 0 013 12c0-4.4 4-8 9-8s9 3.6 9 8z" />
        </svg>
        {comments}
      </span>

      {onDownload && file.canDownload && (
        <button
          type="button"
          onClick={() => onDownload(file)}
          aria-label={`Download ${file.filename}`}
          title={`Download ${file.filename}`}
          className={`flex-shrink-0 rounded-[7px] border border-stiko-border p-[5px] text-stiko-secondary transition hover:bg-stiko-app hover:text-stiko-ink ${FOCUS}`}
        >
          <svg className="h-[13px] w-[13px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      )}

      {onDelete && file.canDelete && (
        <button
          type="button"
          onClick={() => onDelete(file)}
          aria-label={`Delete ${file.filename}`}
          title={`Delete ${file.filename}`}
          className={`flex-shrink-0 rounded-[7px] border border-stiko-chip-red p-[5px] text-note-red-text transition hover:bg-note-red ${FOCUS}`}
        >
          <svg className="h-[13px] w-[13px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default function VersionDetailDrawer({
  version,
  isCurrent,
  files,
  filesLoading,
  briefGenerating,
  confirmOpen,
  offsetLeft,
  onClose,
  onSelectFile,
  onSelectCitedComment,
  onDeleteFile,
  onDownloadFile,
  onDeleteVersion,
}: {
  version: Version | null;
  isCurrent: boolean;
  files: FileRecord[];
  filesLoading: boolean;
  /** True while the page is auto-generating this version's brief. Passed
   *  straight through so the Brief cannot offer a button that would fire a
   *  second, concurrent call to a paid endpoint. */
  briefGenerating: boolean;
  /** True while a delete confirm is open above this drawer. */
  confirmOpen: boolean;
  /** Where the panel's left edge sits, measured from the layout row it is
   *  rendered into — the rail's width plus the grid gap. The page owns this
   *  arithmetic because only it knows whether the rail is collapsed. */
  offsetLeft: number;
  onClose: () => void;
  onSelectFile: (fileId: string) => void;
  onSelectCitedComment: (commentId: string, fileId: string) => void;
  onDeleteFile?: (file: FileRecord) => void;
  onDownloadFile?: (file: FileRecord) => void;
  onDeleteVersion?: (version: Version) => void;
}) {
  // Open is derived from the version being resolvable, not from a boolean the
  // page has to remember to clear. Deleting the version removes it from the
  // rail's list, which closes this with no extra bookkeeping.
  if (!version) return null;

  const isPublished = version.publishedAt !== null;
  const fallback = changelogFallback({ changelog: version.changelog, isPublished });

  return (
    <Drawer
      isOpen
      onClose={onClose}
      closeOnEscape={!confirmOpen}
      // Beside the version rail rather than at the window's right edge, and
      // bounded to the rail's own height instead of the full window.
      anchor="inline"
      offsetLeft={offsetLeft}
      title={`Version ${version.versionNumber}`}
      subtitle={versionSubtitle({
        isCurrent,
        isPublished,
        // Published date when there is one, creation date for a draft. Written
        // as ?? rather than a non-null assertion: TypeScript cannot narrow
        // publishedAt through the isPublished boolean, and the fallback is the
        // same value the assertion would have forced.
        dateLabel: formatDay(version.publishedAt ?? version.createdAt),
        createdByName: version.createdByName,
      })}
    >
      <div className="flex flex-col gap-6">
        <section>
          <SectionLabel>Files{filesLoading ? '' : ` · ${files.length}`}</SectionLabel>
          {filesLoading ? (
            <div className="flex flex-col gap-[7px]">
              <SkeletonBar height={52} />
              <SkeletonBar height={52} secondary />
            </div>
          ) : files.length === 0 ? (
            <p className="text-[12.5px] text-stiko-faint">No files in this version.</p>
          ) : (
            files.map((file) => (
              <FileCard
                key={file.id}
                file={file}
                onSelect={() => {
                  onSelectFile(file.id);
                  onClose();
                }}
                onDelete={onDeleteFile}
                onDownload={onDownloadFile}
              />
            ))
          )}
        </section>

        <section>
          <SectionLabel>What changed in this version</SectionLabel>
          {fallback ? (
            <p className="rounded-[11px] bg-stiko-subtle p-[11px_12px] text-[12.5px] italic leading-[1.55] text-stiko-faint">
              {fallback}
            </p>
          ) : (
            <p className="whitespace-pre-wrap rounded-[11px] bg-stiko-subtle p-[11px_12px] text-[12.5px] leading-[1.55] text-stiko-secondary">
              {version.changelog}
            </p>
          )}
        </section>

        {/* Renders nothing below BRIEF_MIN_COMMENTS — no card, no placeholder. */}
        <VersionBrief
          versionId={version.id}
          autoBusy={briefGenerating}
          onSelectComment={(commentId, fileId) => {
            onSelectCitedComment(commentId, fileId);
            onClose();
          }}
        />

        {onDeleteVersion && version.canDelete && (
          <button
            type="button"
            onClick={() => onDeleteVersion(version)}
            className={`w-full rounded-[11px] border border-stiko-chip-red bg-white p-[10px] text-[12.5px] font-bold text-note-red-text transition hover:bg-note-red ${FOCUS}`}
          >
            Delete Version {version.versionNumber} and everything in it
          </button>
        )}
      </div>
    </Drawer>
  );
}
