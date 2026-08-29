'use client';

import { useState, useRef, useCallback } from 'react';
import { fontSizeForStrokeWidth, strokeWidthForFontSize, MIN_FONT_SIZE } from '@/lib/markup/text';

export type AnnotationObjectType = 'freehand' | 'line' | 'arrow' | 'rect' | 'text' | 'image';
export type AnnTool = 'pointer' | 'freehand' | 'line' | 'arrow' | 'rect' | 'text' | 'eraser';

/**
 * Everything the toolbar can have armed. One definition, imported by the toolbar, both
 * drawing surfaces and the portal page — it used to be hand-copied into four files, which
 * is one place to forget when a tool is added.
 *
 * 'comment' is the pin mode, which is a toolbar state but never an AnnTool: it places a
 * comment rather than drawing an object.
 */
export type ToolType = AnnTool | 'comment';

export interface AnnotationObject {
  id: string;
  type: AnnotationObjectType;
  points: number[];               // freehand/line/arrow (flat [x,y,...], in object space)
  x: number; y: number;           // rect/text origin; drag offset for all types
  width: number; height: number;  // rect
  text: string; fontSize: number; // text
  src: string;                    // image
  rotation: number; scaleX: number; scaleY: number;
  color: string; strokeWidth: number;
}

/** What a surface reports upward about its selection, so the toolbar can reflect it. */
export interface MarkupSelection {
  type: AnnotationObjectType;
  color: string;
  strokeWidth: number;
}

const GESTURE_TOOLS = new Set<AnnTool>(['freehand', 'line', 'arrow', 'rect']);

