import type { CommentAttachment } from '@/lib/types';

/** Presign, PUT to S3, and return the attachment record. */
export async function uploadFile(file: File): Promise<CommentAttachment> {
  const res = await fetch('/api/comments/attachments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, contentType: file.type }),
  });
  const { presignedUrl, storageKey } = await res.json();

  await fetch(presignedUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });

  return { storageKey, filename: file.name, contentType: file.type, size: file.size };
}

/** Convert a data URL (e.g. canvas JPEG) into a File for the upload pipeline. */
export async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], filename, { type: blob.type || 'image/jpeg' });
}
