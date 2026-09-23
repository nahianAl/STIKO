import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { canRenameVersion, getVersionAccess, getVersionDeleteDecision } from '@/lib/access';
import { deleteObjects } from '@/lib/s3';
import { normalizeSubmissionName } from '@/lib/submissionName';

/**
 * DELETE — remove a whole version.
 *
 * Owners and coordinators only. Files, comments, markups, verdicts, views and
 * the AI summary all cascade from the version row.
 *
 * The version number is not reused and the gap is not closed. Numbers appear in
 * comments, notifications, verdicts and already-sent emails; renumbering would
 * silently repoint every one of those at different content.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const decision = await getVersionDeleteDecision(session.user.id, params.id);
  if (!decision) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!decision.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await sql`
    DELETE FROM versions WHERE id = ${params.id} RETURNING id
  `;
  if (!result[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await deleteObjects(decision.storageKeys);

  return NextResponse.json({ success: true });
}

/**
 * PATCH — rename a submission. Body: { name: string | null }.
 *
 * A blank or null name clears it, and the rail goes back to "Submission N".
 * Owner, coordinator and uploader only (canRenameVersion).
 *
 * The order of the checks is the point. Anything the caller cannot see is a
 * 404, and only then is the permission judged, so a 403 can never confirm that
 * a hidden version exists.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Package access and version scope. Null for a missing version too.
  const access = await getVersionAccess(session.user.id, params.id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // getVersionAccess does not apply the draft rule that GET /api/versions
  // does: drafts are visible only to people who can publish. Without this, a
  // commenter probing a draft id would get the 403 below, which says "this
  // exists".
  const rows = await sql`
    SELECT published_at AS "publishedAt" FROM versions WHERE id = ${params.id}
  `;
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (rows[0].publishedAt === null && !access.canUpload) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!canRenameVersion(access.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = normalizeSubmissionName(
    body && typeof body === 'object' ? (body as { name?: unknown }).name : undefined
  );
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const updated = await sql`
    UPDATE versions SET name = ${parsed.name}, renamed_at = NOW()
    WHERE id = ${params.id}
    RETURNING id, name
  `;
  if (!updated[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ id: updated[0].id, name: updated[0].name });
}
