'use client';

import { useCallback, useRef, useState } from 'react';
import type { FileWithPath } from '@/components/ui/FileDropzone';
import type { UploadItem } from '@/components/ui/UploadProgress';
import { runOptimize, shouldOptimize } from '@/lib/model/runOptimize';

/**
 * Parallel, per-file upload with progress and retry — gap #12.
 *
 * The old flow uploaded sequentially with no progress and no way to recover a
 * single failure. This runs a bounded pool, reports each file separately, and
 * lets one failure be retried without restarting the batch.
 */

/** Enough to saturate a connection without starving the browser's socket pool. */
const CONCURRENCY = 4;

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

        // XHR rather than fetch: fetch still has no upload progress event.
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', presignedUrl);
          xhr.setRequestHeader(
            'Content-Type',
            entry.file.type || 'application/octet-stream'
          );
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              patch(entry.path, {
                progress: Math.round((e.loaded / e.total) * 100),
              });
            }
          };
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(new Error(`Upload failed (${xhr.status})`));
          xhr.onerror = () => reject(new Error('Upload failed'));
          xhr.send(entry.file);
        });

        // Optimization happens AFTER the original is safely in S3, so a failure here can
        // never cost the upload. The original is what the uploader downloads; the
        // optimized copy is only ever what the viewer loads.
        //
        // The variant URL was presigned in the SAME call that presigned the original, so
        // there is no second round trip and the client never names the object it uploads.
        let hasOptimizedVariant = false;
        if (variantPresignedUrl && shouldOptimize(entry.file.name, entry.file.size)) {
          patch(entry.path, { state: 'optimizing' });
          const optimized = await runOptimize(entry.file);

          if (optimized) {
            try {
              const put = await fetch(variantPresignedUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'model/gltf-binary' },
                body: optimized.buffer,
              });
              if (!put.ok) throw new Error(`Variant upload failed (${put.status})`);

              hasOptimizedVariant = true;
              const { before, after } = optimized.stats;
              console.info(
                `Optimised ${entry.file.name}: ${before.primitives} → ${after.primitives} draw calls, ` +
                  `${after.triangles} triangles preserved, ` +
                  `${Math.round(before.bytes / 1024)}KB → ${Math.round(after.bytes / 1024)}KB`
              );
            } catch (err) {
              // Same policy as everywhere else here: the original is already uploaded and
              // the viewer falls back to it, so this is a downgrade, not a failure.
              console.warn(`Could not store optimised copy of ${entry.file.name}`, err);
              hasOptimizedVariant = false;
            }
          }

          patch(entry.path, { state: 'uploading' });
        }

        const folderPath = entry.path.includes('/')
          ? entry.path.slice(0, entry.path.lastIndexOf('/'))
          : null;

        const completeRes = await fetch('/api/files/complete', {
          method: 'POST',
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

      const queue = [...files];
      const results: boolean[] = [];

      const worker = async () => {
        for (;;) {
          const next = queue.shift();
          if (!next) return;
          results.push(await uploadOne(next));
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker)
      );

      return results.every(Boolean);
    },
    [uploadOne]
  );

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

  return { items, start, retry, reset, allDone, anyFailed, doneCount };
}
