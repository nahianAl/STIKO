/**
 * A link that opens a package on one file, with one comment highlighted.
 *
 * Both ends live here so they cannot drift: the notification that builds the
 * link and the package page that reads it. No imports, so `node --test` can
 * load it.
 *
 * The parameter is `submission` because that is the word people see; in code
 * the id it carries is still a versionId.
 */
export interface PortalDeepLink {
  versionId: string;
  fileId: string;
  commentId: string | null;
}

export function portalDeepLinkPath(portalId: string, link: PortalDeepLink): string {
  const params = new URLSearchParams({ submission: link.versionId, file: link.fileId });
  if (link.commentId) params.set('comment', link.commentId);
  return `/portal/${portalId}?${params.toString()}`;
}

/** Null unless both the submission and the file are named; the comment is optional. */
export function parsePortalDeepLink(search: string): PortalDeepLink | null {
  const params = new URLSearchParams(search);
  const versionId = params.get('submission');
  const fileId = params.get('file');
  if (!versionId || !fileId) return null;
  return { versionId, fileId, commentId: params.get('comment') || null };
}
