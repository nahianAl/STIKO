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
    const [textFontSize, setTextFontSize] = useState(16);
    const [textBold, setTextBold] = useState(false);
    const [textItalic, setTextItalic] = useState(false);
    const [textUnderline, setTextUnderline] = useState(false);
    const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('left');

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
              pageNumber: null,
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
      saveMarkup('text', {
        x: textPopup.x,
        y: textPopup.y,
        text: textInput.trim(),
        fontSize: textFontSize,
        bold: textBold,
        italic: textItalic,
        underline: textUnderline,
        align: textAlign,
      });
      setTextPopup(null);
      setTextInput('');
    }, [textPopup, textInput, textFontSize, textBold, textItalic, textUnderline, textAlign, saveMarkup]);

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
          const fs = (data.fontSize as number) ?? style.strokeWidth * 1.2;
          // Scale font size: stored as px (e.g. 16), SVG viewBox is 100-unit.
          // Use ~0.28 factor so 16px ≈ 4.5 SVG units (readable on the 100x100 viewBox).
          const svgFontSize = fs * 0.28;
          const isBold = (data.bold as boolean) ?? true;
          const isItalic = (data.italic as boolean) ?? false;
          const isUnderline = (data.underline as boolean) ?? false;
          const align = (data.align as string) ?? 'left';
          const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
          return (
            <text
              key={key}
              x={data.x as number}
              y={data.y as number}
              fill={style.color}
              fontSize={svgFontSize}
              fontFamily="sans-serif"
              fontWeight={isBold ? 'bold' : 'normal'}
              fontStyle={isItalic ? 'italic' : 'normal'}
              textDecoration={isUnderline ? 'underline' : 'none'}
              textAnchor={anchor}
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
            className="absolute z-30 rounded-xl shadow-xl overflow-hidden"
            style={{
              left: `${Math.min(textPopup.x, 60)}%`,
              top: `${Math.min(textPopup.y, 70)}%`,
              width: 320,
              backgroundColor: '#2a2a2e',
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Text input area */}
            <div className="p-3">
              <input
                type="text"
                autoFocus
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Type text..."
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                style={{
                  backgroundColor: '#3a3a3e',
                  color: '#fff',
                  border: '1px solid #4a4a4e',
                  fontWeight: textBold ? 'bold' : 'normal',
                  fontStyle: textItalic ? 'italic' : 'normal',
                  textDecoration: textUnderline ? 'underline' : 'none',
                  textAlign: textAlign,
                }}
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
            </div>

            {/* Formatting toolbar */}
            <div className="flex items-center gap-1 px-3 pb-3">
              {/* Alignment buttons */}
              {(['left', 'center', 'right'] as const).map((a) => (
                <button
                  key={a}
                  title={`Align ${a}`}
                  onClick={() => setTextAlign(a)}
                  className="w-8 h-8 flex items-center justify-center rounded transition-colors"
                  style={{
                    backgroundColor: textAlign === a ? '#4a4a4e' : 'transparent',
                    color: textAlign === a ? '#fff' : '#999',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    {a === 'left' && (
                      <>
                        <line x1="1" y1="2" x2="13" y2="2" />
                        <line x1="1" y1="5.5" x2="9" y2="5.5" />
                        <line x1="1" y1="9" x2="11" y2="9" />
                        <line x1="1" y1="12.5" x2="8" y2="12.5" />
                      </>
                    )}
                    {a === 'center' && (
                      <>
                        <line x1="1" y1="2" x2="13" y2="2" />
                        <line x1="3" y1="5.5" x2="11" y2="5.5" />
                        <line x1="2" y1="9" x2="12" y2="9" />
                        <line x1="4" y1="12.5" x2="10" y2="12.5" />
                      </>
                    )}
                    {a === 'right' && (
                      <>
                        <line x1="1" y1="2" x2="13" y2="2" />
                        <line x1="5" y1="5.5" x2="13" y2="5.5" />
                        <line x1="3" y1="9" x2="13" y2="9" />
                        <line x1="6" y1="12.5" x2="13" y2="12.5" />
                      </>
                    )}
                  </svg>
                </button>
              ))}

              {/* Divider */}
              <div className="w-px h-5 mx-0.5" style={{ backgroundColor: '#4a4a4e' }} />

              {/* Font size selector */}
              <select
                value={textFontSize}
                onChange={(e) => setTextFontSize(Number(e.target.value))}
                className="h-8 rounded px-1.5 text-xs outline-none cursor-pointer appearance-none text-center"
                style={{
                  backgroundColor: '#3a3a3e',
                  color: '#ccc',
                  border: '1px solid #4a4a4e',
                  width: 48,
                }}
                title="Font size"
              >
                {[10, 12, 14, 16, 20, 24, 32, 40, 48, 64].map((s) => (
                  <option key={s} value={s}>{s}px</option>
                ))}
              </select>

              {/* Divider */}
              <div className="w-px h-5 mx-0.5" style={{ backgroundColor: '#4a4a4e' }} />

              {/* Bold */}
              <button
                title="Bold"
                onClick={() => setTextBold((b) => !b)}
                className="w-8 h-8 flex items-center justify-center rounded text-sm font-bold transition-colors"
                style={{
                  backgroundColor: textBold ? '#4a4a4e' : 'transparent',
                  color: textBold ? '#fff' : '#999',
                }}
              >
                B
              </button>

              {/* Italic */}
              <button
                title="Italic"
                onClick={() => setTextItalic((i) => !i)}
                className="w-8 h-8 flex items-center justify-center rounded text-sm transition-colors"
                style={{
                  backgroundColor: textItalic ? '#4a4a4e' : 'transparent',
                  color: textItalic ? '#fff' : '#999',
                  fontStyle: 'italic',
                }}
              >
                I
              </button>

              {/* Underline */}
              <button
                title="Underline"
                onClick={() => setTextUnderline((u) => !u)}
                className="w-8 h-8 flex items-center justify-center rounded text-sm transition-colors"
                style={{
                  backgroundColor: textUnderline ? '#4a4a4e' : 'transparent',
                  color: textUnderline ? '#fff' : '#999',
                  textDecoration: 'underline',
                }}
              >
                U
              </button>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Submit button */}
              <button
                title="Add text"
                onClick={handleTextSubmit}
                disabled={!textInput.trim()}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-white transition-colors disabled:opacity-40"
                style={{ backgroundColor: textInput.trim() ? '#3b82f6' : '#3a3a3e' }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2 7 6 11 12 3" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
);

export default MarkupOverlay;
