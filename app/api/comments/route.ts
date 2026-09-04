import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getDownloadPresignedUrl } from '@/lib/s3';
import { getFileAccess } from '@/lib/access';
import { isAllowedCommentKey } from '@/lib/storageKeys';

// Ensure new columns exist (runs once per cold start)
let migrationAttempted = false;
async function ensureCommentColumns() {
  if (migrationAttempted) return;
  migrationAttempted = true;
  try {
    await sql`ALTER TABLE comments ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'`;
    await sql`ALTER TABLE comments ADD COLUMN IF NOT EXISTS timestamp DOUBLE PRECISION DEFAULT NULL`;
  } catch {
    // columns may already exist or insufficient permissions — either way, proceed
  }
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('fileId');
  if (!fileId) {
    return NextResponse.json({ error: 'fileId required' }, { status: 400 });
  }

  // This route resolves attachments and snapshots to presigned URLs, so without
  // a check it hands out package contents to anyone holding a file id — and
  // would route straight around the authorization on /api/files/url.
  const access = await getFileAccess(session.user.id, fileId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await ensureCommentColumns();

  let rows;
  try {
    rows = await sql`
      SELECT id, file_id AS "fileId", user_id AS "userId", parent_comment_id AS "parentCommentId",
             content, x_position AS "xPosition", y_position AS "yPosition",
             world_x AS "worldX", world_y AS "worldY", world_z AS "worldZ",
             snapshot_url AS "snapshotUrl", attachments,
             page_number AS "pageNumber", timestamp,
             author, created_at AS "createdAt"
      FROM comments WHERE file_id = ${fileId}
      ORDER BY created_at ASC
    `;
  } catch {
    // Fallback if attachments column still doesn't exist
    rows = await sql`
      SELECT id, file_id AS "fileId", user_id AS "userId", parent_comment_id AS "parentCommentId",
             content, x_position AS "xPosition", y_position AS "yPosition",
             world_x AS "worldX", world_y AS "worldY", world_z AS "worldZ",
             snapshot_url AS "snapshotUrl",
             page_number AS "pageNumber",
             author, created_at AS "createdAt"
      FROM comments WHERE file_id = ${fileId}
      ORDER BY created_at ASC
    `;
  }

  // Resolve snapshot and attachment storage keys to presigned download URLs
  const resolved = await Promise.all(
    rows.map(async (row) => {
      // Resolve snapshot URL
      if (row.snapshotUrl && !row.snapshotUrl.startsWith('http') && !row.snapshotUrl.startsWith('data:')) {
        try {
          row = { ...row, snapshotUrl: await getDownloadPresignedUrl(row.snapshotUrl) };
        } catch {
          // keep original
        }
      }
      // Resolve attachment URLs
      const rawAttachments = row.attachments ?? [];
      const attachments = typeof rawAttachments === 'string' ? JSON.parse(rawAttachments) : rawAttachments;
      if (Array.isArray(attachments) && attachments.length > 0) {
        const resolvedAttachments = await Promise.all(
          attachments.map(async (att: { storageKey: string; filename: string; contentType: string; size: number }) => {
            try {
              const url = await getDownloadPresignedUrl(att.storageKey);
              return { ...att, url };
            } catch {
              return att;
            }
          })
        );
        return { ...row, attachments: resolvedAttachments };
      }
      return { ...row, attachments: [] };
    })
  );

  return NextResponse.json(resolved);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { fileId, content, xPosition, yPosition, worldX, worldY, worldZ, parentCommentId, snapshotUrl, pageNumber, timestamp, attachments } =
    await request.json();

  if (!fileId) {
    return NextResponse.json({ error: 'fileId required' }, { status: 400 });
  }

  // Anyone could previously post a comment onto any file id, anonymously. 01
  // has no anonymous role — every role arrives through an invitation — and a
  // viewer is explicitly view-only.
  const access = await getFileAccess(session.user.id, fileId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!access.canComment) {
    return NextResponse.json(
      { error: 'Your role on this package is view-only' },
      { status: 403 }
    );
  }

  // Both of these are stored object keys, and deleting a comment's file now
  // deletes what they name. A comment that names a file object could destroy
  // it, so each is held to its own prefix.
  if (snapshotUrl != null && !isAllowedCommentKey(String(snapshotUrl))) {
    return NextResponse.json({ error: 'Invalid snapshot reference' }, { status: 400 });
  }
  const attachmentList = Array.isArray(attachments) ? attachments : [];
  if (
    attachmentList.some(
      (att) => !att?.storageKey || !isAllowedCommentKey(String(att.storageKey))
    )
  ) {
    return NextResponse.json({ error: 'Invalid attachment reference' }, { status: 400 });
  }

  // The author is the session, never a client-supplied string.
  const resolvedAuthor = session.user.name || session.user.email || 'Someone';
  const attachmentsJson = JSON.stringify(attachments ?? []);

  await ensureCommentColumns();

  const id = uuidv4();
  let rows;
  try {
    rows = await sql`
      INSERT INTO comments (id, file_id, user_id, parent_comment_id, content,
                            x_position, y_position, world_x, world_y, world_z,
                            snapshot_url, attachments, page_number, timestamp, author)
      VALUES (${id}, ${fileId}, ${session?.user?.id ?? null}, ${parentCommentId ?? null},
              ${content}, ${xPosition ?? null}, ${yPosition ?? null},
              ${worldX ?? null}, ${worldY ?? null}, ${worldZ ?? null},
              ${snapshotUrl ?? null}, ${attachmentsJson}::jsonb, ${pageNumber ?? null}, ${timestamp ?? null}, ${resolvedAuthor})
      RETURNING id, file_id AS "fileId", user_id AS "userId",
                parent_comment_id AS "parentCommentId", content,
                x_position AS "xPosition", y_position AS "yPosition",
                world_x AS "worldX", world_y AS "worldY", world_z AS "worldZ",
                snapshot_url AS "snapshotUrl", attachments,
                page_number AS "pageNumber", timestamp,
                author, created_at AS "createdAt"
    `;
  } catch {
    // Fallback without attachments column
    rows = await sql`
      INSERT INTO comments (id, file_id, user_id, parent_comment_id, content,
                            x_position, y_position, world_x, world_y, world_z,
                            snapshot_url, page_number, author)
      VALUES (${id}, ${fileId}, ${session?.user?.id ?? null}, ${parentCommentId ?? null},
              ${content}, ${xPosition ?? null}, ${yPosition ?? null},
              ${worldX ?? null}, ${worldY ?? null}, ${worldZ ?? null},
              ${snapshotUrl ?? null}, ${pageNumber ?? null}, ${resolvedAuthor})
      RETURNING id, file_id AS "fileId", user_id AS "userId",
                parent_comment_id AS "parentCommentId", content,
                x_position AS "xPosition", y_position AS "yPosition",
                world_x AS "worldX", world_y AS "worldY", world_z AS "worldZ",
                snapshot_url AS "snapshotUrl",
                page_number AS "pageNumber",
                author, created_at AS "createdAt"
    `;
  }
  return NextResponse.json(rows[0], { status: 201 });
}
