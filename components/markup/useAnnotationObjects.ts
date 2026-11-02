'use client';

import { useState, useRef, useCallback } from 'react';
import {
  DEFAULT_TEXT_STYLE,
  MIN_TEXT_WIDTH,
  clampFontSize,
  scaledTextOnCorner,
  textPadding,
  widthOnSideDrag,
  type TextAlign,
  type TextStyle,
} from '@/lib/markup/text';
import { startGeometry, updateGeometry, isBoxTool, type DraftTool } from '@/lib/markup/draft';
import { pickId, mergeSelection } from '@/lib/markup/selection';

export type AnnotationObjectType = 'freehand' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloud' | 'text' | 'image';
export type AnnTool = 'pointer' | 'freehand' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloud' | 'text' | 'eraser';

/** The three measure-tool modes. Not AnnTools: they create no markup object and carry no style. */
export type MeasureTool = 'measure' | 'angle' | 'calibrate';

export const MEASURE_TOOLS: readonly MeasureTool[] = ['measure', 'angle', 'calibrate'];

/**
 * Everything the toolbar can have armed. One definition, imported by the toolbar, both
 * drawing surfaces and the portal page — it used to be hand-copied into four files, which
 * is one place to forget when a tool is added.
 *
 * 'comment' is the pin mode, which is a toolbar state but never an AnnTool: it places a
 * comment rather than drawing an object. The measure tools are the same kind of exception —
 * they produce measurements, which are their own layer with no colour and no stroke width, so
 * they must never reach the markup style model.
 */
export type ToolType = AnnTool | 'comment' | MeasureTool;

export function isMeasureTool(tool: ToolType): tool is MeasureTool {
  return (MEASURE_TOOLS as readonly string[]).includes(tool);
}

export interface AnnotationObject {
  id: string;
  type: AnnotationObjectType;
  points: number[];               // freehand/line/arrow (flat [x,y,...], in object space)
  x: number; y: number;           // rect/text origin; drag offset for all types
  width: number; height: number;  // rect; on text, the box's OUTER width (ignored while autoWidth)
  text: string; fontSize: number; // text
  // Text style (the floating bar). Non-text objects carry DEFAULT_TEXT_STYLE's values and never
  // read them, so every object has one shape.
  bold: boolean; italic: boolean; align: TextAlign;
  fill: string;                   // '' = no fill
  border: boolean;
  autoWidth: boolean;             // no wrapping; the box hugs its longest line
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

const GESTURE_TOOLS = new Set<AnnTool>(['freehand', 'line', 'arrow', 'rect', 'ellipse', 'cloud']);

export function useAnnotationObjects() {
  const [objects, setObjects] = useState<AnnotationObject[]>([]);
  const [draft, setDraft] = useState<AnnotationObject | null>(null);
  // Ordered; the first id is the "primary" the toolbar reflects. A list rather than one id so
  // Shift+click and the selection box can hold several objects at once.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedId = selectedIds[0] ?? null;
  /** Replace the selection with one object, or clear it. The single-object API every caller had. */
  const setSelectedId = useCallback((id: string | null) => setSelectedIds(id ? [id] : []), []);
  /** A press on an object with the Pointer: see pickId. */
  const pick = useCallback((id: string, additive: boolean) => setSelectedIds((ids) => pickId(ids, id, additive)), []);
  /** The selection box's hits: see mergeSelection. */
  const selectMany = useCallback((ids: string[], additive: boolean) => setSelectedIds((cur) => mergeSelection(cur, ids, additive)), []);
  const idRef = useRef(0);
  const draftRef = useRef<AnnotationObject | null>(null);

  const base = (type: AnnotationObjectType, color: string, strokeWidth: number): AnnotationObject => ({
    id: `obj-${idRef.current++}`, type, points: [], x: 0, y: 0, width: 0, height: 0,
    text: '', fontSize: DEFAULT_TEXT_STYLE.fontSize,
    bold: DEFAULT_TEXT_STYLE.bold, italic: DEFAULT_TEXT_STYLE.italic, align: DEFAULT_TEXT_STYLE.align,
    fill: DEFAULT_TEXT_STYLE.fill, border: DEFAULT_TEXT_STYLE.border, autoWidth: false,
    src: '', rotation: 0, scaleX: 1, scaleY: 1, color, strokeWidth,
  });

  const startDraw = useCallback((tool: AnnTool, p: { x: number; y: number }, color: string, strokeWidth: number) => {
    if (!GESTURE_TOOLS.has(tool)) return;
    const o = { ...base(tool as AnnotationObjectType, color, strokeWidth), ...startGeometry(tool as DraftTool, p) };
    draftRef.current = o;
    setDraft(o);
  }, []);

  /**
   * `constrain` is the Shift key, read fresh off each pointer event by the surface. Optional
   * so a caller that does not care (a test, a surface not yet wired) behaves as before.
   */
  const moveDraw = useCallback((tool: AnnTool, p: { x: number; y: number }, constrain = false) => {
    const d = draftRef.current;
    if (!d || !GESTURE_TOOLS.has(tool)) return;
    const next = { ...d, ...updateGeometry(tool as DraftTool, d, p, constrain) };
    draftRef.current = next;
    setDraft(next);
  }, []);

  const endDraw = useCallback((): string | null => {
    const d = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!d) return null;
    const valid = d.type === 'freehand' ? d.points.length > 2
      : isBoxTool(d.type) ? Math.abs(d.width) > 3 && Math.abs(d.height) > 3
      : (d.type === 'line' || d.type === 'arrow') ? Math.hypot(d.points[2] - d.points[0], d.points[3] - d.points[1]) > 3
      : true;
    if (!valid) return null;
    let obj = d;
    if (isBoxTool(d.type)) {
      obj = { ...d, x: Math.min(d.x, d.x + d.width), y: Math.min(d.y, d.y + d.height), width: Math.abs(d.width), height: Math.abs(d.height) };
    }
    setObjects((prev) => [...prev, obj]);
    setSelectedIds([obj.id]);
    return obj.id;
  }, []);

