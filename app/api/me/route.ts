import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await sql`
    SELECT id, name, email, job_title AS "jobTitle", company,
           email_paused_until AS "emailPausedUntil"
    FROM users WHERE id = ${session.user.id}
  `;
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(rows[0]);
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
