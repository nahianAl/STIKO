import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';
import { sendEmail, inviteEmail } from '@/lib/email';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const portalId = request.nextUrl.searchParams.get('portalId');
  if (!portalId) {
    return NextResponse.json({ error: 'portalId required' }, { status: 400 });
  }

  // A package is a permission boundary — never hand back its roster to someone
  // who isn't on it.
  const access = await getPackageAccess(session.user.id, portalId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const rows = await sql`
    SELECT p.id, p.portal_id AS "portalId", p.user_id AS "userId",
           p.role, p.created_at AS "createdAt",
           u.email, u.name, u.company
    FROM participants p
    JOIN users u ON u.id = p.user_id
    WHERE p.portal_id = ${portalId}
    ORDER BY p.created_at ASC
  `;
  return NextResponse.json(rows);
}

/** POST — issue an invitation. Same tokenised link for every role (bug #2). */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { portalId, email, role, note } = await request.json();

  if (!portalId || !email || !role) {
    return NextResponse.json(
      { error: 'portalId, email and role are required' },
      { status: 400 }
    );
  }
  if (!['viewer', 'commenter', 'uploader'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const access = await getPackageAccess(session.user.id, portalId);
  if (!access?.canManagePeople) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const token = uuidv4();
  // 04 states 14 days in user-facing copy; the code previously issued 7.
  const expiresAt = new Date(Date.now() + FOURTEEN_DAYS_MS);

  const rows = await sql`
    INSERT INTO invite_tokens
      (id, token, portal_id, role, email, expires_at, invited_by, note)
    VALUES (
      ${uuidv4()}, ${token}, ${portalId}, ${role}, ${email},
      ${expiresAt.toISOString()}, ${session.user.id}, ${note ?? null}
    )
    RETURNING token
  `;

  const context = await sql`
    SELECT po.name AS "packageName", pr.name AS "projectName"
    FROM portals po JOIN projects pr ON pr.id = po.project_id
    WHERE po.id = ${portalId}
  `;

  const base = process.env.NEXTAUTH_URL ?? request.nextUrl.origin;
  const link = `${base}/invite/${rows[0].token}`;

  const result = await sendEmail({
    to: email,
    ...inviteEmail({
      inviterName: session.user.name ?? 'Someone',
      packageName: context[0]?.packageName ?? 'a package',
      projectName: context[0]?.projectName ?? '',
      role,
      link,
      note,
    }),
  });

  // Report delivery honestly — the UI adjusts its wording rather than claiming
  // an email went out when no provider is configured.
  return NextResponse.json(
    { token: rows[0].token, link, emailDelivered: result.delivered },
    { status: 201 }
  );
}
