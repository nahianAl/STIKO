/**
 * Make sure a WorkOS user has its local users row, and return that row's id.
 *
 * The rule itself (use, link, create or refuse) is lib/workosIdentity.ts and is
 * tested there. This is only the database half. It runs on every WorkOS
 * sign-in, before the session is saved, so a session never exists for someone
 * auth() cannot map to a row.
 */
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { resolveLocalUser } from '@/lib/workosIdentity';

export type LinkResult = { ok: true; userId: string } | { ok: false; error: 'account_conflict' };

export async function linkLocalUser(
  workosUser: { id: string; email: string; firstName: string | null; lastName: string | null },
  opts: { name?: string | null; passwordHash?: string | null } = {}
): Promise<LinkResult> {
  const email = workosUser.email.trim().toLowerCase();

  // Two passes at most. The second only runs when another request linked or
  // created this row between our read and our write; re-resolving then lands
  // on 'use' or 'conflict' instead of creating a duplicate.
  for (let attempt = 0; attempt < 2; attempt++) {
    const byWorkosId = await sql`SELECT id FROM users WHERE workos_user_id = ${workosUser.id} LIMIT 1`;
    const byEmail = await sql`SELECT id, workos_user_id FROM users WHERE lower(email) = ${email} LIMIT 1`;

    const resolution = resolveLocalUser({
      byWorkosId: byWorkosId[0] ? { id: byWorkosId[0].id as string } : null,
      byEmail: byEmail[0]
        ? { id: byEmail[0].id as string, workosUserId: (byEmail[0].workos_user_id as string | null) ?? null }
        : null,
    });

    switch (resolution.action) {
      case 'use':
        return { ok: true, userId: resolution.userId };

      case 'link': {
        const updated = await sql`
          UPDATE users SET workos_user_id = ${workosUser.id}
          WHERE id = ${resolution.userId} AND workos_user_id IS NULL
          RETURNING id
        `;
        if (updated[0]) return { ok: true, userId: resolution.userId };
        continue;
      }

      case 'create': {
        const name =
          opts.name?.trim() ||
          [workosUser.firstName, workosUser.lastName].filter(Boolean).join(' ') ||
          null;
        const id = uuidv4();
        try {
          // password_hash is written when the caller has the password (sign-up):
          // it is what lets AUTH_PROVIDER=nextauth roll back without locking
          // out accounts created under WorkOS.
          await sql`
            INSERT INTO users (id, name, email, password_hash, workos_user_id)
            VALUES (${id}, ${name}, ${email}, ${opts.passwordHash ?? null}, ${workosUser.id})
          `;
          return { ok: true, userId: id };
        } catch (err) {
          // 23505: a concurrent request inserted this address first.
          if ((err as { code?: string }).code === '23505') continue;
          throw err;
        }
      }

      case 'conflict':
        console.error(
          `[auth] ${email} is linked to WorkOS user ${resolution.existingWorkosUserId}, ` +
            `not ${workosUser.id}. Refusing to re-point it.`
        );
        return { ok: false, error: 'account_conflict' };
    }
  }

  console.error(`[auth] could not settle the local row for ${email} after a retry.`);
  return { ok: false, error: 'account_conflict' };
}
