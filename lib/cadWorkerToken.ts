import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The token the CAD worker echoes back to /api/conversions/cad-callback. Bound to the file and the
 * claim, so a late callback from an earlier attempt, or one for another file, never verifies.
 * Server-only (node:crypto): never import this from a client component.
 */
export function cadCallbackToken(secret: string, fileId: string, claimId: string): string {
  return createHmac('sha256', secret).update(`${fileId}:${claimId}`).digest('hex');
}

export function verifyCadCallbackToken(secret: string, fileId: string, claimId: string, token: string): boolean {
  const expected = Buffer.from(cadCallbackToken(secret, fileId, claimId), 'utf8');
  const given = Buffer.from(token, 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
