'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import LoadingCube from '@/components/ui/LoadingCube';
import PortalTopBar from '@/components/portal/PortalTopBar';
import FileTreeSidebar from '@/components/portal/FileTreeSidebar';
import CommentsPanel from '@/components/portal/CommentsPanel';
import CommentComposer from '@/components/portal/CommentComposer';
import { NewVersionDrawer } from '@/components/portal/NewVersionDrawer';
import { uploadFile, dataUrlToFile } from '@/lib/uploadAttachment';
import { manrope } from '@/lib/fonts';
import ViewerContainer, { type WorldPin, type PinScreenPosition, type ContentTransform, type PDFKonvaViewerHandle, type ModelViewerHandle } from '@/components/viewers/ViewerContainer';
import FocalLengthControl from '@/components/viewers/FocalLengthControl';
import CrossSectionControl from '@/components/viewers/CrossSectionControl';
import TransformTools from '@/components/viewers/TransformTools';
import DrawingTools from '@/components/markup/DrawingTools';
import MarkupOverlay from '@/components/markup/MarkupOverlay';
import type { Comment, FileRecord } from '@/lib/types';
import { DEFAULT_FOCAL_LENGTH } from '@/lib/focalLength';
import { DEFAULT_CROSS_SECTION, type CrossSection } from '@/lib/crossSection';

// AnnotationCanvas uses react-konva, which cannot be server-rendered (same reason
// PDFKonvaViewer is dynamically imported in ViewerContainer).
const AnnotationCanvas = dynamic(() => import('@/components/markup/AnnotationCanvas'), { ssr: false });
import type { AnnotationCanvasHandle } from '@/components/markup/AnnotationCanvas';
import type { AnnTool } from '@/components/markup/useAnnotationObjects';

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

interface Participant {
  id: string;
  portalId: string;
  email: string;
  role: string;
  createdAt: string;
}

type ToolType = 'pointer' | 'comment' | 'freehand' | 'line' | 'arrow' | 'rect' | 'text' | 'eraser';

const MODEL_3D_EXTENSIONS = ['.glb', '.gltf', '.step', '.stp', '.obj', '.stl', '.3ds', '.ply', '.dae'];

const DRAW_TOOLS: ToolType[] = ['freehand', 'line', 'arrow', 'rect', 'text'];

// Synthetic id for the not-yet-posted tag, so it renders as a live preview pin
const PENDING_TAG_ID = '__pending_tag__';

