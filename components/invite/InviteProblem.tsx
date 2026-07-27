'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { StickyNotes } from '@/components/ui/Primitives';
import { NOTES } from '@/lib/design';

/**
 * The invitation and access failure screens: 3n (expired / revoked), 3o (no
 * access) and 3p (not found).
 *
 * Each one names the cause and offers the single action that actually unblocks
 * the person — a bare 403 leaves them stuck.
 */
export function InviteProblem({
  kind,
  packageName,
  inviterName,
  inviterEmail,
  signedInAs,
}: {
  kind: string;
  packageName?: string;
  inviterName?: string;
  inviterEmail?: string;
  signedInAs?: string;
}) {
  const router = useRouter();

  if (kind === 'not_found') {
    // 3p — no card, content directly on the field.
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-stiko-app px-4 text-center">
        <StickyNotes
          notes={[
            { color: 'purple', size: 74, rotate: -10 },
            { color: 'yellow', size: 78, rotate: 6 },
          ]}
        >
          <span
            className="text-[22px] font-extrabold"
            style={{ color: NOTES.yellow.text }}
          >
            ?
          </span>
        </StickyNotes>

        <h1 className="mt-7 text-[21px] font-extrabold text-stiko-ink">
          Nothing here
        </h1>
        <p className="mt-2 max-w-[380px] text-[13px] leading-[1.6] text-stiko-muted">
          This package may have been deleted, or the link is wrong.
        </p>
        <div className="mt-6">
          <Button onClick={() => router.push('/')}>Back to your packages</Button>
        </div>
      </div>
    );
  }

  if (kind === 'no_access') {
    // 3o — naming the signed-in account is the point. The overwhelmingly common
    // cause is the wrong work identity, and a generic 403 leaves you stuck.
    return (
      <ProblemCard
        tone="red"
        icon={
          <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        }
        title="You don't have access to this package"
      >
        <p className="text-[13px] leading-[1.6] text-stiko-muted">
          You&apos;re signed in as <b className="text-stiko-ink">{signedInAs}</b>
          . If your invitation went to a different address, switch accounts.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button fullWidth className="!py-3">
            Request access
          </Button>
          <Button
            variant="secondary"
            fullWidth
            onClick={() => router.push('/login')}
            className="!py-3"
          >
            Switch account
          </Button>
        </div>
      </ProblemCard>
    );
  }

  // 3n — expired or revoked. Same shape, different copy.
  const revoked = kind === 'revoked';
  return (
    <ProblemCard
      tone="yellow"
      icon={<path d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />}
      title={
        revoked
          ? 'This invitation is no longer valid'
          : 'This invitation has expired'
      }
    >
      <p className="text-[13px] leading-[1.6] text-stiko-muted">
        {revoked ? (
          <>
            The invitation to{' '}
            <b className="text-stiko-ink">{packageName ?? 'this package'}</b> was
            withdrawn. {inviterName ?? 'The person who invited you'} can send you
            a fresh one in a click.
          </>
        ) : (
          <>
            Invitations to{' '}
            <b className="text-stiko-ink">{packageName ?? 'a package'}</b> last
            14 days. {inviterName ?? 'The person who invited you'} can send you a
            fresh one in a click.
          </>
        )}
      </p>
      <div className="mt-6">
        <Button fullWidth className="!py-3">
          Ask {inviterName ?? 'them'} for a new link
        </Button>
      </div>
      <p className="mt-3 text-[12px] text-stiko-faint">
        We&apos;ll email {inviterEmail ?? 'them'} on your behalf.
      </p>
    </ProblemCard>
  );
}

function ProblemCard({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'red' | 'yellow';
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const swatch = tone === 'red' ? NOTES.red : NOTES.yellow;
  return (
    <div className="flex min-h-screen items-center justify-center bg-stiko-app px-4">
      <div className="w-full max-w-[420px] rounded-sheet bg-white p-8 text-center shadow-stiko-panel">
        <span
          className="mx-auto flex h-[44px] w-[44px] items-center justify-center rounded-[13px]"
          style={{ background: swatch.pastel }}
        >
          <svg
            className="h-5 w-5"
            style={{ color: swatch.text }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {icon}
          </svg>
        </span>

        <h1 className="mt-4 text-[19px] font-extrabold text-stiko-ink">
          {title}
        </h1>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}
