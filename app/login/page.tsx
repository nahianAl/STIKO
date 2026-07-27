'use client';

import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import Button from '@/components/ui/Button';
import { ErrorBanner, Field, Input } from '@/components/ui/Primitives';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError('Invalid email or password');
      return;
    }

    router.push(callbackUrl);
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to pick up your reviews."
      below={
        <>
          New to Stiko?{' '}
          <Link
            href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}
            className="font-bold"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-[15px]">
        {error && <ErrorBanner>{error}</ErrorBanner>}

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

        <Field
          label="Password"
          action={
            <Link
              href="/forgot-password"
              className="text-[11.5px] font-bold"
            >
              Forgot?
            </Link>
          }
        >
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>

        <Button type="submit" fullWidth disabled={loading} className="!py-3">
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
