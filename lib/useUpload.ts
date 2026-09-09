'use client';

import { useCallback, useRef, useState } from 'react';
import type { FileWithPath } from '@/components/ui/FileDropzone';
import type { UploadItem } from '@/components/ui/UploadProgress';
import { prepareViewerVariant, shouldPrepareVariant } from '@/lib/model/runOptimize';
import {
  MAX_UPLOAD_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  isRetriableUploadFailure,
  retryDelayMs,
  shouldAbortForStall,
} from '@/lib/uploadRetry';

/**
 * Parallel, per-file upload with progress and retry — gap #12.
 *
 * The old flow uploaded sequentially with no progress and no way to recover a
 * single failure. This runs a bounded pool, reports each file separately, and
 * lets one failure be retried without restarting the batch.
 */

/** Enough to saturate a connection without starving the browser's socket pool. */
const CONCURRENCY = 4;

/** A failure carrying the HTTP status, or null when no response ever arrived. */
interface UploadAttemptError extends Error {
  status: number | null;
}

/**
 * One PUT attempt straight to R2.
 *
 * XHR rather than fetch: fetch still has no upload progress event.
 */
function putOnce(
  url: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // A black-holed socket fires neither onload nor onerror, so without this the
    // promise never settles and putWithRetry never gets a rejection to react to.
    // One such file used to wedge the whole batch forever — no error, no failed
    // state, and no retry button, since that only renders for state === 'failed'.
    let lastProgressAt = Date.now();
    let settled = false;
    const watchdog = setInterval(() => {
      // abort() fires onabort below, which rejects as retriable — so a stall
      // becomes an ordinary retry rather than either a hang or a hard failure.
      if (shouldAbortForStall(Date.now() - lastProgressAt)) xhr.abort();
    }, 5_000);

    /** Settle exactly once and always stop the watchdog. */
    const settle = (act: () => void) => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      act();
    };

    const failWith = (message: string, status: number | null) => {
      const err = new Error(message) as UploadAttemptError;
      err.status = status;
      reject(err);
    };

    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      lastProgressAt = Date.now();
      // e.total is 0 for a zero-byte file, and 0/0 renders as "NaN%".
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () =>
      settle(() => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        failWith(`Upload failed (${xhr.status})`, xhr.status);
      });
    // No HTTP response ever arrived — a connection reset, a dropped VPN, a proxy
    // closing the socket. xhr.status is 0 here, which is precisely the case
    // isRetriableUploadFailure treats as worth another go.
    xhr.onerror = () => settle(() => failWith('Upload failed', null));
    xhr.onabort = () =>
      settle(() => failWith('Upload stalled and was restarted', null));
    xhr.send(file);
  });
}

/**
 * PUT with bounded retries.
 *
 * The browser uploads directly to R2, so anything between the two can reset the
 * connection — flaky wifi, a VPN, a corporate proxy doing TLS inspection, a
 * laptop suspending. This used to reject on the first `xhr.onerror`, so a single
 * blip permanently failed an upload that would have succeeded immediately after.
 * Observed 2026-09-08: a 23MB GLB failed three times with ERR_CONNECTION_RESET
 * for one user while uploading in 14 seconds from another network.
 *
 * The same presigned URL is reused across attempts. That is why the backoff is
 * capped and why the URL is minted with a generous expiry — the waiting spends
 * the URL's lifetime, and retrying against an expired one would turn a retriable
 * reset into a certain 403.
 */
async function putWithRetry(
  url: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await putOnce(url, file, onProgress);
      return;
    } catch (err) {
      const status = (err as UploadAttemptError).status ?? null;
      const lastAttempt = attempt >= MAX_UPLOAD_ATTEMPTS - 1;
      if (lastAttempt || !isRetriableUploadFailure(status)) throw err;

      console.warn(
        `Upload of ${file.name} failed (${status ?? 'network error'}); ` +
          `retrying, attempt ${attempt + 2} of ${MAX_UPLOAD_ATTEMPTS}`
      );
      // The retry restarts the transfer from zero, so the bar must too rather
      // than appearing stuck at wherever the dropped attempt reached.
      onProgress(0);
      await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
    }
  }
}

