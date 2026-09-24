/**
 * The one session shape every route handler sees, whichever provider signed
 * the person in.
 *
 * `name` stays in the shape even though the design spec lists only id and
 * email: five handlers read session.user.name (comment author, invite and
 * publish emails, two notifications), and dropping it would quietly turn every
 * one of those into "Someone".
 */

export interface AppSession {
  user: { id: string; name: string | null; email: string };
}

export function toAppSession(
  user: { id?: string | null; name?: string | null; email?: string | null } | null | undefined
): AppSession | null {
  if (!user?.id) return null;
  return { user: { id: user.id, name: user.name ?? null, email: user.email ?? '' } };
}
