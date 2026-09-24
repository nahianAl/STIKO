/**
 * Where to go after signing in, if the link said.
 *
 * Only same-site paths are honoured. `//host` and `/\host` look like paths but
 * browsers treat them as another origin, so both are refused along with
 * anything carrying a scheme.
 */
export function safeCallbackUrl(raw: string | null | undefined): string {
  if (!raw) return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}
