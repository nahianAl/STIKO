/**
 * stiko_profile: "this browser's user has completed the KYC step", so the
 * middleware does not query the database on every page.
 *
 * A cache, not an authorization: forging it only skips a marketing form.
 * Web Crypto, so it runs in the edge middleware and in node --test alike.
 * The subject is the identity the middleware can see without a DB call: the
 * WorkOS user id under AUTH_PROVIDER=workos, the local users.id under nextauth.
 */
import { ONBOARDING_VERSION } from './gate.ts';

export const PROFILE_COOKIE = 'stiko_profile';
export const PROFILE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

async function hmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  let bin = '';
  for (let i = 0; i < sig.length; i++) bin += String.fromCharCode(sig[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signProfileCookie(subject: string, secret: string): Promise<string> {
  return `${subject}.${await hmac(secret, `stiko-profile:${ONBOARDING_VERSION}:${subject}`)}`;
}

export async function profileCookieValid(
  value: string | undefined,
  subject: string,
  secret: string | undefined
): Promise<boolean> {
  if (!value || !secret || !subject) return false;
  const expected = await signProfileCookie(subject, secret);
  if (value.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < value.length; i++) diff |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * The Set-Cookie header value for stiko_profile.
 *
 * A raw header string, not NextResponse.cookies.set(): authkit appends its
 * refreshed session cookie to the response headers after the NextResponse is
 * built, and .cookies.set() rewrites Set-Cookie from a snapshot taken at
 * construction, which drops that session cookie. Appending this string leaves
 * every existing Set-Cookie alone.
 */
export function profileCookieHeader(value: string, secure: boolean): string {
  return [
    `${PROFILE_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${PROFILE_COOKIE_MAX_AGE}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
