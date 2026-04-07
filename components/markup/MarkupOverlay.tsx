'use client';

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import CommentPin from './CommentPin';
import type { Markup, Comment } from '@/lib/types';
import type { ContentTransform } from '@/components/viewers/ImageViewer';

type ToolType = 'pointer' | 'comment' | 'freehand' | 'line' | 'arrow' | 'rect' | 'text';

interface PinScreenPosition {
  x: number;
  y: number;
  visible: boolean;
}

interface MarkupOverlayProps {
  fileId: string;
  activeTool: ToolType;
  color: string;
  strokeWidth: number;
  onCommentPlace: (x: number, y: number) => void;
  comments: Comment[];
  activeCommentId: string | null;
  onCommentPinClick: (comment: Comment) => void;
  // When true: drawings are session-only (not saved to DB, stored markups not shown)
  ephemeral?: boolean;
  // 3D support: when true, comment tool clicks pass through to canvas for raycasting
  is3DFile?: boolean;
  // Projected screen positions for world-space pins, updated every frame
  worldPinPositions?: Map<string, PinScreenPosition>;
  // Content transform from ImageViewer zoom/pan — applied in live view mode
  contentTransform?: ContentTransform | null;
}

export interface MarkupOverlayHandle {
  getSvgElement: () => SVGSVGElement | null;
}

interface DrawingState {
  isDrawing: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  points: { x: number; y: number }[];
}

