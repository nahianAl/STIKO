'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogoMark, Wordmark } from '@/components/ui/Shell';
import OnboardingForm from '@/components/welcome/OnboardingForm';
import { EMPTY_FORM, FIELD_ERRORS, toRequestBody, type FormValues } from '@/lib/kyc/form';
import type { OnboardingKind, SubmitKind } from '@/lib/kyc/profile';
import { safeCallbackUrl } from '@/lib/callbackUrl';
import { useAuthActions } from '@/lib/authClient';

const PRIVACY_URL = 'https://www.stiko.design/privacy';
const linkClass = 'font-bold text-stiko-primary';

const COPY: Record<SubmitKind, { title: string; subtitle: string; button: string }> = {
  full: { title: 'Set up your workspace', subtitle: 'So we can set stiko up for the files you review.', button: 'Create workspace' },
  role: { title: 'Welcome to stiko', subtitle: 'One question before you see what was shared with you.', button: 'Continue' },
  company: { title: 'Tell us about your company', subtitle: 'Needed once, before your first project.', button: 'Save and continue' },
};

interface WelcomeState { kind: OnboardingKind; prefillWebsite: string }

function Welcome() {
  const router = useRouter();
  const callbackUrl = safeCallbackUrl(useSearchParams().get('callbackUrl'));
  const { signOutTo } = useAuthActions();
  // Switching account must not lose where the person was headed (an invitation, a package).
  const signedOutLanding = callbackUrl === '/' ? '/login' : `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  const loginAgain = () =>
    router.push(`/login?callbackUrl=${encodeURIComponent(`/welcome?callbackUrl=${encodeURIComponent(callbackUrl)}`)}`);

  const [state, setState] = useState<WelcomeState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<{ field: string | null; message: string } | null>(null);

  const load = () => {
    setLoadError(false);
    fetch('/api/welcome')
      .then(async (r) => {
        if (r.status === 401) return loginAgain();
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as WelcomeState;
        // Nothing left to answer: go where they were headed.
        if (data.kind === 'done') window.location.assign(callbackUrl);
        else setState(data);
      })
      .catch(() => setLoadError(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const submit = async (values: FormValues) => {
    if (!state || state.kind === 'done') return;
    setSaving(true);
    setServerError(null);
    try {
      const res = await fetch('/api/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...toRequestBody(values, state.kind), callbackUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // A full navigation, not router.push: the middleware must see the new cookie.
        window.location.assign(safeCallbackUrl(data.redirectPath));
        return;
      }
      setSaving(false);
      if (res.status === 401) return loginAgain();
      if (res.status === 409) {
        // The account changed under us (e.g. finished in another tab): reload the right variant.
        setState(null);
        load();
        return;
      }
      const field = typeof data.field === 'string' ? data.field : null;
      setServerError({
        field,
        message: (field && FIELD_ERRORS[field as keyof typeof FIELD_ERRORS]) || 'Could not save your answers. Try again.',
      });
    } catch {
      setSaving(false);
      setServerError({ field: null, message: 'Could not save your answers. Check your connection and try again.' });
    }
  };

  const kind = state && state.kind !== 'done' ? state.kind : null;

  return (
    <div className="min-h-screen bg-stiko-app px-4 pb-10 pt-6 sm:pt-12">
      <div className="mx-auto flex w-full max-w-[480px] flex-col">
        <div className="flex items-center gap-[7px]">
          <LogoMark size={24} />
          <Wordmark />
        </div>

        {loadError && (
          <p className="mt-10 text-[13.5px] text-stiko-muted">
            Could not load this page.{' '}
            <button type="button" onClick={load} className={linkClass}>Try again</button>
          </p>
        )}

        {kind && (
          <>
            <h1 className="mt-8 text-[22px] font-extrabold leading-[1.2] tracking-title text-stiko-ink sm:text-[24px]">
              {COPY[kind].title}
            </h1>
            <p className="mt-[6px] text-[13.5px] text-stiko-muted">{COPY[kind].subtitle}</p>
            <div className="mt-6 rounded-[14px] border border-stiko-border bg-white p-5 sm:p-6">
              <OnboardingForm
                variant={kind}
                initial={EMPTY_FORM}
                prefillWebsite={state!.prefillWebsite}
                submitLabel={COPY[kind].button}
                showMarketing={kind !== 'company'}
                saving={saving}
                serverError={serverError}
                onSubmit={submit}
                onEdit={() => serverError && setServerError(null)}
              />
            </div>
          </>
        )}

        <p className="mt-4 text-center text-[11.5px] text-stiko-faint">
          How we use your answers:{' '}
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className={linkClass}>Privacy policy</a>
          {' · '}Not you?{' '}
          <button type="button" disabled={saving} onClick={() => void signOutTo(signedOutLanding)} className={`${linkClass} disabled:opacity-50`}>
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={null}>
      <Welcome />
    </Suspense>
  );
}
