'use client';

import React from 'react';
import { FileChip } from './Primitives';

export type UploadState = 'pending' | 'uploading' | 'done' | 'failed';

export interface UploadItem {
  path: string;
  filename: string;
  /** 0–100. */
  progress: number;
  bytes: number;
  state: UploadState;
  /** 2e: a file that supersedes an existing one carries a REPLACES V4 chip. */
  replacesVersion?: number | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

/**
 * Upload progress row (02). Three states share one shape so nothing jumps as a
 * file moves between them.
 */
export function UploadProgressRow({
  item,
  onRetry,
}: {
  item: UploadItem;
  onRetry?: (path: string) => void;
}) {
  const track =
    item.state === 'done'
      ? '#EDFFDA'
      : item.state === 'failed'
        ? '#FFE2E2'
        : '#F1F3FF';

  return (
    <div className="flex flex-col gap-[6px]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-[10px]">
          <FileChip filename={item.filename} />
          <span className="truncate text-[12.5px] font-bold text-stiko-ink">
            {item.filename}
          </span>
          {item.replacesVersion != null && (
            <span
              className="shrink-0 rounded-chip px-[6px] py-[3px] text-[10px] font-extrabold uppercase"
              style={{ background: '#FFFCCE', color: '#7A5E00' }}
            >
              Replaces V{item.replacesVersion}
            </span>
          )}
        </div>

        <div className="shrink-0 text-[11.5px]">
          {item.state === 'done' && (
            <span className="font-bold text-[#4B7A28]">Done</span>
          )}
          {item.state === 'failed' && (
            <span className="flex items-center gap-2">
              <span className="font-bold text-[#B23A52]">Upload failed</span>
              {onRetry && (
                <button
                  onClick={() => onRetry(item.path)}
                  className="font-bold text-stiko-primary hover:text-stiko-primary-hover"
                >
                  Retry
                </button>
              )}
            </span>
          )}
          {(item.state === 'uploading' || item.state === 'pending') && (
            <span className="text-stiko-muted">
              {item.progress}% · {formatSize(item.bytes)}
            </span>
          )}
        </div>
      </div>

      <div
        className="h-[5px] w-full overflow-hidden rounded-full"
        style={{ background: track }}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${
            item.state === 'done'
              ? 'bg-[#7BC24A]'
              : item.state === 'failed'
                ? 'bg-[#FF6B6B]'
                : 'bg-gradient-to-r from-[#8094F5] to-[#5B60FF]'
          }`}
          style={{
            width: `${item.state === 'done' || item.state === 'failed' ? 100 : item.progress}%`,
          }}
        />
      </div>
    </div>
  );
}
