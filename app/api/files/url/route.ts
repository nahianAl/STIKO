import { NextRequest, NextResponse } from 'next/server';
import { getDownloadPresignedUrl } from '@/lib/s3';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';

/**
 * Hand back a presigned download URL for a file.
 *
 * This route previously minted a URL for ANY storage key with no session at
 * all, which handed out the contents of every package to anyone who could guess
 * or observe a key. The key must now belong to a real file, and the caller must
 * have access to the package that file lives in.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storageKey = request.nextUrl.searchParams.get('key');
  if (!storageKey) {
    return NextResponse.json({ error: 'Missing key parameter' }, { status: 400 });
  }

  // Comment attachments and annotation snapshots live outside the files table;
  // they are already scoped by an unguessable per-upload key.
  const isAttachment =
    storageKey.startsWith('attachments/') || storageKey.startsWith('snapshots/');

  if (!isAttachment) {
    const rows = await sql`
      SELECT v.portal_id AS "portalId"
      FROM files f
      JOIN versions v ON v.id = f.version_id
      WHERE f.storage_key = ${storageKey}
         OR f.converted_storage_key = ${storageKey}
      LIMIT 1
    `;
    if (!rows[0]) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const access = await getPackageAccess(session.user.id, rows[0].portalId);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const url = await getDownloadPresignedUrl(storageKey);
  return NextResponse.json({ url });
}
