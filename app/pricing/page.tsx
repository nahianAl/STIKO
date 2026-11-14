'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell, TopBar, Column } from '@/components/ui/Shell';
import AvatarMenu from '@/components/shell/AvatarMenu';
import Button from '@/components/ui/Button';
import { useAuthSession } from '@/lib/authClient';
import { PLANS } from '@/lib/plans';
import { PRICE_DISPLAY, type BillingInterval, type BillingStatusPayload } from '@/lib/billing';
import { formatBytes } from '@/lib/design';
import { openPortal, startCheckout } from '@/components/billing/checkout';

const SIGNUP = `/signup?${new URLSearchParams({ callbackUrl: '/pricing' })}`;

export default function PricingPage() {
  const { status: authStatus } = useAuthSession();
  const signedIn = authStatus === 'authenticated';
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('year');
  const [billing, setBilling] = useState<BillingStatusPayload | null>(null);
  const [billingFailed, setBillingFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, [signedIn]);

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
  const onStandard = billing?.plan === 'standard';
  const price = PRICE_DISPLAY[billingInterval];

  // Who is looking, and do we know yet? Until both the session and (for a
  // signed-in visitor) the billing status have resolved, every button is
  // neutral and disabled — a signed-in customer must never see "Get Standard",
  // and a paying one must never see "Upgrade", even for a moment.
  const authResolving = authStatus === 'loading';
  const billingResolving = signedIn && !billing && !billingFailed;
  const pending = authResolving || billingResolving;

  const loadingCta = (
    <Button variant="secondary" className="w-full" disabled>
      Loading…
    </Button>
  );

  // Standard card's button, by viewer state (spec §1).
  let standardCta: React.ReactNode;
  if (pending) {
    standardCta = loadingCta;
  } else if (!signedIn) {
    standardCta = <LinkButton href={SIGNUP} primary>Get Standard</LinkButton>;
  } else if (billingFailed || !billing) {
    // Plan unknown: offer nothing that could be wrong. The note under the cards
    // says why.
    standardCta = <Button className="w-full" disabled>Upgrade</Button>;
  } else if (billing.action === 'manage') {
    standardCta = (
      <Button variant="secondary" className="w-full" disabled={busy} onClick={() => run(openPortal)}>
        {busy ? 'Opening…' : 'Manage billing'}
      </Button>
    );
  } else if (onStandard) {
    // Standard granted by hand, no subscription behind it: nothing to manage.
    standardCta = <Button variant="secondary" className="w-full" disabled>Current plan</Button>;
  } else if (billing.action === 'none') {
    // Billing is off.
    standardCta = <Button variant="secondary" className="w-full" disabled>Coming soon</Button>;
  } else {
    standardCta = (
      <Button className="w-full" disabled={busy} onClick={() => run(() => startCheckout(billingInterval))}>
        {busy ? 'Opening…' : 'Upgrade'}
      </Button>
    );
  }

  let freeCta: React.ReactNode;
  if (pending) {
    freeCta = loadingCta;
  } else if (!signedIn) {
    freeCta = <LinkButton href={SIGNUP}>Start free</LinkButton>;
  } else {
    freeCta = (
      <Button variant="secondary" className="w-full" disabled>
        {billing && !onStandard ? 'Current plan' : 'Free'}
      </Button>
    );
  }

  return (
    <Shell>
      <TopBar
        right={
          signedIn ? (
            <AvatarMenu />
          ) : authResolving ? null : (
            <Link href="/login" className="text-[13px] font-bold !text-stiko-secondary hover:!text-stiko-ink">
              Sign in
            </Link>
          )
        }
      />
      <Column width={860}>
        <div className="py-10 text-center">
          <h1 className="text-[30px] font-extrabold text-stiko-ink">Plans</h1>
          <p className="mt-2 text-[14px] text-stiko-muted">Collaborators are always free. Only the project owner needs a plan.</p>

          <div className="mt-6 inline-flex rounded-pill bg-white p-1 shadow-stiko-panel" role="tablist">
            {(['month', 'year'] as const).map((i) => (
              <button
                key={i}
                role="tab"
                aria-selected={billingInterval === i}
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
            price="$0"
            note="Free forever"
            features={[`${free.maxProjects} projects`, `${formatBytes(free.storageBytes)} storage`, 'Unlimited collaborators']}
            cta={freeCta}
          />
          <PlanCard
            highlight
            name={standard.label}
            price={`${price.perMonth}/mo`}
            note={price.note}
            features={['Unlimited projects', `${formatBytes(standard.storageBytes)} storage`, 'Unlimited collaborators']}
            cta={standardCta}
          />
        </div>
        {error && <p className="mt-3 text-center text-[12.5px] text-red-600">{error}</p>}
        {billingFailed && !error && (
          <p className="mt-3 text-center text-[12.5px] text-stiko-muted">
            We couldn&apos;t load your plan. Refresh the page to try again.
          </p>
        )}

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
 * A link that looks like a Button. Not <Link><Button/></Link>: a button inside
 * an anchor is invalid HTML, gives two tab stops, and Firefox does not follow
 * the link when the inner button is clicked. The `!` colours beat the global
 * `a { color }` rule in globals.css.
 */
function LinkButton({ href, primary = false, children }: { href: string; primary?: boolean; children: React.ReactNode }) {
  const look = primary
    ? 'bg-gradient-to-br from-[#8094F5] to-[#5B60FF] px-[18px] py-[10px] text-[13px] rounded-[11px] font-bold !text-white shadow-stiko-primary hover:brightness-[1.04]'
    : 'border-[1.5px] border-stiko-border-strong bg-white px-[16px] py-[9px] text-[12.5px] rounded-[10px] font-bold !text-stiko-ink hover:bg-stiko-app';
  return (
    <Link
      href={href}
      className={`flex w-full items-center justify-center whitespace-nowrap outline-none transition duration-150 focus-visible:shadow-stiko-focus ${look}`}
    >
      {children}
    </Link>
  );
}

function PlanCard({
  name, price, note, features, cta, highlight = false,
}: {
  name: string; price: string; note: string; features: string[]; cta: React.ReactNode; highlight?: boolean;
}) {
  return (
    <section
      className={`flex flex-col rounded-panel bg-white px-6 py-6 shadow-stiko-panel ${
        highlight ? 'ring-2 ring-stiko-primary' : ''
      }`}
    >
      <h2 className="text-[15px] font-extrabold text-stiko-ink">{name}</h2>
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
