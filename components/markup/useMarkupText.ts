'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { normalizeBox, type Box, type Point } from '@/lib/markup/selection';
import { fontStepFromKey, isBlank, stepFontSize, textBoxFromGesture, type RectLike, type TextStyle } from '@/lib/markup/text';
import type { AnnotationObject, ToolType, useAnnotationObjects } from './useAnnotationObjects';

type Annotations = ReturnType<typeof useAnnotationObjects>;

const NO_IDS: readonly string[] = [];

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const h = el as HTMLElement;
  return h.tagName === 'INPUT' || h.tagName === 'TEXTAREA' || h.tagName === 'SELECT' || h.isContentEditable;
}

export interface MarkupTextOptions {
  /** The surface takes markup input at all (always on AnnotationCanvas; `annotating` on the PDF viewer). */
  enabled: boolean;
  activeTool: ToolType;
  /** The portal's "back to the Pointer". Called when a text is created, or opened with the Text tool. */
  onObjectCreated?: () => void;
  /** The surface's container. Enter-to-edit acts only when focus is on nothing or inside it. */
  containerRef?: RefObject<HTMLElement>;
}

/** Focus where Enter belongs to the focused thing itself: a button, a link, a menu item. */
function isActivatable(el: Element): boolean {
  return !!el.closest('button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [role="checkbox"], [role="switch"]');
}

/**
 * Everything about markup TEXT that both drawing surfaces share: creating by click or drag,
 * opening and finishing the editor, which texts the floating bar edits, and the keyboard
 * shortcuts. The surfaces keep only what differs between them — their coordinate space.
 */
export function useMarkupText(ann: Annotations, { enabled, activeTool, onObjectCreated, containerRef }: MarkupTextOptions) {
  const { objects, selectedIds, textOnlySelection, setSelectedId, addText, deleteObject, updateTextStyle } = ann;
  // The text currently open in the editor. The object itself already exists in `ann` — this is
  // only which one the editor is bound to.
  const [editingId, setEditingId] = useState<string | null>(null);
  // A drag or transform in flight: the bar hides.
  const [gesture, setGesture] = useState(false);
  // The live Text-tool drag, drawn as a selection-style box.
  const [createBox, setCreateBox] = useState<Box | null>(null);
  const startRef = useRef<Point | null>(null);
  const lastRef = useRef<Point | null>(null);

  // What the bar edits: the open text, or a selection made only of text.
  const targetIds: readonly string[] = editingId ? [editingId] : textOnlySelection ? selectedIds : NO_IDS;
  const targetObject: AnnotationObject | null = targetIds.length ? objects.find((o) => o.id === targetIds[0]) ?? null : null;

  // Read by handlers that are bound once (the window key listener) or must not change identity
  // on every keystroke (the PDF viewer's useCallback mouse handlers depend on them).
  const live = useRef({ editingId, objects, targetIds, activeTool, onObjectCreated });
  live.current = { editingId, objects, targetIds, activeTool, onObjectCreated };

  // The open text was deleted (or the markup cleared) from under the editor: unbind it, or the
  // bar and the Delete guard would go on treating a missing object as being edited.
  useEffect(() => {
    if (editingId && !objects.some((o) => o.id === editingId)) setEditingId(null);
  }, [editingId, objects]);

  /** Open a committed text, selected. Every way in — double-click, the Text tool, Enter — lands here. */
  const startEditing = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
    // The Text tool on an existing text: hand back to the Pointer, as a create does, or the click
    // that finishes this edit would start another box — and the surfaces clear the selection
    // whenever a non-Pointer tool is armed.
    if (live.current.activeTool !== 'pointer') live.current.onObjectCreated?.();
  }, [setSelectedId]);

  /** Finish editing. Blank text was a mis-click and goes; anything else stays SELECTED. */
  const commit = useCallback(() => {
    const id = live.current.editingId;
    if (!id) return;
    const obj = live.current.objects.find((o) => o.id === id);
    if (obj && isBlank(obj.text)) deleteObject(id);
    else setSelectedId(id);
    setEditingId(null);
  }, [deleteObject, setSelectedId]);

  const beginCreate = useCallback((p: Point) => {
    startRef.current = p;
    lastRef.current = p;
  }, []);

  const moveCreate = useCallback((p: Point) => {
    const s = startRef.current;
    if (!s) return;
    lastRef.current = p;
    setCreateBox(normalizeBox(s, p));
  }, []);

  /**
   * Finish a Text-tool press: a click is an auto-width box, a drag a fixed-width one as wide as
   * the drag (see textBoxFromGesture). `scale` is screen px per drawing unit; `bounds` is the
   * surface the box must stay on. A no-op (null) when no press is in flight, so a surface can
   * call it from every mouseup and mouseleave.
   */
  const endCreate = useCallback((style: { color: string; strokeWidth: number }, scale: number, bounds: RectLike): string | null => {
    const s = startRef.current;
    const e = lastRef.current;
    if (!s || !e) return null;
    startRef.current = null;
    lastRef.current = null;
    setCreateBox(null);
    const b = textBoxFromGesture(s, e, scale, bounds);
    const id = addText({ x: b.x, y: b.y }, { color: style.color, strokeWidth: style.strokeWidth, width: b.width, autoWidth: b.autoWidth });
    setEditingId(id);
    // Back to the Pointer at once: with the Text tool still armed, the click that finishes this
    // box would start another.
    live.current.onObjectCreated?.();
    return id;
  }, [addText]);

  /** Restyle the bar's targets — by default the current ones; a caller may pin the ids it saw. */
  const applyStyle = useCallback((patch: Partial<TextStyle>, ids: readonly string[] = live.current.targetIds) => {
    updateTextStyle(ids, patch);
  }, [updateTextStyle]);

  /** Every target steps from the FIRST one's size — the size the bar shows. */
  const stepFont = useCallback((dir: 1 | -1) => {
    const { targetIds: ids, objects: objs } = live.current;
    const first = objs.find((o) => o.id === ids[0]);
    if (first) updateTextStyle(ids, { fontSize: stepFontSize(first.fontSize, dir) });
  }, [updateTextStyle]);

  // Enter opens the one selected text; Cmd/Ctrl+Shift+> and < step the selected texts' size.
  // (While editing, the editor's own textarea handles both and stops the event.) Never while a
  // field has focus — the portal's comment box, the bar's size field — and Enter never from a
  // focused button, where Enter is that button's own click. Enter acts only when focus is on
  // nothing (the body) or inside this surface: a focused link or control elsewhere on the page
  // owns its own Enter.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const { editingId: editing, targetIds: ids } = live.current;
      if (editing || e.defaultPrevented || !ids.length) return;
      const el = document.activeElement;
      if (isTypingTarget(el)) return;
      const step = fontStepFromKey(e);
      if (step) {
        e.preventDefault();
        stepFont(step);
        return;
      }
      const container = containerRef?.current;
      const focusFree = !el || el === document.body || (!!container && container.contains(el) && !isActivatable(el));
      if (
        e.key === 'Enter' && ids.length === 1 && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey
        && !e.repeat && !e.isComposing && focusFree
      ) {
        // preventDefault also keeps this Enter from typing a newline into the editor it opens.
        e.preventDefault();
        startEditing(ids[0]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, stepFont, startEditing, containerRef]);

  return {
    editingId, setEditingId, startEditing, commit,
    createBox, beginCreate, moveCreate, endCreate,
    targetIds, targetObject, applyStyle, stepFont,
    gesture, setGesture,
  };
}
