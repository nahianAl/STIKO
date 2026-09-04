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
import VersionDetailDrawer from '@/components/portal/VersionDetailDrawer';
import { uploadFile, dataUrlToFile } from '@/lib/uploadAttachment';
import { manrope } from '@/lib/fonts';
import ViewerContainer, { type WorldPin, type PinScreenPosition, type ContentTransform, type PDFKonvaViewerHandle, type ModelViewerHandle } from '@/components/viewers/ViewerContainer';
import FocalLengthControl from '@/components/viewers/FocalLengthControl';
import CrossSectionControl from '@/components/viewers/CrossSectionControl';
import PlanesPanel from '@/components/viewers/section/PlanesPanel';
import TransformTools from '@/components/viewers/TransformTools';
import DrawingTools from '@/components/markup/DrawingTools';
import MarkupOverlay from '@/components/markup/MarkupOverlay';
import AnnotationBanner from '@/components/markup/AnnotationBanner';
import type { Comment, FileRecord, Version } from '@/lib/types';
import { DEFAULT_FOCAL_LENGTH } from '@/lib/focalLength';
import { emptySlots, setPlaneFlipped, togglePlane, type PlaneId, type SectionSlots } from '@/lib/crossSection';
import { CANVAS_MATTE } from '@/lib/markup/matte';
import { BRIEF_MIN_COMMENTS } from '@/lib/brief';
import { DestructiveConfirm } from '@/components/settings/DestructiveConfirm';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

// AnnotationCanvas uses react-konva, which cannot be server-rendered (same reason
// PDFKonvaViewer is dynamically imported in ViewerContainer).
const AnnotationCanvas = dynamic(() => import('@/components/markup/AnnotationCanvas'), { ssr: false });
import type { AnnotationCanvasHandle } from '@/components/markup/AnnotationCanvas';
import type { AnnTool, AnnotationObjectType, MarkupSelection, ToolType } from '@/components/markup/useAnnotationObjects';

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

interface Participant {
  id: string;
  portalId: string;
  email: string;
  role: string;
  createdAt: string;
}

const MODEL_3D_EXTENSIONS = ['.glb', '.gltf', '.step', '.stp', '.obj', '.stl', '.3ds', '.ply', '.dae'];

