'use client';

import { useEffect, useRef } from 'react';
import { diffDigest, type DigestDiff, type PortalDigest, type PortalEntity } from '@/lib/portalActivity';

const BASE_INTERVAL_MS = 6000;
const MAX_INTERVAL_MS = 60000;
// A stalled connection (dead mobile radio, a proxy that neither answers nor
// closes) never rejects and never resolves on its own. Without a deadline
// per request, `inFlight` would stay true forever and nothing — not even
// returning to the tab — reschedules a poll while it is stuck true.
const ACTIVITY_REQUEST_TIMEOUT_MS = 15000;

export type ActivityHandlers = Partial<Record<PortalEntity, () => void>>;

/**
 * Poll the package's change feed and call back for whatever moved.
 *
 * Owns the timer and nothing else: it never fetches portal data itself, so the
 * loaders it triggers remain the single place each entity is loaded from.
 */
export function usePortalActivity(portalId: string | null, handlers: ActivityHandlers) {
  // The handlers object is rebuilt on every render because it closes over page
  // state. Holding it in a ref keeps that out of the effect's dependencies —
  // otherwise the timer is torn down and rebuilt on every render and never
  // survives long enough to fire. The ref also means handlers read current
  // state (e.g. the selected version) rather than whatever was current at mount.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!portalId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let interval = BASE_INTERVAL_MS;
    let previous: PortalDigest | null = null;
    // The controller for whichever request is currently in flight (there is
    // ever only one, per the `inFlight` guard). Cleanup aborts this one;
    // nulled once the request settles so a stale reference is never aborted.
    let active: AbortController | null = null;

    const schedule = (ms: number) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(poll, ms);
    };

    const poll = async () => {
      // A tick that lands while the previous request is still out is dropped.
      // The in-flight request reschedules in its own finally, so on a slow
      // connection this degrades to "as fast as the network allows" instead of
      // piling requests up.
      if (cancelled || inFlight) return;

      // A hidden tab costs nothing at all: no request AND no timer. The
      // visibilitychange listener re-arms it.
      if (document.visibilityState !== 'visible') return;

      inFlight = true;

      // Everything that can throw between here and the network call must sit
      // inside the try. Setup used to happen before it (an `AbortSignal.any`
      // call, dropped below), and a throw there skipped catch and finally
      // both: `inFlight` never reset, and nothing — not even a
      // visibilitychange poll on returning to the tab — could get past that
      // stuck guard. Only a remount recovered.
      let requestTimer: ReturnType<typeof setTimeout> | null = null;
      let changed: DigestDiff | null = null;
      try {
        // Fresh per request rather than chained onto one long-lived signal
        // (`inFlight` guarantees only one is ever outstanding, so there is
        // never a need to fan a timeout out across more than one). Cleanup
        // aborts whatever `active` currently holds; this timer aborts this
        // one specifically if it runs past its own deadline.
        const controller = new AbortController();
        active = controller;
        requestTimer = setTimeout(() => controller.abort(), ACTIVITY_REQUEST_TIMEOUT_MS);

        const res = await fetch(`/api/portals/${portalId}/activity`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (cancelled) return;

        // Access revoked mid-session (401/403), OR the middleware couldn't
        // tell this apart from a browser navigation and 307-redirected it to
        // /login — /portal/[id] is public, so a logged-out viewer never gets
        // the 401 body, just a 200 whose HTML fails to parse as JSON.
        // `res.redirected` is true whenever fetch followed one of those, and
        // it is the only way to see the redirect from here since the 307
        // itself is invisible to the caller. All three are terminal: retrying
        // cannot start succeeding, and without this an open tab would poll
        // the login page every 60s for as long as it stayed open.
        if (res.status === 401 || res.status === 403 || res.redirected) {
          cancelled = true;
          return;
        }
        if (!res.ok) throw new Error(`activity ${res.status}`);

        const next = (await res.json()) as PortalDigest;
        changed = diffDigest(previous, next);
        previous = next;
        interval = BASE_INTERVAL_MS;
      } catch {
        // `cancelled` is set (by the effect cleanup) before the unmount
        // controller is aborted, so an unmount abort always lands here with
        // cancelled already true. Anything else reaching this branch —
        // including this request's own timeout firing — is a real failure to
        // back off from; there is no other source left to special-case.
        if (cancelled) return;
        // Transient — a Neon blip, a deploy swapping the function out, or
        // this request's own timeout. Back off rather than hammer, and reset
        // on the first success above.
        interval = Math.min(interval * 2, MAX_INTERVAL_MS);
      } finally {
        if (requestTimer) clearTimeout(requestTimer);
        active = null;
        inFlight = false;
        schedule(interval);
      }

      // Handlers run outside the network try/catch on purpose: a handler that
      // throws must not be mistaken for a fetch failure (which would double
      // the backoff for no network reason) and must not be swallowed either —
      // `previous` above has already advanced, so a change eaten here is gone
      // for good, not reported on the next poll.
      if (cancelled || !changed) return;
      for (const key of Object.keys(changed) as PortalEntity[]) {
        if (!changed[key]) continue;
        try {
          handlersRef.current[key]?.();
        } catch {
          // One handler's bug must not drop the other entities' refresh for
          // this tick — `previous` has already advanced, so a change missed
          // here is never re-reported.
        }
      }
    };

    const onVisibilityChange = () => {
      // Poll at once rather than serving up to six seconds of stale data to
      // someone who has just come back to the tab. If a request is already
      // in flight, its own finally clears this 0ms timer and reschedules a
      // full-interval one instead, so the immediate poll is skipped — that's
      // fine, since fresh data had just arrived anyway.
      if (document.visibilityState === 'visible') schedule(0);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    schedule(interval);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      active?.abort();
    };
  }, [portalId]);
}
