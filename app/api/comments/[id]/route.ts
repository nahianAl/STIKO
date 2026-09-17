import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { content } = await request.json();
  if (!content || !content.trim()) {
    return NextResponse.json({ error: 'Content is required' }, { status: 400 });
  }

  const existing = await sql`SELECT user_id FROM comments WHERE id = ${params.id}`;
  if (!existing[0]) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }
  // Only the comment's owner may edit (anonymous comments have no owner and are not editable).
  if (existing[0].user_id !== session.user.id) {
    return NextResponse.json({ error: 'Not authorized to edit this comment' }, { status: 403 });
  }

  // edited_at is what lets every other open portal notice this edit. The change
  // feed compares a (count, latest stamp) pair, and an edit moves neither
  // created_at nor the row count — see lib/migrations/013-comment-edits.sql.
  const rows = await sql`
    UPDATE comments SET content = ${content.trim()}, edited_at = NOW()
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
  return NextResponse.json(rows[0]);
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
