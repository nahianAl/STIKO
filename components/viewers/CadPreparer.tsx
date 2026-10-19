'use client';

import { useEffect, useState } from 'react';
import {
  CAD_POLL_INTERVAL_MS,
  nextCadPollStep,
  type ConversionStatus,
} from '@/lib/cadConversion';

interface Props {
  fileId: string;
  /** Called once with the GLB's key; the parent swaps the file over to the 3D viewer. */
  onConverted: (convertedStorageKey: string) => void;
  /** Must be called when this ends without a model, to release the page's loading indicator. */
  onReady?: () => void;
}

interface StartBody {
  conversionStatus: ConversionStatus;
  convertedStorageKey: string | null;
  deferredUntil?: string;
  reason?: 'disabled' | 'not-configured' | 'retry';
}

type View =
  | { kind: 'converting' }
  | { kind: 'failed' }
  | { kind: 'deferred'; until: string }
  | { kind: 'disabled' }
  | { kind: 'unavailable' }
  | { kind: 'slow' };

function formatDay(isoDay: string): string {
  return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/**
 * Shown for a .sldprt that has no GLB yet. Asks the server to start a conversion (a no-op if one
 * is running) and polls until the GLB exists, the conversion fails, or CAD_POLL_LIMIT_MS passes.
 * Unlike DrawingPreparer the start call answers at once: the worker reports back on its own.
 */
export default function CadPreparer({ fileId, onConverted, onReady }: Props) {
  const [view, setView] = useState<View>({ kind: 'converting' });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    const stop = (next: View) => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      setView(next);
      onReady?.();
    };

    const settle = (status: ConversionStatus, key: string | null): boolean => {
      const step = nextCadPollStep(status, key, Date.now() - started);
      if (step === 'done' && key) {
        cancelled = true;
        if (timer) clearTimeout(timer);
        onConverted(key);
        return true;
      }
      if (step === 'failed') {
        stop({ kind: 'failed' });
        return true;
      }
      if (step === 'timeout') {
        stop({ kind: 'slow' });
        return true;
      }
      return false;
    };

    const poll = async () => {
      if (cancelled) return;
      let body: StartBody | null = null;
      try {
        const res = await fetch(`/api/files/${fileId}/conversion-status`);
        body = res.ok ? ((await res.json()) as StartBody) : null;
      } catch {
        // A failed status check is not a verdict, but it still counts toward the time limit:
        // it goes through settle() as an unknown status, so the limit is reached even when
        // every check fails.
      }
      // The fetch and the body read are both awaits: the file may have changed (or another
      // path settled) meanwhile, and a stale answer must not settle anything.
      if (cancelled) return;
      if (settle(body?.conversionStatus ?? null, body?.convertedStorageKey ?? null)) return;
      timer = setTimeout(poll, CAD_POLL_INTERVAL_MS);
    };

    fetch(`/api/files/${fileId}/convert-cad`, { method: 'POST' })
      .then(async (res) => {
        if (cancelled) return;
        const body = (await res.json().catch(() => null)) as StartBody | null;
        if (cancelled) return;
        if (res.status === 503) {
          stop(body?.reason === 'disabled' ? { kind: 'disabled' } : { kind: 'unavailable' });
          return;
        }
        if (!res.ok || !body) {
          stop({ kind: 'unavailable' });
          return;
        }
        if (body.deferredUntil) {
          stop({ kind: 'deferred', until: body.deferredUntil });
          return;
        }
        if (settle(body.conversionStatus, body.convertedStorageKey)) return;
        timer = setTimeout(poll, CAD_POLL_INTERVAL_MS);
      })
      .catch(() => {
        if (!cancelled) stop({ kind: 'unavailable' });
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // onConverted/onReady are callbacks from the parent; restarting on their identity would
    // re-trigger the conversion on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const lines: Record<View['kind'], [string, string | null]> = {
    converting: ['Converting SolidWorks part…', 'The first one after a quiet spell can take a couple of minutes.'],
    failed: ["Couldn't convert this SolidWorks part.", 'Save As STEP in SolidWorks and upload that.'],
    deferred: ['', 'Save As STEP to view it now.'],
    disabled: ['SolidWorks preview is turned off.', 'Save As STEP to view it.'],
    unavailable: ["SolidWorks preview isn't available right now.", 'Try again in a few minutes, or Save As STEP to view it now.'],
    slow: ['Still converting.', 'Check back in a few minutes.'],
  };
  const [title, detail] = lines[view.kind];
  const heading = view.kind === 'deferred' ? `Preview available from ${formatDay(view.until)}.` : title;

  return (
    <div role="status" aria-live="polite" className="flex h-full w-full items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <p className={view.kind === 'converting' ? 'text-sm text-gray-500' : 'text-sm font-medium text-gray-700'}>{heading}</p>
        {detail && <p className="mt-1 text-sm text-gray-500">{detail}</p>}
      </div>
    </div>
  );
}
