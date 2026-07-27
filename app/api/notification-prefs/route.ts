import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { NOTIFICATION_EVENTS } from '@/lib/notificationEvents';

/** Per-event, per-channel notification preferences (3k). */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await sql`
    SELECT event, in_app AS "inApp", email
    FROM notification_prefs WHERE user_id = ${session.user.id}
  `;

  const stored = new Map(rows.map((r) => [r.event as string, r]));

  return NextResponse.json(
    NOTIFICATION_EVENTS.map((e) => ({
      key: e.key,
      label: e.label,
      note: e.note,
      inAppApplies: e.inAppApplies,
      emailApplies: e.emailApplies,
      inApp: stored.has(e.key) ? Boolean(stored.get(e.key)!.inApp) : e.inApp,
      email: stored.has(e.key) ? Boolean(stored.get(e.key)!.email) : e.email,
    }))
  );
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { event, inApp, email } = await request.json();

  if (!NOTIFICATION_EVENTS.some((e) => e.key === event)) {
    return NextResponse.json({ error: 'Unknown event' }, { status: 400 });
  }

  await sql`
    INSERT INTO notification_prefs (id, user_id, event, in_app, email)
    VALUES (${uuidv4()}, ${session.user.id}, ${event}, ${Boolean(inApp)}, ${Boolean(email)})
    ON CONFLICT (user_id, event)
    DO UPDATE SET in_app = EXCLUDED.in_app, email = EXCLUDED.email
  `;

  return NextResponse.json({ ok: true });
}
