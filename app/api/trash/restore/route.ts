import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { restoreFromTrash } from '@/lib/trashQueries';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { kind, id } = await request.json().catch(() => ({}));

  if (kind !== 'project' && kind !== 'package') {
    return NextResponse.json(
      { error: 'kind must be "project" or "package"' },
      { status: 400 }
    );
  }
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const outcome = await restoreFromTrash(session.user.id, kind, id);
  if (outcome === 'not-found') {
    // Covers gone, not yours, and expired — kept indistinguishable so this
    // endpoint cannot be used to probe what exists.
    return NextResponse.json(
      { error: 'That item is no longer in your trash.' },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}
