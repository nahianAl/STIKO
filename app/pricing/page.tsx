'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AvatarMenu from '@/components/shell/AvatarMenu';
import { LogoMark, Wordmark } from '@/components/ui/Shell';
import { useAuthSession } from '@/lib/authClient';
import { PRICE_DISPLAY, type BillingInterval, type BillingStatusPayload } from '@/lib/billing';
import { pricingView } from '@/lib/pricingView';
import { loginRedirectPath } from '@/lib/routeAccess';
import { openPortal, startCheckout, useResetOnPageShow } from '@/components/billing/checkout';
import {
  FAQ,
  FEATURE_ROWS,
  FREE_COPY,
  LIMIT_ROWS,
  STANDARD_COPY,
  STANDARD_STORAGE,
  type CompareRow,
  type PlanCopy,
} from './content';
import s from './pricing.module.css';

const SIGNUP = `/signup?${new URLSearchParams({ callbackUrl: '/pricing' })}`;
const MARKETING = 'https://www.stiko.design';

// Button looks, matched to the marketing site's .stk-btn family. The `!text-*`
// colours beat globals.css `a:hover { color }` when these are applied to links.
const BTN =
  'inline-flex w-full items-center justify-center rounded-[12px] px-6 py-[14px] text-[15px] font-extrabold tracking-[-0.005em] transition duration-150 disabled:cursor-not-allowed disabled:opacity-60';
const BTN_GRADIENT = `${BTN} bg-gradient-to-br from-[#8094F5] to-[#5B60FF] !text-white shadow-[0_14px_30px_-14px_rgba(91,96,255,0.8)] hover:brightness-[1.06]`;
const BTN_GHOST = `${BTN} border-[1.5px] border-[#D3D8E6] bg-white !text-stiko-ink hover:border-[#8094F5]`;
const BTN_WHITE = `${BTN} bg-white !text-[#4247D6] shadow-[0_14px_30px_-16px_rgba(0,0,0,0.6)] hover:bg-[#F1F3FF]`;
const BTN_ON_DARK = `${BTN} border border-white/20 bg-white/[0.06] !text-white hover:bg-white/[0.12]`;