const MarkupOverlay = forwardRef<MarkupOverlayHandle, MarkupOverlayProps>(
  function MarkupOverlay(
    {
      fileId,
      activeTool,
      color,
      strokeWidth,
      onCommentPlace,
      comments,
      activeCommentId,
      onCommentPinClick,
      ephemeral = false,
      is3DFile = false,
      worldPinPositions,
      contentTransform,
    },
    ref
  ) {
    const [markups, setMarkups] = useState<Markup[]>([]);
    const [drawing, setDrawing] = useState<DrawingState>({
      isDrawing: false,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      points: [],
    });
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Text tool state
    const [textPopup, setTextPopup] = useState<{ x: number; y: number } | null>(null);
    const [textInput, setTextInput] = useState('');

    useImperativeHandle(ref, () => ({
      getSvgElement: () => svgRef.current,
    }));

    const fetchMarkups = useCallback(async () => {
      if (!fileId || ephemeral) return;
      try {
        const res = await fetch(`/api/markups?fileId=${fileId}`);
        if (res.ok) {
          const data = await res.json();
          setMarkups(data);
        }
      } catch (err) {
        console.error('Failed to fetch markups:', err);
      }
    }, [fileId, ephemeral]);

    useEffect(() => {
      if (ephemeral) {
        setMarkups([]);
        return;
      }
      fetchMarkups();
    }, [fetchMarkups, ephemeral]);

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

    const saveMarkup = useCallback(
      async (type: Markup['type'], data: unknown) => {
        if (ephemeral) {
          // Store in local state only — visible during this session, not persisted to DB
          setMarkups((prev) => [
            ...prev,
            {
              id: `local-${Date.now()}-${Math.random()}`,
              fileId,
              type,
              data,
              style: { color, strokeWidth },
              createdAt: new Date().toISOString(),
            },
          ]);
          return;
        }
        try {
          await fetch('/api/markups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileId,
              type,
              data,
              style: { color, strokeWidth },
            }),
          });
          await fetchMarkups();
        } catch (err) {
          console.error('Failed to save markup:', err);
        }
      },
      [fileId, color, strokeWidth, fetchMarkups, ephemeral]
    );

    // Text tool submit handler
    const handleTextSubmit = useCallback(() => {
      if (!textPopup || !textInput.trim()) {
        setTextPopup(null);
        setTextInput('');
        return;
      }
      saveMarkup('text', { x: textPopup.x, y: textPopup.y, text: textInput.trim() });
      setTextPopup(null);
      setTextInput('');
    }, [textPopup, textInput, saveMarkup]);

    const handleMouseDown = useCallback(
      (e: React.MouseEvent) => {
        if (activeTool === 'pointer') return;
        const coords = getPercentCoords(e);

        if (activeTool === 'comment') {
          onCommentPlace(coords.x, coords.y);
          return;
        }

        if (activeTool === 'text') {
          setTextPopup({ x: coords.x, y: coords.y });
          setTextInput('');
          return;
        }

        setDrawing({
          isDrawing: true,
          startX: coords.x,
          startY: coords.y,
          currentX: coords.x,
          currentY: coords.y,
          points: [{ x: coords.x, y: coords.y }],
        });
      },
      [activeTool, getPercentCoords, onCommentPlace]
    );

    const handleMouseMove = useCallback(
      (e: React.MouseEvent) => {
        if (!drawing.isDrawing) return;
        const coords = getPercentCoords(e);

        setDrawing((prev) => ({
          ...prev,
          currentX: coords.x,
          currentY: coords.y,
          points:
            activeTool === 'freehand'
              ? [...prev.points, { x: coords.x, y: coords.y }]
              : prev.points,
        }));
      },
      [drawing.isDrawing, getPercentCoords, activeTool]
    );

    const handleMouseUp = useCallback(() => {
      if (!drawing.isDrawing) return;

      const { startX, startY, currentX, currentY, points } = drawing;

      switch (activeTool) {
        case 'freehand':
          if (points.length > 1) {
            saveMarkup('freehand', { points });
          }
          break;
        case 'line':
          saveMarkup('line', { x1: startX, y1: startY, x2: currentX, y2: currentY });
          break;
        case 'arrow':
          saveMarkup('arrow', { x1: startX, y1: startY, x2: currentX, y2: currentY });
          break;
        case 'rect': {
          const x = Math.min(startX, currentX);
          const y = Math.min(startY, currentY);
          const width = Math.abs(currentX - startX);
          const height = Math.abs(currentY - startY);
          if (width > 0.5 && height > 0.5) {
            saveMarkup('rect', { x, y, width, height });
          }
          break;
        }
      }

      setDrawing({
        isDrawing: false,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
        points: [],
      });
    }, [drawing, activeTool, saveMarkup]);

    // Render a stored or in-progress markup as SVG
    const renderMarkupSvg = (
      type: string,
      data: Record<string, unknown>,
      style: { color: string; strokeWidth: number },
      key: string
    ) => {
      switch (type) {
        case 'freehand': {
          const pts = data.points as { x: number; y: number }[];
          if (!pts || pts.length < 2) return null;
          const d = pts
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`)
            .join(' ');
          return (
            <path
              key={key}
              d={d}
              fill="none"
              stroke={style.color}
              strokeWidth={style.strokeWidth * 0.3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        }
        case 'line':
          return (
            <line
              key={key}
              x1={data.x1 as number}
              y1={data.y1 as number}
              x2={data.x2 as number}
              y2={data.y2 as number}
              stroke={style.color}
              strokeWidth={style.strokeWidth * 0.3}
              strokeLinecap="round"
            />
          );
        case 'arrow':
          return (
            <line
              key={key}
              x1={data.x1 as number}
              y1={data.y1 as number}
              x2={data.x2 as number}
              y2={data.y2 as number}
              stroke={style.color}
              strokeWidth={style.strokeWidth * 0.3}
              strokeLinecap="round"
              markerEnd="url(#arrowhead)"
            />
          );
        case 'rect':
          return (
            <rect
              key={key}
              x={data.x as number}
              y={data.y as number}
              width={data.width as number}
              height={data.height as number}
              fill="none"
              stroke={style.color}
              strokeWidth={style.strokeWidth * 0.3}
            />
          );
        case 'text': {
          const fontSize = style.strokeWidth * 1.2;
          return (
            <text
              key={key}
              x={data.x as number}
              y={data.y as number}
              fill={style.color}
              fontSize={fontSize}
              fontFamily="sans-serif"
              fontWeight="bold"
              dominantBaseline="hanging"
            >
              {data.text as string}
            </text>
          );
        }
        default:
          return null;
      }
    };

    // Build preview shape data from drawing state
    const getPreviewData = (): Record<string, unknown> | null => {
      if (!drawing.isDrawing) return null;
      const { startX, startY, currentX, currentY, points } = drawing;
      switch (activeTool) {
        case 'freehand':
          return { points };
        case 'line':
        case 'arrow':
          return { x1: startX, y1: startY, x2: currentX, y2: currentY };
        case 'rect': {
          return {
            x: Math.min(startX, currentX),
            y: Math.min(startY, currentY),
            width: Math.abs(currentX - startX),
            height: Math.abs(currentY - startY),
          };
        }
        default:
          return null;
      }
    };

    const previewData = getPreviewData();
    const isInteractive = activeTool !== 'pointer';
    // For 3D files with comment tool on live canvas: let clicks pass through for raycasting
    // But NOT when ephemeral (frozen snapshot) — handle clicks on the overlay instead
    const passThrough3DComment = is3DFile && activeTool === 'comment' && !ephemeral;

    // Positional comments for pins — either 2D (xPosition/yPosition) or 3D (worldX/Y/Z projected)
    const positionalComments = comments.filter(
      (c) => (c.xPosition !== null && c.yPosition !== null) || (c.worldX !== null && c.worldY !== null && c.worldZ !== null)
    );

    // Content transform style for SVG/pins to follow image zoom/pan (live view only)
    const transformStyle: React.CSSProperties = contentTransform ? {
      transform: `translate(${contentTransform.translateX}px, ${contentTransform.translateY}px) scale(${contentTransform.scale})`,
      transformOrigin: 'center center',
    } : {};

    return (
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ pointerEvents: passThrough3DComment ? 'none' : (isInteractive ? 'all' : 'none') }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Inner wrapper that transforms with content zoom/pan */}
        <div className="absolute inset-0" style={transformStyle}>
          {/* SVG layer for markups */}
          <svg
            ref={svgRef}
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ pointerEvents: 'none' }}
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#333" />
              </marker>
            </defs>

            {/* Render stored markups */}
            {markups.map((m) =>
              renderMarkupSvg(m.type, m.data as Record<string, unknown>, m.style, m.id)
            )}

            {/* Render in-progress preview */}
            {previewData &&
              renderMarkupSvg(
                activeTool,
                previewData,
                { color, strokeWidth },
                'preview'
              )}
          </svg>

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

            return (
              <CommentPin
                key={comment.id}
                index={idx + 1}
                x={pinX}
                y={pinY}
                isActive={activeCommentId === comment.id}
                onClick={() => onCommentPinClick(comment)}
              />
            );
          })}
        </div>

        {/* Text tool input popup */}
        {textPopup && (
          <div
            className="absolute z-30 bg-white rounded-lg shadow-lg border border-gray-200 p-2"
            style={{
              left: `${Math.min(textPopup.x, 70)}%`,
              top: `${Math.min(textPopup.y, 80)}%`,
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              type="text"
              autoFocus
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Type text..."
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              style={{ minWidth: 150 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleTextSubmit();
                }
                if (e.key === 'Escape') {
                  setTextPopup(null);
                  setTextInput('');
                }
              }}
            />
            <div className="flex justify-end gap-1.5 mt-1.5">
              <button
                onClick={() => { setTextPopup(null); setTextInput(''); }}
                className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleTextSubmit}
                disabled={!textInput.trim()}
                className="px-2.5 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
);

export default MarkupOverlay;
