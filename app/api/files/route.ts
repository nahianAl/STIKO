import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { canDeleteContent, getPackageAccess } from '@/lib/access';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  const versionId = request.nextUrl.searchParams.get('versionId');
  if (!versionId) {
    return NextResponse.json({ error: 'versionId required' }, { status: 400 });
  }

  // A package is a permission boundary. This route previously listed the files
  // of any version to anyone who knew its id, signed in or not.
  const versionRows = await sql`
    SELECT portal_id AS "portalId" FROM versions WHERE id = ${versionId}
  `;
  if (!versionRows[0]) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const access = await getPackageAccess(userId, versionRows[0].portalId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const rows = await sql`
    SELECT id, version_id AS "versionId", filename, storage_key AS "storageKey",
           file_size AS "fileSize", file_type AS "fileType",
           conversion_status AS "conversionStatus",
           converted_storage_key AS "convertedStorageKey",
           conversion_job_id AS "conversionJobId",
           folder_path AS "folderPath",
           uploaded_by AS "uploadedBy",
           position_x AS "positionX", position_y AS "positionY", position_z AS "positionZ",
           rotation_x AS "rotationX", rotation_y AS "rotationY", rotation_z AS "rotationZ",
           created_at AS "createdAt"
    FROM files WHERE version_id = ${versionId}
    ORDER BY folder_path ASC NULLS FIRST, created_at ASC
  `;

  // Whether the version is published decides an uploader's reach, so it is
  // fetched once here rather than per row.
  const publishedRows = await sql`
    SELECT published_at AS "publishedAt" FROM versions WHERE id = ${versionId}
  `;
  const isPublished = publishedRows[0]?.publishedAt !== null;

  // What a delete confirm has to be able to state. Counted here rather than in
  // the client because the client can only see comments it has already loaded
  // for the file it is looking at.
  const counts = await sql`
    SELECT f.id,
           COUNT(DISTINCT c.id) AS "commentCount"
    FROM files f
    LEFT JOIN comments c ON c.file_id = f.id
    WHERE f.version_id = ${versionId}
    GROUP BY f.id
  `;
  const countsById = new Map(
    counts.map((c) => [c.id as string, { commentCount: Number(c.commentCount) }])
  );

  const files = rows.map((row) => {
    const { positionX, positionY, positionZ, rotationX, rotationY, rotationZ, ...file } = row;
    return {
      ...file,
      transform: {
        position: [positionX, positionY, positionZ],
        rotation: [rotationX, rotationY, rotationZ],
      },
      // Computed server-side and sent down, never re-derived in the client: a
      // hidden button and a 403 must not be able to disagree.
      canDelete: canDeleteContent({
        role: access.role,
        isOwnUpload: row.uploadedBy === userId,
        isPublished,
      }),
      commentCount: countsById.get(file.id as string)?.commentCount ?? 0,
    };
  });

  return NextResponse.json(files);
}