const DRAW_TOOLS: ToolType[] = ['freehand', 'line', 'arrow', 'rect', 'ellipse', 'cloud', 'text'];

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
      ctx.fillStyle = CANVAS_MATTE;
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
  const { toast } = useToast();

  // Two shapes of confirm, because the stakes differ. A published version
  // carries other people's comments; a file the uploader added a minute ago to
  // an unpublished version carries only their own mistake, and making them type
  // its name to undo it would train them to type past the serious dialog.
  const [fileToDelete, setFileToDelete] = useState<FileRecord | null>(null);
  const [versionToDelete, setVersionToDelete] = useState<Version | null>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [portal, setPortal] = useState<Portal | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [headlines, setHeadlines] = useState<Record<string, string>>({});
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(false);
  // Whether the selected file is actually on screen. Not the same question as
  // "have we finished fetching the file list" — a 3D model still has to be
  // downloaded, parsed and measured after that, and the indicator used to stop
  // at the earlier moment, leaving the viewport visibly still working.
  const [viewerReady, setViewerReady] = useState(false);
  const handleViewerReady = useCallback(() => setViewerReady(true), []);
  const [commentsCollapsed, setCommentsCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 2e: submitting a version is a drawer over this view, not a route change —
  // no navigation, no reload, no lost zoom or scroll.
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false);
  const [canUpload, setCanUpload] = useState(false);
  const [canTransform, setCanTransform] = useState(false);

  // Which version the detail drawer is showing. The version OBJECT is resolved
  // from `versions` each render rather than copied into state, so a version that
  // disappears — deleted, or dropped by a scope change — closes the drawer with
  // no extra bookkeeping.
  const [detailVersionId, setDetailVersionId] = useState<string | null>(null);
  // The version id currently being auto-summarised, or null. VersionBrief's own
  // `busy` is local to itself and cannot see this, so without it the Brief's
  // Summarise button sits enabled during exactly the window the page is already
  // generating — and POST /api/versions/[id]/summary only short-circuits once a
  // brief EXISTS, so two concurrent calls with no brief yet are two real ones.
  const [autoBriefBusy, setAutoBriefBusy] = useState<string | null>(null);

  // Drawing tools state
  const [activeTool, setActiveTool] = useState<ToolType>('pointer');
  const [drawingColor, setDrawingColor] = useState('#FF6B6B'); // red-pastel accent; matches default toolbar swatch
  const [drawingStrokeWidth, setDrawingStrokeWidth] = useState(4);
  const [selectionType, setSelectionType] = useState<AnnotationObjectType | null>(null);

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
  // Which version an auto-generate has already been attempted for this mount.
  const autoBriefAttempted = useRef<string | null>(null);

  // Snapshot state (annotation mode — frozen view for drawing)
  const [viewerSnapshot, setViewerSnapshot] = useState<string | null>(null);
  // An attachment/snapshot opened for full viewing in the center viewport
  const [viewportImage, setViewportImage] = useState<string | null>(null);
  const [annotating, setAnnotating] = useState(false);
  // Always mirrors `annotating`, but read fresh (not closed over) so async
  // callbacks — e.g. the FileReader below — can check "is a session already
  // running" at the instant they're about to commit, not at the instant they
  // were created.
  const annotatingRef = useRef(annotating);
  annotatingRef.current = annotating;
  // The exact File being marked up while annotating an attachment the user has
  // picked but not yet posted. Null means the session is the ordinary one over
  // the viewer. Identity (not position) on purpose: the composer's remove
  // button can reorder/shrink composerFiles mid-session, and an index would
  // then point at a different, unrelated file. Decides three things: which
  // surface draws, whether Done replaces or appends, and what the banner says.
  const [annotatingFile, setAnnotatingFile] = useState<File | null>(null);
  const annotationCanvasRef = useRef<AnnotationCanvasHandle>(null);
  const modelViewerRef = useRef<ModelViewerHandle>(null);
  const viewerAreaRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Selected file (needed before 3D state)
  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null;

  // 3D comment pin state
  const [worldPinPositions, setWorldPinPositions] = useState<Map<string, PinScreenPosition>>(new Map());

  // null hides the gizmo. Set by any role via handleSelectPlane (arms Move on a plane) or by
  // TransformTools (arms Move/Rotate on whichever target is live — see the prop comment at the
  // ViewerContainer call site for how that target is decided and gated).
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | null>(null);

  // Session only: a lens is how you happen to be looking at something, not a property of
  // the design, so it is deliberately not persisted the way the object transform is.
  const [focalLength, setFocalLength] = useState(DEFAULT_FOCAL_LENGTH);

  // Session only, like the focal length: a cut is a way of looking at the model, not a
  // property of the design. Nothing here is persisted, and nothing survives a file change.
  //
  // Only the FLAGS live here. Each plane's position and rotation live on its Object3D inside
  // the canvas and are never read back — see lib/crossSection for why.
  const [sectionActive, setSectionActive] = useState(false);
  const [sectionSlots, setSectionSlots] = useState<SectionSlots>(emptySlots);
  const [selectedPlane, setSelectedPlane] = useState<PlaneId | null>(null);

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

  // Which surface a markup session draws on. A PDF draws directly on its own
  // PDFKonvaViewer surface — except when the session is marking up a picked-but-not-
  // posted attachment, which is never the PDF being reviewed and so always draws on
  // AnnotationCanvas instead. Every other file type always draws on AnnotationCanvas.
  // Single source of truth for a rule that used to be hand-written at five call sites.
  const drawsOnCanvas = !isPDFFile || annotatingFile !== null;

  const pdfKonvaRef = useRef<PDFKonvaViewerHandle>(null);

  /**
   * Colour and stroke width now do two things: set the default for the next object, and
   * restyle whatever is selected. With nothing selected the second half is a no-op, which is
   * exactly the behaviour these controls had before.
   */
  const activeSurface = useCallback(
    () => (drawsOnCanvas ? annotationCanvasRef.current : pdfKonvaRef.current),
    [drawsOnCanvas]
  );

  const handleColorChange = useCallback((c: string) => {
    setDrawingColor(c);
    activeSurface()?.applyStyleToSelection({ color: c });
  }, [activeSurface]);

  const handleStrokeWidthChange = useCallback((w: number) => {
    setDrawingStrokeWidth(w);
    activeSurface()?.applyStyleToSelection({ strokeWidth: w });
  }, [activeSurface]);

  /**
   * Selecting an object pulls its style into the toolbar, so the swatch and the preset on show
   * are the selected object's. That also makes it the style of the *next* object — the ordinary
   * design-tool convention, and it keeps one piece of state driving both rather than two that
   * can disagree. Images carry no style, so they only clear the type.
   */
  const handleSelectionChange = useCallback((s: MarkupSelection | null) => {
    setSelectionType(s?.type ?? null);
    if (s && s.type !== 'image') {
      setDrawingColor(s.color);
      setDrawingStrokeWidth(s.strokeWidth);
    }
  }, []);

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

  // The master toggle is the only control that removes a cut: switching the tool off clears
  // every slot, so `cutting` goes false everywhere and the model returns to its whole shape.
  const handleSectionToggle = useCallback(() => {
    if (!sectionActive) {
      setSectionActive(true);
      // Object placement is only ever editable with the tool off (see the mount condition
      // in ModelViewerInner). Without this, arming Move on the object and then opening the
      // tool left transformMode stranded non-null with no plane selected yet — the object
      // gizmo stayed live for the whole session, and the Move button rendered simultaneously
      // active and disabled.
      setTransformMode(null);
      return;
    }
    setSectionActive(false);
    setSectionSlots(emptySlots());
    setSelectedPlane(null);
    setTransformMode(null);
  }, [sectionActive]);

  const handlePlaneToggle = useCallback((id: PlaneId) => {
    setSectionSlots((slots) => togglePlane(slots, id));
  }, []);

  // A hidden plane cannot be dragged, so hiding the selected one has to release it — otherwise
  // the gizmo hangs in mid-air over an invisible target. Driven off the COMMITTED slots rather
  // than decided inline in handlePlaneToggle: that handler updates slots functionally, and
  // deciding here too, from a value closed over at call time, would let two toggles batched
  // into the same render disagree with the update they are supposed to be reacting to. This
  // effect instead reacts to whatever slots actually end up being, which cannot disagree with
  // itself. (Not a `setState` call inside the `setSectionSlots` updater above — React may
  // invoke that updater more than once, which a `setSelectedPlane` call inside it would then
  // do too.)
  useEffect(() => {
    if (selectedPlane !== null && !sectionSlots[selectedPlane].visible) {
      setSelectedPlane(null);
      // Clearing selection alone left transformMode stranded at 'translate' with
      // selectedPlane null and the tool still open — exactly the condition
      // ModelViewerInner mounts the OBJECT gizmo on, so it jumped onto the model and a
      // drag from there rewrote and saved the design's placement, with Move/Rotate
      // disabled so the user had no UI path to disarm it.
      setTransformMode(null);
    }
  }, [sectionSlots, selectedPlane]);

  const handlePlaneFlip = useCallback((id: PlaneId) => {
    setSectionSlots((slots) => setPlaneFlipped(slots, id, !slots[id].flipped));
  }, []);

  // Clicking a plane arms Move on it, per the tool's design: selection and the move gizmo are
  // one gesture. Switching to Rotate afterwards keeps the same plane.
  const handleSelectPlane = useCallback((id: PlaneId | null) => {
    setSelectedPlane(id);
    setTransformMode(id === null ? null : 'translate');
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

  // Extracted from the effect below so deleting a version can re-run it.
  const loadVersions = useCallback(async () => {
    try {
      const res = await fetch(`/api/versions?portalId=${portalId}`);
      // A 401 or 403 returns a JSON error object, not an array. Without this
      // it lands in setVersions and the sidebar's reduce throws during render,
      // taking out the whole route — there is no error boundary above it.
      if (!res.ok) {
        setVersions([]);
        return;
      }
      const data: Version[] = await res.json();
      setVersions(data);
      if (data.length > 0) {
        setSelectedVersionId((current) =>
          current && data.some((v) => v.id === current) ? current : data[0].id
        );
      }
    } catch (err) {
      console.error('Failed to fetch versions:', err);
    } finally {
      setLoading(false);
    }
  }, [portalId]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  // Fetch each version's one-line AI headline for the sidebar. GET never
  // triggers the model — this only reads whatever brief already exists.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entries = await Promise.all(
          versions.map(async (v) => {
            try {
              const res = await fetch(`/api/versions/${v.id}/summary`);
              if (!res.ok) return [v.id, ''] as const;
              const body = await res.json();
              return [v.id, body.brief?.headline ?? ''] as const;
            } catch {
              return [v.id, ''] as const;
            }
          })
        );
        if (!cancelled) setHeadlines(Object.fromEntries(entries.filter(([, h]) => h)));
      } catch (err) {
        console.error('Failed to fetch headlines:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [versions]);

  // One auto-generate attempt per selected version.
  //
  // This used to live inside VersionBrief, which mounted in the comment panel
  // whenever a version was selected. The component now lives in the version
  // drawer, which most people never open — and the card headline below is read
  // from a GET that never generates. Leaving the trigger in the component would
  // mean no brief, so no headline, so no hint that a Brief exists, so nobody
  // opens the drawer. The cadence here is exactly what the component did: one
  // attempt per selected version, per mount.
  useEffect(() => {
    const target = selectedVersionId;
    if (!target) return;
    if (autoBriefAttempted.current === target) return;
    // Claimed synchronously, before any await. React re-invokes effects in
    // development, and a guard set after an await lets both invocations through
    // to a paid endpoint. The cost of claiming early is that a network failure
    // skips this version for the rest of the session — acceptable, because the
    // drawer's Summarise and Refresh buttons both still work.
    autoBriefAttempted.current = target;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/versions/${target}/summary`);
        if (cancelled || !res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        // Switched off for the deployment, unconfigured, or already summarised.
        if (!body.enabled || !body.configured || body.brief) return;
        if ((body.facts?.commentCount ?? 0) < BRIEF_MIN_COMMENTS) return;

        setAutoBriefBusy(target);
        try {
          const gen = await fetch(`/api/versions/${target}/summary`, { method: 'POST' });
          if (cancelled || !gen.ok) return;
          const genBody = await gen.json();
          if (cancelled) return;
          const headline = genBody.brief?.headline;
          // Fold the new headline straight into the rail rather than refetching
          // every version's summary again.
          if (headline) setHeadlines((h) => ({ ...h, [target]: headline }));
        } finally {
          if (!cancelled) setAutoBriefBusy(null);
        }
      } catch (err) {
        console.error('Failed to auto-generate brief:', err);
        // A brief is an enhancement. Failing to produce one must not put an
        // error in front of someone reviewing drawings.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedVersionId]);

  // Fetch files when version changes
  const fetchFiles = useCallback(async (versionId: string) => {
    setFilesLoading(true);
    try {
      const res = await fetch(`/api/files?versionId=${versionId}`);
      // Same failure shape as loadVersions: a 401/403 body is a JSON object,
      // not an array, and would otherwise reach setFiles and blow up render.
      if (!res.ok) {
        setFiles([]);
        return;
      }
      const data: FileRecord[] = await res.json();
      setFiles(data);
      if (data.length > 0) {
        // A version change should land on the first file, but a delete that
        // leaves the current selection intact must not throw the viewer back
        // to file 1.
        setSelectedFileId((current) =>
          current && data.some((f) => f.id === current) ? current : data[0].id
        );
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
      // Cheap early exit — avoids reading the file at all for the common case.
      if (annotatingRef.current) return;
      const file = composerFiles[index];
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        // Re-check here, not just above: readAsDataURL is async, so a second
        // click (another thumbnail, or a draw tool) can land while this read
        // is in flight. The state that matters is whatever is true right now,
        // at commit time — not whatever was true when this callback started.
        if (annotatingRef.current) return;
        // An open attachment/snapshot (viewportImage) fills the viewport at a higher
        // z-index than AnnotationCanvas and has no session of its own to clear it —
        // without this the session starts hidden behind it, with no visible tools.
        setViewportImage(null);
        setViewerSnapshot(reader.result as string);
        setAnnotatingFile(file);
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
    // Clear the plane selection along with the mode: leaving it set stranded a selected
    // plane with no gizmo on screen — still highlighted, its flip button still showing,
    // Move/Rotate still enabled — because nothing was driving TransformGizmo anymore. The
    // other direction (selecting a plane disarms tagging) already goes through
    // handleSelectPlane; match it here so arming a comment/draw tool fully releases a
    // plane selection too.
    if (tagging || DRAW_TOOLS.includes(activeTool)) {
      setTransformMode(null);
      setSelectedPlane(null);
    }
  }, [tagging, activeTool]);

  // Discard snapshots and reset transform when the selected file changes
  useEffect(() => {
    // A different file has to prove itself on screen again before the
    // indicator comes down.
    setViewerReady(false);
    setViewerSnapshot(null);
    setViewportImage(null);
    setAnnotating(false);
    setAnnotatingFile(null);
    setActiveTool('pointer');
    setContentTransform(null);
    setComposerText('');
    setComposerFiles([]);
    setPendingTag(null);
    setTagging(false);
    setTransformMode(null);
    setFocalLength(DEFAULT_FOCAL_LENGTH);
    setSectionActive(false);
    setSectionSlots(emptySlots());
    setSelectedPlane(null);
  }, [selectedFileId]);

  const handleSelectVersion = (versionId: string) => {
    setSelectedVersionId(versionId);
    setFilesLoading(true);
    setSelectedFileId(null);
    setFiles([]);
    setActiveTool('pointer');
    setActiveCommentId(null);
  };

  // A plain function, matching handleSelectVersion directly above it. Wrapping
  // it in useCallback would need handleSelectVersion in its dependency array,
  // and that is redefined every render, so the memo would never hold — while
  // omitting it trips react-hooks/exhaustive-deps. The sidebar is not memoized,
  // so a stable identity buys nothing here.
  const handleOpenVersionDetails = (version: Version) => {
    // Opening the drawer moves the whole page to that version. Guarded on the
    // id: handleSelectVersion clears the file list, the selected file, the
    // active tool and the active comment, so calling it for the version that is
    // ALREADY selected would throw away the open drawing just because someone
    // asked to see the version's details.
    if (version.id !== selectedVersionId) handleSelectVersion(version.id);
    setDetailVersionId(version.id);
  };

  const confirmDeleteFile = async () => {
    if (!fileToDelete) return;
    const target = fileToDelete;
    setFileToDelete(null);

    const res = await fetch(`/api/files/${target.id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast('Could not delete this file');
      return;
    }

    // Selection has to move before the refetch, or the viewer keeps rendering a
    // file that no longer exists.
    if (selectedFileId === target.id) setSelectedFileId(null);
    toast('File deleted');
    if (selectedVersionId) fetchFiles(selectedVersionId);
    // The version rail carries file and comment counts that the delete confirm
    // reads, so a stale count here would overstate what the next delete costs.
    await loadVersions();
  };

  const confirmDeleteVersion = async () => {
    if (!versionToDelete) return;
    const target = versionToDelete;
    setVersionToDelete(null);
    // The drawer resolves its version from `versions`, so loadVersions() below
    // would close it anyway — but only after a round trip. Clearing it here
    // means the drawer does not linger over the confirm's dismissal.
    if (detailVersionId === target.id) setDetailVersionId(null);

    const res = await fetch(`/api/versions/${target.id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast('Could not delete this version');
      return;
    }

    toast(`Version ${target.versionNumber} deleted`);
    if (selectedVersionId === target.id) {
      setSelectedVersionId(null);
      setSelectedFileId(null);
    }
    await loadVersions();
  };

  // The counts on `files` and `versions` were fetched when the version was
  // selected, and posting a comment does not refresh them. A confirm whose
  // whole purpose is to state what dies must not read a number that went stale
  // while the package sat open.
  const openFileDelete = useCallback(async (file: FileRecord) => {
    setFileToDelete(file);
    try {
      const res = await fetch(`/api/files?versionId=${file.versionId}`);
      if (!res.ok) return;
      const fresh: FileRecord[] = await res.json();
      const match = fresh.find((f) => f.id === file.id);
      // Only the counts are refreshed — replacing the whole object would
      // discard nothing, but re-setting state the user may have already
      // dismissed would reopen the dialog.
      if (match) setFileToDelete((current) => (current?.id === file.id ? match : current));
    } catch {
      // The stale count still shows; failing to refresh must not block a delete.
    }
  }, []);

  const openVersionDelete = useCallback(async (version: Version) => {
    setVersionToDelete(version);
    try {
      const res = await fetch(`/api/versions?portalId=${portalId}`);
      if (!res.ok) return;
      const fresh: Version[] = await res.json();
      const match = fresh.find((v) => v.id === version.id);
      if (match) setVersionToDelete((current) => (current?.id === version.id ? match : current));
    } catch {
      // As above.
    }
  }, [portalId]);

  // The URL is minted per click rather than held on the row: it is presigned
  // and short-lived, and a row rendered an hour ago would hand over a dead one.
  const downloadFile = useCallback(async (file: FileRecord) => {
    try {
      const res = await fetch(`/api/files/${file.id}/download`);
      if (!res.ok) {
        toast('Could not download this file');
        return;
      }
      const { url } = await res.json();
      // An anchor rather than window.location.href: if the storage service
      // ever drops the attachment header, the worst case is a new tab, not the
      // reviewer being navigated out of the viewer and losing their place.
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast('Could not download this file');
    }
  }, [toast]);

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
    setAnnotatingFile(null);
    setViewerSnapshot(null);
    annotationCanvasRef.current?.clear();
    pdfKonvaRef.current?.clearDrawings();
    setActiveTool('pointer');
    setSelectionType(null);
  };

  /** "sketch.png" → "sketch-markup.jpg". The capture is always a JPEG, so
   *  keeping the original extension would be a lie about the bytes. */
  const markupName = (original: string) =>
    `${original.replace(/\.[^./]+$/, '')}-markup.jpg`;

  const handleAnnotationDone = async () => {
    const original = annotatingFile;
    try {
      if (original !== null) {
        // Attachment session: the surface is always AnnotationCanvas (never the union —
        // an attachment is never the PDF being reviewed). Capture at the background
        // image's own resolution, cropped to its fitted region: the whole-stage capture
        // the ordinary session below uses would letterbox and resample the attachment
        // Done is about to replace.
        const surface = annotationCanvasRef.current;
        if (surface?.hasObjects()) {
          const dataUrl = surface.captureSnapshot({ native: true });
          if (dataUrl) {
            const file = await dataUrlToFile(dataUrl, markupName(original.name));
            setComposerFiles((prev) => {
              // Look the File up by identity, not a remembered position: the
              // composer's remove button is live throughout the session and can
              // reorder or shrink this array. Appending is also the fallback
              // when the attachment was removed mid-session — the capture must
              // never be silently dropped, and must never land on a bystander.
              const index = prev.indexOf(original);
              if (index === -1) return [...prev, file];
              return prev.map((f, i) => (i === index ? file : f));
            });
          }
        }
      } else {
        // Ordinary session: PDF draws directly on its own surface; everything else
        // draws on AnnotationCanvas over a viewer-snapshot background.
        const surface = drawsOnCanvas ? annotationCanvasRef.current : pdfKonvaRef.current;
        if (surface?.hasObjects()) {
          const dataUrl = surface.captureSnapshot();
          if (dataUrl) {
            const file = await dataUrlToFile(dataUrl, `annotation-${Date.now()}.jpg`);
            setComposerFiles((prev) => [...prev, file]);
          }
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
    // Same rule as the other surface-selection gates: an attachment session
    // always draws on AnnotationCanvas, even when the selected package file
    // is a PDF and PDFKonvaViewer is what's normally active.
    const surface = drawsOnCanvas ? annotationCanvasRef.current : pdfKonvaRef.current;
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

  // A citation chip in the AI brief was clicked. Unlike handleCommentClick /
  // handleCommentPinClick above, this is not a toggle — it is "take me there" —
  // and the cited comment may live on a file other than the one on screen.
  // Switch to that file first (a no-op if it's already selected: React bails
  // out of the state update and the [selectedFileId] reset effect never
  // fires), then set activeCommentId. CommentsPanel's own effect owns the
  // scroll/highlight and re-runs once that file's comments have loaded, so
  // there is nothing else to do here — never scrollIntoView directly.
  const handleSelectCitedComment = useCallback(
    (commentId: string, fileId: string) => {
      if (fileId !== selectedFileId) {
        setSelectedFileId(fileId);
      }
      setActiveCommentId(commentId);
    },
    [selectedFileId]
  );

  // The viewport has nothing usable on it yet — still finding the files, or the
  // file is still becoming visible. One expression, because the indicator and
  // everything that must not sit on top of it have to agree exactly.
  const viewportBusy = loading || filesLoading || (!!selectedFile && !viewerReady);

  const renderFileViewer = () => {
    // No loading branch here any more. One overlay below owns the whole wait,
    // from "which files are there" through to the file being drawn, so the
    // animation runs once instead of being handed between two components.
    if (loading || filesLoading) return null;

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
    const annotatingOnCanvas = annotating && drawsOnCanvas;
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
            transformMode={canTransform || selectedPlane !== null ? transformMode : null}
            focalLength={focalLength}
            sectionSlots={sectionSlots}
            selectedPlane={selectedPlane}
            onSelectPlane={handleSelectPlane}
            // Structural guarantee, not a tidy-up: ModelViewerInner's OBJECT-gizmo branch
            // mounts on `transformMode && onTransformCommit && ... && selectedPlane === null`
            // (its plane-gizmo branch carries no onCommit at all). Withholding this prop
            // whenever the user may not transform means that branch cannot mount for them no
            // matter what transformMode or selectedPlane happen to be — a non-null
            // transformMode arriving here for a selected plane can never accidentally also
            // satisfy the object branch's condition, because the callback it requires simply
            // isn't there. Do not widen this to `canTransform ? handleTransformCommit :
            // undefined` being the only gate elsewhere; this is the one place the invariant is
            // enforced structurally rather than by every caller happening to agree.
            onTransformCommit={canTransform ? handleTransformCommit : undefined}
            activeTool={activeTool}
            tagging={tagging}
            // ViewerContainer only forwards this to PDFKonvaViewer (a no-op for every
            // other file type), where it means "draw directly on the PDF's own
            // surface" — i.e. the ordinary, non-attachment PDF session. That is
            // `annotating && !drawsOnCanvas`, not drawsOnCanvas itself.
            annotating={annotating && !drawsOnCanvas}
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
            onSelectionChange={handleSelectionChange}
            onReady={handleViewerReady}
          />
        </div>
      </>
    );
  };

  // Publish state alone is the wrong test: a draft can already carry other
  // people's comments, because commenting is gated on canComment and never on
  // whether the version is published. What matters is whether anything would
  // be destroyed alongside the file.
  const fileDeleteIsGrave =
    (fileToDelete?.commentCount ?? 0) > 0 ||
    Boolean(versions.find((v) => v.id === selectedVersionId)?.publishedAt);

  // Resolved from `versions` each render rather than held in state, so a
  // version that disappears takes the drawer with it. "Current" is the highest
  // version number, the same rule FileTreeSidebar uses for its badge gradient.
  const detailVersion = versions.find((v) => v.id === detailVersionId) ?? null;
  const maxVersionNumber = versions.reduce((m, v) => Math.max(m, v.versionNumber), 0);

  return (
    <div className={`${manrope.variable} font-manrope h-screen flex flex-col bg-stiko-app p-3 gap-3`}>
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
      {/* Submitting a version is the sidebar's job now — it sits next to the
          versions it creates, and the top bar had the only other copy. */}
      <PortalTopBar project={project} portal={portal} portalId={portalId} />

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
          headlines={headlines}
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
          loading={loading}
          onOpenVersionDetails={handleOpenVersionDetails}
        />

        {/* Center Panel: File Viewer with Drawing Tools & Markup Overlay */}
        <div className="flex flex-col gap-3 min-h-0 overflow-hidden">
          <div ref={viewerAreaRef} className="relative flex-1 overflow-hidden bg-white rounded-panel shadow-stiko-panel">
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'repeating-linear-gradient(45deg, #F6F8FE 0 16px, #FBFCFF 16px 32px)' }} />
            {renderFileViewer()}

            {/* ONE loading indicator for the whole viewport, from "which files are
                in this version" through to the file being decoded, measured and
                drawn. It used to be two — this page's, which ended when the file
                LIST arrived, and a second, smaller one inside ViewerContainer
                that started when the presigned URL was requested — so the
                animation appeared to stop short and restart, and a third state
                (the 3D chunk's "Loading 3D model...") could follow it.

                Opaque, so nothing half-drawn shows through underneath, and it
                covers a viewer's own internal spinner on first load. The PDF
                viewer keeps its ring for page-to-page changes, which happen
                afterwards and are not this. */}
            {viewportBusy && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-white">
                <LoadingCube
                  label={
                    loading
                      ? 'Loading package…'
                      : filesLoading
                        ? 'Loading files…'
                        : 'Opening file…'
                  }
                />
              </div>
            )}

            {/* Markup tools float over the top of the viewport rather than taking a row above
                it. Hidden while an attachment is open there — there is nothing to mark up. */}
            {!viewportBusy && !viewportImage && (
              <DrawingTools
                activeTool={activeTool}
                onToolChange={setActiveTool}
                color={drawingColor}
                onColorChange={handleColorChange}
                strokeWidth={drawingStrokeWidth}
                onStrokeWidthChange={handleStrokeWidthChange}
                tagging={tagging}
                onToggleTagging={() => setTagging((t) => !t)}
                onInsertImage={handleInsertImage}
                offsetTop={isPDFFile ? 45 : 12}
                selectionType={selectionType}
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

            {/* Planes panel, cross-section, move, rotate — one row of chips at even spacing,
                the panel inline immediately left of the button that opens it.

                Cross-section is a way of LOOKING at the model, so everyone gets it — and a
                plane's pose is exactly that too: session-only, never persisted, discarded the
                moment the tool closes. So Move/Rotate render for anyone who may transform the
                object OR who currently has the cross-section tool open, whether or not they
                may transform. That is deliberately not "OR has a plane selected" — with the
                tool open and nothing selected yet, the buttons must still be visible (disabled,
                below) so the user has an affordance to select a plane in the first place.

                The MODEL's own saved placement is a different thing and stays gated on
                canTransform alone — see ModelViewerInner's object-gizmo branch, which only
                mounts when onTransformCommit is passed, and that prop is only ever passed to
                the viewer when canTransform is true (see the ViewerContainer call below). A
                user without the permission can select and drag a plane here, but the object
                itself remains structurally unreachable through this row. */}
            {selectedFileId && is3DFile && !annotating && !viewportImage && (
              <div className="absolute bottom-3 right-3 z-20 flex items-end gap-2">
                {sectionActive && (
                  <PlanesPanel
                    slots={sectionSlots}
                    selected={selectedPlane}
                    onToggle={handlePlaneToggle}
                    onFlip={handlePlaneFlip}
                  />
                )}
                <CrossSectionControl active={sectionActive} onToggle={handleSectionToggle} />
                {(canTransform || sectionActive) && (
                  <TransformTools
                    mode={transformMode}
                    onModeChange={setTransformMode}
                    disabled={sectionActive && selectedPlane === null}
                    disabledReason="Select a plane"
                  />
                )}
              </div>
            )}

            {annotating && drawsOnCanvas && (
              <AnnotationCanvas
                backgroundDataUrl={viewerSnapshot}
                activeTool={activeTool as AnnTool}
                color={drawingColor}
                strokeWidth={drawingStrokeWidth}
                handleRef={annotationCanvasRef}
                onObjectCreated={() => setActiveTool('pointer')}
                onSelectionChange={handleSelectionChange}
              />
            )}

            {/* Floats rather than taking a row: a row would shrink the viewer after the
                snapshot behind this session was already captured at the taller size, and the
                resulting letterbox is the black border in the saved JPEG. Being DOM, it is
                invisible to the capture. */}
            {annotating && (
              <AnnotationBanner
                annotatingFileName={annotatingFile?.name ?? null}
                onDiscard={handleAnnotationDiscard}
                onApply={handleAnnotationDone}
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
          versionId={selectedVersionId}
          onCommentClick={handleCommentClick}
          activeCommentId={activeCommentId}
          refreshKey={commentsRefreshKey}
          collapsed={commentsCollapsed}
          onToggleCollapse={() => setCommentsCollapsed((c) => !c)}
          onViewImage={setViewportImage}
          onCommentsChanged={() => setCommentsRefreshKey((k) => k + 1)}
          onSelectCitedComment={handleSelectCitedComment}
          composer={
            <CommentComposer
              text={composerText}
              onTextChange={setComposerText}
              pendingFiles={composerFiles}
              onFilesChange={setComposerFiles}
              onAnnotateFile={annotating ? undefined : handleAnnotateAttachment}
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

      <VersionDetailDrawer
        version={detailVersion}
        isCurrent={!!detailVersion && detailVersion.versionNumber === maxVersionNumber}
        files={files}
        filesLoading={filesLoading}
        briefGenerating={!!detailVersion && autoBriefBusy === detailVersion.id}
        onClose={() => setDetailVersionId(null)}
        onSelectFile={setSelectedFileId}
        onSelectCitedComment={handleSelectCitedComment}
        onDeleteFile={openFileDelete}
        onDownloadFile={downloadFile}
        onDeleteVersion={openVersionDelete}
      />

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
        latestVersionId={versions[0]?.id ?? null}
        onPublished={() => {
          // Refresh the rail and the file list in place — the whole point of
          // the drawer is that nothing navigates.
          fetch(`/api/versions?portalId=${portalId}`)
            .then((r) => (r.ok ? r.json() : []))
            .then((next: Version[]) => {
              setVersions(next);
              if (next.length > 0) {
                setSelectedVersionId(next[0].id);
                setFilesLoading(true);
              }
            })
            .catch(() => {});
        }}
      />

      {/* Unpublished: nobody has seen it, so a plain confirm is the honest
          weight. Requiring a typed filename here would train users to type
          past the serious dialog below. */}
      {fileToDelete && !fileDeleteIsGrave && (
        <Modal
          isOpen
          onClose={() => setFileToDelete(null)}
          title="Delete this file?"
          subtitle={fileToDelete.filename}
          width={420}
          footer={
            <>
              <Button variant="secondary" onClick={() => setFileToDelete(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmDeleteFile}>Delete file</Button>
            </>
          }
        >
          <p className="text-[13px] text-stiko-secondary">
            This removes the file and anything attached to it. It cannot be undone.
          </p>
        </Modal>
      )}

      {/* Published: reviewers can have built work on this file, so it gets the
          same weight as deleting a whole version. */}
      {fileToDelete && fileDeleteIsGrave && (
        <DestructiveConfirm
          isOpen
          onClose={() => setFileToDelete(null)}
          onConfirm={confirmDeleteFile}
          title="Delete this file?"
          name={fileToDelete.filename}
          consequence="This cannot be undone. Everyone loses this file and the review work on it, including people mid-review."
          inventory={[
            { label: 'Comments', value: fileToDelete.commentCount ?? 0, urgent: (fileToDelete.commentCount ?? 0) > 0 },
          ]}
          confirmLabel="Delete file"
        />
      )}

      {/* A whole version, with other people's review work on it. Full weight:
          typed name and a count of what dies. */}
      {versionToDelete && (
        <DestructiveConfirm
          isOpen
          onClose={() => setVersionToDelete(null)}
          onConfirm={confirmDeleteVersion}
          title={`Delete version ${versionToDelete.versionNumber}?`}
          name={`V${versionToDelete.versionNumber}`}
          consequence="This cannot be undone. Everyone loses this version and every comment on it, including people mid-review."
          inventory={[
            { label: 'Files', value: versionToDelete.fileCount ?? 0 },
            { label: 'Comments', value: versionToDelete.commentCount ?? 0, urgent: (versionToDelete.commentCount ?? 0) > 0 },
          ]}
          confirmLabel="Delete version"
        />
      )}
    </div>
  );
}
