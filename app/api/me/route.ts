import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';

/**
 * Postgres undefined_table / undefined_column: what a missed migration 019
 * (workspaces, users.profile_completed_at) looks like to a query that uses them.
 */
const MISSING_SCHEMA_CODES: ReadonlySet<string> = new Set(['42P01', '42703']);
let loggedMissingSchema = false;

function isMissingSchema(err: unknown): err is { code: string } {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && MISSING_SCHEMA_CODES.has(code);
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let row: Record<string, unknown> | undefined;
  try {
    const rows = await sql`
      SELECT u.id, u.name, u.email, u.job_title AS "jobTitle", u.company,
             u.email_paused_until AS "emailPausedUntil",
             w.id AS "workspaceId",
             (u.profile_completed_at IS NOT NULL) AS "profileCompleted"
      FROM users u LEFT JOIN workspaces w ON w.owner_user_id = u.id
      WHERE u.id = ${session.user.id}
    `;
    row = rows[0];
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    // Migration 019 was not applied before this deploy. This route feeds the
    // profile page and the analytics identity; it must not 500 for that. Serve
    // the pre-019 shape: no workspace yet, and profileCompleted true so nothing
    // on the client sends the person to /welcome (the gate itself lives in the
    // middleware, not here).
    if (!loggedMissingSchema) {
      loggedMissingSchema = true;
      console.error(
        `[api/me] migration 019 looks unapplied (Postgres ${err.code}); serving the users-only profile. Apply lib/migrations/019-kyc-analytics.sql.`
      );
    }
    const rows = await sql`
      SELECT id, name, email, job_title AS "jobTitle", company,
             email_paused_until AS "emailPausedUntil"
      FROM users WHERE id = ${session.user.id}
    `;
    row = rows[0] ? { ...rows[0], workspaceId: null, profileCompleted: true } : undefined;
  }
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(row);
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name, jobTitle, company, emailPausedUntil } = await request.json();

  // COALESCE so an omitted field keeps its current value rather than being
  // blanked by a partial update.
  await sql`
    UPDATE users SET
      name = COALESCE(${name ?? null}, name),
      job_title = COALESCE(${jobTitle ?? null}, job_title),
      company = COALESCE(${company ?? null}, company),
      email_paused_until = ${emailPausedUntil ?? null}
    WHERE id = ${session.user.id}
  `;

  return NextResponse.json({ ok: true });
}
