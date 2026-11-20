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
  /** A registered guard refused this press; nothing ran and both stacks are as they were. */
  | { status: 'blocked' }
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
  /**
   * Register a veto over undo/redo. It runs after the flushes, with the step this press would
   * run (undefined when the stack is empty) and the direction; returning true blocks the press
   * with `{ status: 'blocked' }` and touches nothing. For rules about WHEN history may be walked
   * — a store holding unrecorded work, a markup session that owns the timeline — as opposed to
   * which steps exist. Returns the unregister.
   */
  registerGuard(guard: (step: UndoStep | undefined, direction: 'undo' | 'redo') => boolean): () => void;
  /**
   * Mark the history busy for work it does not own — a drag's own server save. undo/redo return
   * 'busy' until the returned release is called. The release is idempotent.
   */
  beginExternal(): () => void;
  /** True while an async step (a server save) is running or an external hold is open. */
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
  const guards = new Set<(step: UndoStep | undefined, direction: 'undo' | 'redo') => boolean>();
  // Open beginExternal() holds. A count, not a flag: two saves can overlap.
  let externalHolds = 0;

  const trim = () => {
    if (undoStack.length > capacity) undoStack.splice(0, undoStack.length - capacity);
  };

  const run = async (direction: 'undo' | 'redo'): Promise<UndoOutcome> => {
    if (busy || externalHolds > 0) return { status: 'busy' };
    for (const flush of Array.from(flushes)) flush();
    const source = direction === 'undo' ? undoStack : redoStack;
    const step = source[source.length - 1];
    // After the flushes, so a guard judges the step this press would really run.
    for (const guard of Array.from(guards)) if (guard(step, direction)) return { status: 'blocked' };
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
    registerGuard(guard) {
      guards.add(guard);
      return () => { guards.delete(guard); };
    },
    beginExternal() {
      externalHolds++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        externalHolds--;
      };
    },
    isBusy: () => busy || externalHolds > 0,
    depth: () => ({ undo: undoStack.length, redo: redoStack.length }),
  };
}
