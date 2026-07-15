'use client';

import { useRef, useCallback } from 'react';
import CommentPin from './CommentPin';
import type { Comment } from '@/lib/types';
import type { ContentTransform } from '@/components/viewers/ImageViewer';
import { paletteForComment } from '@/lib/commentColors';

interface PinScreenPosition {
  x: number;
  y: number;
  visible: boolean;
}

interface MarkupOverlayProps {
  fileId: string;
  onCommentPlace: (x: number, y: number) => void;
  tagging?: boolean;
  comments: Comment[];
  activeCommentId: string | null;
  onCommentPinClick: (comment: Comment) => void;
  // 3D support: when true, comment tool clicks pass through to canvas for raycasting
  is3DFile?: boolean;
  // Projected screen positions for world-space pins, updated every frame
  worldPinPositions?: Map<string, PinScreenPosition>;
  // Content transform from ImageViewer zoom/pan — applied in live view mode
  contentTransform?: ContentTransform | null;
  // Id of the not-yet-posted tag being placed, rendered as a distinct preview pin
  pendingCommentId?: string | null;
}

export default function MarkupOverlay({
  onCommentPlace,
  tagging = false,
  comments,
  activeCommentId,
  onCommentPinClick,
  is3DFile = false,
  worldPinPositions,
  contentTransform,
  pendingCommentId,
}: MarkupOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const getPercentCoords = useCallback(
    (e: React.MouseEvent): { x: number; y: number } => {
      const container = containerRef.current;
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 100,
        y: ((e.clientY - rect.top) / rect.height) * 100,
      };
    },
    []
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!tagging) return;
      const coords = getPercentCoords(e);
      onCommentPlace(coords.x, coords.y);
    },
    [tagging, getPercentCoords, onCommentPlace]
  );

  // For 3D + tagging on the live canvas: let clicks pass through for raycasting.
  const passThrough3DTag = is3DFile && tagging;

  // Positional comments for pins — either 2D (xPosition/yPosition) or 3D (worldX/Y/Z projected)
  const positionalComments = comments.filter(
    (c) => (c.xPosition !== null && c.yPosition !== null) || (c.worldX !== null && c.worldY !== null && c.worldZ !== null)
  );

  // Content transform style for pins to follow image zoom/pan (live view only)
  const transformStyle: React.CSSProperties = contentTransform ? {
    transform: `translate(${contentTransform.translateX}px, ${contentTransform.translateY}px) scale(${contentTransform.scale})`,
    transformOrigin: 'center center',
  } : {};

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{
        pointerEvents: passThrough3DTag ? 'none' : (tagging ? 'all' : 'none'),
        cursor: tagging && !passThrough3DTag ? 'crosshair' : undefined,
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Inner wrapper that transforms with content zoom/pan */}
      <div className="absolute inset-0" style={transformStyle}>
        {/* Comment pins layer */}
        {positionalComments.map((comment, idx) => {
          const isWorldPin = comment.worldX !== null && comment.worldY !== null && comment.worldZ !== null;
          let pinX: number;
          let pinY: number;
          let pinVisible = true;

          if (isWorldPin && worldPinPositions) {
            const projected = worldPinPositions.get(comment.id);
            if (!projected || !projected.visible) {
              pinVisible = false;
              pinX = 0;
              pinY = 0;
            } else {
              pinX = projected.x;
              pinY = projected.y;
            }
          } else {
            pinX = comment.xPosition ?? 0;
            pinY = comment.yPosition ?? 0;
          }

          if (!pinVisible) return null;

          const c = paletteForComment(comment);

          return (
            <CommentPin
              key={comment.id}
              index={idx + 1}
              x={pinX}
              y={pinY}
              isActive={activeCommentId === comment.id}
              isPending={comment.id === pendingCommentId}
              fill={c.swatch}
              textColor={c.dark}
              onClick={() => onCommentPinClick(comment)}
            />
          );
        })}
      </div>
    </div>
  );
}
