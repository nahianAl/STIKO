'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Button from '@/components/ui/Button';
import Header from '@/components/ui/Header';
import FileTreeSidebar from '@/components/portal/FileTreeSidebar';
import CommentsPanel from '@/components/portal/CommentsPanel';
import CommentComposer from '@/components/portal/CommentComposer';
import { uploadFile, dataUrlToFile } from '@/lib/uploadAttachment';
import ViewerContainer, { type WorldPin, type PinScreenPosition, type ContentTransform, type PDFKonvaViewerHandle } from '@/components/viewers/ViewerContainer';
import DrawingTools from '@/components/markup/DrawingTools';
import MarkupOverlay, { type MarkupOverlayHandle } from '@/components/markup/MarkupOverlay';
import type { Comment } from '@/lib/types';

interface Project {
  id: string;
  name: string;
  createdAt: string;
}

interface Portal {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
}

interface Version {
  id: string;
  portalId: string;
  versionNumber: number;
  createdAt: string;
}

interface FileRecord {
  id: string;
  versionId: string;
  filename: string;
  storageKey: string;
  fileSize: number;
  fileType: string;
  createdAt: string;
  conversionStatus: 'pending' | 'processing' | 'completed' | 'failed' | null;
  convertedStorageKey: string | null;
  conversionJobId: string | null;
  folderPath: string | null;
}

interface Participant {
  id: string;
  portalId: string;
  email: string;
  role: string;
  createdAt: string;
}

type ToolType = 'pointer' | 'comment' | 'freehand' | 'line' | 'arrow' | 'rect' | 'text';

const MODEL_3D_EXTENSIONS = ['.glb', '.gltf', '.step', '.stp', '.obj', '.stl', '.3ds', '.ply', '.dae'];

const DRAW_TOOLS: ToolType[] = ['freehand', 'line', 'arrow', 'rect', 'text'];

// Captures the current viewer state as a JPEG data URL.
// Tries WebGL canvas first (3D), then img, then video.
function captureViewerSnapshot(container: HTMLElement): string | null {
  // WebGL canvas (3D models, PDF)
  const canvas = container.querySelector('canvas') as HTMLCanvasElement | null;
  if (canvas) {
    try {
      return canvas.toDataURL('image/jpeg', 0.92);
    } catch (e) {
      console.error('Canvas capture failed:', e);
    }
  }

  // Image viewer
  const img = container.querySelector('img') as HTMLImageElement | null;
  if (img && img.complete && img.naturalWidth > 0) {
    const containerRect = container.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    const offscreen = document.createElement('canvas');
    offscreen.width = containerRect.width;
    offscreen.height = containerRect.height;
    const ctx = offscreen.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#f9fafb';
      ctx.fillRect(0, 0, offscreen.width, offscreen.height);
      ctx.drawImage(
        img,
        imgRect.left - containerRect.left,
        imgRect.top - containerRect.top,
        imgRect.width,
        imgRect.height
      );
      try {
        return offscreen.toDataURL('image/jpeg', 0.92);
      } catch (e) {
        console.error('Image capture failed:', e);
      }
    }
  }

  // Video viewer
  const video = container.querySelector('video') as HTMLVideoElement | null;
  if (video && video.readyState >= 2 && video.videoWidth > 0) {
    const containerRect = container.getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();
    const offscreen = document.createElement('canvas');
    offscreen.width = containerRect.width;
    offscreen.height = containerRect.height;
    const ctx = offscreen.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, offscreen.width, offscreen.height);
      ctx.drawImage(
        video,
        videoRect.left - containerRect.left,
        videoRect.top - containerRect.top,
        videoRect.width,
        videoRect.height
      );
      return offscreen.toDataURL('image/jpeg', 0.92);
    }
  }

  return null;
}

// Composites a snapshot image with SVG markup into a single JPEG data URL.
async function compositeSnapshotWithMarkup(
  snapshotDataUrl: string,
  svgElement: SVGSVGElement,
  width: number,
  height: number
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Draw snapshot background
  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
      resolve();
    };
    img.onerror = reject;
    img.src = snapshotDataUrl;
  });

  // Draw SVG markup overlay — use base64 data URL (blob URLs can fail for SVG in some browsers)
  const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
  svgClone.setAttribute('width', String(width));
  svgClone.setAttribute('height', String(height));
  const svgData = new XMLSerializer().serializeToString(svgClone);
  const svgDataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));

  await new Promise<void>((resolve) => {
    const svgImg = new Image();
    svgImg.onload = () => {
      ctx.drawImage(svgImg, 0, 0, width, height);
      resolve();
    };
    // If SVG overlay fails, still resolve — snapshot without markup is better than nothing
    svgImg.onerror = () => {
      console.warn('SVG overlay failed to composite; snapshot will have no markup drawn on it');
      resolve();
    };
    svgImg.src = svgDataUrl;
  });

  return canvas.toDataURL('image/jpeg', 0.88);
}

