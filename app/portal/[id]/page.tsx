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
import ViewerContainer, { IMAGE_EXTENSIONS, type WorldPin, type PinScreenPosition, type ContentTransform, type PDFKonvaViewerHandle, type ModelViewerHandle } from '@/components/viewers/ViewerContainer';
import FocalLengthControl from '@/components/viewers/FocalLengthControl';
import CrossSectionControl from '@/components/viewers/CrossSectionControl';
import PlanesPanel from '@/components/viewers/section/PlanesPanel';
import TransformTools from '@/components/viewers/TransformTools';
import DrawingTools from '@/components/markup/DrawingTools';
import MarkupOverlay from '@/components/markup/MarkupOverlay';
import AnnotationBanner from '@/components/markup/AnnotationBanner';
import { messageForStatus } from '@/lib/submitErrors';
import type { Comment, FileRecord, Version } from '@/lib/types';
import PartsPanel from '@/components/viewers/PartsPanel';
import { autoColors, BASE_GREY } from '@/lib/model/autoColor';
import { cascadeToDescendants, type PartNode } from '@/lib/model/partTree';
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
import type { AnnotationObjectType, MarkupSelection, ToolType } from '@/components/markup/useAnnotationObjects';
import { isMeasureTool } from '@/components/markup/useAnnotationObjects';
import { useMeasurements } from '@/components/markup/useMeasurements';
import CalibrationPanel from '@/components/markup/CalibrationPanel';
import { DEFAULT_LENGTH_UNIT, type LengthUnit } from '@/lib/measure/units';
import { resolveScale, mmPerUnitFrom, UNPAGED } from '@/lib/measure/calibration';
import { distance } from '@/lib/measure/geometry';
import { pointsPerStagePixel, type ImageSnapshotSpace } from '@/lib/measure/space';
import { extensionOf } from '@/lib/fileFormats';

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

interface ViewerSnapshot {
  dataUrl: string;
  /**
   * Where the source image sits inside the snapshot, and how big it really is. Non-null only
   * for the image branch — it is what lets a calibration be stored in NATURAL pixels rather
   * than in whatever zoom the viewer happened to be at when the frame was frozen. A snapshot is
   * fit-scaled and letterboxed at that zoom, so a factor captured in stage pixels reads
   * plausibly once and is wrong the next time the file is opened.
   */
  imageSpace: ImageSnapshotSpace | null;
}

