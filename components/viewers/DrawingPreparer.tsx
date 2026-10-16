'use client';

import { useEffect, useState } from 'react';
import {
  DRAWING_POLL_INTERVAL_MS,
  nextPollStep,
  type ConversionStatus,
} from '@/lib/drawingConversion';

interface Props {
  fileId: string;
  /** Called once with the PDF's key; the parent swaps the file over to the PDF viewer. */
  onConverted: (convertedStorageKey: string) => void;
  /** Must be called when this ends in failure, to release the page's loading indicator. */
  onReady?: () => void;
}

interface StatusBody {
  conversionStatus: ConversionStatus;
  convertedStorageKey: string | null;
}

/**
 * Shown for a DWG/DXF that has no PDF yet. Asks the server to convert it (a no-op if a
 * conversion is already running) and polls until the PDF exists, the conversion fails, or
 * DRAWING_POLL_LIMIT_MS passes.
 */
export default function DrawingPreparer({ fileId, onConverted, onReady }: Props) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    const settle = (body: StatusBody | null): boolean => {
      const step = nextPollStep(
        body?.conversionStatus ?? null,
        body?.convertedStorageKey ?? null,
        Date.now() - started
      );
      if (step === 'done' && body?.convertedStorageKey) {
        onConverted(body.convertedStorageKey);
        return true;
      }
      if (step === 'failed') {
        setFailed(true);
        onReady?.();
        return true;
      }
      return false;
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/files/${fileId}/conversion-status`);
        if (!cancelled && settle(res.ok ? ((await res.json()) as StatusBody) : null)) return;
      } catch {
        if (!cancelled && settle(null)) return;
      }
      if (!cancelled) timer = setTimeout(poll, DRAWING_POLL_INTERVAL_MS);
    };

    // The POST may take the whole conversion (up to a minute) to answer, so polling starts
    // alongside it rather than after it. Its own answer is used too, when it arrives first.
    fetch(`/api/files/${fileId}/convert-drawing`, { method: 'POST' })
      .then((res) => (res.ok ? (res.json() as Promise<StatusBody>) : null))
      .then((body) => {
        if (!cancelled && body && settle(body)) {
          cancelled = true;
          if (timer) clearTimeout(timer);
        }
      })
      .catch(() => {});
    timer = setTimeout(poll, DRAWING_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // onConverted/onReady are callbacks from the parent; restarting on their identity would
    // re-trigger the conversion on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="max-w-sm text-center">
        {failed ? (
          <>
            <p className="text-sm font-medium text-gray-700">
              This drawing couldn&apos;t be converted for viewing.
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Download the original to open it in your CAD software.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-500">Preparing drawing…</p>
        )}
      </div>
    </div>
  );
}
