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
  /**
   * The markup colour in force when this was placed. Measurements carry colour but NOT stroke
   * width: a width is part of a drawing, whereas a dimension is chrome that has to stay legible
   * at any zoom. This is also why measurements never go through `onSelectionChange` — the
   * stroke picker must not relabel itself for an object that ignores it.
   */
  color: string;
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

  /**
   * Where the cursor is, in the surface's OWN space, while a gesture is pending.
   *
   * Rendered as a provisional last point so the user sees the line and its running value before
   * committing, instead of clicking once and seeing nothing until the second click. Surface-
   * agnostic like every other point here: stage pixels from the 2D surfaces, model-frame
   * coordinates from the 3D one.
   */
  const [hoverPoint, setHoverPointState] = useState<number[] | null>(null);

  // Copied on the way in, exactly like `addPoint` copies its point: the 3D surface hands over an
  // array it derived from a THREE.Vector3 it may well reuse, and holding that array directly
  // would let a later mutation rewrite state React believes it already rendered.
  const setHoverPoint = useCallback((point: number[] | null) => {
    setHoverPointState(point ? [...point] : null);
  }, []);

  const setGesture = useCallback((next: PendingGesture | null) => {
    pendingRef.current = next;
    setPending(next);
    // A new or cleared gesture invalidates the hover line BY DEFINITION, and this is the one
    // funnel every gesture change goes through — `begin`, `addPoint`, `cancel` and `clear` all
    // land here. Clearing here rather than at each of those call sites is what makes "the hover
    // point never outlives its gesture" a property of the store instead of four things to
    // remember: tool disarm and a PDF page turn reach it via `cancel`, a file switch and a
    // stage-resize invalidation via `clear`, and a commit via `addPoint`.
    setHoverPointState(null);
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
    (point: number[], minSeparation: number, color: string): Measurement | null => {
      const current = pendingRef.current;
      if (!current) return null;

      const result = addGesturePoint(current, point, minSeparation);
      if (result.status === 'pending') {
        setGesture(result.gesture);
        return null;
      }

      setGesture(beginGesture(current.kind, current.page));
      if (result.status === 'rejected') return null;

      const committed: Measurement = {
        ...result.measurement,
        id: `measure-${idRef.current++}`,
        color,
      };
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

  /** Restyle one measurement. The colour picker's route to a selected dimension. */
  const recolor = useCallback((id: string, color: string) => {
    setMeasurements((prev) => prev.map((m) => (m.id === id ? { ...m, color } : m)));
  }, []);

  const clear = useCallback(() => {
    setMeasurements([]);
    setGesture(null);
    setSelectedId(null);
  }, [setGesture]);

  return {
    measurements,
    pending,
    hoverPoint,
    setHoverPoint,
    selectedId,
    setSelectedId,
    begin,
    addPoint,
    cancel,
    remove,
    recolor,
    clear,
  };
}