// Captures the current viewer state as a JPEG data URL.
// Tries WebGL canvas first (3D), then img, then video.
function captureViewerSnapshot(container: HTMLElement): string | null {
  // WebGL canvas (3D models). The R3F canvas renders to a transparent buffer, so encoding it
  // straight to JPEG flattens the transparent areas to black. Composite onto the viewer's real
  // background (#f0f0f0, set in ModelViewerInner) first so the snapshot keeps the gray the user sees.
  const canvas = container.querySelector('canvas') as HTMLCanvasElement | null;
  if (canvas) {
    try {
      const offscreen = document.createElement('canvas');
      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      const ctx = offscreen.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, offscreen.width, offscreen.height);
        ctx.drawImage(canvas, 0, 0);
        return offscreen.toDataURL('image/jpeg', 0.92);
      }
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
  const [loading, setLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(false);
  const [commentsCollapsed, setCommentsCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 2e: submitting a version is a drawer over this view, not a route change —
  // no navigation, no reload, no lost zoom or scroll.
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false);
  const [canUpload, setCanUpload] = useState(false);
  const [canTransform, setCanTransform] = useState(false);

  // Drawing tools state
  const [activeTool, setActiveTool] = useState<ToolType>('pointer');
  const [drawingColor, setDrawingColor] = useState('#FF6B6B'); // red-pastel accent; matches default toolbar swatch
  const [drawingStrokeWidth, setDrawingStrokeWidth] = useState(4);

  // Comment linking state
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsRefreshKey, setCommentsRefreshKey] = useState(0);

  // Top-level composer draft (single source of truth)
  const [composerText, setComposerText] = useState('');
  const [composerFiles, setComposerFiles] = useState<File[]>([]);
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
  // An attachment/snapshot opened for full viewing in the center viewport
  const [viewportImage, setViewportImage] = useState<string | null>(null);
  const [annotating, setAnnotating] = useState(false);
  // Index into composerFiles while marking up an attachment the user has picked
  // but not yet posted. Null means the session is the ordinary one over the
  // viewer. It decides three things: which surface draws, whether Done replaces
  // or appends, and what the banner says.
  const [annotatingAttachment, setAnnotatingAttachment] = useState<number | null>(null);
  const annotationCanvasRef = useRef<AnnotationCanvasHandle>(null);
  const modelViewerRef = useRef<ModelViewerHandle>(null);
  const viewerAreaRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Selected file (needed before 3D state)
  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null;

  // 3D comment pin state
  const [worldPinPositions, setWorldPinPositions] = useState<Map<string, PinScreenPosition>>(new Map());

  // null hides the gizmo. Only ever set for a role that may transform.
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | null>(null);

  // Session only: a lens is how you happen to be looking at something, not a property of
  // the design, so it is deliberately not persisted the way the object transform is.
  const [focalLength, setFocalLength] = useState(DEFAULT_FOCAL_LENGTH);

  // Session only, like the focal length: a cut is a way of looking at the model, not a
  // property of the design. Null means not sectioned; the last cut is remembered in
  // `lastSection` so toggling the tool off and on does not throw away your position.
  const [crossSection, setCrossSection] = useState<CrossSection | null>(null);
  const lastSection = useRef<CrossSection>(DEFAULT_CROSS_SECTION);

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

  // Live preview: include the not-yet-posted tag among the pins so the user sees exactly where it lands.
  const pinComments: Comment[] = useMemo(() => {
    if (!pendingTag || !selectedFileId) return comments;
    const pending: Comment = {
      id: PENDING_TAG_ID,
      fileId: selectedFileId,
      parentCommentId: null,
      content: '',
      xPosition: pendingTag.xPosition ?? null,
      yPosition: pendingTag.yPosition ?? null,
      worldX: pendingTag.worldX ?? null,
      worldY: pendingTag.worldY ?? null,
      worldZ: pendingTag.worldZ ?? null,
      pageNumber: pendingTag.pageNumber ?? null,
      timestamp: pendingTag.timestamp ?? null,
      author: 'You',
      createdAt: '',
      snapshotUrl: null,
      attachments: [],
    };
    return [...comments, pending];
  }, [comments, pendingTag, selectedFileId]);

  const worldPins: WorldPin[] = useMemo(() => {
    return pinComments
      .filter((c) => c.worldX !== null && c.worldY !== null && c.worldZ !== null)
      .map((c) => ({ id: c.id, worldX: c.worldX!, worldY: c.worldY!, worldZ: c.worldZ! }));
  }, [pinComments]);

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

  const handleCrossSectionChange = useCallback((next: CrossSection | null) => {
    if (next) lastSection.current = next;
    setCrossSection(next);
  }, []);

  // Content transform for markups to follow image zoom/pan
  const [contentTransform, setContentTransform] = useState<ContentTransform | null>(null);
  const handleTransformChange = useCallback((transform: ContentTransform) => {
    setContentTransform(transform);
  }, []);

  // Persist the 3D object's move/rotate gizmo transform once a drag ends.
  const handleTransformCommit = useCallback(
    async (transform: { position: [number, number, number]; rotation: [number, number, number] }) => {
      if (!selectedFileId) return;
      try {
        const res = await fetch(`/api/files/${selectedFileId}/transform`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(transform),
        });
        if (!res.ok) throw new Error(`Transform save failed: ${res.status}`);
        // Keep the in-memory file in step so a re-render does not snap the object back
        // to the position it had when the list was last fetched.
        setFiles((prev) =>
          prev.map((f) => (f.id === selectedFileId ? { ...f, transform } : f))
        );
      } catch (e) {
        console.error('Failed to save object transform:', e);
        // Put the object back where it is actually persisted. The gizmo has already moved the
        // group directly, and nothing else will undo that — leaving it there would mean the
        // view and the stored placement disagree, and any comment pin placed next would be
        // saved against the wrong frame. A fresh object identity is what makes the viewer's
        // re-apply effect fire, since the values themselves are unchanged.
        setFiles((prev) =>
          prev.map((f) =>
            f.id === selectedFileId
              ? {
                  ...f,
                  transform: {
                    position: [...f.transform.position] as [number, number, number],
                    rotation: [...f.transform.rotation] as [number, number, number],
                  },
                }
              : f
          )
        );
      }
    },
    [selectedFileId]
  );

  // Fetch package details and the parent project's NAME for the breadcrumb.
  //
  // The name comes from the package's own access endpoint rather than
  // /api/projects/[id]: a guest is not a project member, so that route
  // correctly refuses them (01 — guests cannot see the project). They still
  // need the name as breadcrumb context, which is package-scoped information
  // they are already entitled to.
  useEffect(() => {
    const fetchPortal = async () => {
      try {
        const res = await fetch(`/api/portals/${portalId}`);
        if (!res.ok) return;
        setPortal(await res.json());

        const accessRes = await fetch(`/api/portals/${portalId}/access`);
        if (accessRes.ok) {
          const info = await accessRes.json();
          setProject({
            id: info.package.projectId,
            name: info.package.projectName,
            createdAt: '',
          });
        }
      } catch (err) {
        console.error('Failed to fetch package:', err);
      }
    };
    fetchPortal();
  }, [portalId]);

  // Fetch participants
  useEffect(() => {
    const fetchParticipants = async () => {
      try {
        const res = await fetch(`/api/participants?portalId=${portalId}`);
        if (!res.ok) return;
        const data = await res.json();
        setParticipants(data);
      } catch (err) {
        console.error('Failed to fetch participants:', err);
      }
    };
    fetchParticipants();
  }, [portalId]);

  // What this viewer is allowed to do here. Drives whether the submit
  // affordances render at all — a commenter never sees them.
  useEffect(() => {
    fetch(`/api/portals/${portalId}/access`)
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        setCanUpload(Boolean(info?.access?.canUpload));
        setCanTransform(Boolean(info?.access?.canTransform));
      })
      .catch(() => {
        setCanUpload(false);
        setCanTransform(false);
      });
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
      // Record that this person opened the version. This is what makes 4b's
      // not-opened / viewed-no-comment distinction real, and what keeps the
      // personal "NEW VERSION" pill honest.
      fetch('/api/version-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: selectedVersionId }),
      }).catch(() => {});
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

  // Starts an annotation session (captures the live-view snapshot for non-PDF files).
  // Shared by the draw-tool session-starter effect below and the insert-image action.
  const startAnnotationSession = useCallback(() => {
    if (annotating) return;
    setAnnotating(true);
    if (!isPDFFile) {
      const container = viewerAreaRef.current;
      // The 3D viewport composites the gizmo HUD into the same buffer the snapshot reads,
      // so ask it for a model-only frame first. No-op for image and video viewers.
      modelViewerRef.current?.renderCleanFrame();
      setViewerSnapshot(container ? captureViewerSnapshot(container) : null);
    }
  }, [annotating, isPDFFile]);

  // Mark up an attachment the user just picked. This is the same session the
  // draw tools start — only the background differs: the attached image itself
  // rather than a screenshot of the viewer.
  const handleAnnotateAttachment = useCallback(
    (index: number) => {
      const file = composerFiles[index];
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        setViewerSnapshot(reader.result as string);
        setAnnotatingAttachment(index);
        setAnnotating(true);
        setActiveTool('pointer');
      };
      reader.readAsDataURL(file);
    },
    [composerFiles]
  );

  // Start an annotation session when a draw tool is picked (only session-starter).
  useEffect(() => {
    if (!DRAW_TOOLS.includes(activeTool)) return;
    startAnnotationSession();
  }, [activeTool, startAnnotationSession]);

  // Tag placement and drawing are mutually exclusive — disarm tagging when a draw tool is selected.
  useEffect(() => {
    if (DRAW_TOOLS.includes(activeTool)) setTagging(false);
  }, [activeTool]);

  // The transform gizmo and the comment/draw tools are mutually exclusive too: drei's
  // TransformControls does not stop pointer-event propagation, so a drag started on a
  // rotate ring near the model could fall through to the comment-pin or drawing handlers
  // underneath it and drop a pin (or start a stroke) at the same time. Arming one disarms
  // the other, in both directions.
  useEffect(() => {
    if (!transformMode) return;
    setTagging(false);
    setActiveTool('pointer');
  }, [transformMode]);

  useEffect(() => {
    if (tagging || DRAW_TOOLS.includes(activeTool)) setTransformMode(null);
  }, [tagging, activeTool]);

  // Discard snapshots and reset transform when the selected file changes
  useEffect(() => {
    setViewerSnapshot(null);
    setViewportImage(null);
    setAnnotating(false);
    setAnnotatingAttachment(null);
    setActiveTool('pointer');
    setContentTransform(null);
    setComposerText('');
    setComposerFiles([]);
    setPendingTag(null);
    setTagging(false);
    setTransformMode(null);
    setFocalLength(DEFAULT_FOCAL_LENGTH);
    setCrossSection(null);
    lastSection.current = DEFAULT_CROSS_SECTION;
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
          // Author is resolved server-side from the session (name/email); this is just the fallback.
          author: 'Anonymous',
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

  const endSession = () => {
    setAnnotating(false);
    setAnnotatingAttachment(null);
    setViewerSnapshot(null);
    annotationCanvasRef.current?.clear();
    pdfKonvaRef.current?.clearDrawings();
    setActiveTool('pointer');
  };

  /** "sketch.png" → "sketch-markup.jpg". The capture is always a JPEG, so
   *  keeping the original extension would be a lie about the bytes. */
  const markupName = (original: string) =>
    `${original.replace(/\.[^./]+$/, '')}-markup.jpg`;

  const handleAnnotationDone = async () => {
    const index = annotatingAttachment;
    try {
      // An attachment session always draws on AnnotationCanvas, whatever the
      // selected package file is — the PDF surface belongs to the PDF.
      const surface =
        isPDFFile && index === null ? pdfKonvaRef.current : annotationCanvasRef.current;
      if (surface?.hasObjects()) {
        const dataUrl = surface.captureSnapshot();
        if (dataUrl) {
          const original = index !== null ? composerFiles[index] : null;
          const file = await dataUrlToFile(
            dataUrl,
            original ? markupName(original.name) : `annotation-${Date.now()}.jpg`
          );
          setComposerFiles((prev) => {
            // Appending is also the fallback when the attachment was removed
            // mid-session and the index no longer points at anything.
            if (index === null || index >= prev.length) return [...prev, file];
            return prev.map((f, i) => (i === index ? file : f));
          });
        }
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

  // Insert-image action: ensure a session is running (captures the snapshot for non-PDF),
  // then open the file picker within the same user gesture.
  const handleInsertImage = () => {
    startAnnotationSession();
    imageInputRef.current?.click();
  };

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const surface = isPDFFile ? pdfKonvaRef.current : annotationCanvasRef.current;
    surface?.insertImage(file);
    setActiveTool('pointer');
  };

  const handleCommentPinClick = useCallback((comment: Comment) => {
    setActiveCommentId((prev) => (prev === comment.id ? null : comment.id));
    if (comment.timestamp != null) {
      const video = viewerAreaRef.current?.querySelector('video') as HTMLVideoElement | null;
      if (video) video.currentTime = comment.timestamp;
    }
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
          <LoadingCube label="Loading files…" />
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

    // Only swap the live viewer out once a snapshot actually replaced it — if the capture
    // failed there is nothing behind the annotation surface, and hiding it blanks the viewport.
    // An attachment session always has a background, and always hides the viewer.
    const annotatingOnCanvas = annotating && (!isPDFFile || annotatingAttachment !== null);
    const isHidden = (annotatingOnCanvas && !!viewerSnapshot) || !!viewportImage;

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
            transform={selectedFile.transform}
            transformMode={canTransform ? transformMode : null}
            focalLength={focalLength}
            crossSection={crossSection}
            onTransformCommit={handleTransformCommit}
            activeTool={activeTool}
            tagging={tagging}
            annotating={annotating && annotatingAttachment === null}
            color={drawingColor}
            strokeWidth={drawingStrokeWidth}
            fileId={selectedFileId!}
            onCommentPlace={handlePDFCommentPlace}
            comments={pinComments}
            activeCommentId={activeCommentId}
            onCommentPinClick={handleCommentPinClick}
            pdfViewerRef={pdfKonvaRef}
            modelViewerRef={modelViewerRef}
            pendingCommentId={pendingTag ? PENDING_TAG_ID : null}
            onObjectCreated={() => setActiveTool('pointer')}
          />
        </div>
      </>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingCube label="Loading package…" />
      </div>
    );
  }

  return (
    <div className={`${manrope.variable} font-manrope h-screen flex flex-col bg-stiko-app p-3 gap-3`}>
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
      <PortalTopBar
        project={project}
        portal={portal}
        portalId={portalId}
        canUpload={canUpload}
        onSubmitVersion={() => setVersionDrawerOpen(true)}
      />

      {/* 3-Panel Layout */}
      <div className={`flex-1 grid gap-3 overflow-hidden min-h-0 ${
        sidebarCollapsed && commentsCollapsed ? 'grid-cols-[48px_1fr_48px]' :
        sidebarCollapsed ? 'grid-cols-[48px_1fr_340px]' :
        commentsCollapsed ? 'grid-cols-[272px_1fr_48px]' :
        'grid-cols-[272px_1fr_340px]'
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
          onSubmitVersion={
            canUpload ? () => setVersionDrawerOpen(true) : undefined
          }
        />

        {/* Center Panel: File Viewer with Drawing Tools & Markup Overlay */}
        <div className="flex flex-col gap-3 min-h-0 overflow-hidden">
          {/* Annotation mode banner */}
          {annotating && (
            <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-2 text-xs text-amber-700 flex-shrink-0">
              <span className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                {annotatingAttachment !== null
                  ? `Marking up ${composerFiles[annotatingAttachment]?.name ?? 'attachment'} — Done replaces the attachment`
                  : 'Annotating — draw on the file, then attach it to a comment'}
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

          <div ref={viewerAreaRef} className="relative flex-1 overflow-hidden bg-white rounded-panel shadow-stiko-panel">
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'repeating-linear-gradient(45deg, #F6F8FE 0 16px, #FBFCFF 16px 32px)' }} />
            {renderFileViewer()}

            {/* Markup tools float over the top of the viewport rather than taking a row above
                it. Hidden while an attachment is open there — there is nothing to mark up. */}
            {!viewportImage && (
              <DrawingTools
                activeTool={activeTool}
                onToolChange={setActiveTool}
                color={drawingColor}
                onColorChange={setDrawingColor}
                strokeWidth={drawingStrokeWidth}
                onStrokeWidthChange={setDrawingStrokeWidth}
                tagging={tagging}
                onToggleTagging={() => setTagging((t) => !t)}
                onInsertImage={handleInsertImage}
                offsetTop={isPDFFile ? 45 : 12}
              />
            )}
            {selectedFileId && !isPDFFile && !annotating && (
              <MarkupOverlay
                fileId={selectedFileId}
                tagging={tagging}
                onCommentPlace={handleCommentPlace}
                comments={pinComments}
                activeCommentId={activeCommentId}
                onCommentPinClick={handleCommentPinClick}
                is3DFile={is3DFile}
                worldPinPositions={worldPinPositions}
                contentTransform={viewerSnapshot ? null : contentTransform}
                pendingCommentId={pendingTag ? PENDING_TAG_ID : null}
              />
            )}

            {/* Both viewport control groups are hidden during a markup session: the live
                viewer is replaced by a frozen snapshot then, so they would sit on the drawing
                surface and drive a viewer nobody is looking at. Same while an
                attachment/snapshot is open in the viewport (viewportImage set), where the live
                viewer is behind it.

                items-end on both rows: the focal presets and the cross-section panel open
                upward, so the rows must be anchored by their bottom edge or the buttons shift
                as a panel appears. */}
            {selectedFileId && is3DFile && !annotating && !viewportImage && (
              <div className="absolute bottom-3 left-3 z-20 flex items-end gap-2">
                <FocalLengthControl value={focalLength} onChange={setFocalLength} />
              </div>
            )}

            {/* Cross-section, move, rotate — separate chips at even spacing. Cross-section is
                a way of LOOKING at the model so everyone gets it; move and rotate change the
                design itself, so only a role that may transform sees them. That is why the
                permission gate is on the two buttons rather than the row: without a permission
                a viewer still gets the cross-section, alone. */}
            {selectedFileId && is3DFile && !annotating && !viewportImage && (
              <div className="absolute bottom-3 right-3 z-20 flex items-end gap-2">
                <CrossSectionControl
                  section={crossSection}
                  lastSection={lastSection.current}
                  onChange={handleCrossSectionChange}
                />
                {canTransform && (
                  <TransformTools mode={transformMode} onModeChange={setTransformMode} />
                )}
              </div>
            )}

            {annotating && (!isPDFFile || annotatingAttachment !== null) && (
              <AnnotationCanvas
                backgroundDataUrl={viewerSnapshot}
                activeTool={activeTool as AnnTool}
                color={drawingColor}
                strokeWidth={drawingStrokeWidth}
                handleRef={annotationCanvasRef}
                onObjectCreated={() => setActiveTool('pointer')}
              />
            )}

            {/* Attachment/snapshot opened for full viewing in the viewport */}
            {viewportImage && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-gray-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={viewportImage}
                  alt="Attachment"
                  className="max-w-full max-h-full object-contain"
                  draggable={false}
                />
                <button
                  onClick={() => setViewportImage(null)}
                  className="absolute top-3 right-3 flex items-center gap-1.5 rounded-md bg-black/60 px-2.5 py-1.5 text-xs text-white hover:bg-black/80 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Back to live view
                </button>
              </div>
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
          onViewImage={setViewportImage}
          onCommentsChanged={() => setCommentsRefreshKey((k) => k + 1)}
          composer={
            <CommentComposer
              text={composerText}
              onTextChange={setComposerText}
              pendingFiles={composerFiles}
              onFilesChange={setComposerFiles}
              onAnnotateFile={handleAnnotateAttachment}
              tagging={tagging}
              hasTag={!!pendingTag}
              onClearTag={() => setPendingTag(null)}
              onSubmit={handleComposerSubmit}
              submitting={submittingComposer}
              inputRef={composerInputRef}
            />
          }
        />
      </div>

      <NewVersionDrawer
        isOpen={versionDrawerOpen}
        onClose={() => setVersionDrawerOpen(false)}
        portalId={portalId}
        projectId={project?.id ?? ''}
        packageName={portal?.name ?? ''}
        nextVersionNumber={
          versions.reduce((m, v) => Math.max(m, v.versionNumber), 0) + 1
        }
        currentVersionNumber={
          versions.length > 0
            ? versions.reduce((m, v) => Math.max(m, v.versionNumber), 0)
            : null
        }
        existingFilenames={files.map((f) => f.filename)}
        participants={participants.map((p) => ({
          id: p.id,
          name: p.email,
        }))}
        openComments={comments.filter((c) => !c.parentCommentId).length}
        onPublished={() => {
          // Refresh the rail and the file list in place — the whole point of
          // the drawer is that nothing navigates.
          fetch(`/api/versions?portalId=${portalId}`)
            .then((r) => (r.ok ? r.json() : []))
            .then((next: Version[]) => {
              setVersions(next);
              if (next.length > 0) setSelectedVersionId(next[0].id);
            })
            .catch(() => {});
        }}
      />
    </div>
  );
}
