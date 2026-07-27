'use client';

import React from 'react';
import { LogoMark } from '@/components/ui/Shell';

/**
 * The shell every auth screen shares (04): full viewport, #F6F8FE, no app
 * chrome, content centred, card column 400px.
 */
export default function AuthShell({
  title,
  subtitle,
  width = 400,
  children,
  below,
}: {
  title: string;
  subtitle?: string;
  width?: number;
  children: React.ReactNode;
  /** Rendered under the card — the "New to Stiko?" line and friends. */
  below?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stiko-app px-4 py-10">
      <div className="w-full" style={{ maxWidth: width }}>
        <div className="mb-6 flex flex-col items-center text-center">
          <LogoMark size={44} />
          <h1 className="mt-4 text-[22px] font-extrabold tracking-title text-stiko-ink">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-[6px] text-[13.5px] text-stiko-muted">{subtitle}</p>
          )}
        </div>

        <div className="rounded-sheet bg-white p-[26px] shadow-stiko-panel">
          {children}
        </div>

        {below && (
          <div className="mt-4 text-center text-[13px] text-stiko-muted">
            {below}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Password strength meter (3b, 3d): three 4px bars plus a label.
 *
 * Deliberately simple and honest — it measures length and variety, and never
 * claims "Strong" for something short.
 */
export function PasswordStrength({ password }: { password: string }) {
  const score = scorePassword(password);
  const spec = [
    { label: '', color: '#EFEFF4', text: '#A2A7B8' },
    { label: 'Weak', color: '#FF6B6B', text: '#B23A52' },
    { label: 'Fair', color: '#FFCF2E', text: '#7A5E00' },
    { label: 'Strong', color: '#7BC24A', text: '#4B7A28' },
  ][score];

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1">
        {[1, 2, 3].map((bar) => (
          <span
            key={bar}
            className="h-1 flex-1 rounded-full transition-colors duration-150"
            style={{ background: score >= bar ? spec.color : '#EFEFF4' }}
          />
        ))}
      </div>
      {spec.label && (
        <p
          className="mt-[5px] text-[11.5px] font-bold"
          style={{ color: spec.text }}
        >
          {spec.label}
        </p>
      )}
    </div>
  );
}

/** 0 = empty, 1 = weak, 2 = fair, 3 = strong. */
export function scorePassword(password: string): 0 | 1 | 2 | 3 {
  if (!password) return 0;
  if (password.length < 8) return 1;

  let variety = 0;
  if (/[a-z]/.test(password)) variety++;
  if (/[A-Z]/.test(password)) variety++;
  if (/[0-9]/.test(password)) variety++;
  if (/[^A-Za-z0-9]/.test(password)) variety++;

  if (password.length >= 12 && variety >= 3) return 3;
  if (variety >= 2) return 2;
  return 1;
}
