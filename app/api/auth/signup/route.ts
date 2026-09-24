import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { hashPassword } from '@/lib/password';

export async function POST(request: NextRequest) {
  const { name, email: rawEmail, password } = await request.json();

  if (!rawEmail || !password || !name) {
    return NextResponse.json({ error: 'Name, email and password are required' }, { status: 400 });
  }

  // The page enforces this too, but only the server's check counts: the form's
  // minLength was the only thing stopping a one-character password.
  if (typeof password !== 'string' || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  // Stored lowercased: WorkOS lowercases addresses too, and the import and
  // sign-in lookups compare against lower(email). One canonical form on both
  // sides is what keeps them matching.
  const email = String(rawEmail).trim().toLowerCase();

  // Case-insensitive, matching app/api/auth/forgot-password/route.ts. A
  // case-sensitive check let DANA@co.com be registered alongside dana@co.com as
  // a separate account — which, since lib/inviteBinding.ts compares addresses
  // case-insensitively, was enough to redeem an invitation addressed to the
  // other one. The lower(email) unique index from migration 010 now enforces
  // this in the database as well.
  const existing = await sql`SELECT id FROM users WHERE lower(email) = ${email}`;
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
