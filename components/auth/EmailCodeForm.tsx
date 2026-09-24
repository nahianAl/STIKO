'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { ErrorBanner, Field, Input } from '@/components/ui/Primitives';
import { useAuthActions } from '@/lib/authClient';
import { authErrorMessage } from '@/lib/authMessages';

const RESEND_SECONDS = 60;

/**
 * The emailed-code step of a WorkOS sign-in. Used on /verify-email and inside
 * the invitation panel, so an invited person never leaves the invitation to
 * confirm their address.
 */
export default function EmailCodeForm({
  email,
  onVerified,
  submitLabel = 'Verify and continue',
}: {
  email: string;
  onVerified: () => void;
  submitLabel?: string;
}) {
  const { verifyEmail, resendCode } = useAuthActions();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(RESEND_SECONDS);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (countdown === 0) return;
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await verifyEmail(code.trim());
    if (result.ok) {
      onVerified();
      return;
    }
    setLoading(false);
    setError(authErrorMessage(result));
  };

  const resend = async () => {
    setCountdown(RESEND_SECONDS);
    setError(null);
    const result = await resendCode();
    if (result.ok) setResent(true);
    else setError(authErrorMessage(result));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-[15px]">
      <p className="text-[13px] leading-[1.6] text-stiko-muted">
        We sent a code to <b className="text-stiko-ink">{email}</b>. Enter it to finish.
      </p>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <Field label="Code">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
        />
      </Field>

      <Button type="submit" fullWidth disabled={loading || !code.trim()} className="!py-3">
        {loading ? 'Checking…' : submitLabel}
      </Button>

      <p className="text-center text-[12.5px] text-stiko-faint">
        Didn&apos;t arrive?{' '}
        {countdown > 0 ? (
          <span>
            {resent ? 'Sent. ' : ''}Resend in 0:{String(countdown).padStart(2, '0')}
          </span>
        ) : (
          <button
            type="button"
            onClick={resend}
            className="font-bold text-stiko-primary hover:text-stiko-primary-hover"
          >
            Resend
          </button>
        )}
      </p>
    </form>
  );
}
