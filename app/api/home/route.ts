import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getHomeData } from '@/lib/queries';

/**
 * Everything home needs in one request, including the disclosure signals — 03
 * requires these to be known before paint so no element materialises a beat
 * late.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await getHomeData(session.user.id);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/home] query failed:', message);

    // A missing table means the redesign's migration has not been applied.
    // Say so plainly — this is the single most likely cause of a fresh install
    // failing here, and an opaque 500 sends people looking in the wrong place.
    if (/relation .* does not exist|column .* does not exist/i.test(message)) {
      return NextResponse.json(
        {
          error:
            'The database is missing tables this version needs. Run `npm run migrate` to apply lib/migrations.',
          detail: message,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: 'Could not load your packages.' },
      { status: 500 }
    );
  }
}
