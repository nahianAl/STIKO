import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getFileAccess } from '@/lib/access';
import { ensureCommentColumns } from '@/lib/commentColumns';
import { mentionableUsers } from '@/lib/mentionable';
import { notifyMentions } from '@/lib/mentionNotify';
import { newlyMentioned, parseMentions, reconcileMentions } from '@/lib/mentions';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const editorId = session.user.id;

  const { content, mentions } = await request.json();
  if (!content || !content.trim()) {
    return NextResponse.json({ error: 'Content is required' }, { status: 400 });
  }
  const trimmed: string = content.trim();

  await ensureCommentColumns();

  const existing = await sql`
    SELECT user_id, file_id, mentions FROM comments WHERE id = ${params.id}
  `;
  if (!existing[0]) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }
  // Only the comment's owner may edit (anonymous comments have no owner and are not editable).
  if (existing[0].user_id !== editorId) {
    return NextResponse.json({ error: 'Not authorized to edit this comment' }, { status: 403 });
  }

  const fileId = existing[0].file_id as string;
  const stored = parseMentions(existing[0].mentions);
  // A client that does not know about mentions sends none. That means "check
  // the ones already here against the new text", not "clear them".
  const requested: unknown[] = Array.isArray(mentions)
    ? mentions
    : stored.map((m) => m.userId);

  // The list is only needed to admit someone NEW. And an author who has since
  // lost comment access may still fix their own words, but may not use the
  // edit to notify people on a package they are no longer on.
  const allowed = new Map<string, string>();
  const addsSomeone = requested.some((id) => !stored.some((m) => m.userId === id));
  if (addsSomeone) {
    const access = await getFileAccess(editorId, fileId);
    if (access?.canComment) {
      for (const p of await mentionableUsers(fileId)) {
        if (p.userId !== editorId) allowed.set(p.userId, p.label);
      }
    }
  }
  const nextMentions = reconcileMentions(trimmed, requested, allowed, stored);

  // edited_at is what lets every other open portal notice this edit. The change
  // feed compares a (count, latest stamp) pair, and an edit moves neither
  // created_at nor the row count — see lib/migrations/013-comment-edits.sql.
  const rows = await sql`
    UPDATE comments
    SET content = ${trimmed},
        mentions = ${JSON.stringify(nextMentions)}::jsonb,
        edited_at = NOW()
    WHERE id = ${params.id}
    RETURNING id, file_id AS "fileId", user_id AS "userId",
              parent_comment_id AS "parentCommentId", content,
              x_position AS "xPosition", y_position AS "yPosition",
              world_x AS "worldX", world_y AS "worldY", world_z AS "worldZ",
              snapshot_url AS "snapshotUrl", author, created_at AS "createdAt",
              edited_at AS "editedAt"
  `;
  if (!rows[0]) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }

  // Only people this edit added. Everyone already mentioned was told when
  // they were first mentioned.
  const added = newlyMentioned(stored, nextMentions);
  if (added.length > 0) {
    await notifyMentions({
      actorId: editorId,
      actorName: session.user.name || session.user.email || 'Someone',
      recipientIds: added,
      fileId,
      commentId: params.id,
      content: trimmed,
    });
  }

  return NextResponse.json({ ...rows[0], mentions: nextMentions });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const existing = await sql`SELECT user_id FROM comments WHERE id = ${params.id}`;
  if (!existing[0]) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }
  if (existing[0].user_id !== session.user.id) {
    return NextResponse.json({ error: 'Not authorized to delete this comment' }, { status: 403 });
  }

  // Cascade: delete the comment and its direct replies.
  await sql`DELETE FROM comments WHERE id = ${params.id} OR parent_comment_id = ${params.id}`;
  return NextResponse.json({ success: true });
}
