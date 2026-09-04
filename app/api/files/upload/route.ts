import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getUploadPresignedUrl, getPublicUrl } from '@/lib/s3';
import { isOptimizableFilename, optimizedVariantKey } from '@/lib/storageKeys';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';

// Step 1: Request a presigned URL for direct S3 upload
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { versionId, filename, contentType } = await request.json();

  if (!versionId || !filename) {
    return NextResponse.json(
      { error: 'versionId and filename are required' },
      { status: 400 }
    );
  }

  // This route used to mint a presigned PUT for anyone who asked, so an
  // unauthenticated caller could write arbitrary objects into the bucket.
  // A version id is an identifier, not a capability.
  const versionRows = await sql`
    SELECT po.id AS "portalId", po.project_id AS "projectId"
    FROM versions v
    JOIN portals po ON po.id = v.portal_id
    WHERE v.id = ${versionId}
  `;
  if (!versionRows[0]) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const access = await getPackageAccess(session.user.id, versionRows[0].portalId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canUpload) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  const fileId = uuidv4();
  // projectId and portalId come from the version, never from the body. Trusting
  // the caller's copy would let an authorized uploader on one package write
  // objects under a different package's prefix.
  const storageKey = `uploads/${versionRows[0].projectId}/${versionRows[0].portalId}/${versionId}/${fileId}${ext}`;

  const presignedUrl = await getUploadPresignedUrl(storageKey, contentType);

  // The optimized variant is presigned HERE, in the same call, rather than in a later
  // round trip. The server has just minted the id and built the original key, so it can
  // derive the variant key itself — the client never names an object it will later read
  // back, and there is no window in which the file row must already exist.
  //
  // Presigning a variant the client may never use costs nothing: the URL simply expires.
  // KILL SWITCH, 2026-09-03: this is isOptimizableFilename (GLB only) rather than
  // producesViewerVariant (GLB + STEP) on purpose.
  //
  // Upload-time STEP tessellation was disabled after teammates hit failing uploads across
  // .stp, .step AND .stl, with ERR_CONNECTION_RESET / ERR_SSL_BAD_RECORD_MAC_ALERT on
  // PutObject and "THREE.WebGLRenderer: Context Lost". STL never had a variant, so the tab
  // itself — not the file type — was the common factor: OCCT tessellation runs concurrently
  // with a 4-wide upload pool, and under that memory pressure in-flight requests die.
  //
  // Returning null here means the client receives variantPresignedUrl: null and skips the
  // whole conversion block, so no OCCT runs during upload. The viewer-side worker, its
  // timeout and ModelErrorBoundary are all untouched and still fix the original tab-freeze.
  //
  // Re-enable by restoring producesViewerVariant, but only with the memory ceiling measured
  // first: MAX_STEP_BYTES is 50 MB of STEP text, which can be arbitrarily complex, and
  // conversions serialize across the pool while uploads are in flight.
  const variantStorageKey = isOptimizableFilename(filename)
    ? optimizedVariantKey(storageKey)
    : null;

  return NextResponse.json({
    fileId,
    presignedUrl,
    storageKey,
    publicUrl: getPublicUrl(storageKey),
    variantPresignedUrl: variantStorageKey
      ? // Longer than the original's default 5-minute expiry: the variant PUT only happens
        // after the original PUT completes AND optimization finishes (up to 120s — see
        // TIMEOUT_MS in lib/model/runOptimize.ts), so a large original upload alone can eat
        // most of a 5-minute window before the variant URL is ever used. A short expiry here
        // would 403 the variant PUT for exactly the biggest files, and useUpload.ts swallows
        // that failure as a silent downgrade.
        await getUploadPresignedUrl(variantStorageKey, 'model/gltf-binary', 3600)
      : null,
  });
}
