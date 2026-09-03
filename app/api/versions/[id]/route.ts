import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getVersionDeleteDecision } from '@/lib/access';
import { deleteObjects } from '@/lib/s3';

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
