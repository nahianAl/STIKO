import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAccountUsage } from '@/lib/queries';

/**
 * Storage and project usage for the signed-in account, with their plan.
 *
 * Kept out of /api/home deliberately: this scans the user's files and comments,
 * and the dashboard should not pay for it on every paint to populate something
 * only visible after a click. The account menu fetches this lazily on open.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json(await getAccountUsage(session.user.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/me/usage] query failed:', message);

    // Migrations here are manual and have been forgotten before. A missing
    // users.plan is by far the most likely cause of this route failing on a
    // deploy, so say so rather than returning an opaque 500.
    if (/column .* does not exist/i.test(message)) {
      // The console.error above is what actually helps a developer here; the
      // raw Postgres message has no business leaving the server, and the
      // client never rendered `detail` anyway.
      return NextResponse.json(
        {
          error:
            'The database is missing a column this version needs. Run `npm run migrate` to apply lib/migrations.',
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: 'Could not load your usage.' },
      { status: 500 }
    );
  }
}
