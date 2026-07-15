/** Two-letter initials from an email local-part: "dana.whitmore@x" -> "DW". */
export function initialsFromEmail(email: string): string {
  const local = (email.split('@')[0] || email || '?').trim();
  const parts = local.split(/[._\-+]/).filter(Boolean);
  const letters =
    parts.length >= 2
      ? parts[0][0] + parts[1][0]
      : local.slice(0, 2);
  return letters.toUpperCase();
}
