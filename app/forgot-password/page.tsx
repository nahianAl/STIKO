'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import Button from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Primitives';
import { NOTES } from '@/lib/design';

const RESEND_SECONDS = 60;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (!sent || countdown === 0) return;
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [sent, countdown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    setLoading(false);
    setSent(true);
    setCountdown(RESEND_SECONDS);
  };

  const resend = async () => {
    setCountdown(RESEND_SECONDS);
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  };

  if (sent) {
    // 3c: this state is shown for every address, registered or not — never
    // confirm whether an account exists.
    return (
      <AuthShell title="Reset your password">
        <div className="flex flex-col items-center text-center">
          <span
            className="flex h-[44px] w-[44px] items-center justify-center rounded-[13px]"
            style={{ background: NOTES.green.pastel }}
          >
            <svg
              className="h-5 w-5"
              style={{ color: NOTES.green.text }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 8l9 6 9-6M3 7a1 1 0 011-1h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1z" />
            </svg>
          </span>

          <h2 className="mt-4 text-[18px] font-extrabold text-stiko-ink">
            Check your email
          </h2>
          <p className="mt-2 text-[13px] leading-[1.6] text-stiko-muted">
            We sent a reset link to <b className="text-stiko-ink">{email}</b>. It
            expires in an hour.
          </p>

          <p className="mt-5 text-[12.5px] text-stiko-faint">
            Didn&apos;t arrive?{' '}
            {countdown > 0 ? (
              <span>
                Resend in 0:{String(countdown).padStart(2, '0')}
              </span>
            ) : (
              <button
                onClick={resend}
                className="font-bold text-stiko-primary hover:text-stiko-primary-hover"
              >
                Resend
              </button>
            )}
          </p>

          <Link href="/login" className="mt-5 text-[12.5px] font-bold">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password">
      <form onSubmit={submit} className="flex flex-col gap-[15px]">
        <p className="text-[13px] leading-[1.6] text-stiko-muted">
          We&apos;ll email you a link. It works once and expires in an hour.
        </p>

        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="email"
            placeholder="you@company.com"
          />
        </Field>

        <Button type="submit" fullWidth disabled={loading} className="!py-3">
          {loading ? 'Sending…' : 'Send reset link'}
        </Button>

        <Link
          href="/login"
          className="text-center text-[12.5px] font-bold text-stiko-muted hover:text-stiko-ink"
        >
          Back to sign in
        </Link>
      </form>
    </AuthShell>
  );
}
