'use client';

/**
 * posthog-js for the app (spec §5.1).
 * - Starts only after public/stiko-tracking.js reports 'granted' or 'not_required'.
 * - Autocapture off; $pageview sent on route changes.
 * - Session replay ONLY on /welcome, all inputs and text masked: the rest of the
 *   app shows customers' confidential drawings and models.
 * - identify(user id) + group('workspace', id) once signed in; reset() on sign-out.
 */
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { useAuthSession } from '@/lib/authClient';
import { releasePendingCaptures } from '@/lib/analytics/client';
import { scrubEvent } from '@/lib/analytics/scrub';

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

type TrackingState = 'loading' | 'pending' | 'granted' | 'denied' | 'not_required';

function useTrackingState(): TrackingState {
  const [state, setState] = useState<TrackingState>('loading');
  useEffect(() => {
    const w = window as unknown as { stikoTracking?: { state: TrackingState } };
    if (w.stikoTracking && w.stikoTracking.state !== 'loading') setState(w.stikoTracking.state);
    const onChange = (e: Event) => setState((e as CustomEvent<{ state: TrackingState }>).detail.state);
    window.addEventListener('stiko:tracking', onChange);
    return () => window.removeEventListener('stiko:tracking', onChange);
  }, []);
  return state;
}

// useLayoutEffect warns during server rendering; there is nothing to stop there.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function Pageviews({ ready }: { ready: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  // Replay stops in the same commit that leaves /welcome, before the recorder's
  // observer is handed the next page's DOM. A passive effect runs after that
  // hand-off, and the next page (the dashboard, a package) is exactly what must
  // never be recorded.
  useIsomorphicLayoutEffect(() => {
    if (ready && pathname !== '/welcome') posthog.stopSessionRecording();
  }, [ready, pathname]);
  useEffect(() => {
    if (!ready) return;
    posthog.capture('$pageview');
    if (pathname === '/welcome') posthog.startSessionRecording();
  }, [ready, pathname, search]);
  return null;
}

/** PostHog's own record of whether this browser still carries a signed-in person. */
function browserIsIdentified(): boolean {
  return posthog.get_property('$user_state') === 'identified';
}

export default function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const tracking = useTrackingState();
  const { status } = useAuthSession();
  const [ready, setReady] = useState(false);
  // True once PostHog knows who is (or is not) signed in, so the first $pageview
  // of a page load is never filed under the previous person.
  const [identityKnown, setIdentityKnown] = useState(false);
  const identified = useRef<string | null>(null);

  // Start PostHog once tracking is allowed.
  useEffect(() => {
    if (!KEY || ready) return;
    if (tracking !== 'granted' && tracking !== 'not_required') return;
    posthog.init(KEY, {
      api_host: '/ingest',
      ui_host: 'https://us.posthog.com',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: true,
      cross_subdomain_cookie: true,
      persistence: 'localStorage+cookie',
      disable_session_recording: true,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '*',
        // Local setting beats the project's canvas-recording setting.
        captureCanvas: { recordCanvas: false },
        // alt, title, aria-label, href, src: attributes are not text, so
        // maskTextSelector leaves them; this masks every one of them.
        maskAllElementAttributes: true,
        // Network headers/bodies in replay: an explicit false beats the project.
        recordHeaders: false,
        recordBody: false,
      },
      // These follow the PostHog project's settings unless pinned here. Each can
      // carry a file name, a presigned URL or an invite link out of the app.
      capture_heatmaps: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      capture_performance: false,
      // Console output in replay; local false beats the project's setting.
      enable_recording_console_log: false,
      // PostHog Logs. captureConsoleLogs: false is NOT a veto in 1.450 (the
      // project's setting still switches console capture on), and log records
      // bypass before_send and carry the full page URL. Dropping every record
      // in the logs beforeSend is the veto.
      logs: { captureConsoleLogs: false, beforeSend: () => null },
      // Each of these, if switched on in the project, loads a widget and calls
      // PostHog from the page.
      disable_surveys: true,
      disable_conversations: true,
      disable_product_tours: true,
      disable_web_experiments: true,
      // Credentials and personal data in a URL never leave the browser (lib/analytics/scrub.ts).
      before_send: scrubEvent,
      // No /flags request, ever. Its body carries $initial_current_url and
      // $initial_referrer as person_properties, which before_send never sees, and
      // identify()/group() re-send it. Stiko uses no feature flags. NOT
      // advanced_disable_flags: that also stops the remote config (/array/<key>/config)
      // that session replay on /welcome needs.
      advanced_disable_feature_flags: true,
      // The per-session $referrer is a full URL from another page of the app.
      save_referrer: false,
    });
    // Events raised so far are NOT sent here: identity is not settled yet, and
    // this browser may still carry the previous person (see below).
    setReady(true);
  }, [tracking, ready]);

  // Held client events go out only once identity is settled.
  useEffect(() => {
    if (ready && identityKnown) releasePendingCaptures();
  }, [ready, identityKnown]);

  // A signed-in user who answers the banner: server events follow the answer.
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (tracking !== 'granted' && tracking !== 'denied') return;
    fetch('/api/analytics/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: tracking }),
    }).catch(() => {});
  }, [status, tracking]);

  // identify + group once signed in; reset on sign-out.
  useEffect(() => {
    if (!ready || status === 'loading') return;

    if (status === 'unauthenticated') {
      // Signing out is a full page load (see signOutTo), so nothing in memory
      // survives it: ask PostHog whether this browser still carries a person.
      if (identified.current || browserIsIdentified()) posthog.reset();
      identified.current = null;
      setIdentityKnown(true);
      return;
    }

    if (identified.current) return;
    let cancelled = false;
    // Who is signed in could not be established (/api/me failed or said no):
    // treat it as unknown, and never let the previous person's identity carry
    // what is sent next.
    const forgetStaleIdentity = () => {
      if (browserIsIdentified()) posthog.reset();
    };
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { id: string; workspaceId: string | null } | null) => {
        if (cancelled) return;
        if (!me) return forgetStaleIdentity();
        // A different person's identity left in this browser must not carry over.
        if (browserIsIdentified() && posthog.get_distinct_id() !== me.id) posthog.reset();
        posthog.identify(me.id);
        if (me.workspaceId) posthog.group('workspace', me.workspaceId);
        identified.current = me.id;
      })
      .catch(() => {
        if (cancelled) return;
        try {
          forgetStaleIdentity();
        } catch {
          // analytics never breaks the page
        }
      })
      .finally(() => {
        if (!cancelled) setIdentityKnown(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, status]);

  return (
    <>
      <Script src="/stiko-tracking.js" strategy="afterInteractive" />
      <Suspense fallback={null}>
        <Pageviews ready={ready && identityKnown} />
      </Suspense>
      {children}
    </>
  );
}
