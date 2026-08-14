import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  const access = await getPackageAccess(session.user.id, versionRows[0].portalId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const rows = await sql`
    SELECT id, version_id AS "versionId", filename, storage_key AS "storageKey",
           file_size AS "fileSize", file_type AS "fileType",
           conversion_status AS "conversionStatus",
           converted_storage_key AS "convertedStorageKey",
           conversion_job_id AS "conversionJobId",
           folder_path AS "folderPath",
           position_x AS "positionX", position_y AS "positionY", position_z AS "positionZ",
           rotation_x AS "rotationX", rotation_y AS "rotationY", rotation_z AS "rotationZ",
           created_at AS "createdAt"
    FROM files WHERE version_id = ${versionId}
    ORDER BY folder_path ASC NULLS FIRST, created_at ASC
  `;

  const files = rows.map((row) => {
    const { positionX, positionY, positionZ, rotationX, rotationY, rotationZ, ...file } = row;
    return {
      ...file,
      transform: {
        position: [positionX, positionY, positionZ],
        rotation: [rotationX, rotationY, rotationZ],
      },
    };
  });

  return NextResponse.json(files);
}
