'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import LetteredChoices, { type Choice } from '@/components/welcome/LetteredChoices';
import StepFrame from '@/components/welcome/StepFrame';
import { Input } from '@/components/ui/Primitives';
import { CLIENT_MODELS, OTHER_TEXT_MAX, PILLARS, ROLES, SIZE_BANDS } from '@/lib/kyc/catalog';
import { businessTypesFor, isOtherSegment } from '@/lib/kyc/profile';
import {
  STEPS, canContinue, indexForKey, stepForField, stepValue, type WizardAnswers,
} from '@/lib/kyc/wizard';
import { captureClient } from '@/lib/analytics/client';
import { safeCallbackUrl } from '@/lib/callbackUrl';
import { useAuthActions } from '@/lib/authClient';

const PRIVACY_URL = 'https://www.stiko.design/privacy';
const HEADING_ID = 'welcome-question';
const LAST = STEPS.length - 1;

const FIELD_ERRORS: Record<string, string> = {
  pillar: 'Pick what best describes your work.',
  segmentId: 'Pick your type of business.',
  businessTypeOther: 'Tell us what your business does (up to 120 characters).',
  clientModel: 'Tell us who you design or build for.',
  companySizeBand: 'Pick your company size.',
  role: 'Pick your role.',
};

const QUESTIONS = [
  'What best describes your work?',
  'Which best describes your business?',
  'Who do you design or build for?',
  'How many people work at your company?',
  "What's your role?",
];

const EMPTY: WizardAnswers = {
  pillar: '', segmentId: '', businessTypeOther: '', clientModel: '', companySizeBand: '', role: '',
};

const linkClass = 'font-bold text-stiko-primary';

