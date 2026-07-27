'use client';

import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AuthShell, { PasswordStrength } from '@/components/auth/AuthShell';
import Button from '@/components/ui/Button';
import { ErrorBanner, Field, Input } from '@/components/ui/Primitives';

function SignupForm() {
  const router = useRouter();
  // Bug #1: this page linked from /invite/[token] as
  // /signup?callbackUrl=/invite/... but never read the parameter, so every
  // invited user who created an account landed on an empty dashboard with no
  // way back. /login already did this correctly; this mirrors it.
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? 'Sign up failed');
      setLoading(false);
      return;
    }

    await signIn('credentials', { email, password, redirect: false });
    router.push(callbackUrl);
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Send your first drawings out in a minute."
      below={
        <>
          Already have an account?{' '}
          <Link
            href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
            className="font-bold"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-[15px]">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        <Field label="Name">
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            autoComplete="name"
            placeholder="Marcus Reyes"
          />
        </Field>

        <Field label="Work email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="you@company.com"
          />
        </Field>

        <div>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </Field>
          <PasswordStrength password={password} />
        </div>

        <Button type="submit" fullWidth disabled={loading} className="!py-3">
          {loading ? 'Creating account…' : 'Create account'}
        </Button>

        <p className="text-center text-[11.5px] leading-[1.5] text-stiko-faint">
          By creating an account you agree to our Terms and Privacy Policy.
        </p>
      </form>
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
