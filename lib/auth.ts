/**
 * auth() — who is making this request, as a local users row.
 *
 * Called from 60 places across the API. It keeps its name and a fixed return
 * shape so that swapping the sign-in provider underneath changes none of them;
 * that is the whole blast-radius strategy of the WorkOS migration.
 */
import { auth as nextAuth } from '@/lib/nextauth';
import { toAppSession, type AppSession } from '@/lib/appSession';
import { authProvider } from '@/lib/authProvider';
import { sql } from '@/lib/db';

export type { AppSession };

export async function auth(): Promise<AppSession | null> {
  if (authProvider() === 'workos') return workosAuth();
  const session = await nextAuth();
  return toAppSession(session?.user);
}

/**
 * A WorkOS session names a WorkOS user; everything in Stiko keys on the local
 * users.id. Map through workos_user_id on every call instead of trusting the
 * name or email sealed into the cookie: those are a snapshot from sign-in,
 * while the local row is the identity of record (and the only place a renamed
 * profile shows up).
 */
async function workosAuth(): Promise<AppSession | null> {
  const { withAuth } = await import('@workos-inc/authkit-nextjs');
  // Never { ensureSignedIn: true }: that redirects to WorkOS's hosted login
  // page, which Stiko does not use. A missing user simply means signed out.
  const { user } = await withAuth();
  if (!user) return null;

  const rows = await sql`
    SELECT id, name, email FROM users WHERE workos_user_id = ${user.id} LIMIT 1
  `;
  // A valid session with no linked row should be impossible (sign-in links
  // before it saves the session). If it happens, read it as signed out rather
  // than inventing an identity.
  return toAppSession(rows[0] as { id: string; name: string | null; email: string } | undefined);
}
