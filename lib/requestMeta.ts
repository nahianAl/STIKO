/**
 * The caller's IP address and browser, passed to WorkOS on every
 * authentication call. WorkOS rate-limits and scores sign-in attempts with
 * them; without them every attempt looks like it comes from Vercel.
 */
export function requestMeta(headers: { get(name: string): string | null }): {
  ipAddress?: string;
  userAgent?: string;
} {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ipAddress = forwarded || headers.get('x-real-ip')?.trim() || undefined;
  const userAgent = headers.get('user-agent') || undefined;
  return {
    ...(ipAddress ? { ipAddress } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
