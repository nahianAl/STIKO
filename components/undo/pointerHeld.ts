'use client';

/**
 * Whether any pointer is held down anywhere in the window — mid-stroke, mid-drag, mid-gizmo,
 * mid-colour-picker. A checkpoint waits for this to be false, which is what folds one gesture's
 * many state writes (a group transform fires transformend once per node; a drag-erase deletes
 * one object per hit; a colour drag restyles every move) into one undo step.
 *
 * Capture-phase listeners on window, installed once on first use, so a handler that stops
 * propagation (Konva's cancelBubble, drei's pointer capture) cannot hide a press from it.
 * `blur` releases everything: a button released outside the browser window never sends
 * pointerup here, and a stuck "held" would block every checkpoint for the session.
 */
const down = new Set<number>();
const releaseListeners = new Set<() => void>();
let installed = false;

function release(pointerId?: number) {
  const wasHeld = down.size > 0;
  if (pointerId === undefined) down.clear();
  else down.delete(pointerId);
  if (wasHeld && down.size === 0) for (const cb of Array.from(releaseListeners)) cb();
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('pointerdown', (e) => { down.add(e.pointerId); }, true);
  window.addEventListener('pointerup', (e) => release(e.pointerId), true);
  window.addEventListener('pointercancel', (e) => release(e.pointerId), true);
  window.addEventListener('blur', () => release(), true);
}

export function isPointerHeld(): boolean {
  install();
  return down.size > 0;
}

/** Called each time the last held pointer is released. Returns the unsubscribe. */
export function onPointerRelease(cb: () => void): () => void {
  install();
  releaseListeners.add(cb);
  return () => { releaseListeners.delete(cb); };
}
