'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createUndoHistory, type UndoHistory, type UndoStep } from '@/lib/undo/history';
import { ownsTextUndo, undoKeyOf } from '@/lib/undo/shortcut';
import { isPointerHeld } from './pointerHeld';

/**
 * The open file's undo history. Provided by the portal page, which owns it; read by the
 * drawing surfaces and the 3D viewer, which sit below it. Null anywhere outside the portal —
 * every consumer then simply records nothing.
 */
export const UndoHistoryContext = createContext<UndoHistory | null>(null);

export function useUndoHistory(): UndoHistory | null {
  return useContext(UndoHistoryContext);
}

/** One history for the life of the page. The page clears it on every file switch. */
export function useUndoHistoryRoot(): UndoHistory {
  const [history] = useState(() => createUndoHistory());
  return history;
}

export interface UndoShortcutOptions {
  /** Runs before an UNDO walks history. Return true to consume the press (e.g. abandon a half-placed measurement). */
  beforeUndo?: () => boolean;
  onFailed?: (outcome: { status: 'failed'; step: UndoStep; error: unknown }, direction: 'undo' | 'redo') => void;
}

/**
 * The one window listener for undo/redo. Separate from useUndoHistoryRoot because the page
 * needs the history BEFORE it creates the stores that record into it, and the options here
 * read those stores.
 */
export function useUndoShortcuts(history: UndoHistory, options: UndoShortcutOptions): void {
  // Read through a ref so the listener is bound once and still sees the latest callbacks.
  const opts = useRef(options);
  opts.current = options;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const which = undoKeyOf(e);
      if (!which || e.defaultPrevented) return;
      if (ownsTextUndo(document.activeElement as HTMLElement | null)) return;
      // A dialog or drawer owns the keyboard while it is open.
      if (document.querySelector('[aria-modal="true"]')) return;
      // Mid-gesture: the gesture is not a step yet, and undoing under it would tear it.
      if (isPointerHeld()) return;
      e.preventDefault();
      // A server step is in flight: ignore the press entirely, before beforeUndo can abandon anything.
      if (history.isBusy()) return;
      if (which === 'undo' && opts.current.beforeUndo?.()) return;
      void (which === 'undo' ? history.undo() : history.redo())
        .then((out) => {
          if (out.status === 'failed') opts.current.onFailed?.(out, which);
        })
        .catch((err) => console.error('Undo failed:', err));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history]);
}
