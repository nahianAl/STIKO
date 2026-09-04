import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getFileDownloadDecision } from '@/lib/access';
import { getDownloadPresignedUrl } from '@/lib/s3';

/**
 * Hand back a URL that saves the original file.
 *
 * Separate from /api/files/url, which is the viewer's render path and serves
 * the optimized variant when one exists. A download is the file as uploaded.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const decision = await getFileDownloadDecision(session.user.id, params.id);
  // Missing and invisible are the same answer on purpose.
  if (!decision) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!decision.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = await getDownloadPresignedUrl(
    decision.storageKey,
    3600,
    decision.filename
  );
  return NextResponse.json({ url });
}
