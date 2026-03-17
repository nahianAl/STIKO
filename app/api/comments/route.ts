import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('fileId');

  const rows = await sql`
    SELECT id, file_id AS "fileId", user_id AS "userId", parent_comment_id AS "parentCommentId",
           content, x_position AS "xPosition", y_position AS "yPosition",
           snapshot_url AS "snapshotUrl", author, created_at AS "createdAt"
    FROM comments WHERE file_id = ${fileId}
    ORDER BY created_at ASC
  `;
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  const { fileId, content, xPosition, yPosition, parentCommentId, author, snapshotUrl } =
    await request.json();

  const id = uuidv4();
  const rows = await sql`
    INSERT INTO comments (id, file_id, user_id, parent_comment_id, content,
                          x_position, y_position, snapshot_url, author)
    VALUES (${id}, ${fileId}, ${session?.user?.id ?? null}, ${parentCommentId ?? null},
            ${content}, ${xPosition ?? null}, ${yPosition ?? null},
            ${snapshotUrl ?? null}, ${author})
    RETURNING id, file_id AS "fileId", user_id AS "userId",
              parent_comment_id AS "parentCommentId", content,
              x_position AS "xPosition", y_position AS "yPosition",
              snapshot_url AS "snapshotUrl", author, created_at AS "createdAt"
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
