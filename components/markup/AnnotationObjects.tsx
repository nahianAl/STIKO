'use client';

import { useEffect, useRef, useState } from 'react';
import { Line, Arrow, Rect, Shape, Text, Group, Image as KonvaImage, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { Box } from '@/lib/markup/selection';
import type { AnnotationObject, AnnTool } from './useAnnotationObjects';
import { TEXT_BORDER_WIDTH, TEXT_FONT_FAMILY, konvaFontStyle, textPadding, widthOnSideDrag } from '@/lib/markup/text';
import { TEXT_BOX_NAME, TEXT_GROUP_NAME, glyphLineRects, textOf } from './textNode';
import { cloudArcs } from '@/lib/markup/cloud';
import { normalizedBox } from '@/lib/markup/draft';
import useShiftKey from './useShiftKey';
import { ROTATION_SNAPS_DEG, ROTATION_SNAP_TOLERANCE_DEG } from '@/lib/markup/rotationSnap';

/** Every handle. Konva's own default, spelled out because a lone text swaps in a subset. */
const ALL_ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right'];

/** One text: corners scale the font, sides set the width. No top/bottom — the height always fits the text. */
const TEXT_ANCHORS = ['top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-right'];

const isSideAnchor = (a: string | null | undefined) => a === 'middle-left' || a === 'middle-right';

/**
 * A plain text is hit on its glyphs, line by line. Konva's default Text hit area is the whole
 * width x height, and the width is the WRAP width — a two-word label in a 300px box would
 * swallow clicks meant for whatever is beside it. (A text with a fill or border is hit on its
 * whole box instead, by the box shape behind it.)
 */
function glyphHitFunc(ctx: Konva.Context, shape: Konva.Shape) {
  ctx.beginPath();
  for (const r of glyphLineRects(shape as Konva.Text)) ctx.rect(r.x, r.y, Math.max(r.width, 1), r.height);
  ctx.closePath();
  ctx.fillStrokeShape(shape);
}

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
  selectedIds: string[];
  activeTool: AnnTool;
  /** Shift (additive) toggles; see pickId. */
  onSelect: (id: string, additive: boolean) => void;
  onErase: (id: string) => void;
  onChange: (id: string, patch: Partial<AnnotationObject>) => void;
  /** The text object currently open in the editor. Its Konva node is hidden so the glyphs are
   *  not drawn twice at slightly different rasterisations. */
  editingId?: string | null;
  /** Open a committed text for editing: a Pointer double-click, or a Text-tool press on it. */
  onEditText?: (id: string) => void;
  /** Text transforms bake their scale instead of storing it — see bakeTextTransform. */
  onBakeText?: (id: string, t: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }) => void;
  /** A side-handle drag on a lone text ended at this box width — see setTextWidth. */
  onSetTextWidth?: (id: string, width: number) => void;
  /** True while an object is being dragged or transformed, false when it ends. The floating text bar hides meanwhile. */
  onGestureChange?: (active: boolean) => void;
  /** The live selection box, in the same drawing space as the objects. */
  marquee?: Box | null;
}

