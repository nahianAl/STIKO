import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { canDeleteContent, canDownloadFile, getVersionAccess } from '@/lib/access';

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
  // 404 rather than 403: a version outside the caller's scope must look
  // exactly like one that does not exist.
  const access = await getVersionAccess(userId, versionId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = await sql`
    SELECT f.id, f.version_id AS "versionId", f.filename,
           f.storage_key AS "storageKey",
           f.file_size AS "fileSize", f.file_type AS "fileType",
           f.conversion_status AS "conversionStatus",
           f.converted_storage_key AS "convertedStorageKey",
           f.conversion_job_id AS "conversionJobId",
           f.folder_path AS "folderPath",
           f.uploaded_by AS "uploadedBy",
           u.name AS "uploadedByName",
           f.position_x AS "positionX", f.position_y AS "positionY",
           f.position_z AS "positionZ",
           f.rotation_x AS "rotationX", f.rotation_y AS "rotationY",
           f.rotation_z AS "rotationZ",
           f.created_at AS "createdAt"
    FROM files f
    LEFT JOIN users u ON u.id = f.uploaded_by
    WHERE f.version_id = ${versionId}
    ORDER BY f.folder_path ASC NULLS FIRST, f.created_at ASC
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

  // Sparse by construction — only deliberate overrides are rows — so one query for the whole
  // version is cheaper than a join that would repeat every file row per coloured part.
  const colorRows = await sql`
    SELECT pc.file_id AS "fileId", pc.part_key AS "partKey", pc.color
    FROM part_colors pc
    JOIN files f ON f.id = pc.file_id
    WHERE f.version_id = ${versionId}
  `;
  const colorsByFile = new Map<string, Record<string, string>>();
  colorRows.forEach((row) => {
    const forFile = colorsByFile.get(row.fileId as string) ?? {};
    forFile[row.partKey as string] = row.color as string;
    colorsByFile.set(row.fileId as string, forFile);
  });

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
      // Computed server-side from the same predicate the download endpoint
      // enforces, so a hidden control and a 403 cannot disagree.
      canDownload: canDownloadFile({
        role: access.role,
        isOwnUpload: file.uploadedBy === userId,
        mayDownload: access.mayDownload,
      }),
      commentCount: countsById.get(file.id as string)?.commentCount ?? 0,
      // Computed server-side from the same table the PATCH route writes, never re-derived in
      // the client: what renders and what persists must not be able to disagree.
      partColors: colorsByFile.get(row.id as string) ?? {},
    };
  });

  return NextResponse.json(files);
}
