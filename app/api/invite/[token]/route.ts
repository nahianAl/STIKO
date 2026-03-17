import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';

// GET — validate a token and return its metadata (for the invite landing page)
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string } }
) {
  const rows = await sql`
    SELECT t.id, t.token, t.portal_id AS "portalId", t.role, t.email,
           t.expires_at AS "expiresAt", t.used_at AS "usedAt",
           po.name AS "portalName", pr.name AS "projectName"
    FROM invite_tokens t
    JOIN portals po ON po.id = t.portal_id
    JOIN projects pr ON pr.id = po.project_id
    WHERE t.token = ${params.token}
  `;

  const invite = rows[0];
  if (!invite) return NextResponse.json({ error: 'Invalid invite link' }, { status: 404 });
  if (invite.usedAt) return NextResponse.json({ error: 'Invite already used' }, { status: 410 });
  if (new Date(invite.expiresAt as string) < new Date()) {
    return NextResponse.json({ error: 'Invite has expired' }, { status: 410 });
  }

  return NextResponse.json(invite);
}

// POST — consume the token and add the logged-in user as a participant
export async function POST(
  _request: NextRequest,
  { params }: { params: { token: string } }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await sql`
    SELECT * FROM invite_tokens WHERE token = ${params.token}
  `;
  const invite = rows[0];
  if (!invite) return NextResponse.json({ error: 'Invalid invite link' }, { status: 404 });
  if (invite.used_at) return NextResponse.json({ error: 'Invite already used' }, { status: 410 });
  if (new Date(invite.expires_at as string) < new Date()) {
    return NextResponse.json({ error: 'Invite has expired' }, { status: 410 });
  }

  // Add participant (ignore if already exists)
  await sql`
    INSERT INTO participants (id, portal_id, user_id, role)
    VALUES (${uuidv4()}, ${invite.portal_id}, ${session.user.id}, ${invite.role})
    ON CONFLICT (portal_id, user_id) DO NOTHING
  `;

  // Mark token as used
  await sql`UPDATE invite_tokens SET used_at = NOW() WHERE token = ${params.token}`;

  const redirectPath = invite.role === 'uploader'
    ? `/portal/${invite.portal_id}/submit`
    : `/portal/${invite.portal_id}`;

  return NextResponse.json({ redirectPath });
}