  /**
   * Creates the text object *before* anything is typed, so the editor can be bound to a real
   * object and every keystroke can write through to it. That is what puts the text where it
   * will land rather than in a popup somewhere else — and it is why this no longer rejects
   * empty text. Discarding a blank box is the caller's job, on commit.
   *
   * Always at DEFAULT_TEXT_STYLE: the size lives in the floating bar now, not in the toolbar's
   * stroke width. `strokeWidth` is stored only so a selected text reports something sane to the
   * toolbar; nothing draws with it.
   */
  const addText = useCallback(
    (p: { x: number; y: number }, opts: { text?: string; color: string; strokeWidth: number; width: number; autoWidth: boolean }): string => {
      const o = base('text', opts.color, opts.strokeWidth);
      o.x = p.x;
      o.y = p.y;
      o.text = opts.text ?? '';
      o.autoWidth = opts.autoWidth;
      o.width = opts.autoWidth ? 0 : Math.max(MIN_TEXT_WIDTH, opts.width);
      setObjects((prev) => [...prev, o]);
      setSelectedIds([o.id]);
      return o.id;
    },
    []
  );

  const addImage = useCallback((p: { x: number; y: number }, src: string, width: number, height: number) => {
    const o = base('image', '#000000', 0);
    o.x = p.x; o.y = p.y; o.src = src; o.width = width; o.height = height;
    setObjects((prev) => [...prev, o]);
    setSelectedIds([o.id]);
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
   * Restyle an existing object from the main toolbar. A colour recolours anything but an image.
   * A stroke width means nothing to a text (its size is the floating bar's) or to an image.
   */
  const applyStyle = useCallback((id: string, patch: { color?: string; strokeWidth?: number }) => {
    setObjects((prev) =>
      prev.map((o) => {
        if (o.id !== id || o.type === 'image') return o;
        const next = { ...o };
        if (patch.color !== undefined) next.color = patch.color;
        if (patch.strokeWidth !== undefined && o.type !== 'text') next.strokeWidth = patch.strokeWidth;
        return next;
      })
    );
  }, []);

  /** Restyle every selected object (see applyStyle for what each type takes). */
  const applyStyleToSelected = useCallback((patch: { color?: string; strokeWidth?: number }) => {
    for (const id of selectedIds) applyStyle(id, patch);
  }, [selectedIds, applyStyle]);

  /**
   * The floating text bar. Text objects only — an id of anything else is skipped, so a caller
   * can pass a whole selection. Field by field rather than a spread, so a patch carrying an
   * explicit `undefined` cannot blank a field.
   */
  const updateTextStyle = useCallback((ids: readonly string[], patch: Partial<TextStyle>) => {
    const want = new Set(ids);
    setObjects((prev) =>
      prev.map((o) => {
        if (!want.has(o.id) || o.type !== 'text') return o;
        const next = { ...o };
        if (patch.fontSize !== undefined) next.fontSize = clampFontSize(patch.fontSize);
        if (patch.bold !== undefined) next.bold = patch.bold;
        if (patch.italic !== undefined) next.italic = patch.italic;
        if (patch.align !== undefined) next.align = patch.align;
        if (patch.fill !== undefined) next.fill = patch.fill;
        if (patch.border !== undefined) next.border = patch.border;
        return next;
      })
    );
  }, []);

  /** A side-handle drag: the box is now this wide and wraps. An auto-width box becomes fixed. */
  const setTextWidth = useCallback((id: string, width: number) => {
    setObjects((prev) =>
      prev.map((o) => (o.id === id && o.type === 'text' ? { ...o, width: Math.max(MIN_TEXT_WIDTH, width), autoWidth: false } : o))
    );
  }, []);

  /**
   * Folds a text object's transform scale into its font size and wrap width, resetting the
   * scale to 1, so a stored scale can never multiply against a size set from the bar later.
   *
   * Corner drags (keepRatio) and even group scales arrive with scaleX === scaleY: the font and
   * width scale together. A group's SIDE anchor stretches one axis only (Konva ignores keepRatio
   * there), and the wrap width then follows the horizontal scale on its own. An auto-width text
   * has no wrap width to scale: it re-measures around its new font size.
   */
  const bakeTextTransform = useCallback(
    (id: string, t: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }) => {
      setObjects((prev) =>
        prev.map((o) => {
          if (o.id !== id) return o;
          const sx = Math.abs(t.scaleX) || 1;
          const sy = Math.abs(t.scaleY) || 1;
          const corner = scaledTextOnCorner(o.fontSize, o.width, sy, textPadding(o));
          // A lone text's corner drag is re-laid-out live (AnnotationObjects) and arrives here with
          // the factor its live font got, so this reproduces what is on screen. A group scale
          // still scales a boxed member's padding mid-drag; after the bake it is constant again.
          // Auto-width has no wrap width to scale.
          const width = o.autoWidth ? o.width : Math.abs(sx - sy) < 1e-3 ? corner.width : widthOnSideDrag(o.width, sx);
          return {
            ...o,
            x: t.x,
            y: t.y,
            rotation: t.rotation,
            scaleX: 1,
            scaleY: 1,
            fontSize: corner.fontSize,
            width,
          };
        })
      );
    },
    []
  );

  const deleteObject = useCallback((id: string) => {
    setObjects((prev) => prev.filter((o) => o.id !== id));
    setSelectedIds((ids) => ids.filter((i) => i !== id));
  }, []);

  /** Delete every selected object. */
  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    const drop = new Set(selectedIds);
    setObjects((prev) => prev.filter((o) => !drop.has(o.id)));
    setSelectedIds([]);
  }, [selectedIds]);

