import { sql } from '@/lib/db';

/**
 * Add the comment columns that arrived after the table did, once per cold
 * start.
 *
 * Migrations here are applied by hand and have been forgotten before. The
 * comment list query names these columns, so a missed migration would put
 * every comment in production behind a 500. This bounds that damage; the
 * migration files remain the real mechanism.
 *
 * Shared because both comment routes name `mentions`.
 */
let attempted = false;

export async function ensureCommentColumns(): Promise<void> {
  if (attempted) return;
  attempted = true;
  try {
    await sql`ALTER TABLE comments ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'`;
    await sql`ALTER TABLE comments ADD COLUMN IF NOT EXISTS timestamp DOUBLE PRECISION DEFAULT NULL`;
    await sql`ALTER TABLE comments ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]'`;
  } catch {
    // columns may already exist or insufficient permissions — either way, proceed
  }
}
