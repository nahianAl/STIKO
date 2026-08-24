# Annotation Editing (Select / Move / Scale / Rotate / Erase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add object eraser and select→move/scale/rotate to annotations across all file types by unifying annotation objects onto Konva.

**Architecture:** A shared Konva object model + interaction hook (`useAnnotationObjects`) and a shared renderer (`AnnotationObjects`, which includes a Konva `Transformer`) are used by two hosts: a new `AnnotationCanvas` (Konva stage over the frozen snapshot, for image/video/3D) and the existing `PDFKonvaViewer` stage (for PDF). Annotations stay ephemeral and are flattened to a JPEG via `stage.toDataURL` on Done. The portal owns an explicit `annotating` session flag; Pointer selects within a session, and Done/Discard are the only exits.

**Tech Stack:** Next.js 14 client components, React 18, TypeScript, Konva 10.2.3 / react-konva 18.2.14 (Transformer), Tailwind.

## Global Constraints

- **No test runner exists. Do NOT add one.** Per-task gate: `npx tsc --noEmit` + `npm run lint` (from project root), both must pass before commit; `npm run build` as integration check. Behavioral checks are manual (assume a working dev env; the app needs `DATABASE_URL` + `R2_*` to serve any page — the type/lint/build gate stands in when env is absent).
- **Ephemeral only:** annotation objects are never persisted (no DB, no `/api/markups`). They exist during a session and are flattened into a JPEG comment attachment on Done.
- **Ids:** annotation object ids use a per-session incrementing counter (`obj-${n}`), NOT `Date.now()`/`Math.random()`.
- **Capture:** always deselect (detach the Transformer synchronously) before `stage.toDataURL({ pixelRatio: 2, mimeType: 'image/jpeg', quality: 0.88 })`, so handles never appear in the flattened image.
- **`ToolType`** gains `'eraser'` in every file that declares the union; the unused `'comment'` literal stays. `DRAW_TOOLS` (session-starters) = `freehand/line/arrow/rect/text`; `pointer` and `eraser` never start a session.
- **Styling scope:** color/stroke apply to NEW objects only. No re-styling, multi-select, undo/redo, or PDF multi-page-per-session this pass.

---

## File Structure

**Create:**
- `components/markup/useAnnotationObjects.ts` — object model + state + draw-gesture/CRUD logic + capture-time helpers. One responsibility: manage the session's annotation objects.
- `components/markup/AnnotationObjects.tsx` — shared Konva renderer for objects + in-progress draft + the `Transformer`. Placed inside a host's `<Layer>`.
- `components/markup/AnnotationCanvas.tsx` — non-PDF Konva editing surface (stage + frozen-snapshot background + `AnnotationObjects` + stage event wiring + text popup + imperative capture handle).

**Modify:**
- `components/markup/DrawingTools.tsx` — add Eraser tool; `ToolType += 'eraser'`.
- `components/viewers/ViewerContainer.tsx` — `ToolType += 'eraser'`; add `annotating` pass-through to PDF.
- `components/viewers/PDFKonvaViewer.tsx` — replace ephemeral per-page markups with the shared core + Transformer + eraser; `annotating` prop drives pointer=select; deselect-before-capture.
- `components/markup/MarkupOverlay.tsx` — remove drawing; keep comment pins + tagging.
- `app/portal/[id]/page.tsx` — explicit `annotating` session state; mount `AnnotationCanvas` for non-PDF sessions; Done/Discard capture routing; remove `compositeSnapshotWithMarkup`; `ToolType += 'eraser'`.

---

## Task 1: Eraser tool + `ToolType` extension

**Files:**
- Modify: `components/markup/DrawingTools.tsx`
- Modify: `components/markup/MarkupOverlay.tsx` (ToolType only)
- Modify: `components/viewers/PDFKonvaViewer.tsx` (ToolType only)
- Modify: `components/viewers/ViewerContainer.tsx` (ToolType only)
- Modify: `app/portal/[id]/page.tsx` (ToolType only)

**Interfaces:**
- Produces: `ToolType` includes `'eraser'` everywhere; toolbar shows an Eraser button that calls `onToolChange('eraser')`.

- [ ] **Step 1: Extend `ToolType` in all five files**

In each of these files, find the line:
```ts
type ToolType = 'pointer' | 'comment' | 'freehand' | 'line' | 'arrow' | 'rect' | 'text';
```
and change it to:
```ts
type ToolType = 'pointer' | 'comment' | 'freehand' | 'line' | 'arrow' | 'rect' | 'text' | 'eraser';
```
Files: `components/markup/DrawingTools.tsx`, `components/markup/MarkupOverlay.tsx`, `components/viewers/PDFKonvaViewer.tsx`, `components/viewers/ViewerContainer.tsx`, `app/portal/[id]/page.tsx`.

