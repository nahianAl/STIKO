import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { workosDisabled } from '@/lib/workosFlow';

// Read on every request; a cached answer would show one person's session to
// the next.
export const dynamic = 'force-dynamic';

export async function GET() {
  const disabled = workosDisabled();
  if (disabled) return disabled;

  const session = await auth();
  return NextResponse.json(session ?? { user: null }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