export function useAnnotationObjects() {
  const [objects, setObjects] = useState<AnnotationObject[]>([]);
  const [draft, setDraft] = useState<AnnotationObject | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const idRef = useRef(0);
  const draftRef = useRef<AnnotationObject | null>(null);

  const base = (type: AnnotationObjectType, color: string, strokeWidth: number): AnnotationObject => ({
    id: `obj-${idRef.current++}`, type, points: [], x: 0, y: 0, width: 0, height: 0,
    text: '', fontSize: 16, src: '', rotation: 0, scaleX: 1, scaleY: 1, color, strokeWidth,
  });

  const startDraw = useCallback((tool: AnnTool, p: { x: number; y: number }, color: string, strokeWidth: number) => {
    if (!GESTURE_TOOLS.has(tool)) return;
    const o = base(tool as AnnotationObjectType, color, strokeWidth);
    if (tool === 'freehand') o.points = [p.x, p.y];
    else if (tool === 'line' || tool === 'arrow') o.points = [p.x, p.y, p.x, p.y];
    else if (tool === 'rect') { o.x = p.x; o.y = p.y; }
    draftRef.current = o;
    setDraft(o);
  }, []);

  const moveDraw = useCallback((tool: AnnTool, p: { x: number; y: number }) => {
    const d = draftRef.current;
    if (!d) return;
    let next: AnnotationObject;
    if (tool === 'freehand') next = { ...d, points: [...d.points, p.x, p.y] };
    else if (tool === 'line' || tool === 'arrow') next = { ...d, points: [d.points[0], d.points[1], p.x, p.y] };
    else if (tool === 'rect') next = { ...d, width: p.x - d.x, height: p.y - d.y };
    else return;
    draftRef.current = next;
    setDraft(next);
  }, []);

  const endDraw = useCallback((): string | null => {
    const d = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!d) return null;
    const valid = d.type === 'freehand' ? d.points.length > 2
      : d.type === 'rect' ? Math.abs(d.width) > 3 && Math.abs(d.height) > 3
      : (d.type === 'line' || d.type === 'arrow') ? Math.hypot(d.points[2] - d.points[0], d.points[3] - d.points[1]) > 3
      : true;
    if (!valid) return null;
    let obj = d;
    if (d.type === 'rect') {
      obj = { ...d, x: Math.min(d.x, d.x + d.width), y: Math.min(d.y, d.y + d.height), width: Math.abs(d.width), height: Math.abs(d.height) };
    }
    setObjects((prev) => [...prev, obj]);
    setSelectedId(obj.id);
    return obj.id;
  }, []);

  /**
   * Creates the text object *before* anything is typed, so the editor can be bound to a real
   * object and every keystroke can write through to it. That is what puts the text where it
   * will land rather than in a popup somewhere else — and it is why this no longer rejects
   * empty text. Discarding a blank box is the caller's job, on commit.
   */
  const addText = useCallback(
    (p: { x: number; y: number }, opts: { text?: string; color: string; fontSize: number; width: number }): string => {
      const o = base('text', opts.color, strokeWidthForFontSize(opts.fontSize));
      o.x = p.x;
      o.y = p.y;
      o.text = opts.text ?? '';
      o.fontSize = opts.fontSize;
      o.width = opts.width;
      setObjects((prev) => [...prev, o]);
      setSelectedId(o.id);
      return o.id;
    },
    []
  );

  const addImage = useCallback((p: { x: number; y: number }, src: string, width: number, height: number) => {
    const o = base('image', '#000000', 0);
    o.x = p.x; o.y = p.y; o.src = src; o.width = width; o.height = height;
    setObjects((prev) => [...prev, o]);
    setSelectedId(o.id);
    return o.id;
  }, []);

  const updateObject = useCallback((id: string, patch: Partial<AnnotationObject>) => {
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }, []);

  /** Write-through from the text editor. Separate from updateObject so the editor cannot
   *  accidentally clobber geometry it does not own. */
  const updateText = useCallback((id: string, text: string) => {
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, text } : o)));
  }, []);

  /**
   * Restyle an existing object. The type decides what a stroke width means: on text it is a
   * font size, on an image it means nothing at all.
   */
  const applyStyle = useCallback((id: string, patch: { color?: string; strokeWidth?: number }) => {
    setObjects((prev) =>
      prev.map((o) => {
        if (o.id !== id || o.type === 'image') return o;
        const next = { ...o };
        if (patch.color !== undefined) next.color = patch.color;
        if (patch.strokeWidth !== undefined) {
          next.strokeWidth = patch.strokeWidth;
          if (o.type === 'text') next.fontSize = fontSizeForStrokeWidth(patch.strokeWidth);
        }
        return next;
      })
    );
  }, []);

  /**
   * Folds a text object's transform scale into its font size and wrap width, resetting the
   * scale to 1.
   *
   * Without this the Transformer's scaleX/scaleY would multiply against the font-size presets:
   * a box dragged to 2x and then set to "Thick" would render at 68px rather than 34px. Baking
   * keeps the presets absolute. strokeWidth follows the new size so the toolbar highlights the
   * right chip after a manual resize.
   */
  const bakeTextTransform = useCallback(
    (id: string, t: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }) => {
      setObjects((prev) =>
        prev.map((o) => {
          if (o.id !== id) return o;
          const fontSize = Math.max(MIN_FONT_SIZE, o.fontSize * t.scaleY);
          return {
            ...o,
            x: t.x,
            y: t.y,
            rotation: t.rotation,
            scaleX: 1,
            scaleY: 1,
            fontSize,
            width: Math.max(1, o.width * t.scaleX),
            strokeWidth: strokeWidthForFontSize(fontSize),
          };
        })
      );
    },
    []
  );

  const deleteObject = useCallback((id: string) => {
    setObjects((prev) => prev.filter((o) => o.id !== id));
    setSelectedId((s) => (s === id ? null : s));
  }, []);

  const clear = useCallback(() => {
    setObjects([]); setDraft(null); setSelectedId(null); draftRef.current = null;
  }, []);

  const hasObjects = useCallback(() => objects.length > 0, [objects]);

  // Derived rather than stored, so it can never disagree with `objects`. Consumers must depend
  // on its FIELDS, not its identity — `find` returns a fresh reference on every render.
  const selectedObject = objects.find((o) => o.id === selectedId) ?? null;

  return {
    objects, draft, selectedId, setSelectedId, selectedObject,
    startDraw, moveDraw, endDraw, addText, addImage,
    updateObject, updateText, applyStyle, bakeTextTransform,
    deleteObject, clear, hasObjects,
  };
}
