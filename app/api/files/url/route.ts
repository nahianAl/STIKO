import { NextRequest, NextResponse } from 'next/server';
import { getDownloadPresignedUrl } from '@/lib/s3';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getFileAccess } from '@/lib/access';

/**
 * Hand back a presigned download URL for a stored object.
 *
 * Every key must resolve to a package the caller has access to. There is no
 * prefix that skips the check: a user-supplied key is an identifier, never a
 * capability, and "the key is hard to guess" is not authorization — keys leak
 * through logs, referrers, shared screenshots and old links.
 *
 * Three kinds of key exist, and all three are recorded against a row that
 * chains back to a portal:
 *   - version files          files.storage_key / files.converted_storage_key
 *   - annotation snapshots   comments.snapshot_url
 *   - comment attachments    comments.attachments[].storageKey
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

  const located = await portalForStorageKey(storageKey);
  if (!located) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Resolve through the file so the version scope applies — otherwise a
  // storage key is a way around it.
  const access = await getFileAccess(session.user.id, located.fileId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = await getDownloadPresignedUrl(storageKey);
  return NextResponse.json({ url });
}

/** Resolve any stored object back to the file (and package) it belongs to. */
async function portalForStorageKey(
  storageKey: string
): Promise<{ portalId: string; fileId: string } | null> {
  const fileRows = await sql`
    SELECT v.portal_id AS "portalId", f.id AS "fileId"
    FROM files f
    JOIN versions v ON v.id = f.version_id
    WHERE f.storage_key = ${storageKey}
       OR f.converted_storage_key = ${storageKey}
    LIMIT 1
  `;
  if (fileRows[0]) {
    return { portalId: fileRows[0].portalId as string, fileId: fileRows[0].fileId as string };
  }

  // Snapshots and attachments both hang off a comment, which hangs off a file.
  // The attachments column is a JSONB array of {storageKey, ...} objects.
  const commentRows = await sql`
    SELECT v.portal_id AS "portalId", f.id AS "fileId"
    FROM comments c
    JOIN files f ON f.id = c.file_id
    JOIN versions v ON v.id = f.version_id
    WHERE c.snapshot_url = ${storageKey}
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(
           CASE jsonb_typeof(c.attachments)
             WHEN 'array' THEN c.attachments
             ELSE '[]'::jsonb
           END
         ) AS att
         WHERE att->>'storageKey' = ${storageKey}
       )
    LIMIT 1
  `;
  if (commentRows[0]) {
    return { portalId: commentRows[0].portalId as string, fileId: commentRows[0].fileId as string };
  }

  return null;
}
