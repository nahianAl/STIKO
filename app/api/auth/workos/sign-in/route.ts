import type { NextRequest } from 'next/server';
import { failureResponse, passwordSignIn, readJson, workosDisabled } from '@/lib/workosFlow';

export async function POST(request: NextRequest) {
  const disabled = workosDisabled();
  if (disabled) return disabled;

  const { email, password } = await readJson(request);
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    return failureResponse({ ok: false, error: 'invalid_request', message: 'Enter your email and password.' });
  }

  return passwordSignIn(request, email.trim().toLowerCase(), password);
}
