import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getUploadPresignedUrl, getPublicUrl } from '@/lib/s3';

// Step 1: Request a presigned URL for direct S3 upload
export async function POST(request: NextRequest) {
  const { versionId, projectId, portalId, filename, contentType, variantOfFileId } =
    await request.json();

  // An optimized variant is a second object belonging to a file that already has an id, so
  // it reuses that id rather than minting one — the two objects must stay associated.
  if (variantOfFileId) {
    const storageKey = `uploads/${projectId}/${portalId}/${versionId}/${variantOfFileId}.optimized.glb`;
    return NextResponse.json({
      fileId: variantOfFileId,
      presignedUrl: await getUploadPresignedUrl(storageKey, 'model/gltf-binary'),
      storageKey,
      publicUrl: getPublicUrl(storageKey),
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
