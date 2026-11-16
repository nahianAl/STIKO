'use client';

import React, { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/Primitives';
import { LogoMark, Wordmark } from '@/components/ui/Shell';

/**
 * The chrome around one /welcome question (spec 2026-11-16-welcome-wizard-design.md):
 * logo and "n / 5", the progress bar, the question as the heading, the answers
 * (children), then Back / primary and the small print.
 *
 * The heading takes focus when the step changes (the page does that through
 * headingRef), and the body fades in over 200ms, not at all under
 * prefers-reduced-motion.
 */
export default function StepFrame({
  step,
  total,
  title,
  subtitle,
  headingId,
  headingRef,
  onBack,
  backDisabled = false,
  primaryLabel,
  primaryHint,
  primaryDisabled,
  onPrimary,
  error,
  smallPrint,
  children,
}: {
  /** 0-based. */
  step: number;
  total: number;
  title: string;
  subtitle?: string;
  headingId: string;
  headingRef: React.Ref<HTMLHeadingElement>;
  /** Omit on the first step: there is nothing to go back to. */
  onBack?: () => void;
  backDisabled?: boolean;
  primaryLabel: string;
  /** A keyboard glyph shown after the label; hidden from assistive tech. */
  primaryHint?: string;
  primaryDisabled: boolean;
  onPrimary: () => void;
  error?: string | null;
  smallPrint: React.ReactNode;
  children: React.ReactNode;
}) {
  const n = step + 1;

  return (
    <div className="min-h-screen bg-stiko-app px-4 pb-8 pt-6 sm:pt-12">
      <div className="mx-auto flex w-full max-w-[440px] flex-col sm:min-h-[600px]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-[7px]">
            <LogoMark size={24} />
            <Wordmark />
          </div>
          <span className="text-[12px] font-bold text-stiko-muted" aria-hidden="true">
            {n} / {total}
          </span>
        </div>

        <div className="mb-6 mt-5 h-[5px] overflow-hidden rounded-full bg-stiko-divider" aria-hidden="true">
          <div
            className="h-full rounded-full bg-gradient-to-br from-[#8094F5] to-[#5B60FF] transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${(n / total) * 100}%` }}
          />
        </div>

        <p className="sr-only" aria-live="polite">
          Step {n} of {total}
        </p>

        <StepBody key={step}>
          <h1
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-[22px] font-extrabold leading-[1.2] tracking-title text-stiko-ink outline-none sm:text-[24px]"
          >
            {title}
          </h1>
          {subtitle && <p className="mt-[6px] text-[13.5px] text-stiko-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </StepBody>

        {/* Sticky so Continue stays in reach on a long list (step 2 on a phone). */}
        <div className="sticky bottom-0 z-10 mt-auto flex flex-col gap-3 bg-stiko-app pb-1 pt-5 before:pointer-events-none before:absolute before:inset-x-0 before:-top-4 before:h-4 before:bg-gradient-to-t before:from-stiko-app before:to-transparent">
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <div className="flex items-center justify-between gap-3">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                disabled={backDisabled}
                className="rounded-[8px] py-1 pr-2 text-[13px] font-bold text-stiko-muted outline-none transition hover:text-stiko-ink focus-visible:shadow-stiko-focus disabled:opacity-50 disabled:hover:text-stiko-muted"
              >
                <span aria-hidden="true">← </span>Back
              </button>
            ) : (
              <span />
            )}
            <Button onClick={onPrimary} disabled={primaryDisabled} className="!px-5">
              {primaryLabel}
              {primaryHint && (
                <span aria-hidden="true" className="ml-[6px]">
                  {primaryHint}
                </span>
              )}
            </Button>
          </div>
        </div>

        <p className="mt-3 text-center text-[11.5px] text-stiko-faint">{smallPrint}</p>
      </div>
    </div>
  );
}

/** Mounts once per step (keyed by the frame), so each step eases in. */
function StepBody({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className={`pb-4 transition duration-200 ease-out motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      {children}
    </div>
  );
}
