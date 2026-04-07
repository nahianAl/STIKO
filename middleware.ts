import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/invite',
  '/api/auth',
  '/api/conversions/webhook',
  '/api/files',
];

// Paths that require auth
const PROTECTED_PATHS = [
  '/',
  '/project',
  '/api/projects',
  '/api/portals',
  '/api/versions',
  '/api/participants',
  '/api/invite',
];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthenticated = !!req.auth;

  // Allow public paths through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // /portal/[id] is public (viewer access) — no auth needed
  // /portal/[id]/submit requires auth (checked in the route handler itself)
  if (pathname.startsWith('/portal')) {
    return NextResponse.next();
  }

  // Everything else requires auth
  if (!isAuthenticated) {
    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|uploads).*)'],
};
