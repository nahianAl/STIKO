import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getDownloadPresignedUrl } from '@/lib/s3';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('fileId');

  const rows = await sql`
    SELECT id, file_id AS "fileId", user_id AS "userId", parent_comment_id AS "parentCommentId",
           content, x_position AS "xPosition", y_position AS "yPosition",
           world_x AS "worldX", world_y AS "worldY", world_z AS "worldZ",
           snapshot_url AS "snapshotUrl", author, created_at AS "createdAt"
    FROM comments WHERE file_id = ${fileId}
    ORDER BY created_at ASC
  `;

  // Resolve snapshot storage keys to presigned download URLs
  const resolved = await Promise.all(
    rows.map(async (row) => {
      if (row.snapshotUrl && !row.snapshotUrl.startsWith('http') && !row.snapshotUrl.startsWith('data:')) {
        try {
          const presignedUrl = await getDownloadPresignedUrl(row.snapshotUrl);
          return { ...row, snapshotUrl: presignedUrl };
        } catch {
          return row;
        }
      }
      return row;
    })
  );

  return NextResponse.json(resolved);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  const { fileId, content, xPosition, yPosition, worldX, worldY, worldZ, parentCommentId, author, snapshotUrl } =
    await request.json();

  const resolvedAuthor = session?.user?.name || session?.user?.email || author || 'Anonymous';

  const id = uuidv4();
  const rows = await sql`
    INSERT INTO comments (id, file_id, user_id, parent_comment_id, content,
                          x_position, y_position, world_x, world_y, world_z,
                          snapshot_url, author)
    VALUES (${id}, ${fileId}, ${session?.user?.id ?? null}, ${parentCommentId ?? null},
            ${content}, ${xPosition ?? null}, ${yPosition ?? null},
            ${worldX ?? null}, ${worldY ?? null}, ${worldZ ?? null},
            ${snapshotUrl ?? null}, ${resolvedAuthor})
    RETURNING id, file_id AS "fileId", user_id AS "userId",
              parent_comment_id AS "parentCommentId", content,
              x_position AS "xPosition", y_position AS "yPosition",
              world_x AS "worldX", world_y AS "worldY", world_z AS "worldZ",
              snapshot_url AS "snapshotUrl", author, created_at AS "createdAt"
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