export default function AnnotationObjects({ objects, draft, selectedIds, activeTool, onSelect, onErase, onChange, editingId = null, onEditText, onBakeText, onSetTextWidth, onGestureChange, marquee = null }: AnnotationObjectsProps) {
  const trRef = useRef<Konva.Transformer>(null);
  // Bumped when an ImageObj finishes decoding, so the Transformer rebinds once the
  // (initially null) image node actually exists in the stage.
  const [imgLoadTick, setImgLoadTick] = useState(0);
  const shiftHeld = useShiftKey();

  // Exactly one object selected, and it is a text: corner = font size, side = width.
  const singleText = selectedIds.length === 1 && objects.some((o) => o.id === selectedIds[0] && o.type === 'text');

  // Bind the Transformer to every selected node — except one open in the text editor, where
  // resize handles would fight the caret and sit over the textarea.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const stage = tr.getStage();
    const nodes = stage
      ? selectedIds
          .filter((id) => id !== editingId)
          .map((id) => stage.findOne(`#${id}`))
          .filter((n): n is Konva.Node => !!n)
      : [];
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, objects, activeTool, imgLoadTick, editingId]);

  // Object press: select (pointer), erase, or — Text tool on a text — edit it. Ignored for the
  // draw tools so you can draw over objects.
  const handleObj = (e: Konva.KonvaEventObject<MouseEvent>, obj: AnnotationObject) => {
    // Erase this object immediately (so a plain click erases with no drag needed), but do NOT
    // cancel the bubble: the stage-level handler owns the drag-erase sweep and arms it on this
    // same mousedown. Swallowing the event here would mean a drag that starts on top of an
    // object erases that one object and then arms nothing, leaving the rest of the drag inert.
    // The stage handler will also erase this object a moment later via getIntersection; that's
    // a harmless double delete since deleteObject filters by id.
    if (activeTool === 'eraser') { onErase(obj.id); }
    else if (activeTool === 'pointer') { e.cancelBubble = true; onSelect(obj.id, e.evt.shiftKey); }
    else if (activeTool === 'text' && obj.type === 'text' && onEditText) {
      // Edit it rather than stacking a new box on top. Cancelled so the stage never starts a
      // create gesture underneath.
      e.cancelBubble = true;
      onEditText(obj.id);
    }
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
      onMouseDown: isDraft ? undefined : (e: Konva.KonvaEventObject<MouseEvent>) => handleObj(e, obj),
      onTap: isDraft ? undefined : (e: Konva.KonvaEventObject<MouseEvent>) => handleObj(e, obj),
      onDragStart: isDraft ? undefined : () => onGestureChange?.(true),
      // Konva's Transformer drags the other selected nodes along with this one. Persist every
      // selected position here rather than trusting each node to report its own dragend, so a
      // group move can never leave state behind the canvas. Writing the same value twice is harmless.
      onDragEnd: isDraft ? undefined : (e: Konva.KonvaEventObject<DragEvent>) => {
        onGestureChange?.(false);
        const stage = e.target.getStage();
        const ids = selectedIds.includes(obj.id) ? selectedIds : [obj.id];
        for (const sid of ids) {
          const n = sid === obj.id ? e.target : stage?.findOne(`#${sid}`);
          if (n) onChange(sid, { x: n.x(), y: n.y() });
        }
      },
      onTransformStart: isDraft ? undefined : () => onGestureChange?.(true),
      onTransformEnd: isDraft ? undefined : (e: Konva.KonvaEventObject<Event>) => {
        onGestureChange?.(false);
        const n = e.currentTarget;
        const t = { x: n.x(), y: n.y(), rotation: n.rotation(), scaleX: n.scaleX(), scaleY: n.scaleY() };
        if (obj.type !== 'text') { onChange(obj.id, t); return; }
        // Still set during transformend — Konva clears it only after firing.
        if (singleText && isSideAnchor(trRef.current?.getActiveAnchor())) {
          // onTransform already folded every frame's stretch into the Text's width (scale is
          // back to 1). Persist that width and the origin, which moves on a middle-left drag.
          const tx = textOf(n);
          onChange(obj.id, { x: t.x, y: t.y, rotation: t.rotation, scaleX: 1, scaleY: 1 });
          if (tx) onSetTextWidth?.(obj.id, tx.width());
          return;
        }
        if (onBakeText) {
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
      case 'text': {
        const pad = textPadding(obj);
        const boxed = pad > 0;
        return (
          <Group
            key={obj.id}
            {...common}
            name={TEXT_GROUP_NAME}
            visible={editingId !== obj.id}
            // A side handle on a lone text sets its WIDTH. Konva's Transformer only knows how to
            // scale, so fold the horizontal stretch into the Text's width on every frame: the
            // glyphs reflow instead of stretching. Width first, then the scale reset — the reset
            // is what makes the Transformer re-measure the group, and it must see the reflowed
            // height. Corners are left alone and baked on transformend.
            onTransform={(e: Konva.KonvaEventObject<Event>) => {
              if (!singleText || !isSideAnchor(trRef.current?.getActiveAnchor())) return;
              const g = e.currentTarget;
              const t = textOf(g);
              if (!t) return;
              // An auto-width text renders with wrap 'none', which a width alone does not reflow;
              // the drag is about to make it fixed-width (setTextWidth), so wrap it like one now.
              if (t.wrap() !== 'word') t.wrap('word');
              t.width(widthOnSideDrag(t.width(), g.scaleX()));
              g.scaleX(1);
              g.scaleY(1);
            }}
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
          >
            {boxed && (
              <Shape
                name={TEXT_BOX_NAME}
                fill={obj.fill || undefined}
                stroke={obj.border ? obj.color : undefined}
                strokeWidth={obj.border ? TEXT_BORDER_WIDTH : 0}
                // Sized off the sibling Text at draw time, not from props: an auto-width box is
                // as wide as Konva measured the glyphs, and a side-handle drag changes the Text's
                // width every frame without a React render. The scene function doubles as the hit
                // function, so a filled or bordered text is clickable anywhere inside its box.
                sceneFunc={(ctx, shape) => {
                  const parent = shape.getParent();
                  const t = parent ? textOf(parent) : null;
                  if (!t) return;
                  ctx.beginPath();
                  ctx.rect(0, 0, t.width(), t.height());
                  ctx.closePath();
                  ctx.fillStrokeShape(shape);
                }}
              />
            )}
            <Text
              text={obj.text}
              fontSize={obj.fontSize}
              fontFamily={TEXT_FONT_FAMILY}
              fontStyle={konvaFontStyle(obj)}
              fill={obj.color}
              align={obj.align}
              padding={pad}
              lineHeight={1}
              // `width` is the box's outer width, padding included — Konva's own convention, so
              // the Text and the box shape agree. Auto-width leaves it unset and Konva sizes the
              // node to its longest line.
              width={obj.autoWidth ? undefined : obj.width}
              wrap={obj.autoWidth ? 'none' : 'word'}
              hitFunc={boxed ? undefined : glyphHitFunc}
            />
          </Group>
        );
      }
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
        // A group scales evenly: stretching several nodes unevenly skews any rotated member, and
        // the object model has no skew to store it in, so the canvas and the saved markup would
        // disagree. A lone text's corners scale its font, which must stay in proportion too.
        // Other single objects can still be stretched freely. (Side anchors ignore keepRatio.)
        keepRatio={selectedIds.length > 1 || singleText}
        enabledAnchors={singleText ? TEXT_ANCHORS : ALL_ANCHORS}
        ignoreStroke
        // Konva's rotationSnaps are ABSOLUTE angles, which is exactly the behaviour wanted:
        // Shift straightens a crooked object rather than stepping it 90 deg from wherever it
        // was. An empty array means no snapping at all.
        rotationSnaps={shiftHeld ? ROTATION_SNAPS_DEG : []}
        rotationSnapTolerance={ROTATION_SNAP_TOLERANCE_DEG}
        boundBoxFunc={(oldBox, newBox) => (newBox.width < 5 || newBox.height < 5 ? oldBox : newBox)}
      />
      {marquee && (
        <Rect
          x={marquee.x}
          y={marquee.y}
          width={marquee.width}
          height={marquee.height}
          stroke="#5B60FF"
          strokeWidth={1}
          dash={[4, 4]}
          fill="rgba(91, 96, 255, 0.08)"
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
    </>
  );
}
