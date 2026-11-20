'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { checkpointStep } from '@/lib/undo/checkpoint';
import type { UndoDomain, UndoHistory } from '@/lib/undo/history';
import { isPointerHeld, onPointerRelease } from './pointerHeld';

export interface Checkpointed<T> {
  state: T;
  setState: Dispatch<SetStateAction<T>>;
  /**
   * Replace the state WITHOUT recording, and drop this domain's steps. For programmatic resets —
   * a file switch, the end of an annotation session, closing the cross-section tool — after
   * which the steps would replay onto state that no longer exists.
   */
  reset: (next: T) => void;
  /**
   * Hold checkpoints while `on` (e.g. a text editor is open, the calibrate tool is armed).
   * Releasing the last hold checkpoints on the next frame, so everything done while held is ONE
   * step. While any hold is active, undo and redo are refused outright (a history guard): there
   * is unrecorded work that walking history would run underneath.
   */
  hold: (key: string, on: boolean) => void;
}

/**
 * useState that records ONE undo step per quiet moment: no pointer held anywhere and no hold
 * active. A checkpoint is scheduled on every change and on every pointer release, and runs one
 * animation frame later, so every write from the same gesture — the per-node transformends of a
 * group transform arrive after pointerup — has landed first. The step is the net change from
 * the baseline (the state at the previous checkpoint) to now.
 */
export function useCheckpointedState<T>(
  initial: T | (() => T),
  history: UndoHistory | null,
  domain: UndoDomain
): Checkpointed<T> {
  const [state, setState] = useState<T>(initial);
  // Assigned during render, and ALSO written by undo/redo/reset directly: two undos in one tick
  // must not flush-compare against a state React has not rendered yet.
  const stateRef = useRef(state);
  stateRef.current = state;
  const baselineRef = useRef(state);
  const holds = useRef(new Set<string>());
  const frame = useRef<number | null>(null);

  const cancelFrame = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  const checkpoint = useCallback(() => {
    cancelFrame();
    if (!history || holds.current.size > 0 || isPointerHeld()) return;
    const change = checkpointStep(baselineRef.current, stateRef.current);
    if (!change) return;
    baselineRef.current = change.after;
    const restore = (value: T) => {
      baselineRef.current = value;
      stateRef.current = value;
      setState(value);
    };
    history.record({ domain, undo: () => restore(change.before), redo: () => restore(change.after) });
  }, [history, domain, cancelFrame]);

  const schedule = useCallback(() => {
    cancelFrame();
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      checkpoint();
    });
  }, [checkpoint, cancelFrame]);

  useEffect(() => { schedule(); }, [state, schedule]);
  useEffect(() => onPointerRelease(schedule), [schedule]);
  useEffect(() => (history ? history.registerFlush(checkpoint) : undefined), [history, checkpoint]);
  // The flush above is a no-op under a hold, so work done since the last checkpoint — the markup
  // text being typed, a Calibrate span — is not a step yet and undo would walk history underneath
  // it: the work is lost (a later checkpoint finds nothing to compare, or its record() clears redo)
  // and, with Calibrate, a restored real measurement could be captured as the calibration span.
  // Any active hold therefore refuses undo AND redo until it is released.
  useEffect(
    () => (history ? history.registerGuard(() => holds.current.size > 0) : undefined),
    [history]
  );
  useEffect(() => cancelFrame, [cancelFrame]);

  const reset = useCallback((next: T) => {
    cancelFrame();
    baselineRef.current = next;
    stateRef.current = next;
    setState(next);
    history?.dropDomain(domain);
  }, [history, domain, cancelFrame]);

  const hold = useCallback((key: string, on: boolean) => {
    const had = holds.current.has(key);
    if (on) holds.current.add(key);
    else holds.current.delete(key);
    if (had && !on) schedule();
  }, [schedule]);

  return { state, setState, reset, hold };
}
