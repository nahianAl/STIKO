'use client';

import { useEffect, useMemo, useRef, useState, useImperativeHandle, type Ref } from 'react';
import { Stage, Layer, Rect, Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import { useAnnotationObjects, isMeasureTool, type AnnTool, type MarkupSelection, type ToolType } from './useAnnotationObjects';
import AnnotationObjects from './AnnotationObjects';
import MeasureObjects from './MeasureObjects';
import type { Measurement } from './useMeasurements';
import type { PendingGesture } from '@/lib/measure/gesture';
import { DEFAULT_LENGTH_UNIT, type LengthUnit } from '@/lib/measure/units';
import { naturalPerStagePixel, type ImageSnapshotSpace } from '@/lib/measure/space';
import { UNPAGED } from '@/lib/measure/calibration';
import CanvasTextEditor from './CanvasTextEditor';
import { fontSizeForStrokeWidth, wrapWidthForContent, isBlank } from '@/lib/markup/text';
import { ERASER_CURSOR } from '@/lib/cursors';
import { CANVAS_MATTE } from '@/lib/markup/matte';
import { sweepPoints } from '@/lib/markup/eraseSweep';

export interface AnnotationCanvasHandle {
  /**
   * With no argument (or `{ native: false }`), captures the whole stage at a
   * fixed pixelRatio — correct for the ordinary viewer-snapshot session, whose
   * background already fills the stage.
   *
   * With `{ native: true }` and a background image present, crops the capture
   * to the fitted background region and restores the image's own resolution —
   * used when Done is about to replace a picked attachment, so the result
   * isn't letterboxed and resampled to the stage's aspect ratio.
   */
  captureSnapshot: (opts?: { native?: boolean }) => string | null;
  clear: () => void;
  hasObjects: () => boolean;
  insertImage: (file: File) => void;
  /** Restyle whatever is selected. A no-op with nothing selected. */
  applyStyleToSelection: (patch: { color?: string; strokeWidth?: number }) => void;
}

interface AnnotationCanvasProps {
  backgroundDataUrl: string | null;
  activeTool: ToolType;
  color: string;
  strokeWidth: number;
  handleRef?: Ref<AnnotationCanvasHandle>;
  onObjectCreated?: () => void;
  onSelectionChange?: (selection: MarkupSelection | null) => void;
  // Measurement props. The session store lives in the portal page, not here, because one measure
  // session spans every surface; this canvas only collects points in its own stage space and
  // draws what it is given, exactly like PDFKonvaViewer.
  //
  // Deliberately NOT part of the markup object model: a measurement has no colour and no stroke
  // width, so none of this ever reaches `onSelectionChange`, `applyStyleToSelection` or the
  // eraser.
  //
  // All optional, and the portal withholds them whenever this canvas is NOT the surface the
  // selected file is measured on — over a frozen 3D viewport, or over a picked attachment. See
  // the call site: handing them over there would collect points in one space and scale them by
  // another file's mm-per-unit, which is the silent-wrong-number failure this feature exists to
  // avoid.
  measurements?: Measurement[];
  pendingMeasurement?: PendingGesture | null;
  /**
   * A measure click, in STAGE pixels with a 3-pixel minimum separation. Same signature as the
   * other two surfaces', so the store never learns which one called it.
   */
  onMeasurePoint?: (point: number[], minSeparation: number) => void;
  /**
   * The cursor, in STAGE pixels, while a gesture is pending — drawn as a provisional last point
   * so the leg and its running value follow the pointer between clicks.
   */
  measureHoverPoint?: number[] | null;
  /**
   * Reports the cursor in STAGE pixels on every mouse move while a gesture is pending, and null
   * when there is none. The same `stage.getPointerPosition()` the measure CLICK uses, so the
   * previewed point and the committed one can never land in different places.
   */
  onMeasureHover?: (point: number[] | null) => void;
  /** Millimetres per NATURAL image pixel, or null while the file is uncalibrated. */
  mmPerIntrinsicUnit?: number | null;
  /**
   * Where captureViewerSnapshot drew the source <img> inside the frozen snapshot, and how big
   * that image really is. The second half of the stage-to-natural chain — see
   * `intrinsicPerStagePixel` below. Null for a snapshot that is not an image (a WebGL or video
   * frame, or a pasted attachment), which is what suppresses every length reading.
   */
  imageSpace?: ImageSnapshotSpace | null;
  /**
   * Reports the resolved natural-pixels-per-stage-pixel factor, or null when it cannot be
   * resolved. PUSHED rather than exposed on the handle for a timing reason: `bgFit` needs the
   * snapshot to have DECODED, which happens in an async onload one or more commits after the
   * portal rendered this element. A `useMemo` up there reading it back off the ref would run
   * before that, read null, and — its dependencies never changing again — keep the stage-pixel
   * default for the whole session. A calibration committed against that default is stored in
   * stage pixels, reads plausibly at the zoom it was taken at, and is wrong at every other one.
   */
  onIntrinsicScaleChange?: (naturalPerStagePx: number | null) => void;
  measureUnit?: LengthUnit;
  selectedMeasurementId?: string | null;
  onSelectMeasurement?: (id: string | null) => void;
}

export default function AnnotationCanvas({
  backgroundDataUrl, activeTool, color, strokeWidth, handleRef, onObjectCreated, onSelectionChange,
  measurements = [], pendingMeasurement = null, onMeasurePoint, measureHoverPoint = null,
  onMeasureHover, mmPerIntrinsicUnit = null,
  imageSpace = null, onIntrinsicScaleChange, measureUnit = DEFAULT_LENGTH_UNIT,
  selectedMeasurementId = null, onSelectMeasurement,
}: AnnotationCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  // The measurement layer, so a pointer press can ask whether it landed on a dimension. Identity
  // rather than a name selector: `node.getLayer()` walks to the owning Layer (Stage.getLayer()
  // returns null, Layer.getLayer() returns itself), so one `!==` covers the stage, the background,
  // the markup layer and anything added later, with no string to keep in sync.
  const measureLayerRef = useRef<Konva.Layer>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  // The text object currently open for editing. The object itself already exists in `ann` —
  // this is only which one the editor is bound to.
  const [editingId, setEditingId] = useState<string | null>(null);

  const ann = useAnnotationObjects();

  // Eraser drag state. Refs, not state: this changes on every pointer move and nothing
  // renders from it.
  const erasingRef = useRef(false);
  const lastErasePointRef = useRef<{ x: number; y: number } | null>(null);

  /** Delete whatever object is under `p`, given in CONTAINER coordinates. */
  const eraseAt = (stage: Konva.Stage, p: { x: number; y: number }) => {
    const id = stage.getIntersection(p)?.id();
    // Konva returns the Transformer's own handles and any unnamed node too; only our objects
    // carry an id.
    if (id) ann.deleteObject(id);
  };

  const stopErasing = () => {
    erasingRef.current = false;
    lastErasePointRef.current = null;
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!backgroundDataUrl) { setBgImage(null); return; }
    const img = new window.Image();
    img.onload = () => setBgImage(img);
    img.src = backgroundDataUrl;
  }, [backgroundDataUrl]);

  // Selection-vs-tool contract: clear the selection when the active tool changes to a
  // non-pointer tool, so Transformer handles don't linger over a previously selected object
  // while a draw/eraser tool is active.
  useEffect(() => {
    if (activeTool !== 'pointer') ann.setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, ann.setSelectedId]);

  // Delete/Backspace removes the selected object (unless typing in the text editor).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (ann.selectedId) { e.preventDefault(); ann.deleteObject(ann.selectedId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ann.selectedId, ann.deleteObject]);

  // Depend on the FIELDS, never on `sel` itself: `selectedObject` is derived with `find`, so it
  // is a fresh object every render. Depending on its identity would fire this effect on every
  // render, push state up to the portal page, and re-render forever.
  //
  // The same loop exists from the other end: `onSelectionChange` is in this dependency array,
  // so the caller MUST pass a `useCallback`-stable reference. An inline arrow function there
  // re-subscribes this effect on every render and reintroduces exactly the same cycle.
  const sel = ann.selectedObject;
  const selType = sel?.type ?? null;
  const selColor = sel?.color ?? null;
  const selStroke = sel?.strokeWidth ?? null;
  useEffect(() => {
    onSelectionChange?.(
      selType !== null && selColor !== null && selStroke !== null
        ? { type: selType, color: selColor, strokeWidth: selStroke }
        : null
    );
  }, [selType, selColor, selStroke, onSelectionChange]);

  // Fit the background image within the stage, centered (letterbox), so the drawn snapshot
  // matches what was on screen. Computed once here (rather than separately in the render body
  // and in captureSnapshot below) so the two can't drift apart.
  //
  // A memo rather than the bare IIFE it used to be, because `intrinsicPerStagePixel` below now
  // derives from it: recomputing an equal-but-new object every render would re-run that memo and
  // re-fire the report effect on every single render of this component.
  const bgFit = useMemo(() => {
    if (!bgImage || !size.width || !size.height) return null;
    const scale = Math.min(size.width / bgImage.width, size.height / bgImage.height);
    const w = bgImage.width * scale;
    const h = bgImage.height * scale;
    return { x: (size.width - w) / 2, y: (size.height - h) / 2, width: w, height: h };
  }, [bgImage, size.width, size.height]);

  /**
   * How many NATURAL pixels of the source image one stage pixel spans.
   *
   * Two uniform, aspect-preserving scales compound, and `naturalPerStagePixel` is the tested
   * arithmetic for both — never reimplemented here:
   *
   *   stage px  --bgFit-->  snapshot px  --imageSpace.imageRect-->  natural px
   *
   * The first factor is this canvas's own contain-fit of the snapshot into the stage, so it
   * tracks a window resized AFTER the freeze. The second is where the viewer had drawn the
   * <img> at the instant it was frozen, which bakes in whatever zoom the user happened to be
   * at. Their product is what makes a calibration storable in natural pixels, i.e. in something
   * that is still true the next time the file is opened at some other zoom.
   *
   * Null, not 1, when the chain cannot be resolved. A silent 1 would store a stage-pixel
   * calibration and produce plausible, wrong numbers forever after; null shows no number at all,
   * which is the same rule MeasureObjects applies to an uncalibrated file.
   */
  const intrinsicPerStagePixel = useMemo(() => {
    if (!bgImage || !bgFit || !imageSpace) return null;
    try {
      return naturalPerStagePixel(bgFit, bgImage.width, imageSpace);
    } catch (e) {
      // naturalPerStagePixel validates every operand and throws rather than returning a
      // sentinel. A zero-width fit or a zero-width image rect is a broken capture, not a
      // measurement — swallow it into "no scale" and keep the surface usable for markup.
      console.error('Could not resolve the image measurement scale:', e);
      return null;
    }
  }, [bgImage, bgFit, imageSpace]);

  // Held in a ref and depended on by the FACTOR alone, matching PDFKonvaViewer's onReady and
  // onPageChange: a caller passing an inline arrow must not be able to make this fire on every
  // one of its own re-renders. The unmount half is not tidiness — this canvas is what knows the
  // factor, so when it goes away (session ended, file switched) the portal must stop believing
  // the last one it was told, or a calibrate commit on the NEXT file would be scaled by the
  // previous image's pixel density.
  const reportScale = useRef(onIntrinsicScaleChange);
  reportScale.current = onIntrinsicScaleChange;
  useEffect(() => { reportScale.current?.(intrinsicPerStagePixel); }, [intrinsicPerStagePixel]);
  useEffect(() => () => reportScale.current?.(null), []);

  useImperativeHandle(handleRef, () => ({
    captureSnapshot: (opts) => {
      const stage = stageRef.current;
      if (!stage) return null;
      // A capture while the editor is open would otherwise lose that object: its Konva node is
      // hidden (`visible={editingId !== obj.id}`) so the textarea can stand in for it, and
      // `setEditingId(null)` is a React state update that will not have been applied by the
      // time toDataURL runs on the next line. Un-hide the node directly instead.
      if (editingId) (stage.findOne(`#${editingId}`) as Konva.Node | undefined)?.visible(true);
      setEditingId(null);
      stage.find('Transformer').forEach((t) => (t as Konva.Transformer).nodes([]));
      stage.draw();
      let url: string;
      if (opts?.native && bgImage && bgFit && bgFit.width > 0 && bgFit.height > 0) {
        // Crop to the fitted background box and pick a pixelRatio that maps its width
        // back to the source image's natural width, so the capture comes out at the
        // attachment's own resolution instead of the whole (letterboxed) stage.
        const pixelRatio = bgImage.width / bgFit.width;
        url = stage.toDataURL({
          x: bgFit.x,
          y: bgFit.y,
          width: bgFit.width,
          height: bgFit.height,
          pixelRatio,
          mimeType: 'image/jpeg',
          quality: 0.88,
        });
      } else {
        url = stage.toDataURL({ pixelRatio: 2, mimeType: 'image/jpeg', quality: 0.88 });
      }
      ann.setSelectedId(null);
      return url;
    },
    clear: () => { setEditingId(null); ann.clear(); },
    hasObjects: () => ann.hasObjects(),
    insertImage: (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const src = reader.result as string;
        const im = new window.Image();
        im.onload = () => {
          const maxW = size.width * 0.5;
          const maxH = size.height * 0.5;
          const scale = Math.min(maxW / im.width, maxH / im.height, 1);
          const w = im.width * scale;
          const h = im.height * scale;
          ann.addImage({ x: (size.width - w) / 2, y: (size.height - h) / 2 }, src, w, h);
        };
        im.src = src;
      };
      reader.readAsDataURL(file);
    },
    applyStyleToSelection: (patch) => {
      if (ann.selectedId) ann.applyStyle(ann.selectedId, patch);
    },
  }));

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const p = stage.getPointerPosition();
    if (!p) return;

    // Deselecting a measurement. This is the ONLY place on this surface that can: MeasureObjects
    // never calls onSelect with null, and the portal's remaining clears fire when a measurement
    // is removed. A highlight with no way out turns the next Delete into a surprise — two window
    // keydown listeners answer that key, this component's (deletes the selected markup object)
    // and the portal's (deletes the selected measurement) — so one keypress removes two objects,
    // one of them unintentionally. It also rides into every snapshot from then on.
    //
    // The test is "this press did not land on the measure layer", not "it landed on the stage"
    // like the markup clear below: a press on a rectangle is neither, and the stage test would
    // select the markup while leaving the dimension selected behind it. Presses that DO land on
    // a measurement are left alone, and MeasureObjects' own onClick selects it on the mouseup.
    if (activeTool === 'pointer' && e.target.getLayer() !== measureLayerRef.current) {
      onSelectMeasurement?.(null);
    }

    // A measure click. Ahead of every drawing branch because a measure tool is none of them, and
    // because the fall-through at the bottom of this handler would otherwise reach `ann.startDraw`
    // with a tool that is not an AnnTool at all. On mousedown, like every drawing tool here: this
    // stage never pans or zooms, so a press on it can only ever be a click.
    if (isMeasureTool(activeTool)) {
      // 3 stage pixels, the same floor `endDraw` applies to a drawn object, and the same number
      // the PDF surface passes. Stage space IS screen space here — the stage is untransformed.
      onMeasurePoint?.([p.x, p.y], 3);
      return;
    }

    if (activeTool === 'text') {
      const wrapWidth = wrapWidthForContent(bgFit ? bgFit.width : size.width);
      // Keep the whole box on the surface. Clamp against the fitted background when there is
      // one — a native-resolution capture crops to exactly that region, so a box outside it
      // would be cropped away entirely.
      const bounds = bgFit ?? { x: 0, y: 0, width: size.width, height: size.height };
      const x = Math.max(bounds.x, Math.min(p.x, bounds.x + bounds.width - wrapWidth));
      const id = ann.addText({ x, y: p.y }, {
        text: '',
        color,
        fontSize: fontSizeForStrokeWidth(strokeWidth),
        // The fitted background region, not the stage: the wrap width must not depend on how
        // much matte happens to surround the snapshot.
        width: wrapWidth,
      });
      setEditingId(id);
      // Return to the pointer immediately. Otherwise the click that commits this box would also
      // start another one, since the text tool would still be armed.
      onObjectCreated?.();
      return;
    }
    if (activeTool === 'pointer') {
      // Empty matte clears the markup selection, as it always has — and so does a press that
      // lands on a dimension, which is the other half of the clear above. One Delete keypress
      // answers to BOTH selections (this component's listener deletes the markup object, the
      // portal's deletes the measurement), so the only safe invariant is that at most one of
      // them is live at a time. Without this clause the two orders differ: rectangle-then-
      // dimension would leave both selected and delete two objects on one key.
      if (e.target === stage || e.target.getLayer() === measureLayerRef.current) ann.setSelectedId(null);
      return;
    }
    if (activeTool === 'eraser') {
      erasingRef.current = true;
      lastErasePointRef.current = p;
      eraseAt(stage, p);
      return;
    }
    ann.startDraw(activeTool as AnnTool, p, color, strokeWidth);
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    const p = stage?.getPointerPosition();
    if (!stage || !p) return;
    // A measure gesture is click-by-click: there is nothing to DRAG, and the fall-through below
    // would hand `ann.moveDraw` a tool that is not an AnnTool. What a move does mean here is the
    // live preview — the cursor as a provisional last point.
    if (isMeasureTool(activeTool)) {
      // Only once a gesture has a click in it. `beginGesture` starts one with an EMPTY points
      // array as soon as the tool is armed, so `pendingMeasurement` is non-null for the whole
      // armed session: gating on null alone would push a state update — and so re-render this
      // stage — on every idle mouse move, to preview a line with no first point to draw from.
      if (!pendingMeasurement || pendingMeasurement.points.length === 0) {
        onMeasureHover?.(null);
        return;
      }
      // `p` is the SAME stage.getPointerPosition() the measure click in handleMouseDown reads,
      // in the same untransformed stage space. A second conversion here is how the previewed
      // point and the committed one would end up in different places.
      onMeasureHover?.([p.x, p.y]);
      return;
    }
    if (activeTool === 'eraser') {
      // A mouseup this stage never received — focus lost mid-press (Cmd-Tab, Mission
      // Control, an OS dialog) and the button released elsewhere — leaves erasingRef armed
      // forever, since onMouseUp/onMouseLeave are the only other places that clear it.
      // buttons === 0 means the press has already ended, so disarm before it turns ordinary
      // mouse movement into silent deletion.
      if (e.evt.buttons === 0) { stopErasing(); return; }
      if (!erasingRef.current) return;
      // Interpolated, because pointer events arrive once a frame and a quick flick would
      // otherwise jump clean over an object.
      for (const pt of sweepPoints(lastErasePointRef.current, p)) eraseAt(stage, pt);
      lastErasePointRef.current = p;
      return;
    }
    // Read Shift off the event rather than tracking it: the constraint applies from the next
    // pointer move, which is what every other design tool does.
    ann.moveDraw(activeTool as AnnTool, p, e.evt.shiftKey);
  };

  const editingObj = editingId ? ann.objects.find((o) => o.id === editingId) ?? null : null;

  /** Blank in, nothing out — an empty box is a mis-click, not an object. */
  const commitText = () => {
    if (editingObj && isBlank(editingObj.text)) {
      ann.deleteObject(editingObj.id);
    }
    setEditingId(null);
  };

  const cursor = activeTool === 'pointer' ? 'default' : activeTool === 'eraser' ? ERASER_CURSOR : 'crosshair';

  // What is captured must be what was on screen, so the container matches the in-stage matte
  // rather than contrasting with it. With no snapshot, stay transparent and let the live
  // viewer (which the portal keeps visible in that case) show through.
  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ cursor, background: backgroundDataUrl ? CANVAS_MATTE : 'transparent' }}
    >
      {size.width > 0 && size.height > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={() => { stopErasing(); if (ann.endDraw()) onObjectCreated?.(); }}
          onMouseLeave={() => { stopErasing(); if (ann.endDraw()) onObjectCreated?.(); onMeasureHover?.(null); }}
        >
          <Layer listening={false}>
            {/* Inside the stage, not on the container: toDataURL reads the stage, and JPEG has no
                alpha, so any pixel this rect does not cover is encoded black. */}
            {backgroundDataUrl && <Rect x={0} y={0} width={size.width} height={size.height} fill={CANVAS_MATTE} />}
            {bgImage && bgFit && <KonvaImage image={bgImage} x={bgFit.x} y={bgFit.y} width={bgFit.width} height={bgFit.height} />}
          </Layer>
          <Layer>
            <AnnotationObjects
              objects={ann.objects}
              draft={ann.draft}
              selectedId={ann.selectedId}
              activeTool={activeTool as AnnTool}
              onSelect={ann.setSelectedId}
              onErase={ann.deleteObject}
              onChange={ann.updateObject}
              editingId={editingId}
              onEditText={setEditingId}
              onBakeText={ann.bakeTextTransform}
            />
          </Layer>

          {/* Measurements. Their own layer, above the markup, never through AnnotationObjects: a
              measurement has no colour and no stroke width, so it must not reach the style model
              and must not be selectable as markup.

              On the STAGE, which is what puts it into captureSnapshot's flatten — in BOTH of its
              modes, since a layer is a layer to toDataURL. The whole-stage mode takes everything;
              the `{ native: true }` mode crops to the fitted background box, so a dimension drawn
              over the image is kept and one drawn out on the matte is cropped away, exactly as a
              markup object there would be. Measurements are session-only, so snapshotting one
              into a comment is the only way to keep it.

              `listening` is the pointer tool and nothing else, because the pointer tool is the
              only state in which selecting a measurement is the gesture the user means. Every
              other tool owns the click for its own purpose and would fire twice: with a measure
              tool armed, handleMouseDown drops a gesture point on the very same press, so a click
              landing on an existing dimension would both place a point AND select that dimension.
              With the eraser it cuts both ways: this layer contributes nothing to the hit graph,
              so a drag-erase sweeping the surface can neither delete a dimension nor be shielded
              by one from the markup underneath it. (eraseAt feeds the hit node's id to
              ann.deleteObject, which filters `ann.objects` — a `measure-` id is not in that list,
              so the eraser could not delete one anyway; but the shielding half is real, and a
              non-listening layer settles both. Verified against THIS component's eraseAt, not
              assumed from the PDF's.)

              Not listening is NOT not drawn, and not excluded from a snapshot: Konva's
              Stage._toKonvaCanvas skips invisible layers only, never non-listening ones. */}
          <Layer ref={measureLayerRef} listening={activeTool === 'pointer'}>
            <MeasureObjects
              measurements={measurements}
              pending={pendingMeasurement}
              hoverPoint={measureHoverPoint}
              // The markup colour this canvas already draws in, which is the same value the
              // portal stamps on the commit — so the preview does not change ink the instant it
              // becomes a measurement.
              previewColor={color}
              // No resolvable stage-to-natural chain, no length reading — even on a calibrated
              // file. The scale would have to be invented, and an invented one is exactly the
              // plausible-but-wrong number this tool cannot afford. Angles are scale-free and
              // keep rendering either way.
              mmPerIntrinsicUnit={intrinsicPerStagePixel === null ? null : mmPerIntrinsicUnit}
              intrinsicPerStagePixel={intrinsicPerStagePixel ?? 1}
              unit={measureUnit}
              selectedId={selectedMeasurementId}
              onSelect={(id) => onSelectMeasurement?.(id)}
              // This surface has no pages; the portal begins every non-PDF gesture on UNPAGED.
              page={UNPAGED}
              haloColor={CANVAS_MATTE}
              // 1, and explicitly so rather than by omission: this Stage carries no scaleX/scaleY
              // and no offset (see the text editor's `scale={1}` below, which relies on the same
              // fact), so a stage pixel IS a screen pixel and labels are already the size they
              // should be read at. The PDF surface passes its zoom here because its stage really
              // does scale; this one would be wrong to pass anything else.
              screenScale={1}
            />
          </Layer>
        </Stage>
      )}

      {editingObj && (
        <CanvasTextEditor
          // Keyed by the object so a different text block gets a FRESH editor. The mount
          // effect that focuses and puts the caret at the end runs once per mount.
          //
          // The path this guards is CREATE, not re-edit: clicking to start a new box while an
          // editor is already open fires the document pointerdown that commits the old one and
          // the Konva mousedown that creates the new one in the same task, so React 18 batches
          // them and `editingId` can go straight from one id to another with no null render in
          // between. (A real double-click re-edit already passes through null, a full event
          // earlier.) Without the key the instance would be reused and open unfocused.
          key={editingObj.id}
          // The stage is untransformed here, so object space is screen space.
          x={editingObj.x}
          y={editingObj.y}
          scale={1}
          color={editingObj.color}
          fontSize={editingObj.fontSize}
          wrapWidth={editingObj.width}
          value={editingObj.text}
          onChange={(t) => ann.updateText(editingObj.id, t)}
          onCommit={commitText}
        />
      )}
    </div>
  );
}