function WelcomeWizard() {
  const router = useRouter();
  const callbackUrl = safeCallbackUrl(useSearchParams().get('callbackUrl'));
  const { signOutTo } = useAuthActions();
  // Switching account must not lose where the person was headed (an invitation, a package).
  const signedOutLanding = callbackUrl === '/' ? '/login' : `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  const [answers, setAnswers] = useState<WizardAnswers>(EMPTY);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const needsOther = isOtherSegment(answers.segmentId);
  const options: Choice[] = useMemo(() => {
    switch (STEPS[step]) {
      case 'pillar': return PILLARS.map((p) => ({ id: p.id, label: p.label }));
      case 'business_type': return businessTypesFor(answers.pillar).map((t) => ({ id: t.id, label: t.label, helper: t.helper }));
      case 'client_model': return CLIENT_MODELS.map((c) => ({ id: c.id, label: c.label }));
      case 'company_size': return SIZE_BANDS.map((s) => ({ id: s.id, label: s.label }));
      default: return ROLES.map((r) => ({ id: r.id, label: r.label }));
    }
  }, [step, answers.pillar]);

  const value = stepValue(step, answers);
  const ready = canContinue(step, answers);

  const choose = (id: string) => {
    if (saving) return;
    setError(null);
    setAnswers((a) => {
      switch (STEPS[step]) {
        // Changing the pillar invalidates the business type that belonged to the old one.
        case 'pillar': return id === a.pillar ? a : { ...a, pillar: id, segmentId: '', businessTypeOther: '' };
        case 'business_type': return { ...a, segmentId: id };
        case 'client_model': return { ...a, clientModel: id };
        case 'company_size': return { ...a, companySizeBand: id };
        default: return { ...a, role: id };
      }
    });
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pillar: answers.pillar,
          segmentId: answers.segmentId,
          businessTypeOther: needsOther ? answers.businessTypeOther : undefined,
          clientModel: answers.clientModel,
          companySizeBand: answers.companySizeBand,
          role: answers.role,
          marketingConsent,
          callbackUrl,
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
      // Take the person to the question the server objected to.
      const target = typeof data.field === 'string' ? stepForField(data.field) : null;
      if (target !== null) setStep(target);
      setError(FIELD_ERRORS[data.field] ?? 'Could not save your answers. Try again.');
    } catch {
      // Network failure: fetch rejects instead of returning a status.
      setSaving(false);
      setError('Could not save your answers. Check your connection and try again.');
    }
  };

  const primary = () => {
    if (!ready || saving) return;
    captureClient('onboarding_step_completed', { step: step + 1, step_name: STEPS[step], value });
    if (step === LAST) {
      void submit();
      return;
    }
    setError(null);
    setStep(step + 1);
  };

  const back = () => {
    if (step === 0 || saving) return;
    setError(null);
    setStep(step - 1);
  };

  // Each step starts at the top with its question focused (and announced).
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [step]);

  // The listener is bound once and always calls the latest closure.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const target = e.target instanceof HTMLElement ? e.target : null;

    if (e.key === 'Enter') {
      if (e.repeat) return;
      // A focused button or link keeps its own Enter (Back, Continue, Sign out,
      // Privacy policy). The exception is an already-chosen answer, where Enter
      // means "Continue".
      const control = target?.closest('button, a');
      if (control && !(control.getAttribute('role') === 'radio' && control.getAttribute('aria-checked') === 'true')) return;
      if (!ready || saving) return;
      e.preventDefault();
      primary();
      return;
    }

    // In a text field letters are text.
    if (target && target.closest('input, textarea, select')) return;
    const i = indexForKey(e.key, options.length);
    if (i === null || saving) return;
    // Without this the keystroke would also land in the Other input that
    // choosing "Other" is about to focus.
    e.preventDefault();
    choose(options[i].id);
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const pillarLabel = PILLARS.find((p) => p.id === answers.pillar)?.label;
  const subtitle =
    step === 0 ? 'So we can set stiko up for the files you review.'
    : step === 1 ? pillarLabel
    : undefined;

  const signOut = (
    <>
      Not you?{' '}
      <button
        type="button"
        disabled={saving}
        onClick={() => void signOutTo(signedOutLanding)}
        className={`${linkClass} disabled:opacity-50`}
      >
        Sign out
      </button>
    </>
  );

  return (
    <StepFrame
      step={step}
      total={STEPS.length}
      title={QUESTIONS[step]}
      subtitle={subtitle}
      headingId={HEADING_ID}
      headingRef={headingRef}
      onBack={step > 0 ? back : undefined}
      backDisabled={saving}
      primaryLabel={saving ? 'Saving…' : step === LAST ? 'Finish' : 'Continue'}
      primaryHint={saving ? undefined : '↵'}
      primaryDisabled={!ready || saving}
      onPrimary={primary}
      error={error}
      smallPrint={
        step === LAST ? (
          <>
            How we use your answers:{' '}
            <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className={linkClass}>Privacy policy</a>
            {' · '}
            {signOut}
          </>
        ) : (
          signOut
        )
      }
    >
      <LetteredChoices
        labelledBy={HEADING_ID}
        options={options}
        value={value}
        onChange={choose}
        columns={step >= 3 ? 2 : 1}
        renderAfter={
          STEPS[step] === 'business_type'
            ? (id) =>
                isOtherSegment(id) && id === answers.segmentId ? (
                  <div className="mt-2">
                    <Input
                      className="scroll-mb-28"
                      aria-label="What does your business do?"
                      placeholder="What does your business do?"
                      value={answers.businessTypeOther}
                      maxLength={OTHER_TEXT_MAX}
                      onChange={(e) => {
                        const text = e.target.value;
                        setError(null);
                        setAnswers((a) => ({ ...a, businessTypeOther: text }));
                      }}
                      autoFocus
                    />
                  </div>
                ) : null
            : undefined
        }
      />

      {step === LAST && (
        <label className="mt-4 flex items-start gap-[9px] text-[12.5px] text-stiko-secondary">
          <input
            type="checkbox"
            checked={marketingConsent}
            onChange={(e) => setMarketingConsent(e.target.checked)}
            className="mt-[2px] h-4 w-4 shrink-0 accent-stiko-primary"
          />
          <span>Send me product news and tips from stiko. You can unsubscribe at any time.</span>
        </label>
      )}
    </StepFrame>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={null}>
      <WelcomeWizard />
    </Suspense>
  );
}
