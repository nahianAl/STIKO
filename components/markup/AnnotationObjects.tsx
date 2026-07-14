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