- [ ] **Step 2: Add the Eraser tool button in `DrawingTools`**

In `components/markup/DrawingTools.tsx`, add an eraser entry to `STANDALONE_TOOLS` (after the `text` entry):
```tsx
  {
    id: 'eraser',
    label: 'Eraser',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 20H7L3 16a2 2 0 0 1 0-3l9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8" />
        <line x1="8" y1="9" x2="15" y2="16" />
      </svg>
    ),
  },
```

- [ ] **Step 3: Typecheck & lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. (The `'eraser'` value is now selectable but not yet handled anywhere — that's wired in Tasks 3–4.)

- [ ] **Step 4: Behavioral check (if dev env available)**

Open a portal file, open the toolbar: an Eraser button appears alongside pointer/freehand/text/shapes. Clicking it highlights it (no other effect yet).

- [ ] **Step 5: Commit**

```bash
git add components/markup/DrawingTools.tsx components/markup/MarkupOverlay.tsx components/viewers/PDFKonvaViewer.tsx components/viewers/ViewerContainer.tsx app/portal/\[id\]/page.tsx
git commit -m "feat(annotations): add Eraser tool to toolbar + ToolType"
```

---

## Task 2: Shared annotation core (`useAnnotationObjects` + `AnnotationObjects`)

**Files:**
- Create: `components/markup/useAnnotationObjects.ts`
- Create: `components/markup/AnnotationObjects.tsx`

**Interfaces:**
- Produces:
  - `useAnnotationObjects()` → `{ objects, draft, selectedId, setSelectedId, startDraw, moveDraw, endDraw, addText, updateObject, deleteObject, clear, hasObjects }`.
  - Types `AnnotationObject`, `AnnotationObjectType`, `AnnTool`.
  - `<AnnotationObjects objects draft selectedId activeTool onSelect onErase onChange />` — renders Konva shapes + draft + Transformer; place inside a `<Layer>`.
- Consumes: nothing (pure logic + Konva render). Exercised by Tasks 3 and 4.

- [ ] **Step 1: Create the hook**

Create `components/markup/useAnnotationObjects.ts`:
```ts
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
```

- [ ] **Step 2: Create the shared renderer**

Create `components/markup/AnnotationObjects.tsx`:
```tsx
'use client';

import { useEffect, useRef } from 'react';
import { Line, Arrow, Rect, Text, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { AnnotationObject, AnnTool } from './useAnnotationObjects';

interface AnnotationObjectsProps {
  objects: AnnotationObject[];
  draft: AnnotationObject | null;
  selectedId: string | null;
  activeTool: AnnTool;
  onSelect: (id: string) => void;
  onErase: (id: string) => void;
  onChange: (id: string, patch: Partial<AnnotationObject>) => void;
}

export default function AnnotationObjects({ objects, draft, selectedId, activeTool, onSelect, onErase, onChange }: AnnotationObjectsProps) {
  const trRef = useRef<Konva.Transformer>(null);

  // Bind the Transformer to the selected node
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const stage = tr.getStage();
    const node = selectedId && stage ? stage.findOne(`#${selectedId}`) : null;
    tr.nodes(node ? [node as Konva.Node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, objects, activeTool]);

  // Object click: select (pointer) or erase; ignored for draw tools so you can draw over objects
  const handleObj = (e: Konva.KonvaEventObject<MouseEvent>, id: string) => {
    if (activeTool === 'eraser') { e.cancelBubble = true; onErase(id); }
    else if (activeTool === 'pointer') { e.cancelBubble = true; onSelect(id); }
  };

  const renderObj = (obj: AnnotationObject, isDraft: boolean) => {
    const common = {
      id: obj.id,
      x: obj.x,
      y: obj.y,
      rotation: obj.rotation,
      scaleX: obj.scaleX,
      scaleY: obj.scaleY,
      draggable: !isDraft && activeTool === 'pointer',
      onMouseDown: isDraft ? undefined : (e: Konva.KonvaEventObject<MouseEvent>) => handleObj(e, obj.id),
      onTap: isDraft ? undefined : (e: Konva.KonvaEventObject<MouseEvent>) => handleObj(e, obj.id),
      onDragEnd: isDraft ? undefined : (e: Konva.KonvaEventObject<DragEvent>) => onChange(obj.id, { x: e.target.x(), y: e.target.y() }),
      onTransformEnd: isDraft ? undefined : (e: Konva.KonvaEventObject<Event>) => {
        const n = e.target;
        onChange(obj.id, { x: n.x(), y: n.y(), rotation: n.rotation(), scaleX: n.scaleX(), scaleY: n.scaleY() });
      },
    };
    const hit = Math.max(obj.strokeWidth, 12);
    switch (obj.type) {
      case 'freehand':
        return <Line key={obj.id} {...common} points={obj.points} stroke={obj.color} strokeWidth={obj.strokeWidth} lineCap="round" lineJoin="round" tension={0.4} hitStrokeWidth={hit} />;
      case 'line':
        return <Line key={obj.id} {...common} points={obj.points} stroke={obj.color} strokeWidth={obj.strokeWidth} lineCap="round" hitStrokeWidth={hit} />;
      case 'arrow':
        return <Arrow key={obj.id} {...common} points={obj.points} stroke={obj.color} fill={obj.color} strokeWidth={obj.strokeWidth} pointerLength={10} pointerWidth={8} hitStrokeWidth={hit} />;
      case 'rect':
        return <Rect key={obj.id} {...common} width={obj.width} height={obj.height} stroke={obj.color} strokeWidth={obj.strokeWidth} />;
      case 'text':
        return <Text key={obj.id} {...common} text={obj.text} fontSize={obj.fontSize} fill={obj.color} fontStyle="bold" />;
      default:
        return null;
    }
  };

  return (
    <>
      {objects.map((o) => renderObj(o, false))}
      {draft && renderObj(draft, true)}
      <Transformer
        ref={trRef}
        rotateEnabled
        keepRatio={false}
        ignoreStroke
        boundBoxFunc={(oldBox, newBox) => (newBox.width < 5 || newBox.height < 5 ? oldBox : newBox)}
      />
    </>
  );
}
```

- [ ] **Step 3: Typecheck & lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS (new files compile; not yet imported).

- [ ] **Step 4: Commit**

```bash
git add components/markup/useAnnotationObjects.ts components/markup/AnnotationObjects.tsx
git commit -m "feat(annotations): shared Konva object model + renderer with Transformer"
```

---

## Task 3: `AnnotationCanvas` + portal session lifecycle (non-PDF)

**Files:**
- Create: `components/markup/AnnotationCanvas.tsx`
- Modify: `app/portal/[id]/page.tsx`

**Interfaces:**
- Consumes: `useAnnotationObjects`, `AnnotationObjects`, `dataUrlToFile` (`@/lib/uploadAttachment`), `captureViewerSnapshot` (existing in portal).
- Produces: `AnnotationCanvasHandle = { captureSnapshot(): string | null; clear(): void; hasObjects(): boolean }`; `<AnnotationCanvas backgroundDataUrl activeTool color strokeWidth handleRef />`.

- [ ] **Step 1: Create `AnnotationCanvas`**

Create `components/markup/AnnotationCanvas.tsx`:
```tsx
'use client';

