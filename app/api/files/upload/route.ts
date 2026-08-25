import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getUploadPresignedUrl, getPublicUrl } from '@/lib/s3';
import { sql } from '@/lib/db';
import { optimizedVariantKey } from '@/lib/storageKeys';

// Step 1: Request a presigned URL for direct S3 upload
export async function POST(request: NextRequest) {
  const { versionId, projectId, portalId, filename, contentType, variantOfFileId } =
    await request.json();

  // An optimized variant is a second object for a file that already exists, so it mints no
  // id. The key is looked up, never accepted from the caller: handing out a presigned PUT
  // for a client-named key would let anyone overwrite another package's optimized variant —
  // and that variant is exactly what the 3D viewer loads.
  if (variantOfFileId) {
    const rows = await sql`
      SELECT storage_key AS "storageKey" FROM files WHERE id = ${variantOfFileId}
    `;
    if (!rows[0]) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const storageKey = optimizedVariantKey(rows[0].storageKey);
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
