// lib/undo/shortcut.ts
// Which key events are undo/redo, and when the focused element owns them instead. Pure, for
// node --test.

export type UndoKey = 'undo' | 'redo' | null;

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}

/**
 * Either modifier works on either platform, so a Windows keyboard on a Mac (or the reverse)
 * still undoes. Ctrl+Y is redo only as Ctrl: Cmd+Y is the browser's history in Safari.
 * `key` is lower-cased because Shift reports a capital Z.
 */
export function undoKeyOf(e: KeyLike): UndoKey {
  if (e.isComposing || e.altKey || !(e.metaKey || e.ctrlKey)) return null;
  const k = e.key.toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && e.ctrlKey && !e.metaKey && !e.shiftKey) return 'redo';
  return null;
}

/**
 * A focused text field keeps the browser's own text undo: the comment composer, a rename, the
 * calibration panel, and the markup text editor (a textarea).
 */
export function ownsTextUndo(el: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}
