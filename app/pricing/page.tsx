'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell, TopBar, Column } from '@/components/ui/Shell';
import AvatarMenu from '@/components/shell/AvatarMenu';
import Button, { buttonClasses } from '@/components/ui/Button';
import { useAuthSession } from '@/lib/authClient';
import { PLANS } from '@/lib/plans';
import { PRICE_DISPLAY, type BillingInterval, type BillingStatusPayload } from '@/lib/billing';
import { formatBytes } from '@/lib/design';
import { pricingView } from '@/lib/pricingView';
import { loginRedirectPath } from '@/lib/routeAccess';
import { openPortal, startCheckout, useResetOnPageShow } from '@/components/billing/checkout';

const SIGNUP = `/signup?${new URLSearchParams({ callbackUrl: '/pricing' })}`;

const projectsLabel = (max: number | null) => (max === null ? 'Unlimited projects' : `${max} projects`);

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

  const free = PLANS.free;
  const standard = PLANS.standard;
  const price = PRICE_DISPLAY[billingInterval];
  const view = pricingView({ authStatus, billing, billingFailed });

  const loadingCta = (
    <Button variant="secondary" className="w-full" disabled>
      Loading…
    </Button>
  );

  let standardCta: React.ReactNode = null;
  switch (view.standard) {
    case 'loading':
      standardCta = loadingCta;
      break;
    case 'signup':
      standardCta = <LinkButton href={SIGNUP} primary>Get Standard</LinkButton>;
      break;
    case 'unavailable':
      standardCta = (
        <>
          <Button variant="secondary" className="w-full" onClick={retry}>Try again</Button>
          <p className="mt-2 text-center text-[12px] text-stiko-muted">We couldn&apos;t load your plan.</p>
        </>
      );
      break;
    case 'manage':
      standardCta = (
        <Button variant="secondary" className="w-full" disabled={busy} onClick={() => run(openPortal)}>
          {busy ? 'Opening…' : 'Manage billing'}
        </Button>
      );
      break;
    case 'current':
      // Standard granted by hand, no subscription behind it: the badge says it
      // all and there is nothing to manage.
      break;
    case 'soon':
      standardCta = <Button variant="secondary" className="w-full" disabled>Coming soon</Button>;
      break;
    case 'upgrade':
      standardCta = (
        <Button className="w-full" disabled={busy} onClick={() => run(() => startCheckout(billingInterval))}>
          {busy ? 'Opening…' : 'Upgrade'}
        </Button>
      );
      break;
  }

  let freeCta: React.ReactNode = null;
  switch (view.free) {
    case 'loading':
      freeCta = loadingCta;
      break;
    case 'signup':
      freeCta = <LinkButton href={SIGNUP}>Start free</LinkButton>;
      break;
    case 'included':
      freeCta = <p className="text-center text-[12px] text-stiko-muted">Included in Standard</p>;
      break;
    case 'current':
    case 'none':
      break;
  }

  return (
    <Shell>
      <TopBar
        right={
          signedIn ? (
            <AvatarMenu />
          ) : authStatus === 'loading' ? null : (
            <Link
              href={loginRedirectPath('/pricing')}
              className="text-[13px] font-bold !text-stiko-secondary hover:!text-stiko-ink"
            >
              Sign in
            </Link>
          )
        }
      />
      <Column width={860}>
        <div className="py-10 text-center">
          <h1 className="text-[30px] font-extrabold text-stiko-ink">Plans</h1>
          <p className="mt-2 text-[14px] text-stiko-muted">Collaborators are always free. Only the project owner needs a plan.</p>

          <div className="mt-6 inline-flex rounded-pill bg-white p-1 shadow-stiko-panel" role="group" aria-label="Billing interval">
            {(['month', 'year'] as const).map((i) => (
              <button
                key={i}
                type="button"
                aria-pressed={billingInterval === i}
                onClick={() => setBillingInterval(i)}
                className={`rounded-pill px-4 py-[7px] text-[12.5px] font-bold transition ${
                  billingInterval === i ? 'bg-stiko-tint text-stiko-ink' : 'text-stiko-muted hover:text-stiko-ink'
                }`}
              >
                {i === 'month' ? 'Monthly' : 'Yearly · save 10%'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <PlanCard
            name={free.label}
            current={view.free === 'current'}
            price="$0"
            note="Free forever"
            features={[projectsLabel(free.maxProjects), `${formatBytes(free.storageBytes)} storage`, 'Unlimited collaborators']}
            cta={freeCta}
          />
          <PlanCard
            highlight
            name={standard.label}
            current={view.standard === 'manage' || view.standard === 'current'}
            price={`${price.perMonth}/mo`}
            note={price.note}
            features={[projectsLabel(standard.maxProjects), `${formatBytes(standard.storageBytes)} storage`, 'Unlimited collaborators']}
            cta={standardCta}
          />
        </div>
        {error && <p className="mt-3 text-center text-[12.5px] text-red-600">{error}</p>}

        <dl className="mx-auto mt-10 max-w-[560px] space-y-4 pb-12 text-[13px]">
          <Faq q="Do collaborators need to pay?" a="No. Reviewers and collaborators you invite are free on every plan. Storage and projects count against the project owner." />
          <Faq q="Can I cancel?" a="Any time, from Plan & billing. You keep Standard until the end of the period you paid for." />
          <Faq q="What if I go over a Free limit?" a="Nothing is deleted. You can still view, comment and download; you just can't add projects or upload until you're back under the limit or upgrade." />
        </dl>
      </Column>
    </Shell>
  );
}

/**
 * A link that looks like a Button (classes from Button itself). Not
 * <Link><Button/></Link>: a button inside an anchor is invalid HTML, gives two
 * tab stops, and Firefox does not follow the link when the inner button is
 * clicked. The `!` colours beat globals.css `a:hover { color }`, which would
 * otherwise turn the label blue on hover.
 */
function LinkButton({ href, primary = false, children }: { href: string; primary?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`${buttonClasses(primary ? 'primary' : 'secondary')} w-full ${primary ? '!text-white' : '!text-stiko-ink'}`}
    >
      {children}
    </Link>
  );
}

function PlanCard({
  name, price, note, features, cta, highlight = false, current = false,
}: {
  name: string; price: string; note: string; features: string[]; cta: React.ReactNode; highlight?: boolean; current?: boolean;
}) {
  return (
    <section
      className={`flex flex-col rounded-panel bg-white px-6 py-6 shadow-stiko-panel ${
        highlight ? 'ring-2 ring-stiko-primary' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-extrabold text-stiko-ink">{name}</h2>
        {current && (
          <span className="rounded-chip bg-stiko-tint px-[8px] py-[4px] text-[11px] font-extrabold uppercase tracking-label text-stiko-primary">
            Current plan
          </span>
        )}
      </div>
      <div className="mt-3 text-[28px] font-extrabold text-stiko-ink">{price}</div>
      <div className="text-[12px] text-stiko-muted">{note}</div>
      <ul className="my-5 flex-1 space-y-2 text-[13px] text-stiko-secondary">
        {features.map((f) => (
          <li key={f} className="flex gap-2"><span className="text-stiko-primary">✓</span>{f}</li>
        ))}
      </ul>
      {cta}
    </section>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <dt className="font-bold text-stiko-ink">{q}</dt>
      <dd className="mt-1 text-stiko-muted">{a}</dd>
    </div>
  );
}