export default function PortalPage() {
  const params = useParams();
  const portalId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [portal, setPortal] = useState<Portal | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [showParticipants, setShowParticipants] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(false);
  const [commentsCollapsed, setCommentsCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Drawing tools state
  const [activeTool, setActiveTool] = useState<ToolType>('pointer');
  const [drawingColor, setDrawingColor] = useState('#ef4444');
  const [drawingStrokeWidth, setDrawingStrokeWidth] = useState(4);

  // Comment linking state
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsRefreshKey, setCommentsRefreshKey] = useState(0);

  // Top-level composer draft (single source of truth)
  const [composerText, setComposerText] = useState('');
  const [composerFiles, setComposerFiles] = useState<File[]>([]);
  const [composerAuthor, setComposerAuthor] = useState('Anonymous');
  const [submittingComposer, setSubmittingComposer] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [pendingTag, setPendingTag] = useState<{
    xPosition?: number; yPosition?: number;
    worldX?: number; worldY?: number; worldZ?: number;
    pageNumber?: number; timestamp?: number;
  } | null>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);

  // Snapshot state (annotation mode — frozen view for drawing)
  const [viewerSnapshot, setViewerSnapshot] = useState<string | null>(null);
  const viewerAreaRef = useRef<HTMLDivElement>(null);
  const markupOverlayRef = useRef<MarkupOverlayHandle>(null);
  const prevActiveToolRef = useRef<ToolType>('pointer');

  // Selected file (needed before 3D state)
  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null;

  // 3D comment pin state
  const [worldPinPositions, setWorldPinPositions] = useState<Map<string, PinScreenPosition>>(new Map());

  const is3DFile = useMemo(() => {
    if (!selectedFile) return false;
    const ext = selectedFile.filename.split('.').pop()?.toLowerCase() ?? '';
    return MODEL_3D_EXTENSIONS.includes(`.${ext}`);
  }, [selectedFile]);

  const isPDFFile = useMemo(() => {
    if (!selectedFile) return false;
    const ext = selectedFile.filename.split('.').pop()?.toLowerCase() ?? '';
    return ext === 'pdf';
  }, [selectedFile]);

  const pdfKonvaRef = useRef<PDFKonvaViewerHandle>(null);

  const worldPins: WorldPin[] = useMemo(() => {
    return comments
      .filter((c) => c.worldX !== null && c.worldY !== null && c.worldZ !== null)
      .map((c) => ({ id: c.id, worldX: c.worldX!, worldY: c.worldY!, worldZ: c.worldZ! }));
  }, [comments]);

  const handleSceneClick = useCallback(
    (worldPoint: { x: number; y: number; z: number }, screenPercent: { x: number; y: number }) => {
      setPendingTag({
        xPosition: screenPercent.x,
        yPosition: screenPercent.y,
        worldX: worldPoint.x,
        worldY: worldPoint.y,
        worldZ: worldPoint.z,
      });
      setTagging(false);
    },
    []
  );

  const handlePinPositionsUpdate = useCallback((positions: Map<string, PinScreenPosition>) => {
    setWorldPinPositions(positions);
  }, []);

  // Content transform for markups to follow image zoom/pan
  const [contentTransform, setContentTransform] = useState<ContentTransform | null>(null);
  const handleTransformChange = useCallback((transform: ContentTransform) => {
    setContentTransform(transform);
  }, []);

  // Fetch portal details and parent project
  useEffect(() => {
    const fetchPortal = async () => {
      try {
        const res = await fetch(`/api/portals/${portalId}`);
        if (res.ok) {
          const data = await res.json();
          setPortal(data);
          try {
            const projRes = await fetch(`/api/projects/${data.projectId}`);
            if (projRes.ok) {
              const projData = await projRes.json();
              setProject(projData);
            }
          } catch (projErr) {
            console.error('Failed to fetch project:', projErr);
          }
        }
      } catch (err) {
        console.error('Failed to fetch portal:', err);
      }
    };
    fetchPortal();
  }, [portalId]);

  // Fetch participants
  useEffect(() => {
    const fetchParticipants = async () => {
      try {
        const res = await fetch(`/api/participants?portalId=${portalId}`);
        const data = await res.json();
        setParticipants(data);
      } catch (err) {
        console.error('Failed to fetch participants:', err);
      }
    };
    fetchParticipants();
  }, [portalId]);

  // Fetch versions and select latest
  useEffect(() => {
    const fetchVersions = async () => {
      try {
        const res = await fetch(`/api/versions?portalId=${portalId}`);
        const data: Version[] = await res.json();
        setVersions(data);
        if (data.length > 0) {
          setSelectedVersionId(data[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch versions:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchVersions();
  }, [portalId]);

  // Fetch files when version changes
  const fetchFiles = useCallback(async (versionId: string) => {
    setFilesLoading(true);
    try {
      const res = await fetch(`/api/files?versionId=${versionId}`);
      const data: FileRecord[] = await res.json();
      setFiles(data);
      if (data.length > 0) {
        setSelectedFileId(data[0].id);
      } else {
        setSelectedFileId(null);
      }
    } catch (err) {
      console.error('Failed to fetch files:', err);
    } finally {
      setFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedVersionId) {
      fetchFiles(selectedVersionId);
    }
  }, [selectedVersionId, fetchFiles]);

  // Fetch comments for the selected file (for pins)
  const fetchComments = useCallback(async () => {
    if (!selectedFileId) {
      setComments([]);
      return;
    }
    try {
      const res = await fetch(`/api/comments?fileId=${selectedFileId}`);
      if (res.ok) {
        const data = await res.json();
        setComments(data);
      }
    } catch (err) {
      console.error('Failed to fetch comments for pins:', err);
    }
  }, [selectedFileId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments, commentsRefreshKey]);

  // Freeze a snapshot when entering a draw tool (non-PDF). PDF draws on its live canvas.
  useEffect(() => {
    const prevTool = prevActiveToolRef.current;
    prevActiveToolRef.current = activeTool;

    if (!DRAW_TOOLS.includes(activeTool)) {
      setViewerSnapshot(null);
      return;
    }
    if (isPDFFile) return;
    if (DRAW_TOOLS.includes(prevTool)) return; // snapshot already captured

    const container = viewerAreaRef.current;
    if (!container) return;
    const snapshot = captureViewerSnapshot(container);
    if (snapshot) setViewerSnapshot(snapshot);
  }, [activeTool, isPDFFile]);

  // Discard snapshots and reset transform when the selected file changes
  useEffect(() => {
    setViewerSnapshot(null);
    setContentTransform(null);
    setComposerText('');
    setComposerFiles([]);
    setPendingTag(null);
    setTagging(false);
  }, [selectedFileId]);

  const handleSelectVersion = (versionId: string) => {
    setSelectedVersionId(versionId);
    setSelectedFileId(null);
    setFiles([]);
    setActiveTool('pointer');
    setActiveCommentId(null);
  };

  // Tag placement (image / video). Captures video timestamp when applicable.
  const handleCommentPlace = useCallback((percentX: number, percentY: number) => {
    const video = viewerAreaRef.current?.querySelector('video') as HTMLVideoElement | null;
    setPendingTag({
      xPosition: percentX,
      yPosition: percentY,
      timestamp: video ? video.currentTime : undefined,
    });
    setTagging(false);
  }, []);

  const handlePDFCommentPlace = useCallback((percentX: number, percentY: number, pageNumber: number) => {
    setPendingTag({ xPosition: percentX, yPosition: percentY, pageNumber });
    setTagging(false);
  }, []);

  const handleComposerSubmit = async () => {
    if (!selectedFileId) return;
    if (!composerText.trim() && composerFiles.length === 0 && !pendingTag) return;
    setSubmittingComposer(true);
    try {
      const attachments = composerFiles.length > 0
        ? await Promise.all(composerFiles.map(uploadFile))
        : [];
      await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: selectedFileId,
          content: composerText.trim() || (attachments.length > 0 ? 'Attachment' : ''),
          author: composerAuthor.trim() || 'Anonymous',
          xPosition: pendingTag?.xPosition ?? null,
          yPosition: pendingTag?.yPosition ?? null,
          worldX: pendingTag?.worldX ?? null,
          worldY: pendingTag?.worldY ?? null,
          worldZ: pendingTag?.worldZ ?? null,
          pageNumber: pendingTag?.pageNumber ?? null,
          timestamp: pendingTag?.timestamp ?? null,
          attachments,
        }),
      });
      setComposerText('');
      setComposerFiles([]);
      setPendingTag(null);
      setTagging(false);
      setCommentsRefreshKey((k) => k + 1);
      await fetchComments();
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setSubmittingComposer(false);
    }
  };

  const handleAnnotationDone = async () => {
    let dataUrl: string | null = null;
    try {
      if (isPDFFile && pdfKonvaRef.current) {
        dataUrl = pdfKonvaRef.current.captureSnapshot();
      } else if (viewerSnapshot && markupOverlayRef.current && viewerAreaRef.current) {
        const svgEl = markupOverlayRef.current.getSvgElement();
        if (svgEl) {
          const { clientWidth, clientHeight } = viewerAreaRef.current;
          dataUrl = await compositeSnapshotWithMarkup(viewerSnapshot, svgEl, clientWidth, clientHeight);
        }
      }
      if (dataUrl) {
        const file = await dataUrlToFile(dataUrl, `annotation-${Date.now()}.jpg`);
        setComposerFiles((prev) => [...prev, file]);
      }
    } catch (e) {
      console.error('Failed to finish annotation:', e);
    } finally {
      if (isPDFFile) pdfKonvaRef.current?.clearDrawings();
      else markupOverlayRef.current?.clearDrawings();
      setActiveTool('pointer'); // clears the frozen snapshot via the effect above
      setTimeout(() => composerInputRef.current?.focus(), 0);
    }
  };

  const handleAnnotationDiscard = () => {
    if (isPDFFile) pdfKonvaRef.current?.clearDrawings();
    else markupOverlayRef.current?.clearDrawings();
    setActiveTool('pointer');
  };

  const handleCommentPinClick = useCallback((comment: Comment) => {
    setActiveCommentId((prev) => (prev === comment.id ? null : comment.id));
  }, []);

  const handleCommentClick = useCallback((comment: Comment) => {
    setActiveCommentId((prev) => (prev === comment.id ? null : comment.id));
    if (comment.timestamp != null) {
      const video = viewerAreaRef.current?.querySelector('video') as HTMLVideoElement | null;
      if (video) video.currentTime = comment.timestamp;
    }
  }, []);

  const renderFileViewer = () => {
    if (filesLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      );
    }

    if (!selectedFile) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-gray-400">
          <svg className="h-12 w-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <p className="text-sm">Select a file to view</p>
        </div>
      );
    }

    const isHidden = !isPDFFile && !!viewerSnapshot;

    return (
      <>
        {/* Live viewer — always mounted, hidden when snapshot/review mode is active */}
        <div style={{
          visibility: isHidden ? 'hidden' : 'visible',
          position: 'absolute',
          inset: 0,
        }}>
          <ViewerContainer
            file={selectedFile}
            frozen={!!viewerSnapshot}
            commentToolActive={is3DFile && tagging}
            onSceneClick={handleSceneClick}
            worldPins={worldPins}
            onPinPositionsUpdate={handlePinPositionsUpdate}
            onTransformChange={handleTransformChange}
            activeTool={activeTool}
            tagging={tagging}
            color={drawingColor}
            strokeWidth={drawingStrokeWidth}
            fileId={selectedFileId!}
            onCommentPlace={handlePDFCommentPlace}
            comments={comments}
            activeCommentId={activeCommentId}
            onCommentPinClick={handleCommentPinClick}
            pdfViewerRef={pdfKonvaRef}
          />
        </div>

        {/* Annotation mode: frozen snapshot for drawing on */}
        {viewerSnapshot && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={viewerSnapshot}
            alt="Viewer snapshot"
            className="absolute inset-0 w-full h-full object-contain bg-gray-100"
            draggable={false}
          />
        )}
      </>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <Header
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          ...(project ? [{ label: project.name, href: `/project/${project.id}` }] : []),
          { label: portal?.name ?? 'Loading...' },
        ]}
        rightContent={
          <div className="flex items-center gap-3">
            <div className="relative">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowParticipants(!showParticipants)}
              >
                Participants ({participants.length})
              </Button>
              {showParticipants && (
                <div className="absolute right-0 top-full mt-2 w-64 rounded-lg border border-gray-200 bg-white shadow-lg z-20">
                  <div className="p-3 border-b border-gray-100">
                    <p className="text-xs font-semibold text-gray-900">
                      Participants
                    </p>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {participants.length === 0 ? (
                      <p className="p-3 text-xs text-gray-400">
                        No participants yet
                      </p>
                    ) : (
                      participants.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between px-3 py-2 text-xs border-b border-gray-50 last:border-0"
                        >
                          <span className="text-gray-700 truncate">
                            {p.email}
                          </span>
                          <span className="text-gray-400 capitalize ml-2">
                            {p.role}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <Link href={`/portal/${portalId}/submit`}>
              <Button size="sm">Submit New Version</Button>
            </Link>
          </div>
        }
      />

      {/* 3-Panel Layout */}
      <div className={`flex-1 grid h-[calc(100vh-64px)] ${
        sidebarCollapsed && commentsCollapsed ? 'grid-cols-[48px_1fr_48px]' :
        sidebarCollapsed ? 'grid-cols-[48px_1fr_320px]' :
        commentsCollapsed ? 'grid-cols-[280px_1fr_48px]' :
        'grid-cols-[280px_1fr_320px]'
      }`}>
        {/* Left Panel: File Tree Sidebar */}
        <FileTreeSidebar
          versions={versions}
          selectedVersionId={selectedVersionId}
          onSelectVersion={handleSelectVersion}
          files={files}
          selectedFileId={selectedFileId}
          onSelectFile={setSelectedFileId}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        />

        {/* Center Panel: File Viewer with Drawing Tools & Markup Overlay */}
        <div className="flex flex-col h-full overflow-hidden bg-gray-50">
          <DrawingTools
            activeTool={activeTool}
            onToolChange={setActiveTool}
            color={drawingColor}
            onColorChange={setDrawingColor}
            strokeWidth={drawingStrokeWidth}
            onStrokeWidthChange={setDrawingStrokeWidth}
          />

          {/* Annotation mode banner */}
          {DRAW_TOOLS.includes(activeTool) && (
            <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-2 text-xs text-amber-700 flex-shrink-0">
              <span className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                Annotating — draw on the file, then attach it to a comment
              </span>
              <span className="flex items-center gap-1.5">
                <button
                  onClick={handleAnnotationDiscard}
                  className="px-2 py-1 rounded text-amber-700 hover:bg-amber-100 transition-colors"
                >
                  Discard
                </button>
                <button
                  onClick={handleAnnotationDone}
                  className="px-3 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors font-medium"
                >
                  Done
                </button>
              </span>
            </div>
          )}

          <div ref={viewerAreaRef} className="relative flex-1 overflow-hidden">
            {renderFileViewer()}
            {selectedFileId && !isPDFFile && (
              <MarkupOverlay
                ref={markupOverlayRef}
                fileId={selectedFileId}
                activeTool={activeTool}
                tagging={tagging}
                color={drawingColor}
                strokeWidth={drawingStrokeWidth}
                onCommentPlace={handleCommentPlace}
                comments={comments}
                activeCommentId={activeCommentId}
                onCommentPinClick={handleCommentPinClick}
                ephemeral={!!viewerSnapshot}
                is3DFile={is3DFile}
                worldPinPositions={worldPinPositions}
                contentTransform={viewerSnapshot ? null : contentTransform}
              />
            )}
          </div>
        </div>

        {/* Right Panel: Comments */}
        <CommentsPanel
          fileId={selectedFileId}
          onCommentClick={handleCommentClick}
          activeCommentId={activeCommentId}
          refreshKey={commentsRefreshKey}
          collapsed={commentsCollapsed}
          onToggleCollapse={() => setCommentsCollapsed((c) => !c)}
          composer={
            <CommentComposer
              authorName={composerAuthor}
              onAuthorChange={setComposerAuthor}
              text={composerText}
              onTextChange={setComposerText}
              pendingFiles={composerFiles}
              onFilesChange={setComposerFiles}
              tagging={tagging}
              onToggleTagging={() => setTagging((t) => !t)}
              hasTag={!!pendingTag}
              onClearTag={() => setPendingTag(null)}
              onSubmit={handleComposerSubmit}
              submitting={submittingComposer}
              inputRef={composerInputRef}
            />
          }
        />
      </div>
    </div>
  );
}