import { useEffect, useRef, useState, useImperativeHandle, type Ref } from 'react';
import { Stage, Layer, Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import { useAnnotationObjects, type AnnTool } from './useAnnotationObjects';
import AnnotationObjects from './AnnotationObjects';

export interface AnnotationCanvasHandle {
  captureSnapshot: () => string | null;
  clear: () => void;
  hasObjects: () => boolean;
}

interface AnnotationCanvasProps {
  backgroundDataUrl: string | null;
  activeTool: AnnTool;
  color: string;
  strokeWidth: number;
  handleRef?: Ref<AnnotationCanvasHandle>;
}

export default function AnnotationCanvas({ backgroundDataUrl, activeTool, color, strokeWidth, handleRef }: AnnotationCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [textPopup, setTextPopup] = useState<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState('');

  const ann = useAnnotationObjects();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!backgroundDataUrl) { setBgImage(null); return; }
    const img = new window.Image();
    img.onload = () => setBgImage(img);
    img.src = backgroundDataUrl;
  }, [backgroundDataUrl]);

  useImperativeHandle(handleRef, () => ({
    captureSnapshot: () => {
      const stage = stageRef.current;
      if (!stage) return null;
      stage.find('Transformer').forEach((t) => (t as Konva.Transformer).nodes([]));
      stage.draw();
      const url = stage.toDataURL({ pixelRatio: 2, mimeType: 'image/jpeg', quality: 0.88 });
      ann.setSelectedId(null);
      return url;
    },
    clear: () => ann.clear(),
    hasObjects: () => ann.hasObjects(),
  }));

  // Fit the background image within the stage, centered (letterbox), so the drawn snapshot matches what was on screen.
  const bgFit = (() => {
    if (!bgImage || !size.width || !size.height) return null;
    const scale = Math.min(size.width / bgImage.width, size.height / bgImage.height);
    const w = bgImage.width * scale;
    const h = bgImage.height * scale;
    return { x: (size.width - w) / 2, y: (size.height - h) / 2, width: w, height: h };
  })();

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const p = stage.getPointerPosition();
    if (!p) return;
    if (activeTool === 'text') { setTextPopup({ x: p.x, y: p.y }); setTextInput(''); return; }
    if (activeTool === 'pointer') { if (e.target === stage) ann.setSelectedId(null); return; }
    if (activeTool === 'eraser') return;
    ann.startDraw(activeTool, p, color, strokeWidth);
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const p = e.target.getStage()?.getPointerPosition();
    if (p) ann.moveDraw(activeTool, p);
  };

  const submitText = () => {
    if (textPopup && textInput.trim()) ann.addText(textPopup, textInput, color, strokeWidth);
    setTextPopup(null); setTextInput('');
  };

  const cursor = activeTool === 'pointer' ? 'default' : activeTool === 'eraser' ? 'not-allowed' : 'crosshair';

  return (
    <div ref={containerRef} className="absolute inset-0 bg-gray-900" style={{ cursor }}>
      {size.width > 0 && size.height > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={() => ann.endDraw()}
          onMouseLeave={() => ann.endDraw()}
        >
          <Layer listening={false}>
            {bgImage && bgFit && <KonvaImage image={bgImage} x={bgFit.x} y={bgFit.y} width={bgFit.width} height={bgFit.height} />}
          </Layer>
          <Layer>
            <AnnotationObjects
              objects={ann.objects}
              draft={ann.draft}
              selectedId={ann.selectedId}
              activeTool={activeTool}
              onSelect={ann.setSelectedId}
              onErase={ann.deleteObject}
              onChange={ann.updateObject}
            />
          </Layer>
        </Stage>
      )}

      {textPopup && (
        <div
          className="absolute z-30 bg-white rounded-lg shadow-lg border border-gray-200 p-2"
          style={{ left: Math.min(textPopup.x, size.width - 200), top: Math.min(textPopup.y, size.height - 80) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            autoFocus
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Type text..."
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500"
            style={{ minWidth: 150 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitText(); }
              if (e.key === 'Escape') { setTextPopup(null); setTextInput(''); }
            }}
          />
          <div className="flex justify-end gap-1.5 mt-1.5">
            <button onClick={() => { setTextPopup(null); setTextInput(''); }} className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
            <button onClick={submitText} disabled={!textInput.trim()} className="px-2.5 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">Add</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Portal — imports and session state**

In `app/portal/[id]/page.tsx`, add imports (with the existing markup imports near the top). **`AnnotationCanvas` MUST be loaded via `next/dynamic` with `ssr: false`** — it uses `react-konva`, which cannot be server-rendered (this is why `PDFKonvaViewer` is also dynamically imported in `ViewerContainer`). A static import would pull `react-konva` into the SSR bundle and break `npm run build`:
```ts
import dynamic from 'next/dynamic';
const AnnotationCanvas = dynamic(() => import('@/components/markup/AnnotationCanvas'), { ssr: false });
import type { AnnotationCanvasHandle } from '@/components/markup/AnnotationCanvas';
```
The `import type { AnnotationCanvasHandle }` is type-only (erased at build), so it does not pull the runtime module into SSR. Because `dynamic()` drops React `ref`, `AnnotationCanvas` receives its imperative handle via the `handleRef` **prop** (already designed that way in Task 3 Step 1). If the portal already imports `next/dynamic`, don't duplicate the import. (`dataUrlToFile` is already imported from `@/lib/uploadAttachment`; leave it.)

Add state next to `viewerSnapshot` (after the `const [viewportImage, ...]` line):
```ts
  const [annotating, setAnnotating] = useState(false);
  const annotationCanvasRef = useRef<AnnotationCanvasHandle>(null);
```

- [ ] **Step 3: Portal — replace the snapshot-capture effect with a session-start effect**

Replace the existing effect (the one starting `// Freeze a snapshot when entering a draw tool`) — currently:
```ts
  useEffect(() => {
    const prevTool = prevActiveToolRef.current;
    prevActiveToolRef.current = activeTool;

    if (!DRAW_TOOLS.includes(activeTool)) {
      setViewerSnapshot(null);
      markupOverlayRef.current?.clearDrawings();
      pdfKonvaRef.current?.clearDrawings();
      return;
    }
    if (isPDFFile) return;
    if (DRAW_TOOLS.includes(prevTool)) return; // snapshot already captured

    const container = viewerAreaRef.current;
    if (!container) return;
    const snapshot = captureViewerSnapshot(container);
    if (snapshot) setViewerSnapshot(snapshot);
  }, [activeTool, isPDFFile]);
```
with:
```ts
  // Start an annotation session when a draw tool is picked (only session-starter).
  useEffect(() => {
    if (annotating) return;
    if (!DRAW_TOOLS.includes(activeTool)) return;
    setAnnotating(true);
    if (!isPDFFile) {
      const container = viewerAreaRef.current;
      const snapshot = container ? captureViewerSnapshot(container) : null;
      setViewerSnapshot(snapshot);
    }
  }, [activeTool, annotating, isPDFFile]);
```
(`prevActiveToolRef` is no longer needed; if TypeScript flags it as unused after this and Task-5-era removals, delete its declaration. It is safe to leave for now.)

- [ ] **Step 4: Portal — Done/Discard route to the active surface**

Replace `handleAnnotationDone` and `handleAnnotationDiscard` with:
```ts
  const endSession = () => {
    setAnnotating(false);
    setViewerSnapshot(null);
    annotationCanvasRef.current?.clear();
    pdfKonvaRef.current?.clearDrawings();
    setActiveTool('pointer');
  };

  const handleAnnotationDone = async () => {
    let dataUrl: string | null = null;
    try {
      dataUrl = isPDFFile
        ? (pdfKonvaRef.current?.captureSnapshot() ?? null)
        : (annotationCanvasRef.current?.captureSnapshot() ?? null);
      if (dataUrl) {
        const file = await dataUrlToFile(dataUrl, `annotation-${Date.now()}.jpg`);
        setComposerFiles((prev) => [...prev, file]);
      }
    } catch (e) {
      console.error('Failed to finish annotation:', e);
    } finally {
      endSession();
      setTimeout(() => composerInputRef.current?.focus(), 0);
    }
  };

  const handleAnnotationDiscard = () => {
    endSession();
  };
```
(`Date.now()` in app client code is fine — the id-counter rule is for annotation-object ids, which live in the hook; the snapshot filename can use a timestamp.)

- [ ] **Step 5: Portal — reset the session on file change**

In the `[selectedFileId]` reset effect, add `setAnnotating(false);` alongside the existing resets:
```ts
    setViewerSnapshot(null);
    setViewportImage(null);
    setAnnotating(false);
    setContentTransform(null);
    setComposerText('');
    setComposerFiles([]);
    setPendingTag(null);
    setTagging(false);
```

- [ ] **Step 6: Portal — banner keyed on `annotating`**

Change the annotation banner condition from `{DRAW_TOOLS.includes(activeTool) && (` to `{annotating && (`. The banner's `Done`/`Discard` buttons already call `handleAnnotationDone`/`handleAnnotationDiscard`.

- [ ] **Step 7: Portal — mount AnnotationCanvas; show MarkupOverlay only in live view; drop the frozen `<img>`**

In `renderFileViewer`, delete the frozen-snapshot `<img>` block (the one rendering `viewerSnapshot` as `<img className="absolute inset-0 w-full h-full object-contain bg-gray-100" .../>`) and simplify `isHidden`:
```ts
    const isHidden = (annotating && !isPDFFile) || !!viewportImage;
```
Then in the viewer-area container (`<div ref={viewerAreaRef} ...>`), change the MarkupOverlay guard so it renders only in live view, and add the AnnotationCanvas for sessions. Replace:
```tsx
            {selectedFileId && !isPDFFile && (
              <MarkupOverlay
                ...all existing props...
              />
            )}
```
with:
```tsx
            {selectedFileId && !isPDFFile && !annotating && (
              <MarkupOverlay
                ...all existing props unchanged...
              />
            )}

            {annotating && !isPDFFile && (
              <AnnotationCanvas
                backgroundDataUrl={viewerSnapshot}
                activeTool={activeTool}
                color={drawingColor}
                strokeWidth={drawingStrokeWidth}
                handleRef={annotationCanvasRef}
              />
            )}
```
(Keep the `{viewportImage && (...)}` overlay block after these — it must still render on top.)

- [ ] **Step 8: Portal — remove `compositeSnapshotWithMarkup`**

Delete the `compositeSnapshotWithMarkup` function (the `async function compositeSnapshotWithMarkup(...) { ... }` near the top of the file). It has no remaining callers after Step 4. If `tsc` reports it as unused-only, deletion resolves it.

- [ ] **Step 9: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. Then `npm run build` (with placeholder env, per Global Constraints) → compiles + generates pages.
If `tsc` flags `markupOverlayRef` / `getSvgElement` as unused, leave them for now (Task 5 removes the handle); if it flags `prevActiveToolRef` unused, delete its `useRef` declaration.

- [ ] **Step 10: Behavioral check (if dev env available)**

On an **image**, **video**, and **3D/CAD** file: pick Freehand → the view freezes and you can draw. Draw a stroke, a rect, an arrow, and text. Switch to **Pointer** → click a stroke → handles appear → drag to move, corner to scale, top handle to rotate. Switch to **Eraser** → click an object → it's removed. Click **Done** → a flattened JPEG (no handles) appears as a pending attachment in the composer; add text; Send → the comment shows it. **Discard** drops everything and returns to live view. Switching Pointer mid-session does NOT end the session.

- [ ] **Step 11: Commit**

```bash
git add components/markup/AnnotationCanvas.tsx app/portal/\[id\]/page.tsx
git commit -m "feat(annotations): Konva AnnotationCanvas + session lifecycle (image/video/3D)"
```

---

## Task 4: PDF integration (shared core in `PDFKonvaViewer`)

**Files:**
- Modify: `components/viewers/PDFKonvaViewer.tsx`
- Modify: `components/viewers/ViewerContainer.tsx`
- Modify: `app/portal/[id]/page.tsx` (pass `annotating` to the viewer)

**Interfaces:**
- Consumes: `useAnnotationObjects`, `AnnotationObjects`.
- Produces: `PDFKonvaViewer` accepts `annotating?: boolean`; its drawing uses the shared object model; `captureSnapshot` deselects first; `clearDrawings` clears the shared objects; `getCurrentPage` unchanged.

- [ ] **Step 1: Thread `annotating` through `ViewerContainer`**

In `components/viewers/ViewerContainer.tsx`: add `annotating?: boolean;` to `ViewerContainerProps`, destructure it, and pass `annotating={annotating}` to `<PDFKonvaViewer ... />`.

- [ ] **Step 2: Portal passes `annotating` to `ViewerContainer`**

In `app/portal/[id]/page.tsx`, in the `<ViewerContainer ... />` render, add `annotating={annotating}` (next to `tagging={tagging}`).

- [ ] **Step 3: `PDFKonvaViewer` — swap the drawing internals for the shared core**

In `components/viewers/PDFKonvaViewer.tsx`:

Add imports:
```ts
import { useAnnotationObjects } from '@/components/markup/useAnnotationObjects';
import AnnotationObjects from '@/components/markup/AnnotationObjects';
```
Remove the `Markup` import usage if it becomes unused (the shared model replaces it).

Add `annotating?: boolean;` to `PDFKonvaViewerProps` and destructure `annotating = false`.

Instantiate the hook near the other state:
```ts
    const ann = useAnnotationObjects();
```

**Delete** the old drawing machinery: the `DrawingState` interface and `drawing` state, the `markups` state, `saveMarkup`, `handleTextSubmit` (old), the old `handleMouseDown/Move/Up` bodies for drawing, `renderStoredMarkup`, `renderPreview`, and the page-change `setMarkups([])` reset. (Keep: PDF load/render, sizing, `stageScale`/`stagePos`, `getPageCoords`, wheel/zoom, page nav, comment-pin rendering.)

Replace the imperative handle body:
```ts
    useImperativeHandle(handleRef, () => ({
      captureSnapshot: () => {
        const stage = stageRef.current;
        if (!stage) return null;
        stage.find('Transformer').forEach((t) => (t as Konva.Transformer).nodes([]));
        stage.draw();
        const url = stage.toDataURL({ pixelRatio: 2, mimeType: 'image/jpeg', quality: 0.88 });
        ann.setSelectedId(null);
        return url;
      },
      getCurrentPage: () => currentPage,
      clearDrawings: () => ann.clear(),
    }));
```

Add a text popup state (page-space point + screen point) and stage handlers driven by `activeTool`, using `getPageCoords` for object-space and the raw pointer for the popup position:
```ts
    const [textPopup, setTextPopup] = useState<{ px: number; py: number; sx: number; sy: number } | null>(null);
    const [textInput, setTextInput] = useState('');

    const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      if (!stage) return;
      const coords = getPageCoords(stage);
      if (!coords) return;

      if (tagging) { const pct = toPercent(coords.x, coords.y); onCommentPlace(pct.x, pct.y, currentPage); return; }

      if (!annotating) return; // live view: pointer pans (handled by Stage draggable)

      if (activeTool === 'text') {
        const ptr = stage.getPointerPosition();
        setTextPopup({ px: coords.x, py: coords.y, sx: ptr?.x ?? 0, sy: ptr?.y ?? 0 });
        setTextInput('');
        return;
      }
      if (activeTool === 'pointer') { if (e.target === stage) ann.setSelectedId(null); return; }
      if (activeTool === 'eraser') return;
      ann.startDraw(activeTool, coords, color, strokeWidth);
    }, [tagging, annotating, activeTool, getPageCoords, toPercent, onCommentPlace, currentPage, color, strokeWidth, ann]);

    const handleStageMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!annotating) return;
      const stage = e.target.getStage();
      if (!stage) return;
      const coords = getPageCoords(stage);
      if (coords) ann.moveDraw(activeTool, coords);
    }, [annotating, activeTool, getPageCoords, ann]);

    const submitText = useCallback(() => {
      if (textPopup && textInput.trim()) ann.addText({ x: textPopup.px, y: textPopup.py }, textInput, color, strokeWidth);
      setTextPopup(null); setTextInput('');
    }, [textPopup, textInput, color, strokeWidth, ann]);
```
Note `toPercent` stays (used only for the tag-placement path now).

Update the `<Stage>`: `draggable` and interactivity now depend on `annotating`:
```tsx
              draggable={activeTool === 'pointer' && !annotating && !tagging}
              onWheel={handleWheel}
              onMouseDown={handleStageMouseDown}
              onMouseMove={handleStageMouseMove}
              onMouseUp={() => ann.endDraw()}
              onMouseLeave={() => ann.endDraw()}
```
(Remove the old `isInteractive ?` guards on these handlers; the new handlers self-gate on `annotating`/`tagging`.)

Replace the old "Stored Annotations" + "Drawing Preview" layers with a single annotation layer using the shared renderer (place it above the PDF image layer, below/above the comment-pin layer is fine — put it directly after the PDF image layer):
```tsx
              {/* Annotations (shared Konva objects) */}
              <Layer>
                <AnnotationObjects
                  objects={ann.objects}
                  draft={ann.draft}
                  selectedId={ann.selectedId}
                  activeTool={activeTool}
                  onSelect={ann.setSelectedId}
                  onErase={ann.deleteObject}
                  onChange={ann.updateObject}
                />
              </Layer>
```

Replace the old text popup JSX with one bound to the new state (positioned by `textPopup.sx/sy`):
```tsx
          {textPopup && (
            <div
              className="absolute z-30 bg-white rounded-lg shadow-lg border border-gray-200 p-2"
              style={{ left: Math.min(textPopup.sx, containerSize.width - 200), top: Math.min(textPopup.sy, containerSize.height - 80) }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <input
                type="text"
                autoFocus
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Type text..."
                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500"
                style={{ minWidth: 150 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); submitText(); }
                  if (e.key === 'Escape') { setTextPopup(null); setTextInput(''); }
                }}
              />
              <div className="flex justify-end gap-1.5 mt-1.5">
                <button onClick={() => { setTextPopup(null); setTextInput(''); }} className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                <button onClick={submitText} disabled={!textInput.trim()} className="px-2.5 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">Add</button>
              </div>
            </div>
          )}
```

Update `cursorStyle`: `const cursorStyle = tagging ? 'crosshair' : (annotating && activeTool !== 'pointer' && activeTool !== 'eraser') ? 'crosshair' : annotating && activeTool === 'eraser' ? 'not-allowed' : activeTool === 'pointer' && !annotating ? 'grab' : 'default';`

- [ ] **Step 4: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. Remove any now-unused imports/vars the compiler flags (`Markup` type, `fromPercent` if it became unused for markups — but `fromPercent` is still used by comment-pin rendering, so keep it; `isInteractive` if now unused, delete it). Then `npm run build`.

- [ ] **Step 5: Behavioral check (if dev env available)**

On a **PDF**: Freehand/shape/text draw on the page (crisp). Pointer → select an object → move/scale/rotate. Eraser → click to delete. Done → the captured JPEG (2×, no handles) attaches to the composer. In live view (not annotating), Pointer still pans the page and places tags; zoom and page nav still work.

- [ ] **Step 6: Commit**

```bash
git add components/viewers/PDFKonvaViewer.tsx components/viewers/ViewerContainer.tsx app/portal/\[id\]/page.tsx
git commit -m "feat(annotations): PDF uses shared Konva object model with select/transform/erase"
```

---

## Task 5: Slim `MarkupOverlay` to pins + tagging

**Files:**
- Modify: `components/markup/MarkupOverlay.tsx`

**Interfaces:**
- Produces: `MarkupOverlay` renders only comment pins + handles tag placement; the `MarkupOverlayHandle` (`getSvgElement`/`clearDrawings`) and all drawing code are removed.

- [ ] **Step 1: Remove drawing from `MarkupOverlay`**

In `components/markup/MarkupOverlay.tsx`, remove the drawing responsibilities while keeping pins + tagging:
- Delete `markups` state, the markup-reset effect, `saveMarkup`, `handleTextSubmit`, the text popup state and JSX, `getPreviewData`, `renderMarkupSvg`, and the SVG `<svg>` markup layer (the `<defs>/<marker>` + stored-markup map + preview).
- In `handleMouseDown`, keep ONLY the tagging branch; remove the `text`/draw-tool branches:
```ts
      (e: React.MouseEvent) => {
        if (!tagging) return;
        const coords = getPercentCoords(e);
        onCommentPlace(coords.x, coords.y);
      },
```
  (adjust the dependency array to `[tagging, getPercentCoords, onCommentPlace]`; remove `handleMouseMove`/`handleMouseUp` and their usages, or keep no-op — simplest is to remove the drawing mouse handlers and leave only the tagging mousedown).
- Remove the `forwardRef`/`useImperativeHandle` (`getSvgElement`, `clearDrawings`) — the component no longer needs a ref. Convert `MarkupOverlay` to a plain function component (drop the `MarkupOverlayHandle` export and `forwardRef`).
- Keep: `getPercentCoords`, the `positionalComments` computation, the comment-pins layer (including `pendingCommentId`/`isPending`), the world-pin projection handling, and `contentTransform`.
- Remove props no longer used by the slimmed component: `color`, `strokeWidth`, `activeTool` (unless still needed for cursor), `ephemeral`. Keep: `fileId`, `tagging`, `onCommentPlace`, `comments`, `activeCommentId`, `onCommentPinClick`, `is3DFile`, `worldPinPositions`, `contentTransform`, `pendingCommentId`.

- [ ] **Step 2: Update the portal's `MarkupOverlay` usage**

In `app/portal/[id]/page.tsx`, remove the now-invalid props from the `<MarkupOverlay .../>` render: delete `ref={markupOverlayRef}`, `activeTool`, `color`, `strokeWidth`, `ephemeral`. Delete the `markupOverlayRef` declaration and the `MarkupOverlayHandle` import. (The `endSession` helper's `annotationCanvasRef`/`pdfKonvaRef` clears remain; remove any residual `markupOverlayRef.current?...` calls.)

- [ ] **Step 3: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. Resolve any unused-symbol errors from the removals. Then `npm run build`.

- [ ] **Step 4: Behavioral check (if dev env available)**

Live view: comment pins render for image/video/3D; the tag button places a pin (still works); clicking a pin/comment highlights bidirectionally. Entering an annotation session now shows the Konva `AnnotationCanvas` (not `MarkupOverlay`).

- [ ] **Step 5: Commit**

```bash
git add components/markup/MarkupOverlay.tsx app/portal/\[id\]/page.tsx
git commit -m "refactor(annotations): slim MarkupOverlay to comment pins + tagging"
```

---

## Self-Review

**Spec coverage:**
- Object eraser → `AnnotationObjects.handleObj` (eraser branch) + `deleteObject` (Tasks 2–4). ✓
- Move/scale/rotate → Konva `Transformer` + `draggable` + `onTransformEnd` writeback (Task 2), used in Tasks 3–4. ✓
- Pointer = select when no draw tool active → object `draggable`/select gated on `activeTool === 'pointer'`; portal `annotating` gates pointer meaning; PDF `annotating` prop (Tasks 3–4). ✓
- Unify on Konva → shared hook/renderer; `AnnotationCanvas` (non-PDF) + PDF stage (Tasks 2–4). ✓
- Lifecycle (Pointer no longer exits; Done/Discard only) → `annotating` state + session-start effect + `endSession` (Task 3). ✓
- Eraser tool in toolbar → Task 1. ✓
- MarkupOverlay slimmed; `compositeSnapshotWithMarkup` removed → Tasks 3 & 5. ✓
- Capture deselects Transformer before `toDataURL` @2× → Tasks 2–4. ✓
- Scope boundaries (no restyle/multiselect/undo/PDF-multipage) → not implemented, consistent. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code or an exact, itemized delete/replace list. The two large deletions (PDF drawing internals in Task 4 Step 3; MarkupOverlay drawing in Task 5 Step 1) are specified as itemized removals against named symbols rather than pasting the whole files — acceptable because they enumerate exactly which symbols to remove and what to keep.

**Type consistency:** `AnnTool`/`AnnotationObject`/`AnnotationCanvasHandle` names match across Tasks 2–4. `useAnnotationObjects` return shape matches its consumers. `handleRef`-prop pattern (not `ref`) matches the established fix for `next/dynamic` (`PDFKonvaViewer`) and is reused for `AnnotationCanvas` (also rendered directly by the portal, not via dynamic — a normal ref would also work there, but `handleRef` keeps the two Konva hosts consistent). `captureSnapshot`/`clearDrawings`/`getCurrentPage` on `PDFKonvaViewerHandle` are preserved.

**Note on `AnnotationCanvas` ref + SSR:** `react-konva` cannot be server-rendered, so `AnnotationCanvas` is imported via `dynamic(() => import(...), { ssr: false })` in the portal (Task 3 Step 2), exactly as `PDFKonvaViewer` is in `ViewerContainer`. Because `next/dynamic` drops the React `ref`, the imperative handle is passed via the `handleRef` **prop** and consumed with `useImperativeHandle(handleRef, ...)` — this is the same pattern already applied to `PDFKonvaViewer` (the `next/dynamic`-drops-ref fix). `useAnnotationObjects` (no react-konva) and `AnnotationObjects`/`AnnotationCanvas` (react-konva) are only ever loaded inside already-client, dynamically-imported chunks, so none of them reach the SSR bundle.