export function useUpload() {
  const [items, setItems] = useState<UploadItem[]>([]);
  // Kept in a ref as well so retry can read the current list without the
  // callback closing over a stale copy.
  const filesRef = useRef<Map<string, FileWithPath>>(new Map());
  const contextRef = useRef<{
    versionId: string;
    projectId: string;
    portalId: string;
  } | null>(null);

  // Mirrors `items` so retryFailed can read the CURRENT states from inside an
  // async callback, rather than a copy frozen at whatever render created it —
  // the same reason filesRef exists.
  const itemsRef = useRef<UploadItem[]>([]);
  itemsRef.current = items;

  const patch = useCallback((path: string, next: Partial<UploadItem>) => {
    setItems((prev) =>
      prev.map((i) => (i.path === path ? { ...i, ...next } : i))
    );
  }, []);

  const uploadOne = useCallback(
    async (entry: FileWithPath): Promise<boolean> => {
      const ctx = contextRef.current;
      if (!ctx) return false;

      patch(entry.path, { state: 'uploading', progress: 0 });

      try {
        const presignRes = await fetch('/api/files/upload', {
          method: 'POST',
          // Small same-origin JSON. A flat timeout is right here, where it would be
          // wrong for the file PUT — see the note on STALL_TIMEOUT_MS.
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            versionId: ctx.versionId,
            projectId: ctx.projectId,
            portalId: ctx.portalId,
            filename: entry.file.name,
            contentType: entry.file.type || 'application/octet-stream',
          }),
        });
        if (!presignRes.ok) throw new Error('Could not get an upload URL');
        const { fileId, presignedUrl, storageKey, variantPresignedUrl } = await presignRes.json();

        await putWithRetry(presignedUrl, entry.file, (progress) =>
          patch(entry.path, { progress })
        );

        // Optimization happens AFTER the original is safely in S3, so a failure here can
        // never cost the upload. The original is what the uploader downloads; the
        // optimized copy is only ever what the viewer loads.
        //
        // The variant URL was presigned in the SAME call that presigned the original, so
        // there is no second round trip and the client never names the object it uploads.
        //
        // The entire optimization block — including the runOptimize call — is wrapped in
        // try/finally to enforce the invariant that state is ALWAYS restored on every path,
        // even if runOptimize (or any future change) unexpectedly rejects.
        let hasOptimizedVariant = false;
        if (variantPresignedUrl && shouldPrepareVariant(entry.file.name, entry.file.size)) {
          patch(entry.path, { state: 'optimizing' });
          try {
            const variant = await prepareViewerVariant(entry.file);

            if (variant) {
              try {
                const put = await fetch(variantPresignedUrl, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'model/gltf-binary' },
                  body: variant.buffer,
                });
                if (!put.ok) throw new Error(`Variant upload failed (${put.status})`);

                hasOptimizedVariant = true;
                console.info(variant.summary);
              } catch (err) {
                // Same policy as everywhere else here: the original is already uploaded and
                // the viewer falls back to it, so this is a downgrade, not a failure.
                console.warn(`Could not store optimised copy of ${entry.file.name}`, err);
                hasOptimizedVariant = false;
              }
            }
          } catch (err) {
            // Optimization may fail at any step: worker unavailable, timeout, out of memory,
            // or any error from runOptimize. None of these should block or fail the upload.
            console.warn(`Optimization failed for ${entry.file.name}`, err);
            hasOptimizedVariant = false;
          } finally {
            patch(entry.path, { state: 'uploading' });
          }
        }

        const folderPath = entry.path.includes('/')
          ? entry.path.slice(0, entry.path.lastIndexOf('/'))
          : null;

        const completeRes = await fetch('/api/files/complete', {
          method: 'POST',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileId,
            versionId: ctx.versionId,
            filename: entry.file.name,
            storageKey,
            fileSize: entry.file.size,
            fileType: entry.file.type || 'application/octet-stream',
            folderPath,
            hasOptimizedVariant,
          }),
        });
        if (!completeRes.ok) throw new Error('Could not register the file');

        patch(entry.path, { state: 'done', progress: 100 });
        return true;
      } catch (err) {
        console.error(`Upload failed for ${entry.path}`, err);
        patch(entry.path, { state: 'failed' });
        return false;
      }
    },
    [patch]
  );

  /** Run entries through the bounded pool. Resolves true only if all succeeded. */
  const runPool = useCallback(
    async (entries: FileWithPath[]): Promise<boolean> => {
      const queue = [...entries];
      const results: boolean[] = [];

      const worker = async () => {
        for (;;) {
          const next = queue.shift();
          if (!next) return;
          results.push(await uploadOne(next));
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker)
      );

      return results.every(Boolean);
    },
    [uploadOne]
  );

  /** Upload everything in a bounded pool. Resolves true only if all succeeded. */
  const start = useCallback(
    async (
      files: FileWithPath[],
      context: { versionId: string; projectId: string; portalId: string }
    ): Promise<boolean> => {
      contextRef.current = context;
      filesRef.current = new Map(files.map((f) => [f.path, f]));

      setItems(
        files.map((f) => ({
          path: f.path,
          filename: f.file.name,
          progress: 0,
          bytes: f.file.size,
          state: 'pending' as const,
        }))
      );

      return runPool(files);
    },
    [runPool]
  );

  /**
   * Re-run ONLY the files that failed.
   *
   * The reason this exists rather than calling start() again: start() resets every
   * item to 'pending' and re-uploads the whole array, so recovering from one failure
   * in a batch of twenty re-sent all twenty — and since each upload mints a fresh
   * fileId server-side, the nineteen that had already succeeded were registered a
   * SECOND time. Reviewers saw every file twice and the first copies were orphaned.
   */
  const retryFailed = useCallback(async (): Promise<boolean> => {
    const failed = itemsRef.current
      .filter((i) => i.state === 'failed')
      .map((i) => filesRef.current.get(i.path))
      .filter((f): f is FileWithPath => Boolean(f));
    if (failed.length === 0) return true;
    return runPool(failed);
  }, [runPool]);

  /** Retry one failed file without restarting the batch. */
  const retry = useCallback(
    async (path: string): Promise<boolean> => {
      const entry = filesRef.current.get(path);
      if (!entry) return false;
      return uploadOne(entry);
    },
    [uploadOne]
  );

  const reset = useCallback(() => {
    setItems([]);
    filesRef.current = new Map();
    contextRef.current = null;
  }, []);

  const allDone = items.length > 0 && items.every((i) => i.state === 'done');
  const anyFailed = items.some((i) => i.state === 'failed');
  const doneCount = items.filter((i) => i.state === 'done').length;

  return { items, start, retry, retryFailed, reset, allDone, anyFailed, doneCount };
}