export default function PricingPage() {
  const { status: authStatus } = useAuthSession();
  const signedIn = authStatus === 'authenticated';
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('year');
  const [billing, setBilling] = useState<BillingStatusPayload | null>(null);
  const [billingFailed, setBillingFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Back from Stripe restores the page mid-"Opening…".
  useResetOnPageShow(() => setBusy(false));

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetch('/api/billing/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d) setBilling(d);
        else setBillingFailed(true);
      })
      .catch(() => {
        if (!cancelled) setBillingFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, attempt]);

  const retry = () => {
    setBillingFailed(false);
    setAttempt((a) => a + 1);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  const price = PRICE_DISPLAY[billingInterval];
  const view = pricingView({ authStatus, billing, billingFailed });
  const upgrade = () => run(() => startCheckout(billingInterval));

  // ── Standard card button, by viewer state (lib/pricingView.ts) ──
  let standardCta: React.ReactNode = null;
  switch (view.standard) {
    case 'loading':
      standardCta = <button className={BTN_ON_DARK} disabled>Loading…</button>;
      break;
    case 'signup':
      standardCta = <Link href={SIGNUP} className={BTN_WHITE}>Get Standard</Link>;
      break;
    case 'unavailable':
      standardCta = (
        <>
          <button type="button" className={BTN_ON_DARK} onClick={retry}>Try again</button>
          <p className="mt-2 text-center text-[12px] text-white/60">We couldn&apos;t load your plan.</p>
        </>
      );
      break;
    case 'manage':
      standardCta = (
        <button type="button" className={BTN_ON_DARK} disabled={busy} onClick={() => run(openPortal)}>
          {busy ? 'Opening…' : 'Manage billing'}
        </button>
      );
      break;
    case 'current':
      // Granted by hand, no subscription behind it: nothing to manage.
      standardCta = <p className="text-center text-[13px] font-semibold text-white/70">You&apos;re on Standard</p>;
      break;
    case 'soon':
      standardCta = <button className={BTN_ON_DARK} disabled>Coming soon</button>;
      break;
    case 'upgrade':
      standardCta = (
        <button type="button" className={BTN_WHITE} disabled={busy} onClick={upgrade}>
          {busy ? 'Opening…' : 'Upgrade to Standard'}
        </button>
      );
      break;
  }

  let freeCta: React.ReactNode = null;
  switch (view.free) {
    case 'loading':
      freeCta = <button className={BTN_GHOST} disabled>Loading…</button>;
      break;
    case 'signup':
      freeCta = <Link href={SIGNUP} className={BTN_GHOST}>Start free</Link>;
      break;
    case 'included':
      freeCta = <p className="text-center text-[13px] font-semibold text-stiko-muted">Included in Standard</p>;
      break;
    case 'current':
      freeCta = <p className="text-center text-[13px] font-semibold text-stiko-muted">You&apos;re on Free</p>;
      break;
    case 'none':
      break;
  }

  // ── Closing band: one clear next step for whoever is reading ──
  let closing: { title: string; sub: string; action: React.ReactNode } | null = null;
  if (view.standard === 'signup') {
    closing = {
      title: 'Start your first review in minutes.',
      sub: 'Free to start, no card needed. Upgrade when your projects outgrow it.',
      action: <Link href={SIGNUP} className={`${BTN_WHITE} !w-auto px-9 py-4 text-[16px]`}>Start free</Link>,
    };
  } else if (view.standard === 'upgrade') {
    closing = {
      title: 'Ready for more room?',
      sub: `Unlimited projects and packages, and ${STANDARD_STORAGE} of storage, from ${price.perMonth} a month.`,
      action: (
        <button type="button" className={`${BTN_WHITE} !w-auto px-9 py-4 text-[16px]`} disabled={busy} onClick={upgrade}>
          {busy ? 'Opening…' : 'Upgrade to Standard'}
        </button>
      ),
    };
  } else if (view.standard === 'manage' || view.standard === 'current') {
    closing = {
      title: 'You have all the room you need.',
      sub: 'Head back to your projects.',
      action: <Link href="/" className={`${BTN_WHITE} !w-auto px-9 py-4 text-[16px]`}>Open stiko</Link>,
    };
  }

  return (
    <div className={s.page}>
      <div className={s.atmosphere} aria-hidden="true" />

      <div className="relative mx-auto max-w-[1080px] px-4 sm:px-6">
        {/* ── Header ── */}
        <header className="flex h-[72px] items-center justify-between">
          <a href={signedIn ? '/' : MARKETING} className="flex items-center gap-[9px]" aria-label="stiko home">
            <LogoMark />
            <Wordmark />
          </a>
          <div className="flex items-center gap-3">
            {signedIn ? (
              <>
                <Link href="/" className="hidden text-[13.5px] font-bold !text-stiko-secondary hover:!text-stiko-ink sm:inline">
                  Your projects
                </Link>
                <AvatarMenu />
              </>
            ) : authStatus === 'loading' ? null : (
              <>
                <Link
                  href={loginRedirectPath('/pricing')}
                  className="text-[13.5px] font-bold !text-stiko-secondary hover:!text-stiko-ink"
                >
                  Sign in
                </Link>
                <Link href={SIGNUP} className={`${BTN_GRADIENT} !w-auto px-5 py-[10px] text-[13px]`}>
                  Start free
                </Link>
              </>
            )}
          </div>
        </header>

        {/* ── Hero ── */}
        <section className="pt-10 text-center sm:pt-16">
          <div className={`${s.rise} inline-flex items-center gap-2 rounded-[20px] bg-white px-3 py-[6px] text-[11.5px] font-extrabold uppercase tracking-[0.08em] text-stiko-secondary shadow-[0_1px_3px_rgba(28,32,48,0.06)]`}>
            <span className="h-[6px] w-[6px] rounded-full bg-[#EF6C22]" aria-hidden="true" />
            Pricing
          </div>
          <h1
            className={`${s.rise} mx-auto mt-5 max-w-[760px] text-[36px] font-extrabold leading-[1.05] tracking-[-0.034em] text-stiko-ink sm:text-[52px]`}
            style={{ '--d': '60ms' } as React.CSSProperties}
          >
            Pay for room,{' '}
            <span className="bg-gradient-to-br from-[#8094F5] to-[#5B60FF] bg-clip-text text-transparent">not for features.</span>
          </h1>
          <p
            className={`${s.rise} mx-auto mt-5 max-w-[560px] text-[16px] font-medium leading-[1.6] text-stiko-secondary sm:text-[17px]`}
            style={{ '--d': '120ms' } as React.CSSProperties}
          >
            Every review tool is on every plan, and reviewers are always free. Choose how many projects you run and
            how much you store.
          </p>

          <div className={`${s.rise} mt-8 flex justify-center`} style={{ '--d': '180ms' } as React.CSSProperties}>
            <IntervalToggle value={billingInterval} onChange={setBillingInterval} />
          </div>
        </section>

        {/* ── Plans ── */}
        <section
          className={`${s.rise} mx-auto mt-10 grid max-w-[920px] items-stretch gap-5 md:grid-cols-[1fr_1.08fr]`}
          style={{ '--d': '240ms' } as React.CSSProperties}
          aria-label="Plans"
        >
          <PlanCard
            name="Free"
            copy={FREE_COPY}
            current={view.free === 'current'}
            price={<span className="text-[52px] font-extrabold leading-none tracking-[-0.04em]">$0</span>}
            priceNote="Free forever"
            cta={freeCta}
          />
          <PlanCard
            dark
            name="Standard"
            copy={STANDARD_COPY}
            current={view.standard === 'manage' || view.standard === 'current'}
            price={
              <span key={billingInterval} className={s.priceSwap}>
                <span className="text-[52px] font-extrabold leading-none tracking-[-0.04em]">{price.perMonth}</span>
                <span className="ml-1 text-[15px] font-semibold text-white/60">/ month</span>
              </span>
            }
            priceNote={price.note}
            cta={standardCta}
          />
        </section>
        {error && (
          <p role="alert" className="mt-4 text-center text-[13px] font-semibold text-[#B23A52]">
            {error}
          </p>
        )}

        {/* ── Compare ── */}
        <section className="mx-auto mt-24 max-w-[920px]" aria-labelledby="compare-h">
          <div className="text-center">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-stiko-muted">Compare plans</div>
            <h2 id="compare-h" className="mt-3 text-[28px] font-extrabold leading-[1.15] tracking-[-0.03em] text-stiko-ink sm:text-[36px]">
              Every feature, on every plan.
            </h2>
            <p className="mx-auto mt-3 max-w-[520px] text-[15px] leading-[1.6] text-stiko-secondary">
              The only differences are how many projects you can run and how much you can store.
            </p>
          </div>

          <div className="mt-10 overflow-hidden rounded-[18px] border border-[#EAEDF6] bg-white shadow-[0_24px_60px_-28px_rgba(28,32,48,0.28)]">
            <div className="grid grid-cols-[1fr_72px_88px] items-center border-b border-[#EAEDF6] px-4 py-4 sm:grid-cols-[1fr_140px_160px] sm:px-7">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-stiko-muted">Plan</span>
              <span className="text-center text-[14px] font-extrabold text-stiko-ink">Free</span>
              <span className="text-center text-[14px] font-extrabold text-[#4247D6]">Standard</span>
            </div>
            <CompareGroup title="Limits" rows={LIMIT_ROWS} />
            <CompareGroup title="Review tools" rows={FEATURE_ROWS} />
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="mx-auto mt-24 grid max-w-[920px] gap-8 md:grid-cols-[260px_1fr]" aria-labelledby="faq-h">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-stiko-muted">Questions</div>
            <h2 id="faq-h" className="mt-3 text-[28px] font-extrabold leading-[1.15] tracking-[-0.03em] text-stiko-ink">
              Before you choose.
            </h2>
          </div>
          <div className="flex flex-col gap-[10px]">
            {FAQ.map((f) => (
              <details key={f.q} className={`${s.faq} group rounded-[14px] border border-[#EAEDF6] bg-white px-5 py-4`}>
                <summary className="flex cursor-pointer items-center justify-between gap-4 text-[15px] font-bold text-stiko-ink">
                  {f.q}
                  <span
                    className={`${s.faqIcon} grid h-7 w-7 shrink-0 place-items-center rounded-full bg-stiko-tint text-[18px] leading-none text-[#4247D6] transition-transform duration-200`}
                    aria-hidden="true"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-[14px] leading-[1.65] text-stiko-secondary">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── Closing band ── */}
        {closing && (
          <section className={`${s.cta} mx-auto mt-24 max-w-[1080px] rounded-[20px] px-6 py-14 text-center sm:px-16 sm:py-[72px]`}>
            <h2 className="mx-auto max-w-[680px] text-[28px] font-extrabold leading-[1.14] tracking-[-0.028em] text-white sm:text-[38px]">
              {closing.title}
            </h2>
            <p className="mx-auto mt-4 max-w-[560px] text-[16px] font-medium leading-[1.6] text-white/80 sm:text-[17px]">
              {closing.sub}
            </p>
            <div className="mt-8 flex justify-center">{closing.action}</div>
          </section>
        )}

        <footer className="flex flex-col items-center justify-between gap-3 py-10 text-[13px] text-stiko-muted sm:flex-row">
          <span>© {new Date().getFullYear()} stiko</span>
          <a href={MARKETING} className="font-semibold !text-stiko-secondary hover:!text-stiko-ink">
            stiko.design
          </a>
        </footer>
      </div>
    </div>
  );
}

/** Monthly / Yearly, with a thumb that slides between them. */
function IntervalToggle({ value, onChange }: { value: BillingInterval; onChange: (v: BillingInterval) => void }) {
  return (
    <div
      className="relative grid grid-cols-2 rounded-full border border-[#EAEDF6] bg-white p-1 shadow-[0_8px_24px_-14px_rgba(28,32,48,0.35)]"
      role="group"
      aria-label="Billing period"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-stiko-ink transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
        style={{ transform: value === 'year' ? 'translateX(100%)' : 'none' }}
      />
      {(['month', 'year'] as const).map((i) => (
        <button
          key={i}
          type="button"
          aria-pressed={value === i}
          onClick={() => onChange(i)}
          className={`relative z-10 flex min-w-[124px] items-center justify-center gap-2 rounded-full px-4 py-[9px] text-[13.5px] font-bold transition-colors duration-200 ${
            value === i ? 'text-white' : 'text-stiko-secondary hover:text-stiko-ink'
          }`}
        >
          {i === 'month' ? 'Monthly' : 'Yearly'}
          {i === 'year' && (
            <span
              className={`rounded-full px-[7px] py-[2px] text-[10.5px] font-extrabold transition-colors duration-200 ${
                value === 'year' ? 'bg-white/15 text-white' : 'bg-[#F6FFEC] text-[#4B7A28]'
              }`}
            >
              −10%
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function Check({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className={`mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full ${
        dark ? 'bg-white/15 text-white' : 'bg-stiko-tint text-[#4247D6]'
      }`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 12 12" className="h-[10px] w-[10px]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 6.2 5 8.5l4.5-5" />
      </svg>
    </span>
  );
}

function PlanCard({
  name,
  copy,
  price,
  priceNote,
  cta,
  current = false,
  dark = false,
}: {
  name: string;
  copy: PlanCopy;
  price: React.ReactNode;
  priceNote: string;
  cta: React.ReactNode;
  current?: boolean;
  dark?: boolean;
}) {
  return (
    <article
      className={`flex flex-col rounded-[22px] p-7 sm:p-8 ${
        dark
          ? `${s.darkCard} text-white`
          : 'border border-[#EAEDF6] bg-white text-stiko-ink shadow-[0_24px_60px_-30px_rgba(28,32,48,0.3)]'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[20px] font-extrabold tracking-[-0.02em]">{name}</h2>
        {current && (
          <span
            className={`rounded-full px-[10px] py-[4px] text-[10.5px] font-extrabold uppercase tracking-[0.08em] ${
              dark ? 'bg-white/15 text-white' : 'bg-stiko-tint text-[#4247D6]'
            }`}
          >
            Current plan
          </span>
        )}
      </div>
      <p className={`mt-1 text-[14px] ${dark ? 'text-white/65' : 'text-stiko-secondary'}`}>{copy.tagline}</p>

      <div className="mt-7 flex min-h-[58px] items-end">{price}</div>
      <div className={`mt-2 text-[13px] font-semibold ${dark ? 'text-white/60' : 'text-stiko-muted'}`}>{priceNote}</div>

      <div className="mt-7">{cta}</div>

      <div className={`my-7 h-px ${dark ? 'bg-white/10' : 'bg-[#EAEDF6]'}`} />

      <ul className="flex flex-col gap-3">
        {copy.limits.map((f) => (
          <li key={f} className="flex gap-3 text-[15px] font-bold">
            <Check dark={dark} />
            {f}
          </li>
        ))}
        {copy.shared.map((f) => (
          <li key={f} className={`flex gap-3 text-[14.5px] ${dark ? 'text-white/75' : 'text-stiko-secondary'}`}>
            <Check dark={dark} />
            {f}
          </li>
        ))}
      </ul>
    </article>
  );
}

function CompareCell({ value, accent = false }: { value: string | true; accent?: boolean }) {
  if (value === true) {
    return (
      <span className="flex justify-center">
        <Check />
      </span>
    );
  }
  return (
    <span className={`text-center text-[14px] font-bold ${accent ? 'text-[#4247D6]' : 'text-stiko-ink'}`}>{value}</span>
  );
}

function CompareGroup({ title, rows }: { title: string; rows: CompareRow[] }) {
  return (
    <div>
      <div className="bg-[#FBFCFF] px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-stiko-muted sm:px-7">
        {title}
      </div>
      {rows.map((r) => (
        <div
          key={r.label}
          className="grid grid-cols-[1fr_72px_88px] items-center border-t border-[#F1F1F4] px-4 py-4 sm:grid-cols-[1fr_140px_160px] sm:px-7"
        >
          <div className="pr-3">
            <div className="text-[14.5px] font-bold text-stiko-ink">{r.label}</div>
            {r.detail && <div className="mt-[2px] text-[13px] leading-[1.5] text-stiko-muted">{r.detail}</div>}
          </div>
          <CompareCell value={r.free} />
          <CompareCell value={r.standard} accent />
        </div>
      ))}
    </div>
  );
}
