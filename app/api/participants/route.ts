import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const portalId = searchParams.get('portalId');

  const rows = await sql`
    SELECT p.id, p.portal_id AS "portalId", p.user_id AS "userId",
           p.role, p.created_at AS "createdAt",
           u.email, u.name
    FROM participants p
    JOIN users u ON u.id = p.user_id
    WHERE p.portal_id = ${portalId}
    ORDER BY p.created_at ASC
  `;
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { portalId, email, role } = await request.json();

  // Generate invite token instead of directly adding (handled by invite flow)
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const rows = await sql`
    INSERT INTO invite_tokens (id, token, portal_id, role, email, expires_at)
    VALUES (${uuidv4()}, ${token}, ${portalId}, ${role}, ${email}, ${expiresAt.toISOString()})
    RETURNING token
  `;

  return NextResponse.json({ token: rows[0].token }, { status: 201 });
}