// Captures the current viewer state as a JPEG data URL, plus (image viewer only) the image
// space that data URL was composed from.
// Tries WebGL canvas first (3D), then img, then video.
function captureViewerSnapshot(container: HTMLElement): ViewerSnapshot | null {
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
        // No image space: a WebGL frame has no source <img>, and a 3D file measures in the live
        // scene (MeasureLayer) rather than on a frozen snapshot.
        return { dataUrl: offscreen.toDataURL('image/jpeg', 0.92), imageSpace: null };
      }
      return { dataUrl: canvas.toDataURL('image/jpeg', 0.92), imageSpace: null };
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
        return {
          dataUrl: offscreen.toDataURL('image/jpeg', 0.92),
          // The rect drawImage was just handed, in the snapshot's own pixels, alongside the
          // image's true size. getBoundingClientRect includes ImageViewer's CSS zoom/pan
          // transform, so imageRect.width IS the on-screen size at the moment of the freeze —
          // which is precisely why naturalWidth has to travel with it.
          imageSpace: {
            imageRect: {
              x: imgRect.left - containerRect.left,
              y: imgRect.top - containerRect.top,
              width: imgRect.width,
              height: imgRect.height,
            },
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
          },
        };
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
      // No image space: the measure tool group is withheld for video files entirely.
      return { dataUrl: offscreen.toDataURL('image/jpeg', 0.92), imageSpace: null };
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
  // Separate from the other two because it gates a different thing: calibrating a file. The
  // client-side gate is presentation only — PATCH /api/files/[id]/measure enforces it for real,
  // and enforces the stricter "overwriting an EXISTING calibration needs canTransform" on top.
  const [canComment, setCanComment] = useState(false);

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

  // Measure tool state. The store is session-only, exactly like markup: nothing here survives a
  // file switch, and the way to keep a reading is to snapshot it into a comment.
  const measure = useMeasurements();
  // The store's callbacks are individually stable, but the object holding them is new every
  // render. The effects below therefore depend on the callbacks BY NAME, pulled out here:
  // written as `measure.begin` in a dependency array, react-hooks/exhaustive-deps asks for the
  // whole object instead — and depending on that would re-run every measure effect, restarting
  // the gesture, on every single render of this page.
  const {
    measurements,
    pending: pendingMeasurement,
    hoverPoint: measureHoverPoint,
    setHoverPoint: setMeasureHoverPoint,
    selectedId: selectedMeasurementId,
    setSelectedId: setSelectedMeasurementId,
    addPoint: addMeasurePoint,
    begin: beginMeasure,
    cancel: cancelMeasure,
    clear: clearMeasure,
    remove: removeMeasure,
    recolor: recolorMeasure,
  } = measure;
  // The page PDFKonvaViewer is showing. Mirrored here rather than pulled off its imperative
  // handle because two things RENDER from it — the toolbar's disabled state and the per-page
  // calibration lookup — and getCurrentPage() is a pull, not a subscription.
  const [pdfPage, setPdfPage] = useState(UNPAGED);
  // Why the last calibration save failed, shown inside CalibrationPanel. Null when there is
  // nothing to say.
  const [measureError, setMeasureError] = useState<string | null>(null);
  // The span the calibrate gesture captured, in the active surface's own units. Null until it
  // has one, which is also what keeps CalibrationPanel off screen.
  //
  // Read from a COMMITTED measurement rather than from `measure.pending`: useMeasurements
  // commits a linear gesture the instant its second point lands and restarts the gesture in the
  // same call, so a pending linear gesture only ever holds 0 or 1 points. Calibrate collects the
  // same two points a linear does, so it arrives the same way — see the capture effect below.
  const [calibrationSpan, setCalibrationSpan] = useState<number | null>(null);
  // Assigned during render (like annotatingRef above) so the gesture effects can read the
  // current list WITHOUT depending on it — a dependency there would re-arm, and so restart, the
  // gesture every time a reading was taken.
  const measurementsRef = useRef(measurements);
  measurementsRef.current = measurements;
  // How long the list was when the current tool was armed. Everything past it belongs to this
  // gesture.
  const calibrationBaselineRef = useRef(0);

  // Comment linking state
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsRefreshKey, setCommentsRefreshKey] = useState(0);

  // Top-level composer draft (single source of truth)
  const [composerText, setComposerText] = useState('');
  const [composerFiles, setComposerFiles] = useState<File[]>([]);
  const [submittingComposer, setSubmittingComposer] = useState(false);
  // A failed post keeps the user's text, attachments and pin; this says why.
  const [composerError, setComposerError] = useState<string | null>(null);
  const [tagging, setTagging] = useState(false);
  const [pendingTag, setPendingTag] = useState<{
    xPosition?: number; yPosition?: number;
    worldX?: number; worldY?: number; worldZ?: number;
    pageNumber?: number; timestamp?: number;
  } | null>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);
  // Every version an auto-generate has been attempted for this mount. A Set,
  // not a single slot: with one slot, selecting V3, switching away, and
  // switching back re-armed the guard while the first POST was still in
  // flight, and the GET still reported no brief — so a second, paid
  // generation went out for a version already being summarised.
  const autoBriefAttempted = useRef<Set<string>>(new Set());

  // Snapshot state (annotation mode — frozen view for drawing)
  const [viewerSnapshot, setViewerSnapshot] = useState<string | null>(null);
  // Where the source <img> sat inside that snapshot, for the image branch only. Always set and
  // cleared in the same breath as `viewerSnapshot` — the two describe one frozen frame, and a
  // space left over from a previous freeze would scale the next one's readings.
  const [viewerImageSpace, setViewerImageSpace] = useState<ImageSnapshotSpace | null>(null);
  // Natural image pixels per AnnotationCanvas stage pixel, reported UP by that canvas. It owns
  // `bgFit`, and `bgFit` only exists after the snapshot has decoded — an async onload that lands
  // after this page has already rendered. Pulling it back off the imperative handle in a memo
  // here would therefore read null once and never recompute, leaving every calibration stored in
  // stage pixels. See AnnotationCanvas's onIntrinsicScaleChange. Null means "no usable chain",
  // and nothing downstream may substitute 1 for it.
  const [imageIntrinsicPerStagePixel, setImageIntrinsicPerStagePixel] = useState<number | null>(null);
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

  const [parts, setParts] = useState<PartNode[]>([]);
  // Reported by the viewer, which is the only place the loaded materials exist. The panel
  // needs it so its swatches resolve colours exactly as the viewport does.
  const [authored, setAuthored] = useState(false);
  // Session-only, and reset whenever the viewer shows a different file — a part key means
  // nothing across models, so carrying the set over would hide arbitrary geometry.
  const [hiddenParts, setHiddenParts] = useState<string[]>([]);
  // Mirrors the server so the viewport updates on click rather than after a refetch.
  const [partColors, setPartColors] = useState<Record<string, string>>({});
  const [hoveredPart, setHoveredPart] = useState<string | null>(null);
  const [revealPart, setRevealPart] = useState<string | null>(null);
  // Bumped on every viewport pick, even a repeat of the same part — see handlePartPick's
  // comment for why `revealPart` alone (unchanged when the key repeats) cannot do this job.
  const [revealToken, setRevealToken] = useState(0);
  // Each part's own baked colour, reported by the viewer (only place the loaded materials
  // exist) via onPartsLoaded. The panel's swatch falls back to this — after an override and an
  // auto-colour, before BASE_GREY — so it can agree with what the viewport actually shows for a
  // part that has neither.
  const [partBaseColors, setPartBaseColors] = useState<Map<string, string>>(new Map());

  // ColorPickerPopover emits on EVERY pointermove of a saturation or hue drag — dozens of
  // calls per second. The viewport must follow that live, but the server must not: one PATCH
  // per pointermove would be a write storm against a row that only the last value matters for.
  // So the two are split — state updates immediately, the write is trailing-debounced.
  //
  // One pending write per PART, not a single shared slot: writes for different parts are
  // independent rows on the server and must not displace one another. PartsPanel's swatch
  // onClick (`setPicking(picking === part.key ? null : part.key)`) can move straight from part
  // A to part B with no close step, so colouring A, then colouring B inside the same 400ms
  // window, is ordinary use, not an edge case. Only repeated writes for the SAME part collapse
  // to the last value — that collapsing is the whole point of the debounce.
  //
  // Every entry (in either map below) is tagged with the file id it belongs to, captured at the
  // moment the user set it — not read fresh later — so nothing downstream needs to guess which
  // file a queued or in-flight write was actually meant for, even after the user has since
  // switched files. Part keys are plain index paths that collide across models by construction,
  // so that tag is what keeps a stale write from ever landing on the wrong model.
  //
  // pendingColorWrites: queued locally, waiting out the debounce, not yet sent.
  // inFlightColorWrites: handed off to flushPartColor and now on the wire, awaiting a response.
  // A key lives in at most one of these at a time; flushPartColor moves it from the first to the
  // second the moment it starts sending, and out of the second once that request settles. The
  // partColors-resync effect below reads both, to avoid clobbering a colour that is not yet
  // confirmed by the server, whichever of the two states it is currently in.
  const colorWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingColorWrites = useRef<Map<string, { fileId: string; color: string | null }>>(new Map());
  const inFlightColorWrites = useRef<Map<string, { fileId: string; color: string | null }>>(new Map());
  // Mirrors selectedFileId for reads from inside an already-in-flight async callback, whose own
  // closure over selectedFileId is frozen at whatever render created it and cannot see a later
  // switch. Updated every render (not gated on an effect) so it is never one commit behind.
  const currentFileIdRef = useRef(selectedFileId);
  currentFileIdRef.current = selectedFileId;

  // Session-only part state resets on a genuine file switch — keyed on selectedFileId ALONE.
  // selectedFile is recomputed by files.find(...) every render, and fetchFiles replaces
  // `files` with brand-new objects from a fresh res.json() whenever ANY file in the version
  // changes, including a delete of a file OTHER than the one on screen. Keying this reset on
  // selectedFile?.partColors too (as it used to be, bundled with the effect below) reran it on
  // every such refetch and wiped hiddenParts/parts/authored/hoveredPart/revealPart for the file
  // still being viewed. Because ModelErrorBoundary's key does not change for an unrelated
  // file's delete, the model never remounts to refire onPartsLoaded, so parts stayed empty and
  // PartsPanel rendered null — the whole panel vanished until the user reselected the file.
  //
  // Does NOT touch pendingColorWrites/inFlightColorWrites: those are now self-scoped by the
  // fileId tagged onto each entry (see the declarations above), so there is nothing to clear
  // here on a file switch — a stale entry for the file being left simply never matches the
  // newly selected file's id wherever it is read, and flushPartColor drains and sends it
  // regardless, independent of whether this effect has run yet.
  useEffect(() => {
    setParts([]);
    setAuthored(false);
    setHiddenParts([]);
    setHoveredPart(null);
    setRevealPart(null);
    setPartBaseColors(new Map());
  }, [selectedFileId]);

  // partColors syncs from the server data, so it deliberately stays keyed on
  // selectedFile?.partColors — a refetch (e.g. an unrelated file's delete) SHOULD bring newly
  // saved colours down. That much is correct and desirable on its own.
  //
  // The risk is a resync landing mid-drag: without a guard, it would overwrite `partColors`
  // wholesale with whatever the server last durably had, discarding a colour the user is
  // actively setting but that has not reached the server yet. A key is "not yet confirmed" for
  // two different reasons now — still waiting out the debounce (pendingColorWrites) or already
  // sent and awaiting a response (inFlightColorWrites), since flushPartColor drains the former
  // into the latter synchronously the moment it starts a send (see its own comment). Both are
  // checked here, each filtered to the file currently on screen — a leftover entry for a file
  // the user has since left is never layered onto the one now showing.
  useEffect(() => {
    const serverColors = selectedFile?.partColors ?? {};
    const unconfirmed = new Map<string, string | null>();
    pendingColorWrites.current.forEach((entry, key) => {
      if (entry.fileId === selectedFileId) unconfirmed.set(key, entry.color);
    });
    inFlightColorWrites.current.forEach((entry, key) => {
      if (entry.fileId === selectedFileId) unconfirmed.set(key, entry.color);
    });
    if (unconfirmed.size === 0) {
      setPartColors(serverColors);
      return;
    }
    const next = { ...serverColors };
    unconfirmed.forEach((color, key) => {
      if (color === null) delete next[key];
      else next[key] = color;
    });
    setPartColors(next);
  }, [selectedFile?.partColors, selectedFileId]);

  const handlePartsLoaded = useCallback((next: PartNode[], nextAuthored: boolean, baseColors: Map<string, string>) => {
    setParts(next);
    setAuthored(nextAuthored);
    setPartBaseColors(baseColors);
  }, []);

  // Re-picking the same part while the panel is already open and scrolled to it is a no-op by
  // design: PartsPanel's scroll effect keys on `revealPart`'s VALUE, so setting the same key
  // twice does not re-trigger a redundant rescroll. But REOPENING a panel the user has since
  // closed is a different thing entirely, and `revealPart` alone cannot signal it — `open` is
  // state PartsPanel owns internally, invisible up here, so a repeat key looks identical whether
  // the panel is open or closed. `revealToken` exists purely to force that: it changes on every
  // pick regardless of key, so PartsPanel's open-and-expand effect (which depends on it) always
  // re-runs and always calls setOpen(true) — a no-op when already open, a real reopen when not.
  const handlePartPick = useCallback((key: string) => {
    setRevealPart(key);
    setRevealToken((t) => t + 1);
  }, []);

  const flushPartColor = useCallback(async () => {
    // Drain synchronously, before any await, so a second call into this same closure — e.g. the
    // switch/unmount cleanup below firing right after the debounce timer already fired it once
    // — finds nothing left to send. The map being emptied is a plain, immediate side effect of
    // calling this function at all: correctness no longer depends on which effect fires when,
    // only on this drain happening before the first await, which it always does. A later write
    // to the same key is then just a fresh, independent .set() with its own timer.
    //
    // .forEach(), not for...of / spread — this tsconfig has no `target`, and iterating a Map
    // directly fails `next build` with TS2802 even though `npm test` passes.
    const entries: [string, { fileId: string; color: string | null }][] = [];
    pendingColorWrites.current.forEach((entry, key) => entries.push([key, entry]));
    pendingColorWrites.current.clear();
    if (entries.length === 0) return;

    // Now on the wire. pendingColorWrites was just emptied above, so it can no longer tell the
    // partColors-resync effect which keys are unconfirmed — this map picks up that job for the
    // window between "request sent" and "request settled".
    entries.forEach(([key, entry]) => inFlightColorWrites.current.set(key, entry));

    const results = await Promise.all(
      entries.map(([key, { fileId, color }]) =>
        fetch(`/api/files/${fileId}/part-colors`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partKey: key, color }),
        })
          .then((res) => ({ key, fileId, ok: res.ok }))
          .catch(() => ({ key, fileId, ok: false }))
      )
    );

    // Every entry sent in this batch is settled one way or another now — but delete only if the
    // map still holds THIS CALL's own entry object for the key, not merely a matching key. Two
    // flushes for the same part can overlap on the wire: colour K, wait out the debounce (flush
    // #1 sends and puts ITS OWN {fileId, color} object into inFlightColorWrites), colour K again
    // before #1 settles (a fresh setPartColor call queues a NEW, distinct object, and flush #2
    // later overwrites the map's entry for K with THAT object while #1 is still in flight). If #1
    // then settles first and deleted by key alone, it would erase #2's still-in-flight marker —
    // and a partColors-resync effect landing in that exact window would see K as fully
    // confirmed, sync in whatever the server last durably had (at best #1's value), and revert
    // the viewport away from the user's most recent action while #2's request is still pending.
    // Comparing the object reference this call captured against whatever the map holds NOW means
    // a newer flush's entry is left untouched — it gets deleted only by ITS OWN settling.
    entries.forEach(([key, entry]) => {
      if (inFlightColorWrites.current.get(key) === entry) inFlightColorWrites.current.delete(key);
    });

    // A rejected write must not leave the viewport showing a colour the server does not have —
    // but only for the key(s) that actually failed. A sibling key in the same batch that
    // succeeded is already durably saved on the server and must not be undone alongside it.
    // Also scoped to whichever file is CURRENTLY on screen (via the live ref, not this closure's
    // own possibly-stale selectedFile): if the user has since switched away from the file this
    // failed write belongs to, that file's colours are no longer what `partColors` shows, and
    // reverting into it here would misapply one file's colour onto an unrelated part of another
    // — part keys are plain index paths that collide across models by construction.
    const failed = results.filter((r) => !r.ok && r.fileId === currentFileIdRef.current);
    if (failed.length > 0) {
      const serverColors = selectedFile?.partColors ?? {};
      setPartColors((prev) => {
        const next = { ...prev };
        failed.forEach(({ key }) => {
          if (key in serverColors) next[key] = serverColors[key];
          else delete next[key];
        });
        return next;
      });
    }
    // selectedFileId itself is unused in this body (each entry already carries its own fileId,
    // and the failure-revert's "is this still the current file" check uses the live ref instead)
    // but stays in this dependency list so this closure gets a new identity on EVERY file
    // switch, even one between two files that happen to share the same (absent) partColors
    // reference — that identity change is what the switch/unmount effect below keys on to flush
    // an outgoing file's pending write on the way out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFileId, selectedFile?.partColors]);

  const setPartColor = useCallback(
    (key: string, color: string | null) => {
      if (!selectedFileId) return;

      setPartColors((prev) => {
        const next = { ...prev };
        if (color === null) delete next[key];
        else next[key] = color;
        return next;
      });

      // Repeated writes for the SAME part collapse to the last value — the whole point of the
      // debounce. Writes for a DIFFERENT part are a separate entry in the map and do not evict
      // whatever is already pending for that other part. Tagged with the file id at the moment
      // it is set (not read fresh later), so every later stage knows which file this entry
      // belongs to even after the user has since switched files.
      pendingColorWrites.current.set(key, { fileId: selectedFileId, color });
      if (colorWriteTimer.current) clearTimeout(colorWriteTimer.current);
      colorWriteTimer.current = setTimeout(flushPartColor, 400);
    },
    [selectedFileId, flushPartColor]
  );

  // A drag still in flight when the file changes or the page unmounts must still land — the
  // user saw the colour applied, so dropping it silently would be a lie.
  useEffect(() => () => {
    if (colorWriteTimer.current) {
      clearTimeout(colorWriteTimer.current);
      void flushPartColor();
    }
  }, [flushPartColor]);

  const togglePartVisibility = useCallback((key: string) => {
    setHiddenParts((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  // What the panel's pill shows: an override if there is one, else the auto-colour, else the
  // part's own base colour (reported by the viewer via onPartsLoaded), else the neutral base as
  // a last resort for a part that hasn't reported one yet. This must agree with the resolution
  // order in ModelViewerInner's colour effect — a pill disagreeing with the viewport is worse
  // than no pill. `PartNode` itself carries no colour, so `partBaseColors` — not BASE_GREY — is
  // what makes that agreement possible for a part with neither an override nor an auto-colour.
  //
  // Cascaded through `cascadeToDescendants`, the SAME function and the SAME combined
  // override-or-auto-colour source ModelViewerInner's colour effect resolves through — an
  // assembly row's colour pill is expected to recolour its whole subtree, which means a child
  // row nested under a coloured (or auto-coloured) assembly must show that inherited colour on
  // its OWN swatch too, not just in the viewport. Resolving both through one shared function is
  // what keeps them unable to disagree, rather than two independent cascades that could drift.
  const autoPartColors = useMemo(() => autoColors(parts, authored), [parts, authored]);
  const cascadedPartColors = useMemo(
    () => cascadeToDescendants(parts, (key) => partColors[key] ?? autoPartColors.get(key)),
    [parts, partColors, autoPartColors]
  );
  const effectivePartColor = useCallback(
    (key: string) => cascadedPartColors.get(key) ?? partBaseColors.get(key) ?? BASE_GREY,
    [cascadedPartColors, partBaseColors]
  );

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

  /**
   * Positive, not exclusion: is the selected file one of the extensions the image viewer opens.
   * `measuresOnCanvas` and `measureAvailable` below used to be spelled as "not 3D, not PDF, not
   * video" — which reads fine until a fifth category shows up. An unsupported type like .dwg or
   * .dxf is none of those three, so it silently fell through an exclusion list and inherited the
   * image measure surface: DrawingTools offered Measure, AnnotationCanvas mounted transparent
   * over the "Unsupported file type" message, and Apply attached a near-blank JPEG. A positive
   * test cannot make that mistake — a future file type is simply not in IMAGE_EXTENSIONS until
   * someone deliberately adds it. Reuses ViewerContainer's list rather than a fourth copy of it.
   *
   * There is no separate `isVideoFile` any more: `measureAvailable` below now unions the three
   * known-good measuring surfaces (image, PDF, 3D) instead of excluding the one known-bad type,
   * so video is already false there without being named — the same way an unsupported type is.
   */
  const isImageFile = useMemo(() => {
    if (!selectedFile) return false;
    return IMAGE_EXTENSIONS.includes(`.${extensionOf(selectedFile.filename)}`);
  }, [selectedFile]);

  /** The unit readings are shown in on this file. Falls back until someone chooses one. */
  const measureUnit: LengthUnit = selectedFile?.measureUnit ?? DEFAULT_LENGTH_UNIT;

  // filename is the ORIGINAL upload's, never the converted GLB. A STEP file is on screen as a
  // GLB, and reading the extension off the loaded file would apply the glTF metre convention
  // and report every STEP model 1000x too large. See assumedMmPerUnit for the whole rule.
  const measureScale = useMemo(
    () =>
      selectedFile
        ? resolveScale({
            filename: selectedFile.filename,
            calibrations: selectedFile.calibrations,
            page: isPDFFile ? pdfPage : UNPAGED,
          })
        : { mmPerUnit: null, source: 'unknown' as const },
    [selectedFile, isPDFFile, pdfPage]
  );

  /**
   * How many of the file's own INTRINSIC units one unit of the active surface's space spans.
   *
   * Three surfaces, three answers:
   *   3D    — the picked points are already world units, so 1.
   *   PDF   — stage pixels to PDF points, which is what a PDF calibration must be stored in.
   *   image — AnnotationCanvas stage pixels to the source image's NATURAL pixels, which is the
   *           two-factor chain naturalPerStagePixel() resolves. Not computed here: the canvas
   *           owns both halves of it and pushes the answer up (see imageIntrinsicPerStagePixel).
   *
   * Null means the active surface has no resolvable scale — an image whose snapshot carried no
   * image space, or a surface that is not up yet. Deliberately not 1: substituting a stage pixel
   * for an intrinsic unit is the silent failure this whole module exists to prevent.
   *
   * The attachment session (annotatingFile !== null) is not a case here — canCalibrate is false
   * throughout it, so the calibrate tool cannot be armed on a pasted screenshot at all.
   */
  const intrinsicPerSurfaceUnit = useMemo<number | null>(() => {
    if (is3DFile) return 1;
    if (isPDFFile) return pointsPerStagePixel();
    return imageIntrinsicPerStagePixel;
  }, [is3DFile, isPDFFile, imageIntrinsicPerStagePixel]);

  const calibrationIntrinsicDistance =
    calibrationSpan === null || intrinsicPerSurfaceUnit === null
      ? null
      : calibrationSpan * intrinsicPerSurfaceUnit;

  // Which surface a markup session draws on. A PDF draws directly on its own
  // PDFKonvaViewer surface — except when the session is marking up a picked-but-not-
  // posted attachment, which is never the PDF being reviewed and so always draws on
  // AnnotationCanvas instead. Every other file type always draws on AnnotationCanvas.
  // Single source of truth for a rule that used to be hand-written at five call sites.
  const drawsOnCanvas = !isPDFFile || annotatingFile !== null;

  /**
   * Whether AnnotationCanvas is the surface the SELECTED FILE is measured on. A narrower
   * question than `drawsOnCanvas`, and the two must not be conflated.
   *
   * Image files only — `isImageFile`, not "not 3D, not PDF, not video". A 3D file measures in the
   * live WebGL scene (MeasureLayer) and a PDF on its own stage — yet both can have an
   * AnnotationCanvas over them: picking a draw tool on a 3D file freezes the viewport into a
   * snapshot this canvas draws on, and an attachment session puts this canvas over a PDF. Handing
   * the measure props over in either case would collect points in stage pixels of a frozen WebGL
   * frame, or of a pasted screenshot, and then scale them by the selected file's mm-per-unit — a
   * number that is about something else entirely. That is the plausible-looking wrong reading
   * this feature is built to make impossible, so the props are withheld structurally rather than
   * by hoping no one arms the tool. Spelling this as an exclusion ("not 3D, not PDF, not video")
   * would let it too, the same way `measureAvailable` below used to: any type outside all three —
   * a .dwg, a .dxf — would fall through and inherit the image surface by default.
   */
  const measuresOnCanvas = isImageFile && annotatingFile === null;

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
    // The markup and measurement selections are already mutually exclusive, so exactly one of
    // these two branches can ever fire for a given click.
    if (selectedMeasurementId) {
      recolorMeasure(selectedMeasurementId, c);
      return;
    }
    activeSurface()?.applyStyleToSelection({ color: c });
  }, [activeSurface, selectedMeasurementId, recolorMeasure]);

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

  /**
   * A measurement click on the 3D surface.
   *
   * Nothing to convert on the way in. The point already arrives in the model's own frame (the
   * same frame comment pins are stored in), and `minSeparation` already arrives scene-scaled —
   * ModelViewerInner owns both, because it is the only place that knows the model's bounding
   * radius and the placement transform. That is also why `intrinsicPerSurfaceUnit` is 1 for 3D:
   * a model-frame distance IS a file-intrinsic distance, the placement carrying no scale.
   *
   * The committed measurement that `addPoint` may return is deliberately dropped here. The
   * calibrate flow reads it off the `measurements` list instead, so that one effect handles a
   * span whether it was just taken or restored — see the capture effect further down.
   */
  const handleMeasurePoint = useCallback(
    (point: number[], minSeparation: number) => {
      addMeasurePoint(point, minSeparation, drawingColor);
    },
    [addMeasurePoint, drawingColor]
  );

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
        setCanComment(Boolean(info?.access?.canComment));
      })
      .catch(() => {
        setCanUpload(false);
        setCanTransform(false);
        setCanComment(false);
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
    if (autoBriefAttempted.current.has(target)) return;
    // Claimed synchronously, before any await. React re-invokes effects in
    // development, and a guard set after an await lets both invocations through
    // to a paid endpoint. The cost of claiming early is that a network failure
    // skips this version for the rest of the session — acceptable, because the
    // drawer's Summarise and Refresh buttons both still work.
    autoBriefAttempted.current.add(target);

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
          // Released unconditionally, and only if this run still owns the flag.
          // Conditioning on `cancelled` stranded it: the effect's one-shot
          // autoBriefAttempted guard means no later run for the same version
          // would ever clear it, so switching version mid-POST disabled that
          // version's Summarise button for the rest of the session. Comparing
          // against the current value also stops a settling older run from
          // clearing a newer version's claim.
          setAutoBriefBusy((current) => (current === target ? null : current));
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

  const handleMeasureUnitChange = useCallback(
    async (unit: LengthUnit) => {
      if (!selectedFileId) return;
      // Optimistic: readings relabel immediately. A failed write resyncs from the server rather
      // than leaving the toolbar showing a unit the server never accepted.
      setFiles((prev) => prev.map((f) => (f.id === selectedFileId ? { ...f, measureUnit: unit } : f)));
      const res = await fetch(`/api/files/${selectedFileId}/measure`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit }),
      }).catch(() => null);
      if (!res?.ok && selectedVersionId) fetchFiles(selectedVersionId);
    },
    [selectedFileId, selectedVersionId, fetchFiles]
  );

  /**
   * Commit a calibration from the two points the gesture collected plus the distance the user
   * typed. `intrinsicDistance` arrives already converted out of the surface's space into the
   * file's own intrinsic unit — stage pixels are never stored.
   */
  const handleCalibrationCommit = useCallback(
    async (intrinsicDistance: number | null, realDistance: number, entryUnit: LengthUnit) => {
      if (!selectedFileId) return;
      const page = isPDFFile ? pdfPage : UNPAGED;
      // Clear any earlier failure up front: the panel stays open after a rejected save, so
      // without this the stale message sits under the input while the user retypes and
      // resubmits, only being replaced when the new response finally lands.
      setMeasureError(null);

      // Null is its own fault, distinct from both checks below: the surface could not resolve
      // its own stage-to-intrinsic scale at all, so the span it collected is in stage pixels and
      // there is nothing to convert it with. Storing it anyway would file a stage-pixel number in
      // a column that means intrinsic units — plausible at the zoom it was taken at, wrong at
      // every other one, and nothing throws.
      if (intrinsicDistance === null) {
        setMeasureError("Could not work out this file's pixel scale. Close the file, reopen it and try again.");
        return;
      }

      // mmPerUnitFrom throws the same RangeError type for two different faults, and only one of
      // them is the user's. A non-positive MEASURED span means the two points landed on (or
      // within rounding of) each other — the tool's problem, not the typed number's. Check that
      // operand here so the catch below can only be the typed distance, rather than telling
      // someone to enter a bigger number when the number they entered was fine.
      if (!Number.isFinite(intrinsicDistance) || intrinsicDistance <= 0) {
        setMeasureError('Those two points are too close together to calibrate from. Place them further apart.');
        return;
      }

      let mmPerUnit: number;
      try {
        mmPerUnit = mmPerUnitFrom(intrinsicDistance, realDistance, entryUnit);
      } catch {
        setMeasureError('Enter a distance greater than zero.');
        return;
      }

      const res = await fetch(`/api/files/${selectedFileId}/measure`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calibration: { page, mmPerUnit } }),
      }).catch(() => null);

      if (!res) {
        setMeasureError('Could not reach the server. Try again.');
        return;
      }

      if (res.ok) {
        setMeasureError(null);
        setFiles((prev) =>
          prev.map((f) =>
            f.id === selectedFileId
              ? { ...f, calibrations: { ...(f.calibrations ?? {}), [page]: mmPerUnit } }
              : f
          )
        );
        setActiveTool('pointer');
        return;
      }

      const body = await res.json().catch(() => ({}));
      // A 500 from this route on an app that is otherwise working most likely means the
      // file_calibrations table is missing — this repo applies migrations by hand and has
      // forgotten one twice. Say so, rather than accepting a calibration that silently vanishes.
      setMeasureError(
        body?.error ??
          (res.status === 500
            ? "Measurement isn't available yet on this deployment."
            : 'Could not save the calibration.')
      );
    },
    [selectedFileId, isPDFFile, pdfPage]
  );

  /**
   * Drop every measurement, the half-placed gesture, and the calibrate span that was derived
   * from them.
   *
   * Used wherever the space the points were collected in stops existing. On the image surface a
   * point is a raw STAGE pixel, and stage space there is a property of one freeze at one stage
   * size — nothing re-anchors it — so a measurement that outlives its frozen view keeps being
   * drawn, and keeps being labelled, against a scale that is no longer the one it was placed
   * under. The number changes with no user action; the drawing lands on the wrong part of the
   * image. Both are silent.
   *
   * The two ref assignments are not tidiness. `measurementsRef` and `calibrationBaselineRef` are
   * both assigned during RENDER, while every caller of this runs in an effect or an event
   * handler — so `clearMeasure()` only lands on the next render, and the measure-arming effect
   * that runs immediately after a session start reads the REFS. Left stale, the baseline would
   * be captured against the list this just emptied (say 1 against a list of 0), and the
   * calibrate capture effect's `measurements.slice(baseline)` would never see the span the user
   * then placed: the panel would never open and the file would silently keep its old scale.
   */
  const resetMeasureSession = useCallback(() => {
    clearMeasure();
    measurementsRef.current = [];
    calibrationBaselineRef.current = 0;
    setCalibrationSpan(null);
    setMeasureError(null);
  }, [clearMeasure]);

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
      const snapshot = container ? captureViewerSnapshot(container) : null;
      setViewerSnapshot(snapshot?.dataUrl ?? null);
      setViewerImageSpace(snapshot?.imageSpace ?? null);
      // A NEW freeze means the view the previous session's points were placed on no longer
      // exists — different zoom, different imageRect, different natural-pixels-per-stage-pixel.
      // Carrying them over redraws them somewhere else on the image and relabels them, which is
      // the exact failure the whole natural-pixel calibration chain exists to prevent, arriving
      // by the back door. `measuresOnCanvas` is what makes this the image surface and only the
      // image surface: a 3D freeze must not touch measurements held in the model's frame.
      //
      // Runs BEFORE the measure-arming effect (that effect is declared after the session-starter
      // one, and effects fire in declaration order), so the gesture this drops is immediately
      // begun again on the fresh view.
      if (measuresOnCanvas) {
        resetMeasureSession();
      } else {
        // measuresOnCanvas is false here for a 3D file (among others) — its measurements live
        // in the model's own frame and stay valid, so resetMeasureSession must not run (that's
        // its 3D carve-out, left untouched). But the live 3D surface is about to sit behind this
        // frozen snapshot for the whole markup session, so a measurement selected before the
        // freeze is now invisible while the shared Delete/Backspace handler below can still hit
        // it. Clear just the selection, not the measurements, so there is nothing stale to hit.
        setSelectedMeasurementId(null);
      }
    }
  }, [annotating, isPDFFile, measuresOnCanvas, resetMeasureSession, setSelectedMeasurementId]);

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
        // A pasted attachment is not the package file and has no image space: it is not measured
        // on, and the measure props are withheld from the canvas for the whole session.
        setViewerImageSpace(null);
        setAnnotatingFile(file);
        setAnnotating(true);
        setActiveTool('pointer');
      };
      reader.readAsDataURL(file);
    },
    [composerFiles]
  );

  // Start an annotation session when a draw tool is picked (only session-starter).
  //
  // Measure tools join this for 2D files but NOT for 3D, which is why they are deliberately
  // absent from DRAW_TOOLS: startAnnotationSession freezes the viewport into a snapshot, and a
  // frozen 3D model cannot be orbited — which is most of the point of measuring one. For PDFs
  // the call sets `annotating` without freezing anything, which is exactly what that surface
  // wants: it disables stage panning so a drag reads as a gesture rather than a pan.
  //
  // `!!selectedFile` is part of the measure clause because `is3DFile` is derived from
  // `selectedFile`: if the file list is ever emptied while a measure tool is armed (a failed
  // PATCH resyncs through fetchFiles, which sets `files` to [] on a non-ok response without
  // clearing selectedFileId), `selectedFile` goes null and `is3DFile` goes false with it — which
  // would otherwise read as "not 3D, start a session" and strand `annotating` true with no file
  // to freeze and no file-switch reset to turn it off again.
  useEffect(() => {
    const needsSurface =
      DRAW_TOOLS.includes(activeTool) || (isMeasureTool(activeTool) && !is3DFile && !!selectedFile);
    if (!needsSurface) return;
    startAnnotationSession();
  }, [activeTool, is3DFile, selectedFile, startAnnotationSession]);

  // Tag placement, drawing and measuring are mutually exclusive — disarm tagging when a draw or
  // measure tool is selected.
  //
  // The eraser is named separately for the same reason it's named separately in the gizmo
  // exclusion effect below: it's not in DRAW_TOOLS or MEASURE_TOOLS, so without this it would
  // arm alongside tagging rather than disarming it. On a 3D file `commentToolActive` (in
  // ModelViewerInner) is `is3DFile && tagging`, and `eraserOwnsPointer` requires
  // `!commentToolActive` — so a Tag-then-Eraser sequence would leave the Eraser button lit and
  // the crosshair cursor showing while every click still fell through to the comment-pin branch.
  // That's the enabled-but-cannot-act inversion this task exists to prevent, except here the
  // press does something destructive (drops a pin) instead of nothing.
  useEffect(() => {
    if (DRAW_TOOLS.includes(activeTool) || isMeasureTool(activeTool) || activeTool === 'eraser')
      setTagging(false);
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
    //
    // The eraser is named separately because it is not in DRAW_TOOLS — that list means "tools
    // that START an annotation session", and the eraser must never start one (see the effect
    // above). It is still a tool that owns the press, and on a 3D file it now owns the whole
    // viewport left-drag, so leaving the gizmo armed underneath it means one drag on a handle
    // both moves the model and erases everything the handle passes over. It also hands
    // `controls.enabled` a second writer: drei's TransformControls re-enables the camera on
    // every drag end and TransformGizmo's unmount cleanup restores it unconditionally, either
    // of which would give the orbit back mid-erase.
    if (tagging || DRAW_TOOLS.includes(activeTool) || isMeasureTool(activeTool) || activeTool === 'eraser') {
      setTransformMode(null);
      setSelectedPlane(null);
    }
  }, [tagging, activeTool]);

  // Turning a page mid-gesture must not let the second click land on a different sheet.
  //
  // Declared ABOVE the arming effect on purpose: both fire on a pdfPage change, effects run in
  // declaration order, and the later one wins. This way the page turn abandons the half-placed
  // gesture and the arming effect immediately starts a fresh one on the new page. Swapped
  // around, the cancel would land last and leave the tool armed with no gesture behind it —
  // visibly selected, and dead to every click.
  //
  // A captured calibrate span goes with it. The span was measured on the sheet being left, but
  // handleCalibrationCommit files it against the CURRENT pdfPage — so carrying it across a page
  // turn would store sheet N's measured length as sheet N+1's scale. Unconditional because both
  // setters bail out on Object.is when nothing was held.
  useEffect(() => {
    cancelMeasure();
    setCalibrationSpan(null);
    setMeasureError(null);
  }, [pdfPage, cancelMeasure]);

  // Arming a measure tool begins a gesture; disarming abandons whatever was half-placed.
  // 'calibrate' collects the same two points a linear does — only what happens on commit differs.
  useEffect(() => {
    if (!isMeasureTool(activeTool)) {
      cancelMeasure();
      return;
    }
    // Anything already in the list belongs to an earlier gesture and must not be mistaken for
    // this one's result — see the capture effect below.
    calibrationBaselineRef.current = measurementsRef.current.length;
    beginMeasure(activeTool === 'angle' ? 'angular' : 'linear', isPDFFile ? pdfPage : UNPAGED);
  }, [activeTool, isPDFFile, pdfPage, beginMeasure, cancelMeasure]);

  // A stage resize invalidates every point on the image surface, MID-SESSION and with no user
  // action at all.
  //
  // `bgFit` deliberately re-fits the frozen snapshot into whatever the stage is now, so narrowing
  // the pane from 1000 to 500 px turns 4 natural px per stage px into 8: a dimension reading
  // 500 mm starts reading 1000 mm, in place, while the user watches. The points are dropped
  // rather than re-anchored — re-anchoring correctly needs the whole `bgFit` RECT, because its
  // letterbox offset moves as well as its scale (1000x700 -> 500x700 sends x0.5 *and* y+175), and
  // that rect lives inside AnnotationCanvas, which deliberately exposes only the scalar factor.
  // A reading the user has to take again is recoverable; one that silently relabels itself is not.
  //
  // `imageIntrinsicPerStagePixel` is non-null ONLY on the image measure surface — the canvas is
  // handed `onIntrinsicScaleChange` only when `measuresOnCanvas` — so this can never reach a 3D
  // measurement, whose points are in the model's frame and are correct across any resize, orbit
  // or object transform. The null guards also skip the two legitimate transitions that are not
  // resizes: null -> number when the snapshot first decodes (async, one or more commits after
  // the session started), and number -> null when the canvas unmounts at the end of it.
  const lastIntrinsicScaleRef = useRef<number | null>(null);
  useEffect(() => {
    const previous = lastIntrinsicScaleRef.current;
    lastIntrinsicScaleRef.current = imageIntrinsicPerStagePixel;
    if (previous === null || imageIntrinsicPerStagePixel === null) return;
    if (previous === imageIntrinsicPerStagePixel) return;
    // Nothing placed, nothing to invalidate. Worth the check because a resize is not one event:
    // ResizeObserver fires every frame of a panel's width transition, and without this each of
    // those frames would clear an already-empty list and restart an untouched gesture.
    if (measurementsRef.current.length === 0 && (pendingMeasurement?.points.length ?? 0) === 0) return;
    resetMeasureSession();
    // The half-placed gesture goes with them — its first point is in the same dead stage space —
    // and re-arming it is this effect's job, because `activeTool` has not changed and so the
    // arming effect above will not run. Without this the tool stays visibly selected and dead to
    // every click, which is the same trap the pdfPage cancel above is ordered to avoid.
    // UNPAGED unconditionally: a non-null factor is the image surface, which has no pages.
    if (isMeasureTool(activeTool)) {
      beginMeasure(activeTool === 'angle' ? 'angular' : 'linear', UNPAGED);
    }
  }, [imageIntrinsicPerStagePixel, activeTool, pendingMeasurement, beginMeasure, resetMeasureSession]);

  // Catch the calibrate gesture's result.
  //
  // It arrives as a COMMITTED measurement rather than as a two-point `pending`: useMeasurements
  // commits a linear gesture the instant its second point lands and restarts the gesture in the
  // same call, so `pending` never holds two points. The measurement is left in the list while
  // the panel is up — that is the only feedback showing WHICH span is being named — and taken
  // back out when the tool is disarmed, because a calibration is a scale, not a dimension.
  //
  // ALWAYS the last measurement past the baseline, never latched on the first one. This used to
  // bail out once `calibrationSpan` was set, which was wrong: useMeasurements restarts the
  // gesture straight after every commit, so the surface keeps collecting points for as long as
  // Calibrate stays armed. A user who mis-clicks and places two fresh points gets a second
  // committed span — and with the latch in place the panel stayed pinned to the span they had
  // already replaced, so the real-world distance they typed was divided by the wrong measured
  // length and every later reading on the file was silently wrong. Re-running with an identical
  // span is a no-op: React bails out on Object.is, so there is no render loop.
  useEffect(() => {
    if (activeTool !== 'calibrate') return;
    const since = measurements.slice(calibrationBaselineRef.current);
    const captured = since[since.length - 1];
    if (!captured || captured.points.length < 2) {
      // Nothing past the baseline any more — the user selected the calibrate measurement and
      // pressed Delete, and this effect re-ran because `measurements` changed. Returning here
      // without clearing would strand the span: the panel's gate is `calibrationSpan !== null`,
      // so it would stay mounted showing a measurement that no longer exists, and pressing Set
      // would store a scale derived from a span the user explicitly deleted. Same class as the
      // latch above — the span must always be the points the user last placed, or none.
      setCalibrationSpan(null);
      return;
    }
    setCalibrationSpan(distance(captured.points[0], captured.points[1]));
  }, [activeTool, measurements]);

  // Leaving Calibrate — by committing, by cancelling, or by simply picking another tool — drops
  // the captured span and takes every measurement the gesture made back out of the list: a
  // calibration is a scale, not a dimension anyone asked to see. Swept by the baseline rather
  // than by the one captured id, so extra clicks made while the panel was up go with it. One
  // cleanup rather than three call sites that would each have to remember.
  useEffect(() => {
    if (activeTool !== 'calibrate') return;
    return () => {
      for (const m of measurementsRef.current.slice(calibrationBaselineRef.current)) {
        removeMeasure(m.id);
      }
      setCalibrationSpan(null);
      setMeasureError(null);
    };
  }, [activeTool, removeMeasure]);

  // Escape abandons a pending gesture; Delete removes a selected measurement. One handler for
  // all three surfaces, because the store lives here and the 3D viewer has no keyboard surface
  // of its own. Keys are ignored while a field has focus — CalibrationPanel's own input handles
  // Escape itself, and Backspace there must delete a character, not a measurement.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'Escape' && isMeasureTool(activeTool)) {
        beginMeasure(activeTool === 'angle' ? 'angular' : 'linear', isPDFFile ? pdfPage : UNPAGED);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedMeasurementId) {
        e.preventDefault();
        removeMeasure(selectedMeasurementId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool, isPDFFile, pdfPage, selectedMeasurementId, removeMeasure, beginMeasure]);

  // Discard snapshots and reset transform when the selected file changes
  useEffect(() => {
    // A different file has to prove itself on screen again before the
    // indicator comes down.
    setViewerReady(false);
    setViewerSnapshot(null);
    setViewerImageSpace(null);
    // Cleared here as well as by AnnotationCanvas's own unmount report, because this is the one
    // boundary the number must never cross: a factor is a property of ONE image at ONE frozen
    // zoom, and applying the file being left's pixel density to the file being opened is the
    // silent-wrong-calibration failure. Ordering here is unconditional and one commit deep,
    // rather than resting on the unmount firing before anything reads it.
    setImageIntrinsicPerStagePixel(null);
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
    // Measurements are per-file and session-only: a reading taken on one drawing means nothing
    // on the next, and the scale it was read against has already changed underneath it.
    clearMeasure();
    // Cleared here rather than left to the disarm cleanup that this effect's setActiveTool
    // eventually triggers. That cascade lands a render later, and for the render in between the
    // panel is painted holding file A's span while selectedFileId and handleCalibrationCommit
    // already belong to file B. Reset in one commit instead of depending on an effect chain.
    setCalibrationSpan(null);
    setMeasureError(null);
  }, [selectedFileId, clearMeasure]);

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

    const res = await fetch(`/api/versions/${target.id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast('Could not delete this version');
      return;
    }

    toast(`Version ${target.versionNumber} deleted`);
    // The drawer resolves its version from `versions`, so loadVersions() below
    // would close it anyway — but only after a round trip. Clearing it here
    // means the drawer does not linger over the confirm's dismissal.
    if (detailVersionId === target.id) setDetailVersionId(null);
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
    setComposerError(null);
    try {
      const attachments = composerFiles.length > 0
        ? await Promise.all(
            // Bound explicitly, not `.map(uploadFile)`: map passes the array
            // INDEX as the second argument, which is now the fileId.
            composerFiles.map((f) => uploadFile(f, selectedFileId))
          )
        : [];
      const res = await fetch('/api/comments', {
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
      // fetch only rejects on a NETWORK failure, so without this an expired session
      // (401), a view-only role (403) or a server error all resolved normally and
      // fell through to the clears below — discarding the user's text, their
      // attachments AND the pin they placed, while the UI reported success. On a 3D
      // annotation that is the most expensive thing in the product to redo.
      if (!res.ok) throw new Error(messageForStatus(res.status));

      setComposerText('');
      setComposerFiles([]);
      setPendingTag(null);
      setTagging(false);
      setCommentsRefreshKey((k) => k + 1);
      await fetchComments();
    } catch (err) {
      console.error('Failed to post comment:', err);
      // Deliberately clears nothing: the text, the attachments and the pin all
      // survive so the user can send again without redoing the markup.
      setComposerError(
        err instanceof Error ? err.message : 'Could not post your comment.'
      );
    } finally {
      setSubmittingComposer(false);
    }
  };

  const endSession = () => {
    setAnnotating(false);
    setAnnotatingFile(null);
    setViewerSnapshot(null);
    setViewerImageSpace(null);
    annotationCanvasRef.current?.clear();
    pdfKonvaRef.current?.clearDrawings();
    setActiveTool('pointer');
    setSelectionType(null);
    // Measurements are session-only — the same rule the file-switch reset states, and the one
    // the store's own header states — so ending the session has to take them with it. It did
    // not, and on the image surface that was the more serious half of the bug: a point there is
    // a raw stage pixel of ONE freeze, so a measurement that survived into the next session was
    // redrawn over the wrong part of a differently-zoomed snapshot and silently relabelled by
    // that snapshot's factor (500 mm became 333 mm across a 100% -> 150% re-arm). The reading is
    // gone either way; the honest outcome is that it is visibly gone.
    //
    // NOT on a 3D file. Those points are in the model's own frame, not in any stage space, and
    // stay correct through camera moves, resizes and object transforms — and the session there
    // is a MARKUP session over a frozen viewport that the user opened on top of measurements
    // they were already reading. Clearing them would destroy valid work that nothing had
    // invalidated. The 3D store is emptied by the file-switch reset, as before.
    if (!is3DFile) resetMeasureSession();
  };

  /** "sketch.png" → "sketch-markup.jpg". The capture is always a JPEG, so
   *  keeping the original extension would be a lie about the bytes. */
  const markupName = (original: string) =>
    `${original.replace(/\.[^./]+$/, '')}-markup.jpg`;

  /**
   * Whether a measurement would be VISIBLE in the capture Apply is about to take.
   *
   * The capture used to be gated on `surface.hasObjects()` alone, which counts the MARKUP list —
   * and measurements are deliberately not in it. So a measurement-only session (open an image,
   * arm Linear, place one dimension, press Apply) captured nothing, attached nothing, and then
   * ended; and because measurements are session-only, the reading was simply gone. That defeats
   * the premise of the feature: snapshotting a measurement into a comment is the ONLY way to
   * keep one. The gate is now markup OR this.
   *
   * Decided here rather than inside the surface components because the portal is what owns the
   * measure store; neither surface knows the reading exists.
   *
   * The page test is the same filter the surfaces' own measure layers apply (MeasureObjects
   * renders `m.page === page`, `currentPage` on the PDF and UNPAGED on the image canvas): a
   * dimension on sheet 1 is not on screen while sheet 2 is showing, so it must not qualify a
   * capture of sheet 2. Image and 3D gestures are all begun on UNPAGED.
   *
   * 3D counts, and the capture that would include it is already correct: MeasureLayer draws
   * inside the WebGL scene and deliberately does NOT carry `userData.excludeFromSnapshot`, so
   * `renderCleanFrame` keeps it while dropping viewer chrome, and `captureViewerSnapshot` reads
   * that canvas into the frozen background this session draws on. The measurement is therefore
   * baked into the background before a single markup object exists — it cannot be added
   * mid-session, since `measuresOnCanvas` is false there and the live scene is hidden behind the
   * snapshot.
   *
   * An attachment session never counts, which is why the native branch below keeps the
   * markup-only gate: its background is the pasted image, the measure props are withheld from
   * the canvas for its whole duration, and its capture crops to that image. There is nothing of
   * the viewer in it to have measured.
   */
  const measurementInCapture =
    annotatingFile === null &&
    measurements.some((m) => m.page === (isPDFFile ? pdfPage : UNPAGED));

  const handleAnnotationDone = async () => {
    const original = annotatingFile;
    try {
      if (original !== null) {
        // Attachment session: the surface is always AnnotationCanvas (never the union —
        // an attachment is never the PDF being reviewed). Capture at the background
        // image's own resolution, cropped to its fitted region: the whole-stage capture
        // the ordinary session below uses would letterbox and resample the attachment
        // Done is about to replace.
        //
        // Markup alone is the right gate HERE, and deliberately not `|| measurementInCapture`:
        // see that flag's note — an attachment session can never have a measurement on it, and
        // `measurementInCapture` is false throughout one for exactly that reason.
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
        // `hasObjects()` is the MARKUP list and nothing else, so on its own it threw away every
        // measurement-only session — see `measurementInCapture`. Written as an explicit
        // `surface &&` rather than `surface?.hasObjects() || …` so a true measurement flag can
        // never carry a null surface into `captureSnapshot` below.
        if (surface && (surface.hasObjects() || measurementInCapture)) {
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
            partColors={partColors}
            hiddenParts={hiddenParts}
            highlightedPart={hoveredPart}
            onPartsLoaded={handlePartsLoaded}
            onPartPick={handlePartPick}
            // One store, two surfaces. ViewerContainer forwards this group to ModelViewer AND
            // to PDFKonvaViewer — every prop but `measureActive`, which is 3D-only because the
            // PDF viewer reads the armed tool out of `activeTool` it already receives. Measuring
            // a 3D file happens in the live WebGL scene (see MeasureLayer on why it cannot be a
            // DOM overlay); the 2D surfaces collect their points in their own stage space, which
            // is what `intrinsicPerSurfaceUnit` and mmPerUnit exist to reconcile.
            measureActive={isMeasureTool(activeTool)}
            onMeasurePoint={handleMeasurePoint}
            measurements={measurements}
            pendingMeasurement={pendingMeasurement}
            // The live preview between clicks. Ungated, exactly like `pendingMeasurement` beside
            // it: whichever of the two surfaces ViewerContainer mounts is the one this file is
            // measured on, and each reports hover in its own space.
            measureHoverPoint={measureHoverPoint}
            onMeasureHover={setMeasureHoverPoint}
            mmPerUnit={measureScale.mmPerUnit}
            measureUnit={measureUnit}
            selectedMeasurementId={selectedMeasurementId}
            onSelectMeasurement={setSelectedMeasurementId}
            // The eraser deletes a dimension like any other mark. Ungated for the same reason
            // `measurements` beside it is: only the surface this file is measured on receives
            // them, and ViewerContainer hands this to the PDF viewer and the 3D viewer alone.
            onEraseMeasurement={removeMeasure}
            // Deliberately NOT also gated on `is3DFile`, for the same reason `measureActive`
            // above is not: ViewerContainer already forwards this to the 3D branch alone, and
            // that branch is chosen from its own copy of the extension list. Testing a second
            // hand-copied list here would add nothing today and, the first time the two drifted,
            // would silently leave the eraser armed in the toolbar and inert in the viewport —
            // which is the failure this whole tool keeps producing.
            eraserActive={activeTool === 'eraser'}
            onPageChange={setPdfPage}
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

      {/* 3-Panel Layout. `relative` so the version detail drawer can sit beside
          the rail and inherit this row's height, rather than pinning itself to
          the window and starting above the panels. */}
      {/* grid-template-columns is an interpolable property, so transitioning it
          here slides BOTH side panels open and shut from one declaration —
          neither panel has to know it is being animated, and the viewer in the
          middle reflows with them instead of jumping. */}
      <div className={`stiko-motion relative flex-1 grid gap-3 overflow-hidden min-h-0 transition-[grid-template-columns] duration-[280ms] ease-[cubic-bezier(.4,0,.2,1)] ${
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
                measureUnit={measureUnit}
                onMeasureUnitChange={handleMeasureUnitChange}
                scaleSource={measureScale.source}
                // annotatingFile === null is load-bearing: during an attachment session the
                // surface is a pasted screenshot with no file id, so there is nowhere to store a
                // calibration and nothing to resolve a scale against.
                canCalibrate={canComment && annotatingFile === null}
                // Same `annotatingFile === null` test as canCalibrate directly above, for the
                // same reason one step further out: an attachment session's surface is a pasted
                // screenshot with no file id, no calibration and no image space, so measuring on
                // it could only ever produce a number about some other file. Offering a tool that
                // is inert by design is worse than not offering it.
                //
                // The type half is a positive union of the three surfaces that actually measure
                // something — image (AnnotationCanvas), PDF (its own stage) and 3D (the live
                // WebGL scene) — not "not video". An exclusion list only names the types known to
                // be wrong at the time it was written, so video was covered but an unsupported
                // type like .dwg or .dxf was not: neither video nor 3D nor PDF nor image, it fell
                // through and got Measure shown anyway with no surface underneath it that could
                // ever produce a reading. A positive list cannot make that mistake — a fourth
                // file type is simply absent until someone deliberately adds it here.
                measureAvailable={(isImageFile || isPDFFile || is3DFile) && annotatingFile === null}
              />
            )}

            {/* "This distance is …" — the second half of the calibrate gesture, shown once both
                its points are down. Beside the toolbar rather than inside it: it owns the
                keyboard while it is up, and it is the only thing on screen that can report a
                failed save. */}
            {!viewportBusy && !viewportImage && activeTool === 'calibrate' && calibrationSpan !== null && (
              <CalibrationPanel
                unit={measureUnit}
                error={measureError}
                onCommit={(realDistance, entryUnit) =>
                  handleCalibrationCommit(calibrationIntrinsicDistance, realDistance, entryUnit)
                }
                onCancel={() => { setMeasureError(null); setActiveTool('pointer'); }}
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
                <PartsPanel
                  parts={parts}
                  hiddenParts={hiddenParts}
                  partColors={partColors}
                  effectiveColor={effectivePartColor}
                  canColor={canTransform}
                  revealKey={revealPart}
                  revealToken={revealToken}
                  onToggleVisibility={togglePartVisibility}
                  onSetColor={setPartColor}
                  onHoverPart={setHoveredPart}
                />
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
                activeTool={activeTool}
                color={drawingColor}
                strokeWidth={drawingStrokeWidth}
                handleRef={annotationCanvasRef}
                onObjectCreated={() => setActiveTool('pointer')}
                onSelectionChange={handleSelectionChange}
                // The third measurement surface. Every prop in this group is gated on
                // `measuresOnCanvas` — see its definition for why a canvas that DRAWS here is not
                // necessarily the canvas this file is MEASURED on.
                measurements={measuresOnCanvas ? measurements : []}
                pendingMeasurement={measuresOnCanvas ? pendingMeasurement : null}
                onMeasurePoint={measuresOnCanvas ? handleMeasurePoint : undefined}
                measureHoverPoint={measuresOnCanvas ? measureHoverPoint : null}
                onMeasureHover={measuresOnCanvas ? setMeasureHoverPoint : undefined}
                mmPerIntrinsicUnit={measuresOnCanvas ? measureScale.mmPerUnit : null}
                // Millimetres per NATURAL pixel is what measureScale.mmPerUnit holds for an
                // image file, so this is the rect that turns a stage pixel into one of those.
                imageSpace={measuresOnCanvas ? viewerImageSpace : null}
                onIntrinsicScaleChange={measuresOnCanvas ? setImageIntrinsicPerStagePixel : undefined}
                measureUnit={measureUnit}
                selectedMeasurementId={measuresOnCanvas ? selectedMeasurementId : null}
                onSelectMeasurement={measuresOnCanvas ? setSelectedMeasurementId : undefined}
                // Gated with the rest of the group, and specifically with `measurements`: this
                // canvas needs it whenever it renders one, or the eraser would select a
                // dimension instead of deleting it.
                onEraseMeasurement={measuresOnCanvas ? removeMeasure : undefined}
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
          onCommentClick={handleCommentClick}
          activeCommentId={activeCommentId}
          refreshKey={commentsRefreshKey}
          collapsed={commentsCollapsed}
          onToggleCollapse={() => setCommentsCollapsed((c) => !c)}
          onViewImage={setViewportImage}
          onCommentsChanged={() => setCommentsRefreshKey((k) => k + 1)}
          composer={
            <>
              {composerError && (
                <p className="mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600">
                  {composerError}
                </p>
              )}
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
            </>
          }
        />

        {/* Inside the grid on purpose: it is positioned against this row, so it
            lines up beside the rail and ends where the rail ends. */}
        <VersionDetailDrawer
          version={detailVersion}
          isCurrent={!!detailVersion && detailVersion.versionNumber === maxVersionNumber}
          files={files}
          filesLoading={filesLoading}
          briefGenerating={!!detailVersion && autoBriefBusy === detailVersion.id}
          confirmOpen={!!fileToDelete || !!versionToDelete}
          // The rail's width plus the grid's 12px gap, so the drawer's left
          // edge meets the rail's right edge.
          offsetLeft={(sidebarCollapsed ? 48 : 272) + 12}
          onClose={() => setDetailVersionId(null)}
          onSelectFile={setSelectedFileId}
          onSelectCitedComment={handleSelectCitedComment}
          onDeleteFile={openFileDelete}
          onDownloadFile={downloadFile}
          onDeleteVersion={openVersionDelete}
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
