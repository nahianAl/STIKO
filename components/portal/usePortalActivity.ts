'use client';

import { useEffect, useRef } from 'react';
import { diffDigest, type PortalDigest, type PortalEntity } from '@/lib/portalActivity';

const BASE_INTERVAL_MS = 6000;
const MAX_INTERVAL_MS = 60000;

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
    const controller = new AbortController();

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
      try {
        const res = await fetch(`/api/portals/${portalId}/activity`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (cancelled) return;

        // Access revoked mid-session. Stop for good rather than backing off:
        // retrying cannot start succeeding, and an open tab would otherwise
        // poll a 403 until it was closed.
        if (res.status === 401 || res.status === 403) {
          cancelled = true;
          return;
        }
        if (!res.ok) throw new Error(`activity ${res.status}`);

        const next = (await res.json()) as PortalDigest;
        const changed = diffDigest(previous, next);
        previous = next;
        interval = BASE_INTERVAL_MS;

        for (const key of Object.keys(changed) as PortalEntity[]) {
          if (changed[key]) handlersRef.current[key]?.();
        }
      } catch (err) {
        if (cancelled || (err as Error)?.name === 'AbortError') return;
        // Transient — a Neon blip, or a deploy swapping the function out. Back
        // off rather than hammer, and reset on the first success above.
        interval = Math.min(interval * 2, MAX_INTERVAL_MS);
      } finally {
        inFlight = false;
        schedule(interval);
      }
    };

    const onVisibilityChange = () => {
      // Poll at once rather than serving up to six seconds of stale data to
      // someone who has just come back to the tab.
      if (document.visibilityState === 'visible') schedule(0);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    schedule(interval);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      controller.abort();
    };
  }, [portalId]);
}
