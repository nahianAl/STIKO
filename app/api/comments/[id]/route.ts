import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  const { content } = await request.json();

  if (!content || !content.trim()) {
    return NextResponse.json({ error: 'Content is required' }, { status: 400 });
  }

  // Only the comment author (by user_id) can edit
  if (session?.user?.id) {
    const existing = await sql`SELECT user_id FROM comments WHERE id = ${params.id}`;
    if (!existing[0]) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }
    if (existing[0].user_id && existing[0].user_id !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized to edit this comment' }, { status: 403 });
    }
  }

  const rows = await sql`
    UPDATE comments SET content = ${content.trim()}
    WHERE id = ${params.id}
    RETURNING id, file_id AS "fileId", user_id AS "userId",
              parent_comment_id AS "parentCommentId", content,
              x_position AS "xPosition", y_position AS "yPosition",
              snapshot_url AS "snapshotUrl", author, created_at AS "createdAt"
  `;

  if (!rows[0]) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();

  // Check ownership: if the comment has a user_id, only that user can delete it
  const existing = await sql`SELECT user_id FROM comments WHERE id = ${params.id}`;
  if (!existing[0]) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }

  if (existing[0].user_id && session?.user?.id && existing[0].user_id !== session.user.id) {
    return NextResponse.json({ error: 'Not authorized to delete this comment' }, { status: 403 });
  }

  await sql`DELETE FROM comments WHERE id = ${params.id}`;
  return NextResponse.json({ success: true });
}
