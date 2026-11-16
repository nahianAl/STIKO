import { NextRequest, NextResponse } from 'next/server';
import { consentRequired } from '@/lib/geo';

export const dynamic = 'force-dynamic';

/** The marketing site calls this cross-origin; nothing else may read it from a browser. */
const ALLOWED_ORIGINS = new Set(['https://www.stiko.design', 'https://stiko.design']);

/** GET — does this visitor's country need a cookie banner? Public (lib/routeAccess.ts). */
export async function GET(request: NextRequest) {
  const res = NextResponse.json({
    consentRequired: consentRequired(request.headers.get('x-vercel-ip-country')),
  });
  res.headers.set('Cache-Control', 'private, no-store');
  const origin = request.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
  }
  return res;
}
