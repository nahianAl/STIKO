import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { consentValue } from '@/lib/geo';

/** POST — a signed-in user answered the banner; server events follow their answer. */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const consent = consentValue(body?.consent);
  if (!consent) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  await sql`UPDATE users SET analytics_consent = ${consent} WHERE id = ${session.user.id}`;
  return new NextResponse(null, { status: 204 });
}
