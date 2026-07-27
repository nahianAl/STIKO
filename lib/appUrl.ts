/**
 * The application's own base URL, for links that go into outbound email.
 *
 * This must NEVER be derived from the incoming request. An attacker who can set
 * the Host header can otherwise trigger a password reset for someone else's
 * address and have the victim receive a link pointing at their own host — the
 * token is valid, so that is account takeover. The same applies, less severely,
 * to invitation and new-version emails, which would carry a phishing link
 * wearing our sender.
 *
 * Configuration is therefore mandatory rather than best-effort: if no base URL
 * is set we refuse to build a link at all.
 */
export function appBaseUrl(): string {
  const base = process.env.NEXTAUTH_URL ?? process.env.APP_URL;
  if (!base) {
    throw new Error(
      'NEXTAUTH_URL (or APP_URL) must be configured before Stiko can put links in email.'
    );
  }
  return base.replace(/\/+$/, '');
}

/** Non-throwing variant, for callers that must not fail loudly. */
export function appBaseUrlOrNull(): string | null {
  try {
    return appBaseUrl();
  } catch {
    return null;
  }
}
