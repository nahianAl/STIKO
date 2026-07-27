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

  const data = await getHomeData(session.user.id);
  return NextResponse.json(data);
}
