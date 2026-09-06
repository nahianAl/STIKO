#!/usr/bin/env node
/**
 * Create a WorkOS user for every local account and record the link.
 *
 * Existing bcrypt hashes are carried across, so nobody is forced to reset a
 * password at cutover. Stiko hashes at bcrypt cost 12 (lib/password.ts), which
 * is what WorkOS's passwordHashType: 'bcrypt' expects.
 *
 * Safe to re-run: users already carrying a workos_user_id are skipped, and a
 * user WorkOS reports as already existing is adopted by email rather than
 * failing the run. That matters because this runs against production with no
 * staging environment to rehearse in.
 *
 * Written as a script rather than a migration because it talks to a third-party
 * API: it is rate-limited, partially resumable, and must be able to report what
 * it could not do. lib/migrations/*.sql is for DDL only.
 *
 * Usage:  npm run import-users -- --dry   list what would happen, touch nothing
 *         npm run import-users            do it
 */

import { neon } from '@neondatabase/serverless';
import { WorkOS } from '@workos-inc/node';

const dry = process.argv.includes('--dry');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'DATABASE_URL is not set.\n' +
      'Load your env first, e.g.:  set -a && . .env.local && set +a && npm run import-users'
  );
  process.exit(1);
}

const apiKey = process.env.WORKOS_API_KEY;
if (!apiKey) {
  console.error('WORKOS_API_KEY is not set.');
  process.exit(1);
}

const sql = neon(connectionString);
const workos = new WorkOS(apiKey);

/** Split a stored name into the first/last pair WorkOS expects. */
function splitName(name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return { firstName: undefined, lastName: undefined };
  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
  };
}

async function main() {
  const users = await sql`
    SELECT id, name, email, password_hash, workos_user_id
    FROM users ORDER BY created_at
  `;

  const pending = users.filter((u) => !u.workos_user_id);

  console.log(`${users.length} local user(s), ${pending.length} not yet linked.`);
  if (dry) {
    for (const u of pending) {
      const how = u.password_hash ? 'with existing password' : 'WITHOUT a password';
      console.log(`  would create ${u.email.toLowerCase()} ${how}`);
    }
    console.log('\nDry run — nothing was changed.');
    return;
  }

  let created = 0;
  let adopted = 0;
  const failures = [];

  for (const u of pending) {
    // Lowercased on the way in. The lower(email) unique index added in
    // migration 010 makes this the canonical form locally, and it must match on
    // both sides or the sign-in lookup will miss.
    const email = u.email.toLowerCase();
    const { firstName, lastName } = splitName(u.name);

    let workosUserId = null;
    let createdNow = false;

    try {
      const workosUser = await workos.userManagement.createUser({
        email,
        firstName,
        lastName,
        // These are existing users who have been using the product. Making them
        // re-verify an address they already receive invitations at would be
        // friction with nothing bought.
        emailVerified: true,
        ...(u.password_hash
          ? { passwordHash: u.password_hash, passwordHashType: 'bcrypt' }
          : {}),
      });
      workosUserId = workosUser.id;
      createdNow = true;
    } catch (err) {
      // A re-run after a partial failure, or an address someone already claimed
      // in WorkOS directly. Adopt it rather than failing the whole run: the
      // alternative is a half-imported database and no way to finish.
      //
      // listUsers returns an AutoPaginatable, which is async-iterable. Taking
      // the first item that way rather than reaching into a page wrapper keeps
      // this off an undocumented property of the SDK's list response.
      let existing = null;
      try {
        const page = await workos.userManagement.listUsers({ email, limit: 1 });
        for await (const candidate of page) {
          existing = candidate;
          break;
        }
      } catch {
        existing = null;
      }

      // Adopt ONLY an exact address match. The email filter's semantics are not
      // a contract: if it ever prefix-matches, gets renamed, or is ignored, the
      // first result could be a different person — and since Plan 2 resolves
      // sign-in by workos_user_id, linking the wrong one is account takeover.
      if (existing && existing.email?.toLowerCase() === email) {
        workosUserId = existing.id;
      } else {
        const message = err?.message ?? String(err);
        failures.push({ email, message });
        console.log(`  ✗ ${email} — ${message}`);
        continue;
      }
    }

    // The write-back is its own step. A WorkOS user exists by this point either
    // way, so a failure here is "created but not linked" — not a creation
    // failure — and the operator needs the id to finish it by hand. Keeping it
    // inside the catch above would also run this UPDATE twice on a re-entry,
    // the second time outside any try, killing the run before the summary.
    try {
      await sql`UPDATE users SET workos_user_id = ${workosUserId} WHERE id = ${u.id}`;
      if (createdNow) {
        created++;
        console.log(`  ✓ created ${email}`);
      } else {
        adopted++;
        console.log(`  ✓ adopted existing ${email}`);
      }
    } catch (err) {
      const message = `WorkOS user ${workosUserId} exists but the local link was not written: ${err?.message ?? String(err)}`;
      failures.push({ email, message });
      console.log(`  ✗ ${email} — ${message}`);
    }
  }

  console.log(`\ncreated ${created}, adopted ${adopted}, failed ${failures.length}`);

  if (failures.length) {
    console.error('\nFailures — re-run to retry only these:');
    for (const f of failures) console.error(`  ${f.email}: ${f.message}`);
    process.exit(1);
  }

  console.log('Done. Every local user is linked to a WorkOS user.');
}

main().catch((err) => {
  console.error(`\nImport failed: ${err?.message ?? String(err)}`);
  process.exit(1);
});
