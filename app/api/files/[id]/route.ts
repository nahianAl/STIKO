import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getFileAccess, getFileDeleteDecision } from '@/lib/access';
import { deleteObjects } from '@/lib/s3';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // This route previously answered with any file's row — storage keys included —
  // to anyone signed in who knew an id, without resolving the package at all.
  const access = await getFileAccess(session.user.id, params.id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = await sql`
    SELECT id, version_id AS "versionId", filename, storage_key AS "storageKey",
           file_size AS "fileSize", file_type AS "fileType",
           conversion_status AS "conversionStatus",
           converted_storage_key AS "convertedStorageKey",
           conversion_job_id AS "conversionJobId",
           folder_path AS "folderPath",
           uploaded_by AS "uploadedBy",
           created_at AS "createdAt"
    FROM files WHERE id = ${params.id}
  `;
  if (!rows[0]) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

/**
 * DELETE — remove one file.
 *
 * Owners and coordinators may remove any file; an uploader may remove their own
 * while the version is still a draft. Comments and markups on the file cascade,
 * which is exactly why the uploader's window closes at publication.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const decision = await getFileDeleteDecision(session.user.id, params.id);
  // Missing and invisible are the same answer on purpose.
  if (!decision) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!decision.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await sql`
    DELETE FROM files WHERE id = ${params.id} RETURNING id
  `;
  if (!result[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // After the row, never before: a storage failure now leaves a harmless orphan,
  // where the reverse order could leave a listed file whose bytes are gone.
  await deleteObjects(decision.storageKeys);

  return NextResponse.json({ success: true });
}