  const clear = useCallback(() => {
    setObjects([]); setDraft(null); setSelectedIds([]); draftRef.current = null;
  }, []);

  const hasObjects = useCallback(() => objects.length > 0, [objects]);

  // Derived rather than stored, so it can never disagree with `objects`. Consumers must depend
  // on its FIELDS, not its identity — `find` returns a fresh reference on every render.
  const selectedObject = objects.find((o) => o.id === selectedId) ?? null;

  const selectedObjects = selectedIds
    .map((id) => objects.find((o) => o.id === id))
    .filter((o): o is AnnotationObject => !!o);
  /** Selected, and every selected object is a text: the floating bar's case. */
  const textOnlySelection = selectedObjects.length > 0 && selectedObjects.every((o) => o.type === 'text');
  /**
   * What the main toolbar reflects. The primary — unless the selection mixes text with other
   * objects, when it is the first non-text member: the toolbar hides its stroke picker for
   * 'text', and in a mixed selection that picker still has shapes to restyle. Same identity rule
   * as selectedObject: depend on its fields.
   */
  const toolbarObject = textOnlySelection ? selectedObject : selectedObjects.find((o) => o.type !== 'text') ?? null;

  return {
    objects, draft, selectedIds, selectedId, setSelectedId, pick, selectMany, selectedObject,
    textOnlySelection, toolbarObject,
    startDraw, moveDraw, endDraw, addText, addImage,
    updateObject, updateText, applyStyle, applyStyleToSelected, bakeTextTransform,
    updateTextStyle, setTextWidth,
    deleteObject, deleteSelected, clear, hasObjects,
  };
}
