'use client';

import { useEffect, useRef, useState } from 'react';
import { Line, Arrow, Rect, Shape, Text, Image as KonvaImage, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { AnnotationObject, AnnTool } from './useAnnotationObjects';
import { TEXT_FONT_FAMILY } from '@/lib/markup/text';
import { cloudArcs } from '@/lib/markup/cloud';
import { normalizedBox } from '@/lib/markup/draft';
import useShiftKey from './useShiftKey';
import { ROTATION_SNAPS_DEG, ROTATION_SNAP_TOLERANCE_DEG } from '@/lib/markup/rotationSnap';

function ImageObj({ obj, common, onLoaded }: { obj: AnnotationObject; common: Omit<React.ComponentProps<typeof KonvaImage>, 'image'>; onLoaded?: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!obj.src) return;
    let alive = true;
    const i = new window.Image();
    i.onload = () => { if (!alive) return; setImg(i); onLoaded?.(); };
    i.src = obj.src;
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj.src]);
  if (!img) return null;
  return <KonvaImage {...common} image={img} width={obj.width} height={obj.height} />;
}

interface AnnotationObjectsProps {
  objects: AnnotationObject[];
  draft: AnnotationObject | null;
  selectedId: string | null;
  activeTool: AnnTool;
  onSelect: (id: string) => void;
  onErase: (id: string) => void;
  onChange: (id: string, patch: Partial<AnnotationObject>) => void;
  /** The text object currently open in the editor. Its Konva node is hidden so the glyphs are
   *  not drawn twice at slightly different rasterisations. */
  editingId?: string | null;
  /** Double-click on a committed text object, with the pointer tool active. */
  onEditText?: (id: string) => void;
  /** Text transforms bake their scale instead of storing it — see bakeTextTransform. */
  onBakeText?: (id: string, t: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }) => void;
}

export default function AnnotationObjects({ objects, draft, selectedId, activeTool, onSelect, onErase, onChange, editingId = null, onEditText, onBakeText }: AnnotationObjectsProps) {
  const trRef = useRef<Konva.Transformer>(null);
  // Bumped when an ImageObj finishes decoding, so the Transformer rebinds once the
  // (initially null) image node actually exists in the stage.
  const [imgLoadTick, setImgLoadTick] = useState(0);
  const shiftHeld = useShiftKey();

  // Bind the Transformer to the selected node — unless that node is open in the text editor,
  // where resize handles would fight the caret and sit over the textarea.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const stage = tr.getStage();
    const editing = selectedId !== null && selectedId === editingId;
    const node = selectedId && stage && !editing ? stage.findOne(`#${selectedId}`) : null;
    tr.nodes(node ? [node as Konva.Node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, objects, activeTool, imgLoadTick, editingId]);

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
        const t = { x: n.x(), y: n.y(), rotation: n.rotation(), scaleX: n.scaleX(), scaleY: n.scaleY() };
        if (obj.type === 'text' && onBakeText) {
          // Reset on the node as well as in state: React re-renders a frame later, and without
          // this the text visibly springs to double size and back.
          n.scaleX(1);
          n.scaleY(1);
          onBakeText(obj.id, t);
        } else {
          onChange(obj.id, t);
        }
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
      case 'ellipse':
      case 'cloud': {
        const box = normalizedBox(obj.width, obj.height);
        return (
          <Shape
            key={obj.id}
            {...common}
            // The Transformer reads these to size its bounding box; the drawing below is
            // independent of them.
            width={box.width}
            height={box.height}
            stroke={obj.color}
            strokeWidth={obj.strokeWidth}
            sceneFunc={(ctx, shape) => {
              ctx.beginPath();
              if (obj.type === 'ellipse') {
                ctx.ellipse(box.left + box.width / 2, box.top + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2);
              } else {
                // Consecutive arcs share endpoints exactly (see lib/markup/cloud), so the
                // implicit lineTo between them is a zero-length move, not a chord.
                for (const a of cloudArcs(obj.width, obj.height)) {
                  ctx.arc(a.cx, a.cy, a.r, a.start, a.end, false);
                }
              }
              ctx.closePath();
              ctx.strokeShape(shape);
            }}
            // Stroke-only shapes have no fillable interior, so Konva's default hit test would
            // only register on the line itself and clicks inside the shape would fall through
            // to whatever is beneath. A filled bounding box matches what Rect gives for free.
            hitFunc={(ctx, shape) => {
              ctx.beginPath();
              ctx.rect(box.left, box.top, box.width, box.height);
              ctx.closePath();
              ctx.fillStrokeShape(shape);
            }}
          />
        );
      }
      case 'text':
        return (
          <Text
            key={obj.id}
            {...common}
            text={obj.text}
            fontSize={obj.fontSize}
            fontFamily={TEXT_FONT_FAMILY}
            fill={obj.color}
            fontStyle="bold"
            // The same number the editor wrapped at, so committing does not reflow the text.
            width={obj.width > 0 ? obj.width : undefined}
            wrap="word"
            // Konva's default Text hit area is getWidth() x getHeight(), and getWidth() returns
            // the explicit `width` attr — which we must set for wrap parity with the editor. That
            // would give a two-character label a hit box hundreds of px wide, swallowing clicks
            // meant for whatever is beneath it. Hit-test the glyphs instead.
            hitFunc={(ctx, shape) => {
              const t = shape as Konva.Text;
              ctx.beginPath();
              ctx.rect(0, 0, t.getTextWidth(), t.height());
              ctx.closePath();
              ctx.fillStrokeShape(t);
            }}
            visible={editingId !== obj.id}
            onDblClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
              if (isDraft || activeTool !== 'pointer' || !onEditText) return;
              e.cancelBubble = true;
              onEditText(obj.id);
            }}
            onDblTap={(e: Konva.KonvaEventObject<Event>) => {
              if (isDraft || activeTool !== 'pointer' || !onEditText) return;
              e.cancelBubble = true;
              onEditText(obj.id);
            }}
          />
        );
      case 'image':
        return <ImageObj key={obj.id} obj={obj} common={common} onLoaded={() => setImgLoadTick((t) => t + 1)} />;
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
        // Konva's rotationSnaps are ABSOLUTE angles, which is exactly the behaviour wanted:
        // Shift straightens a crooked object rather than stepping it 90 deg from wherever it
        // was. An empty array means no snapping at all.
        rotationSnaps={shiftHeld ? ROTATION_SNAPS_DEG : []}
        rotationSnapTolerance={ROTATION_SNAP_TOLERANCE_DEG}
        boundBoxFunc={(oldBox, newBox) => (newBox.width < 5 || newBox.height < 5 ? oldBox : newBox)}
      />
    </>
  );
}
