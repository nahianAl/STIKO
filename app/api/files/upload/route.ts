import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getUploadPresignedUrl, getPublicUrl } from '@/lib/s3';
import { isOptimizableFilename, optimizedVariantKey } from '@/lib/storageKeys';

// Step 1: Request a presigned URL for direct S3 upload
export async function POST(request: NextRequest) {
  const { versionId, projectId, portalId, filename, contentType } = await request.json();

  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  const fileId = uuidv4();
  const storageKey = `uploads/${projectId}/${portalId}/${versionId}/${fileId}${ext}`;

  const presignedUrl = await getUploadPresignedUrl(storageKey, contentType);

  // The optimized variant is presigned HERE, in the same call, rather than in a later
  // round trip. The server has just minted the id and built the original key, so it can
  // derive the variant key itself — the client never names an object it will later read
  // back, and there is no window in which the file row must already exist.
  //
  // Presigning a variant the client may never use costs nothing: the URL simply expires.
  const variantStorageKey = isOptimizableFilename(filename)
    ? optimizedVariantKey(storageKey)
    : null;

  return NextResponse.json({
    fileId,
    presignedUrl,
    storageKey,
    publicUrl: getPublicUrl(storageKey),
    variantStorageKey,
    variantPresignedUrl: variantStorageKey
      ? await getUploadPresignedUrl(variantStorageKey, 'model/gltf-binary')
      : null,
  });
}
