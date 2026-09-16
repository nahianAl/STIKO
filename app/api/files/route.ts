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
           f.measure_unit AS "measureUnit",
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
  // IMPORTANT: This query is allowed to fail soft (try/catch below), unlike the files and counts
  // queries. This endpoint is load-bearing for file listing app-wide in production, and this repo
  // applies migrations manually (and has forgotten them twice before). If 009-part-colors.sql
  // has not been run yet, the table won't exist. Rather than take down the whole app, we fall
  // back to no colours — a model in its original colours is far better than a file-listing outage.
  let colorsByFile = new Map<string, Record<string, string>>();
  try {
    const colorRows = await sql`
      SELECT pc.file_id AS "fileId", pc.part_key AS "partKey", pc.color
      FROM part_colors pc
      JOIN files f ON f.id = pc.file_id
      WHERE f.version_id = ${versionId}
    `;
    colorRows.forEach((row) => {
      const forFile = colorsByFile.get(row.fileId as string) ?? {};
      forFile[row.partKey as string] = row.color as string;
      colorsByFile.set(row.fileId as string, forFile);
    });
  } catch (error) {
    console.error(
      `Failed to fetch part_colors for version ${versionId}:`,
      error instanceof Error ? error.message : String(error)
    );
    // Fall back to no colours; file listing is more important than decoration.
    colorsByFile = new Map();
  }

  // Same one-query-per-version shape as the colours above, and the same fail-soft contract for
  // the same reason: this endpoint is load-bearing for file listing app-wide, migrations here
  // are applied by hand, and this repo has forgotten one twice. An unapplied
  // 012-measure-calibration.sql must degrade to "the measure tool is unavailable", never to a
  // file-listing outage.
  let calibrationsByFile = new Map<string, Record<number, number>>();
  try {
    const calibrationRows = await sql`
      SELECT fc.file_id AS "fileId", fc.page_number AS "pageNumber", fc.mm_per_unit AS "mmPerUnit"
      FROM file_calibrations fc
      JOIN files f ON f.id = fc.file_id
      WHERE f.version_id = ${versionId}
    `;
    calibrationRows.forEach((row) => {
      const forFile = calibrationsByFile.get(row.fileId as string) ?? {};
      forFile[Number(row.pageNumber)] = Number(row.mmPerUnit);
      calibrationsByFile.set(row.fileId as string, forFile);
    });
  } catch (error) {
    console.error(
      `Failed to fetch file_calibrations for version ${versionId}:`,
      error instanceof Error ? error.message : String(error)
    );
    // Fall back to uncalibrated; a file listing matters more than a measurement.
    calibrationsByFile = new Map();
  }

  const files = rows.map((row) => {
    const { positionX, positionY, positionZ, rotationX, rotationY, rotationZ, ...file } = row;
    return {
      ...file,
      // file_size is BIGINT, and the Neon driver's pg-types defaults parse int8 (OID
      // 20) as a JS STRING, not a number — there is no default numeric parser for it,
      // unlike int4/int2. Left uncoerced, `FileRecord.fileSize: number` (lib/types.ts)
      // is a lie: `lib/model/modelCache.ts` sums `bytes` to enforce its 300MB LRU
      // budget, and `retained += entry.bytes` silently becomes string concatenation,
      // collapsing the cache to ~2 entries. Number(...), not a SQL ::int cast — int4
      // caps at ~2.1GB, well under files this app actually stores.
      fileSize: Number(file.fileSize),
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
      // Computed server-side from the same table the measure-tool calibration route writes,
      // keyed by page number; empty for files that have never been calibrated.
      calibrations: calibrationsByFile.get(row.id as string) ?? {},
    };
  });

  return NextResponse.json(files);
}
