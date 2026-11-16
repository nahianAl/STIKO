/**
 * Trailing-slash handling for app paths. Pure, no imports (runs in middleware).
 *
 * next.config.mjs sets skipTrailingSlashRedirect so the PostHog proxy
 * (/ingest/e/, /ingest/flags/ ...) is not answered with a CORS-less 308 before
 * its rewrite runs. That flag also switches off Next's own `/x/` -> `/x`
 * redirect for the whole app, so middleware does it instead, for the paths the
 * middleware matcher covers. /ingest, /_next, uploads and the other matcher
 * exclusions never reach middleware, so they are left alone: that is the point.
 */

/**
 * The path without its trailing slash(es), or null when no redirect is needed.
 * '/' and slashless paths -> null; '/settings/' -> '/settings'; '/a//' -> '/a';
 * a path of only slashes ('//') -> '/'. Slashes inside the path are untouched.
 */
export function stripTrailingSlash(pathname: string): string | null {
  if (pathname.length <= 1 || !pathname.endsWith('/')) return null;
  return pathname.replace(/\/+$/, '') || '/';
}

/**
 * The absolute URL to 308 a slash-ended request to, query string kept, or null.
 *
 * The pathname is SET on a URL object, never concatenated into a string and
 * resolved: '//evil.com/' is a path on our host, and resolving the stripped
 * '//evil.com' against the origin would read it as a protocol-relative URL to
 * evil.com, an open redirect. The pathname setter does not re-parse a host.
 * Also deliberately a plain URL, not Next's NextURL: NextURL remembers that the
 * original path ended in '/' and writes the slash back into href.
 */
export function trailingSlashRedirectTarget(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  const stripped = stripTrailingSlash(url.pathname);
  if (stripped === null) return null;
  url.pathname = stripped;
  return url.href;
}
