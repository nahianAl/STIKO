/**
 * Which page requests send a signed-in visitor without a business profile to
 * /welcome. Pure, tested, shared by both auth providers' middleware.
 *
 * Never gated: /welcome itself, every API route (the form must be able to
 * submit, and invite acceptance is an API call), auth and invite pages (an
 * invite is accepted BEFORE the gate, so it cannot be lost), /pricing, and any
 * path with a dot (static files).
 */

const UNGATED_PREFIXES = [
  '/welcome', '/api/', '/ingest', '/_next/', '/login', '/signup', '/invite',
  '/forgot-password', '/reset-password', '/verify-email', '/pricing',
];

export function kycGateEnabled(value: string | undefined = process.env.KYC_GATE): boolean {
  return value !== 'off';
}

export function isGatedPage(pathname: string): boolean {
  if (pathname.includes('.')) return false;
  // '/api/' already ends in a slash; '/welcome' must match '/welcome' and
  // '/welcome/…' but not '/welcomes'.
  return !UNGATED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`)
  );
}

export function welcomeRedirectPath(pathname: string, search: string): string {
  return `/welcome?${new URLSearchParams({ callbackUrl: `${pathname}${search}` }).toString()}`;
}
