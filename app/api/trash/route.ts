import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getTrash } from '@/lib/trashQueries';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json(await getTrash(session.user.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/trash] query failed:', message);

    // Same courtesy /api/home extends: a missing column almost always means
    // migration 014 has not been applied, and an opaque 500 sends whoever is
    // debugging this to entirely the wrong place.
    if (/column .* does not exist/i.test(message)) {
      return NextResponse.json(
        {
          error:
            'The database is missing columns this version needs. Run `npm run migrate` to apply lib/migrations.',
          detail: message,
        },
        { status: 503 }
      );
    }

    return NextResponse.json({ error: 'Could not load your trash.' }, { status: 500 });
  }
}
