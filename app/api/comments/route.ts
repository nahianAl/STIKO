import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getCommentAssetPresignedUrl } from '@/lib/s3';
import { getFileAccess } from '@/lib/access';
import { isAllowedCommentKey } from '@/lib/storageKeys';
import { ensureCommentColumns } from '@/lib/commentColumns';
import { mentionableUsers } from '@/lib/mentionable';
import { notifyMentions } from '@/lib/mentionNotify';
import { parseMentions, reconcileMentions, type Mention } from '@/lib/mentions';

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
  // Not an oracle: a nonexistent file and an out-of-scope one both land here,
  // and the rest of the branch answers that with 404, never 403.
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await ensureCommentColumns();

  let rows;
  try {
    rows = await sql`
      SELECT id, file_id AS "fileId", user_id AS "userId", parent_comment_id AS "parentCommentId",
             content, x_position AS "xPosition", y_position AS "yPosition",
             world_x AS "worldX", world_y AS "worldY", world_z AS "worldZ",
             snapshot_url AS "snapshotUrl", attachments,
             page_number AS "pageNumber", timestamp,
             author, created_at AS "createdAt", mentions
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

  // Resolve snapshot and attachment storage keys to presigned download URLs.
  //
  // The signer here is quantized (see lib/s3.ts): within a signing window the same
  // key yields a byte-identical URL. That matters because this route is polled —
  // the portal's change feed re-runs it every few seconds for the open thread. A
  // per-call signature would hand <img src> a new URL each time and re-download
  // every snapshot and attachment from R2, and would make the client's
  // preserveIfUnchanged guard, which compares the payload by JSON, see a change on
  // every poll and re-render the pins for nothing.
  const resolved = await Promise.all(
    rows.map(async (row) => {
      // Always an array on the wire, including for the fallback query above,
      // which does not select the column at all.
      row = { ...row, mentions: parseMentions(row.mentions) };
      // Resolve snapshot URL
      if (row.snapshotUrl && !row.snapshotUrl.startsWith('http') && !row.snapshotUrl.startsWith('data:')) {
        try {
          row = { ...row, snapshotUrl: await getCommentAssetPresignedUrl(row.snapshotUrl) };
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
              const url = await getCommentAssetPresignedUrl(att.storageKey);
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

  const { fileId, content, xPosition, yPosition, worldX, worldY, worldZ, parentCommentId, snapshotUrl, pageNumber, timestamp, attachments, mentions } =
    await request.json();

  if (!fileId) {
    return NextResponse.json({ error: 'fileId required' }, { status: 400 });
  }

  // Anyone could previously post a comment onto any file id, anonymously. 01
  // has no anonymous role — every role arrives through an invitation — and a
  // viewer is explicitly view-only.
  const access = await getFileAccess(session.user.id, fileId);
  // Not an oracle: a nonexistent file and an out-of-scope one both land here,
  // and the rest of the branch answers that with 404, never 403.
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
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

  // The ids are a claim, not a fact. Each survives only if the server's own
  // list says that person can open this file AND their @label is in the text.
  const authorId = session.user.id;
  let storedMentions: Mention[] = [];
  if (Array.isArray(mentions) && mentions.length > 0 && typeof content === 'string') {
    const allowed = new Map<string, string>();
    for (const p of await mentionableUsers(fileId)) {
      if (p.userId !== authorId) allowed.set(p.userId, p.label);
    }
    storedMentions = reconcileMentions(content, mentions, allowed);
  }

  await ensureCommentColumns();

  const id = uuidv4();
  let rows;
  try {
    rows = await sql`
      INSERT INTO comments (id, file_id, user_id, parent_comment_id, content,
                            x_position, y_position, world_x, world_y, world_z,
                            snapshot_url, attachments, page_number, timestamp, author, mentions)
      VALUES (${id}, ${fileId}, ${session?.user?.id ?? null}, ${parentCommentId ?? null},
              ${content}, ${xPosition ?? null}, ${yPosition ?? null},
              ${worldX ?? null}, ${worldY ?? null}, ${worldZ ?? null},
              ${snapshotUrl ?? null}, ${attachmentsJson}::jsonb, ${pageNumber ?? null}, ${timestamp ?? null}, ${resolvedAuthor},
              ${JSON.stringify(storedMentions)}::jsonb)
      RETURNING id, file_id AS "fileId", user_id AS "userId",
                parent_comment_id AS "parentCommentId", content,
                x_position AS "xPosition", y_position AS "yPosition",
                world_x AS "worldX", world_y AS "worldY", world_z AS "worldZ",
                snapshot_url AS "snapshotUrl", attachments,
                page_number AS "pageNumber", timestamp,
                author, created_at AS "createdAt"
    `;
  } catch {
    // The fallback row has no mentions column to write to, so nobody is
    // recorded as mentioned and nobody may be notified.
    storedMentions = [];
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
  // Awaited, not fired and forgotten: on a serverless host, work still running
  // after the response is sent is killed. It never throws.
  if (storedMentions.length > 0) {
    await notifyMentions({
      actorId: authorId,
      actorName: resolvedAuthor,
      recipientIds: storedMentions.map((m) => m.userId),
      fileId,
      commentId: id,
      content: String(content ?? ''),
    });
  }

  return NextResponse.json({ ...rows[0], mentions: storedMentions }, { status: 201 });
}
