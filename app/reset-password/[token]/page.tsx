'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import AuthShell, { PasswordStrength } from '@/components/auth/AuthShell';
import Button from '@/components/ui/Button';
import { ErrorBanner, Field, Input, Note } from '@/components/ui/Primitives';

function ResetForm() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  // 3d: preserve and follow callbackUrl through the reset, so a pending invite
  // survives a password recovery.
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/';

  const [email, setEmail] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok) setEmail(d.email);
        else setTokenError(d.error ?? 'This link is not valid');
      })
      .catch(() => setTokenError('This link is not valid'));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('Those passwords don’t match');
      return;
    }

    setLoading(true);
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? 'Could not reset your password');
      setLoading(false);
      return;
    }

    // "Save and sign in" — signs you in and returns you wherever you were
    // headed, including a pending invite.
    await signIn('credentials', {
      email: data.email,
      password,
      redirect: false,
    });
    router.push(callbackUrl);
  };

  if (tokenError) {
    return (
      <AuthShell title="Set a new password">
        <div className="flex flex-col gap-4">
          <ErrorBanner>{tokenError}</ErrorBanner>
          <Link
            href="/forgot-password"
            className="text-center text-[12.5px] font-bold"
          >
            Request a new link
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set a new password"
      subtitle={email ?? undefined}
      below={
        <Note className="text-left">
          Signs you in and returns you wherever you were headed — including a
          pending invite.
        </Note>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-[15px]">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        <div>
          <Field label="New password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoFocus
              autoComplete="new-password"
            />
          </Field>
          <PasswordStrength password={password} />
        </div>

        <Field label="Confirm password">
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
          />
        </Field>

        <Button
          type="submit"
          fullWidth
          disabled={loading || !email}
          className="!py-3"
        >
          {loading ? 'Saving…' : 'Save and sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
