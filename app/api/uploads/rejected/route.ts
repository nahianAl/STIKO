import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { normalizeRejectedExtensions } from '@/lib/rejectedUploads';

/**
 * Counts refused uploads by extension. Fire-and-forget from FileDropzone: nothing waits on
 * it, so every failure here is swallowed into a 204 rather than surfaced.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const extensions = normalizeRejectedExtensions(body?.extensions);
  if (extensions.length === 0) return new NextResponse(null, { status: 204 });

  try {
    // GROUP BY first: ON CONFLICT DO UPDATE cannot touch the same row twice in one
    // statement, and three refused .sldprt files in one drop arrive as three entries.
    await sql`
      INSERT INTO rejected_uploads (extension, count, last_seen)
      SELECT ext, COUNT(*)::int, now()
      FROM unnest(${extensions}::text[]) AS t(ext)
      GROUP BY ext
      ON CONFLICT (extension) DO UPDATE
        SET count = rejected_uploads.count + EXCLUDED.count,
            last_seen = EXCLUDED.last_seen
    `;
  } catch (error) {
    // 42P01 undefined_table: migration 017 has not been applied yet. Migrations here are
    // manual and have been forgotten before; a missing table must cost counts, not uploads.
    if ((error as { code?: string }).code !== '42P01') {
      console.warn('Could not record refused uploads', error);
    }
  }
  return new NextResponse(null, { status: 204 });
}
