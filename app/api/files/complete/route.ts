import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';
import { optimizedVariantKey, uploadStorageKey } from '@/lib/storageKeys';

// Step 2: After the client has uploaded to S3, register the file in the DB
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const {
    fileId, versionId, filename, storageKey, fileSize, fileType, folderPath,
    hasOptimizedVariant,
  } = await request.json();

  if (!versionId) {
    return NextResponse.json({ error: 'versionId required' }, { status: 400 });
  }

  // This route used to insert whatever it was handed, so any signed-out caller
  // could attach a file row to any version. A version id is an identifier, not
  // a capability — resolve it to a package and check the caller may upload there.
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

  if (!fileId || !filename) {
    return NextResponse.json(
      { error: 'fileId and filename are required' },
      { status: 400 }
    );
  }

  // The key is derived, then compared — never trusted. This route used to
  // insert whatever key it was handed, so a caller could register someone
  // else's object against their own draft and then delete it, destroying bytes
  // they never had access to.
  const expectedKey = uploadStorageKey({
    projectId: versionRows[0].projectId,
    portalId: versionRows[0].portalId,
    versionId,
    fileId,
    filename,
  });
  if (storageKey !== expectedKey) {
    return NextResponse.json({ error: 'Invalid storage key' }, { status: 400 });
  }

  // Derived, never accepted from the caller — see the security note in this task.
  const convertedStorageKey = hasOptimizedVariant ? optimizedVariantKey(storageKey) : null;

  // conversion_status stays NULL here on purpose. 'completed' means a CloudConvert job
  // finished, and the STEP flow reads it that way; a client-optimized GLB is not that.
  // converted_storage_key is populated independently of the status column.
  //
  // uploaded_by comes from the session, never the body: it decides who may later
  // delete this file, so a caller must not be able to name someone else.
  const rows = await sql`
    INSERT INTO files (id, version_id, filename, storage_key, file_size, file_type, folder_path, converted_storage_key, uploaded_by)
    VALUES (${fileId}, ${versionId}, ${filename}, ${storageKey}, ${fileSize}, ${fileType}, ${folderPath || null}, ${convertedStorageKey}, ${session.user.id})
    RETURNING id, version_id AS "versionId", filename, storage_key AS "storageKey",
              file_size AS "fileSize", file_type AS "fileType",
              conversion_status AS "conversionStatus",
              converted_storage_key AS "convertedStorageKey",
              folder_path AS "folderPath",
              uploaded_by AS "uploadedBy",
              created_at AS "createdAt"
  `;

  return NextResponse.json(rows[0], { status: 201 });
}
