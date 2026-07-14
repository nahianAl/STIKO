'use client';

import { useState, useRef, useCallback } from 'react';

export type AnnotationObjectType = 'freehand' | 'line' | 'arrow' | 'rect' | 'text';
export type AnnTool = 'pointer' | 'freehand' | 'line' | 'arrow' | 'rect' | 'text' | 'eraser';

export interface AnnotationObject {
  id: string;
  type: AnnotationObjectType;
  points: number[];               // freehand/line/arrow (flat [x,y,...], in object space)
  x: number; y: number;           // rect/text origin; drag offset for all types
  width: number; height: number;  // rect
  text: string; fontSize: number; // text
  rotation: number; scaleX: number; scaleY: number;
  color: string; strokeWidth: number;
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
    text: '', fontSize: 16, rotation: 0, scaleX: 1, scaleY: 1, color, strokeWidth,
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

  const endDraw = useCallback(() => {
    const d = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!d) return;
    const valid = d.type === 'freehand' ? d.points.length > 2
      : d.type === 'rect' ? Math.abs(d.width) > 3 && Math.abs(d.height) > 3
      : (d.type === 'line' || d.type === 'arrow') ? Math.hypot(d.points[2] - d.points[0], d.points[3] - d.points[1]) > 3
      : true;
    if (!valid) return;
    let obj = d;
    if (d.type === 'rect') {
      obj = { ...d, x: Math.min(d.x, d.x + d.width), y: Math.min(d.y, d.y + d.height), width: Math.abs(d.width), height: Math.abs(d.height) };
    }
    setObjects((prev) => [...prev, obj]);
  }, []);

  const addText = useCallback((p: { x: number; y: number }, text: string, color: string, strokeWidth: number, fontSize = 16) => {
    if (!text.trim()) return;
    const o = base('text', color, strokeWidth);
    o.x = p.x; o.y = p.y; o.text = text.trim(); o.fontSize = fontSize;
    setObjects((prev) => [...prev, o]);
  }, []);

  const updateObject = useCallback((id: string, patch: Partial<AnnotationObject>) => {
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }, []);

  const deleteObject = useCallback((id: string) => {
    setObjects((prev) => prev.filter((o) => o.id !== id));
    setSelectedId((s) => (s === id ? null : s));
  }, []);

  const clear = useCallback(() => {
    setObjects([]); setDraft(null); setSelectedId(null); draftRef.current = null;
  }, []);

  const hasObjects = useCallback(() => objects.length > 0, [objects]);

  return { objects, draft, selectedId, setSelectedId, startDraw, moveDraw, endDraw, addText, updateObject, deleteObject, clear, hasObjects };
}
