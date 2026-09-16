'use client';

import { useState, useRef, useCallback } from 'react';
import {
  beginGesture,
  addPoint as addGesturePoint,
  type MeasureKind,
  type MeasurementDraft,
  type PendingGesture,
} from '@/lib/measure/gesture';
import { UNPAGED } from '@/lib/measure/calibration';

export interface Measurement extends MeasurementDraft {
  id: string;
}

/**
 * Measurements for one viewing session, mirroring useAnnotationObjects.
 *
 * Surface-agnostic: each surface feeds points in its OWN intrinsic space (stage pixels for the
 * 2D surfaces, model-frame coordinates for the 3D one) and renders them back in that same space.
 * Nothing here knows about pixels, world units or millimetres — conversion to a displayed number
 * happens at render time, where the file's scale is known.
 *
 * Measurements are session-only, exactly like markup: the way to keep one is to snapshot it into
 * a comment.
 */
export function useMeasurements() {
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [pending, setPending] = useState<PendingGesture | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const idRef = useRef(0);

  // The pending gesture is mirrored in a ref and READ from the ref, never from inside a state
  // updater. useAnnotationObjects does the same with draftRef, for the same reason: a click
  // handler needs the current gesture synchronously, and doing the work inside setPending's
  // updater would run it twice under StrictMode — double-incrementing idRef and making the
  // committed measurement a side effect of rendering.
  const pendingRef = useRef<PendingGesture | null>(null);

  const setGesture = useCallback((next: PendingGesture | null) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  const begin = useCallback(
    (kind: MeasureKind, page: number = UNPAGED) => setGesture(beginGesture(kind, page)),
    [setGesture]
  );

  /**
   * Returns the committed measurement, or null while the gesture is still collecting points or
   * when the gesture was rejected as degenerate. A rejection restarts the gesture rather than
   * leaving a half-finished one on screen — the user's next click should begin cleanly.
   */
  const addPoint = useCallback(
    (point: number[], minSeparation: number): Measurement | null => {
      const current = pendingRef.current;
      if (!current) return null;

      const result = addGesturePoint(current, point, minSeparation);
      if (result.status === 'pending') {
        setGesture(result.gesture);
        return null;
      }

      setGesture(beginGesture(current.kind, current.page));
      if (result.status === 'rejected') return null;

      const committed: Measurement = { ...result.measurement, id: `measure-${idRef.current++}` };
      setMeasurements((prev) => [...prev, committed]);
      return committed;
    },
    [setGesture]
  );

  const cancel = useCallback(() => setGesture(null), [setGesture]);

  const remove = useCallback((id: string) => {
    setMeasurements((prev) => prev.filter((m) => m.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  const clear = useCallback(() => {
    setMeasurements([]);
    setGesture(null);
    setSelectedId(null);
  }, [setGesture]);

  return { measurements, pending, selectedId, setSelectedId, begin, addPoint, cancel, remove, clear };
}
