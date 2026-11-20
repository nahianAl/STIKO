// lib/undo/history.ts
// The undo/redo timeline for one open file. Plain data — no React, no three, no `@/` imports —
// so the node --test suite can import it directly.
//
// A step carries its own undo and redo because Stiko's state lives in three different places:
// React state (markup, measurements, plane flags), the three.js scene (plane poses) and the
// server (the model's placement). A snapshot of "the state" does not exist to take.

export type UndoDomain = 'markup' | 'measure' | 'section' | 'model';

export interface UndoStep {
  domain: UndoDomain;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

export type UndoOutcome =
  | { status: 'done'; step: UndoStep }
  | { status: 'empty' }
  | { status: 'busy' }
  | { status: 'failed'; step: UndoStep; error: unknown };

export const UNDO_CAPACITY = 200;

export interface UndoHistory {
  /** Push a step. Clears the redo stack: a new action forks the timeline. */
  record(step: UndoStep): void;
  undo(): Promise<UndoOutcome>;
  redo(): Promise<UndoOutcome>;
  /**
   * Remove every step of one domain from both stacks, keeping the rest in order. Safe because
   * the domains never share state: each domain's steps chain only among themselves.
   */
  dropDomain(domain: UndoDomain): void;
  clear(): void;
  /**
   * Register a function run before every undo/redo, so a change that has not been checkpointed
   * yet becomes a step first — otherwise the first undo would skip it. Returns the unregister.
   */
  registerFlush(flush: () => void): () => void;
  /** True while an async step (a server save) is running. */
  isBusy(): boolean;
  depth(): { undo: number; redo: number };
}

export function createUndoHistory(capacity: number = UNDO_CAPACITY): UndoHistory {
  let undoStack: UndoStep[] = [];
  let redoStack: UndoStep[] = [];
  let busy = false;
  // Set when record() runs while a step is in flight: the redo branch was forked away under it.
  let recordedInFlight = false;
  // Steps removed by clear()/dropDomain(): gone on purpose, so an in-flight one must not come back.
  const dropped = new WeakSet<UndoStep>();
  const flushes = new Set<() => void>();

  const trim = () => {
    if (undoStack.length > capacity) undoStack.splice(0, undoStack.length - capacity);
  };

  const run = async (direction: 'undo' | 'redo'): Promise<UndoOutcome> => {
    if (busy) return { status: 'busy' };
    for (const flush of Array.from(flushes)) flush();
    const source = direction === 'undo' ? undoStack : redoStack;
    const step = source[source.length - 1];
    if (!step) return { status: 'empty' };
    busy = true;
    recordedInFlight = false;
    const undoLengthAtStart = undoStack.length;
    try {
      await (direction === 'undo' ? step.undo() : step.redo());
    } catch (error) {
      // Left where it was: the user can try again, and the stacks still describe the state.
      return { status: 'failed', step, error };
    } finally {
      busy = false;
    }
    // Located again by identity rather than popped: the stacks may have been reassigned while
    // an async step was in flight. Two different things can have happened meanwhile. A step in
    // `dropped` was removed on purpose (a file switch) and stays gone. Otherwise a record() may
    // have forked the timeline: an undone step then has no redo branch left to join, but a redone
    // step's change was applied and must stay undoable, just older than what was recorded since.
    if (dropped.has(step)) return { status: 'done', step };
    if (direction === 'undo') {
      const i = undoStack.lastIndexOf(step);
      if (i !== -1) undoStack.splice(i, 1);
      if (!recordedInFlight) redoStack.push(step);
    } else {
      const i = redoStack.lastIndexOf(step);
      if (i !== -1) redoStack.splice(i, 1);
      undoStack.splice(Math.min(undoLengthAtStart, undoStack.length), 0, step);
      trim();
    }
    return { status: 'done', step };
  };

  return {
    record(step) {
      if (busy) recordedInFlight = true;
      undoStack.push(step);
      trim();
      redoStack = [];
    },
    undo: () => run('undo'),
    redo: () => run('redo'),
    dropDomain(domain) {
      for (const s of [...undoStack, ...redoStack]) if (s.domain === domain) dropped.add(s);
      undoStack = undoStack.filter((s) => s.domain !== domain);
      redoStack = redoStack.filter((s) => s.domain !== domain);
    },
    clear() {
      for (const s of [...undoStack, ...redoStack]) dropped.add(s);
      undoStack = [];
      redoStack = [];
    },
    registerFlush(flush) {
      flushes.add(flush);
      return () => { flushes.delete(flush); };
    },
    isBusy: () => busy,
    depth: () => ({ undo: undoStack.length, redo: redoStack.length }),
  };
}
