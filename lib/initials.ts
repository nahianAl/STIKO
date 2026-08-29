/**
 * Initials for an avatar.
 *
 * Shared because a person's avatar has to read the same everywhere they appear
 * — the comment card header, and the citation avatars in the version brief.
 * Two copies of this drifted apart is a bug nobody would notice until the same
 * name showed two different sets of letters in one panel.
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
