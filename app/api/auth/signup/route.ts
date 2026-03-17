import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { hashPassword } from '@/lib/password';

export async function POST(request: NextRequest) {
  const { name, email, password } = await request.json();

  if (!email || !password || !name) {
    return NextResponse.json({ error: 'Name, email and password are required' }, { status: 400 });
  }

  const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
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
