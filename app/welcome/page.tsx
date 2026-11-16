'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import Button from '@/components/ui/Button';
import { ErrorBanner, Field, Input, inputClass } from '@/components/ui/Primitives';
import { CLIENT_MODELS, OTHER_TEXT_MAX, PILLARS, ROLES, SIZE_BANDS, type PillarId } from '@/lib/kyc/catalog';
import { businessTypesFor, isOtherSegment } from '@/lib/kyc/profile';
import { safeCallbackUrl } from '@/lib/callbackUrl';
import { useAuthActions } from '@/lib/authClient';

const PRIVACY_URL = 'https://www.stiko.design/privacy';

const FIELD_ERRORS: Record<string, string> = {
  pillar: 'Pick what best describes your work.',
  segmentId: 'Pick your type of business.',
  businessTypeOther: 'Tell us what your business does (up to 120 characters).',
  clientModel: 'Tell us who you design or build for.',
  companySizeBand: 'Pick your company size.',
  role: 'Pick your role.',
};

function chip(selected: boolean) {
  return `rounded-[10px] border-[1.5px] px-3 py-[9px] text-left text-[13px] transition ${
    selected
      ? 'border-stiko-primary bg-stiko-tint font-bold text-stiko-ink'
      : 'border-stiko-divider bg-white text-stiko-secondary hover:border-stiko-primary'
  }`;
}

function WelcomeForm() {
  const router = useRouter();
  const callbackUrl = safeCallbackUrl(useSearchParams().get('callbackUrl'));
  const { signOutTo } = useAuthActions();
  // Switching account must not lose where the person was headed (an invitation, a package).
  const signedOutLanding = callbackUrl === '/' ? '/login' : `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  const [pillar, setPillar] = useState<PillarId | ''>('');
  const [segmentId, setSegmentId] = useState('');
  const [other, setOther] = useState('');
  const [clientModel, setClientModel] = useState('');
  const [size, setSize] = useState('');
  const [role, setRole] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const types = useMemo(() => (pillar ? businessTypesFor(pillar) : []), [pillar]);
  const needsOther = isOtherSegment(segmentId);
  const complete =
    pillar && segmentId && clientModel && size && role && (!needsOther || other.trim().length > 0);

  const choosePillar = (id: PillarId) => {
    if (id !== pillar) {
      setPillar(id);
      setSegmentId('');
      setOther('');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complete || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pillar, segmentId, businessTypeOther: needsOther ? other : undefined,
          clientModel, companySizeBand: size, role, marketingConsent, callbackUrl,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // A full navigation, not router.push: the middleware must see the new
        // stiko_profile cookie on the next request.
        window.location.assign(safeCallbackUrl(data.redirectPath));
        return;
      }
      setSaving(false);
      if (res.status === 401) {
        router.push(`/login?callbackUrl=${encodeURIComponent(`/welcome?callbackUrl=${encodeURIComponent(callbackUrl)}`)}`);
        return;
      }
      setError(FIELD_ERRORS[data.field] ?? 'Could not save your answers. Try again.');
    } catch {
      // Network failure: fetch rejects instead of returning a status.
      setSaving(false);
      setError('Could not save your answers. Check your connection and try again.');
    }
  };

  return (
    <AuthShell
      title="Tell us about your work"
      subtitle="Five quick questions so stiko fits how you review."
      width={560}
      below={
        <>
          Not you?{' '}
          <button type="button" disabled={saving} onClick={() => void signOutTo(signedOutLanding)} className="font-bold disabled:opacity-50">
            Sign out
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-[22px]">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        <fieldset className="min-w-0">
          <legend className="mb-[8px] text-[12px] font-bold text-stiko-secondary">What best describes your work?</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PILLARS.map((p) => (
              <button key={p.id} type="button" aria-pressed={pillar === p.id} onClick={() => choosePillar(p.id)} className={chip(pillar === p.id)}>
                {p.label}
              </button>
            ))}
          </div>
        </fieldset>

        {pillar && (
          <fieldset className="min-w-0">
            <legend className="mb-[8px] text-[12px] font-bold text-stiko-secondary">Which best describes your business?</legend>
            <div className="flex max-h-[300px] flex-col gap-[6px] overflow-y-auto pr-1">
              {types.map((t) => (
                <button key={t.id} type="button" aria-pressed={segmentId === t.id} onClick={() => setSegmentId(t.id)} className={chip(segmentId === t.id)}>
                  <span className="block">{t.label}</span>
                  <span className="block text-[11.5px] font-medium text-stiko-faint">{t.helper}</span>
                </button>
              ))}
            </div>
            {needsOther && (
              <div className="mt-[10px]">
                <Field label="What does your business do?">
                  <Input value={other} maxLength={OTHER_TEXT_MAX} onChange={(e) => setOther(e.target.value)} autoFocus />
                </Field>
              </div>
            )}
          </fieldset>
        )}

        <fieldset className="min-w-0">
          <legend className="mb-[8px] text-[12px] font-bold text-stiko-secondary">Who do you design or build for?</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {CLIENT_MODELS.map((c) => (
              <button key={c.id} type="button" aria-pressed={clientModel === c.id} onClick={() => setClientModel(c.id)} className={chip(clientModel === c.id)}>
                {c.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="mb-[8px] text-[12px] font-bold text-stiko-secondary">How many people work at your company?</legend>
          <div className="flex flex-wrap gap-2">
            {SIZE_BANDS.map((s) => (
              <button key={s.id} type="button" aria-pressed={size === s.id} onClick={() => setSize(s.id)} className={chip(size === s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </fieldset>

        <Field label="What is your role?">
          <select value={role} onChange={(e) => setRole(e.target.value)} required className={inputClass}>
            <option value="" disabled>Choose…</option>
            {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </Field>

        <label className="flex items-start gap-[10px] text-[12.5px] text-stiko-secondary">
          <input type="checkbox" checked={marketingConsent} onChange={(e) => setMarketingConsent(e.target.checked)} className="mt-[2px]" />
          <span>Send me product news and tips from stiko. You can unsubscribe at any time.</span>
        </label>

        <Button type="submit" fullWidth disabled={!complete || saving} className="!py-3">
          {saving ? 'Saving…' : 'Continue'}
        </Button>

        <p className="text-center text-[11.5px] text-stiko-faint">
          We use your answers to tailor stiko and our emails.{' '}
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="font-bold underline">Privacy policy</a>
        </p>
      </form>
    </AuthShell>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={null}>
      <WelcomeForm />
    </Suspense>
  );
}
