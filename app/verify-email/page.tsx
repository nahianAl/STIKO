'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import EmailCodeForm from '@/components/auth/EmailCodeForm';
import { safeCallbackUrl } from '@/lib/callbackUrl';

function VerifyEmail() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'));
  // Display only. The code is checked against the paused sign-in held in an
  // httpOnly cookie, never against this parameter.
  const email = searchParams.get('email') ?? 'your email';

  return (
    <AuthShell
      title="Check your email"
      subtitle="One more step to finish signing in."
      below={
        <Link href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`} className="font-bold">
          Back to sign in
        </Link>
      }
    >
      <EmailCodeForm email={email} onVerified={() => router.push(callbackUrl)} />
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
