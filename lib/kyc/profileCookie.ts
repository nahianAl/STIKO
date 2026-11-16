/**
 * stiko_profile: "this browser's user has completed the KYC step", so the
 * middleware does not query the database on every page.
 *
 * A cache, not an authorization: forging it only skips a marketing form.
 * Web Crypto, so it runs in the edge middleware and in node --test alike.
 * The subject is the identity the middleware can see without a DB call: the
 * WorkOS user id under AUTH_PROVIDER=workos, the local users.id under nextauth.
 */

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
  return `${subject}.${await hmac(secret, `stiko-profile:${subject}`)}`;
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
