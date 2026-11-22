import Link from 'next/link';
import { LogoMark, Wordmark } from '@/components/ui/Shell';

/**
 * The frame shared by the billing step pages (/billing/checkout, /success,
 * /cancelled): the app background, the logo, one centred card. Lightly branded
 * on purpose. These screens sit between Stiko and Stripe and should feel like
 * Stiko without competing with the one thing to do next.
 */

export type BillingTone = 'success' | 'pending' | 'neutral';

/** Full-width gradient call to action. `!text-white` beats globals.css `a:hover`. */
export const PRIMARY_CTA =
  'flex w-full items-center justify-center rounded-[14px] bg-stiko-primary px-6 py-[17px] text-[16px] font-extrabold tracking-[-0.005em] !text-white shadow-[0_14px_30px_-12px_rgba(91,96,255,0.7)] transition duration-150 hover:brightness-[1.05] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#8094F5]/40';

export const QUIET_LINK = 'font-bold text-stiko-muted transition-colors hover:text-stiko-ink';

function Badge({ tone }: { tone: BillingTone }) {
  if (tone === 'pending') {
    return (
      <span className="relative grid h-[64px] w-[64px] place-items-center rounded-full bg-[#EEF1FB]" aria-hidden="true">
        <span className="h-[28px] w-[28px] animate-spin rounded-full border-[3px] border-[#C9D0F5] border-t-[#5B60FF] motion-reduce:animate-none" />
      </span>
    );
  }
  if (tone === 'success') {
    return (
      <span
        className="grid h-[64px] w-[64px] place-items-center rounded-full bg-stiko-primary shadow-[0_14px_30px_-10px_rgba(91,96,255,0.75)]"
        aria-hidden="true"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className="grid h-[64px] w-[64px] place-items-center rounded-full bg-[#EEF1FB]" aria-hidden="true">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <path d="M7 7l10 10M17 7L7 17" stroke="#5B60FF" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export default function BillingFrame({
  tone,
  title,
  subtitle,
  children,
  footer,
}: {
  tone: BillingTone;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-stiko-app px-4 pb-10 pt-6 sm:pt-10">
      {/* A soft brand glow behind the card; decoration only. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-180px] h-[460px] w-[760px] max-w-[160vw] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(128,148,245,0.22),rgba(128,148,245,0))]"
      />
      <div className="relative mx-auto w-full max-w-[460px]">
        <Link href="/" className="inline-flex items-center gap-[7px]" aria-label="stiko dashboard">
          <LogoMark />
          <Wordmark />
        </Link>

        <main className="mt-10 rounded-[20px] border border-stiko-border bg-white px-6 pb-7 pt-9 text-center shadow-stiko-sheet sm:mt-14 sm:px-9 sm:pb-9">
          <div className="flex justify-center">
            <Badge tone={tone} />
          </div>
          <h1
            className="mt-6 text-[24px] font-extrabold leading-[1.2] tracking-title text-stiko-ink sm:text-[26px]"
            aria-live="polite"
          >
            {title}
          </h1>
          {subtitle && (
            <p className="mx-auto mt-2 max-w-[340px] text-[14.5px] leading-[1.5] text-stiko-muted" aria-live="polite">
              {subtitle}
            </p>
          )}
          {children}
        </main>

        {footer && <div className="mt-5 text-center text-[12.5px] text-stiko-faint">{footer}</div>}
      </div>
    </div>
  );
}
