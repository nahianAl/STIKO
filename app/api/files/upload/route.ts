import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getUploadPresignedUrl, getPublicUrl } from '@/lib/s3';
import { optimizedVariantKey } from '@/lib/storageKeys';

// Step 1: Request a presigned URL for direct S3 upload
export async function POST(request: NextRequest) {
  const { versionId, projectId, portalId, filename, contentType, variantOfStorageKey } =
    await request.json();

  // An optimized variant is a second object for a file that already exists, so it mints no
  // id. The key is DERIVED from the original rather than accepted from the caller: the
  // client never gets to name the object the viewer will later load.
  if (variantOfStorageKey) {
    const storageKey = optimizedVariantKey(variantOfStorageKey);
    return NextResponse.json({
      presignedUrl: await getUploadPresignedUrl(storageKey, 'model/gltf-binary'),
      storageKey,
    });
  }

  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  const fileId = uuidv4();
  const storageKey = `uploads/${projectId}/${portalId}/${versionId}/${fileId}${ext}`;

  const presignedUrl = await getUploadPresignedUrl(storageKey, contentType);

  return NextResponse.json({
    fileId,
    presignedUrl,
    storageKey,
    publicUrl: getPublicUrl(storageKey),
  });
}
