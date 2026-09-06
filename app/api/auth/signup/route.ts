import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { hashPassword } from '@/lib/password';

export async function POST(request: NextRequest) {
  const { name, email, password } = await request.json();

  if (!email || !password || !name) {
    return NextResponse.json({ error: 'Name, email and password are required' }, { status: 400 });
  }

  // Case-insensitive, matching app/api/auth/forgot-password/route.ts. A
  // case-sensitive check let DANA@co.com be registered alongside dana@co.com as
  // a separate account — which, since lib/inviteBinding.ts compares addresses
  // case-insensitively, was enough to redeem an invitation addressed to the
  // other one. The permanent fix is the lower(email) unique index in the WorkOS
  // migration; this closes the hole until that lands.
  const existing = await sql`SELECT id FROM users WHERE lower(email) = lower(${email})`;
  if (existing[0]) {
    return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
  }

  const id = uuidv4();
  const passwordHash = await hashPassword(password);

  await sql`
    INSERT INTO users (id, name, email, password_hash)
    VALUES (${id}, ${name}, ${email}, ${passwordHash})
  `;

  return NextResponse.json({ success: true }, { status: 201 });
}
