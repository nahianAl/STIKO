/**
 * Pure presentation logic for the version detail drawer.
 *
 * Imports nothing, so tests load it without a database — the same split that
 * keeps lib/brief.ts loadable when DATABASE_URL is unset.
 *
 * Dates arrive already formatted. Formatting them here would mean asserting on
 * toLocaleDateString output, which varies by the machine's timezone and would
 * make this suite pass or fail by region.
 */

/**
 * Who uploaded a file, or an honest admission that we do not know.
 *
 * files.uploaded_by is ON DELETE SET NULL, and rows predating migration 005
 * were backfilled from versions.created_by, which can itself be null. Guessing
 * — "the version author probably uploaded it" — would attribute a file to
 * someone who may not have touched it.
 */
export function uploaderLabel(name: string | null): string {
  return name && name.trim() ? name : 'Uploader unknown';
}

/** One decimal from a kilobyte up, matching the local helper in CommentsPanel. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The drawer's header subtitle. Varies on two axes: whether this is the newest
 * version in the package, and whether it has been published.
 *
 * `createdByName` is null when the author's user row was deleted; the by-clause
 * is dropped rather than rendering "by null".
 */
export function versionSubtitle({
  isCurrent,
  isPublished,
  dateLabel,
  createdByName,
}: {
  isCurrent: boolean;
  isPublished: boolean;
  dateLabel: string;
  createdByName: string | null;
}): string {
  const by = createdByName && createdByName.trim() ? ` by ${createdByName}` : '';
  if (!isPublished) return `Draft · Created ${dateLabel}${by}`;
  const prefix = isCurrent ? 'Current · ' : '';
  return `${prefix}Published ${dateLabel}${by}`;
}

/**
 * What to show instead of a changelog, or null when there is a real one.
 *
 * A draft gets a different line from a published version with an empty
 * changelog: the field is captured at publish time, so "no description was
 * written" would blame an uploader who has not reached that step yet.
 */
export function changelogFallback({
  changelog,
  isPublished,
}: {
  changelog: string | null;
  isPublished: boolean;
}): string | null {
  if (changelog && changelog.trim()) return null;
  return isPublished
    ? 'No description was written for this version.'
    : 'Not published yet.';
}

/** The second line of a file card: who, when, how big. */
export function fileMetaLine({
  uploadedByName,
  dateLabel,
  fileSize,
}: {
  uploadedByName: string | null;
  dateLabel: string;
  fileSize: number;
}): string {
  return `${uploaderLabel(uploadedByName)} · ${dateLabel} · ${formatFileSize(fileSize)}`;
}
