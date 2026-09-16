# Measure tool — design

Date: 2026-09-16
Status: approved, not yet implemented

A measure tool in the portal toolbar: linear distance, angular measurement, a calibration
gesture for files that carry no dimensions of their own, and a units selector. It works on
3D models, PDFs and images — the three surfaces the portal already renders — with one shared
core doing the arithmetic and each surface measuring in its own coordinate space.

## Why this shape

Three facts about the existing code drove every decision below.

**Markup is ephemeral.** Picking a draw tool freezes the viewport into a JPEG and you draw on
that; the result becomes an image attached to a comment. The `markups` table is dead code with
no callers (see its own comment in `lib/schema.sql`). So a measurement is only *keepable* if it
survives into the comment snapshot. If it does not get captured, the feature is decorative.

**Point picking already exists in 3D.** `SceneInteraction` in `components/viewers/ModelViewerInner.tsx`
raycasts for comment pins, and carries two guards this feature needs anyway: a 4px drag test so
an orbit does not also drop a point, and a clipping-plane test so a surface a cross-section has
cut away is not pickable (three's raycaster ignores clip planes entirely).

**Calibration must be stored in file-intrinsic coordinates.** A snapshot is fit-scaled and
letterboxed at whatever zoom the user happened to have. A scale factor captured in snapshot
space is wrong the next time the file is opened.

Note that `lib/modelMeasurement.ts` already exists and means something unrelated — bounding-sphere
sizing for scene furniture. The new code lives in `lib/measure/` and must not be confused with it.

## Decisions

| Question | Decision |
| --- | --- |
| File types in v1 | 3D, PDF and image |
| Measurement lifetime | Ephemeral, session-only — same as markup |
| Calibration lifetime | Persisted per file (and per page) |
| 3D units | Assumed by format, Calibrate overrides |
| 3D point picking | Vertex snap within 12px, else free surface point |
| Angle gesture | Three clicks: leg, vertex, leg |
| Units | mm / cm / m / in / ft, remembered per file. Angles always degrees |
| Angular gating | Never gated — angles are scale-invariant, so calibration does not affect them |
| Who calibrates | Anyone with `canComment` may set a first calibration; only `canTransform` may change an existing one |

### Why angular is not gated

A uniform scale factor does not change an angle. On an orthographic drawing the angle is already
correct uncalibrated; on a perspective photo it stays wrong after calibrating. Gating it would
imply the calibration was doing something it is not.

## Architecture

### Rendering, per surface

Each viewer measures in its own space, and snapshot capture then works with no new capture code:

| Surface | Where measurements live | How they reach the snapshot |
| --- | --- | --- |
| 3D | In-scene WebGL: `THREE.Line` legs plus canvas-texture `THREE.Sprite` labels, anchored in model-frame coords | `captureViewerSnapshot` already reads the WebGL canvas |
| PDF | Konva layer on the live stage, in page coords | `PDFKonvaViewerHandle.captureSnapshot` already captures the stage |
| Image | Inside the existing frozen `AnnotationCanvas` session | Already the Konva canvas |

The 3D label is a sprite and **not** drei's `Html`: `captureViewerSnapshot` reads only the WebGL
canvas, so a DOM label would be missing from every snapshot a user posts. The measurement group
is deliberately *not* flagged `excludeFromSnapshot`, unlike the transform handles, so
`renderCleanFrame` keeps it.

**Measurements are their own layer on all three surfaces, not annotation objects.** They carry no
colour and no stroke width, so they do not belong in the markup style model and the stroke picker
must not start reflecting them. Two consequences worth stating plainly: each surface needs its own
click-to-select and Delete/Backspace handling for measurements, and the eraser deliberately does
not erase them — a drag-erase sweeping across the viewport should not take out a dimension the user
was about to snapshot.

Rejected alternative: measuring everything on the frozen snapshot in screen space. Roughly half
the code, but it turns 3D measurement into screenshot measurement — no depth, no orbiting, and
every model would need calibrating because a screenshot has no units.

Deferred alternative: a live SVG overlay for images too, transformed by `contentTransform` the way
`MarkupOverlay` already transforms pins, so you could zoom and pan while measuring a photo. It
costs a fourth surface and a second snapshot-capture path to keep in sync. Revisit if measuring
photos at zoom turns out to matter.

### Shared core: `lib/measure/`

Everything testable lives here. These modules are imported directly by `node --test`, so:
relative imports only (no `@/` alias), and any `lib/queries` reference must be `import type`.

- `units.ts` — the mm/cm/m/in/ft table with mm factors, `formatLength(mm, unit)` with per-unit
  precision, `formatAngle(rad)`.
- `calibration.ts` — `resolveScale(file, page)` returning `{ mmPerUnit, source }` where source is
  `'calibrated' | 'assumed' | 'unknown'`; `mmPerUnitFrom(intrinsicDistance, realDistance, unit)`;
  and `assumedMmPerUnit(filename)` holding the format table.
- `geometry.ts` — `distance(a, b)` and `angleAt(vertex, p1, p2)`, dimension-agnostic over number
  arrays so 2D and 3D share one implementation.
- `gesture.ts` — the click-counting state machine. `addPoint()` returns either a still-pending
  gesture or a finished measurement, so "three clicks makes an angle" is one tested fact rather
  than three copies.
- `imageSpace.ts` — the stage → snapshot → natural-pixel affine chain.

A `useMeasurements()` hook mirrors `useAnnotationObjects`: committed measurements, pending gesture,
selection. Surface-agnostic — each surface feeds it points in its own intrinsic space.

### Assumed units by format

Derived client-side from the filename extension; nothing is stored. The presence of a calibration
row means calibrated, its absence means assumed or unknown.

The extension read is the **original upload's** (`file.filename`), never the loaded GLB's. A STEP
upload is viewed as a converted GLB, but `stepToGlb` emits OCCT's millimetres — so a `.step` file
is 1 mm per world unit even though what the viewer actually loaded is a `.glb`. Keying off the
loaded file would apply the glTF metre convention and read every STEP model 1000x too large.

| Extension | mm per world unit | Why |
| --- | --- | --- |
| `.step`, `.stp` | 1 | OCCT emits millimetres, which the rest of the pipeline already assumes (`lib/model/stepWireframe.ts`) |
| `.glb`, `.gltf` | 1000 | The glTF spec specifies metres |
| `.obj`, `.stl`, `.ply`, `.3ds`, `.dae` | unknown | No unit convention exists; Linear is blocked until calibrated |

## UI

A `Measure` button in the main markup bar, after Shapes and before Stroke width — keeping the
bar's left half "things you draw" and its right half "how they look". Its sub-bar uses the same
`SUB_BAR` mechanics as Shapes, inheriting click-outside dismissal, `hideLabel` muting of the main
row, and the one-sub-bar-at-a-time rule.

```
┌─────────────────────────────────┐
│  ↔    ∠    ⇹✎   [ mm ▾ ]        │
│ Linear Angle Calibrate  Units   │
└─────────────────────────────────┘
```

Linear and Angle are armable modes that toggle off when re-clicked, exactly like shapes. Calibrate
is a self-terminating mode: one gesture, an input panel, then back to Pointer. Units is not a
`ToolButton` — it is a chip showing the current unit that opens a short list panel anchored
right-edge-to-trigger, like the colour picker, so it cannot clip in a narrow viewer pane.

### Gestures

- **Linear** — click, click. A live rubber-band segment with a running value follows the cursor.
- **Angular** — click, click, click (leg, vertex, leg). An arc previews at the vertex after the
  second click.
- **Calibrate** — click, click, then type the real distance with its own unit selector:
  "This distance is `[ 2400 ] [ mm ▾ ]`". Confirming writes the calibration and re-enables Linear
  if it was blocked.
- **Escape** cancels a pending gesture. Clicking a finished measurement selects it;
  Delete/Backspace removes it.

### Tool state

Three ids join `ToolType`: `'measure'`, `'angle'`, `'calibrate'`.

They must **not** be added to `DRAW_TOOLS`. That array is what triggers `startAnnotationSession()`,
which freezes the viewport — freezing a 3D model the moment Measure is armed would defeat the
feature. Instead, arming a measure tool calls `startAnnotationSession()` only when the file is not
3D. `startAnnotationSession` already does the right thing on both sides of that: it freezes
non-PDFs and merely sets `annotating` for PDFs, which is exactly what the PDF surface wants (it
disables stage panning so gestures are not read as pans).

The measure tools do join the existing mutual-exclusion rules: arming Measure disarms tagging, the
transform gizmo and any selected cross-section plane.

### Disabled states

- Uncalibrated file that needs calibration → Linear disabled, hover label "Calibrate this file
  first". Opening Measure on such a file highlights Calibrate.
- Angular is never gated. Units is never gated.

## Data model

One canonical quantity: **`mm_per_unit`**, how many real millimetres one *intrinsic* unit of the
file represents. Millimetres because that is already what the STEP pipeline assumes, and because
no unit in the dropdown needs a fractional base.

"Intrinsic unit" differs per surface, and each definition is a trap if got wrong:

| Surface | Intrinsic unit | The trap |
| --- | --- | --- |
| Image | one **natural** pixel of the source image | Not displayed px, not snapshot px — those change with zoom and viewport |
| PDF | one **PDF point** (1/72") | The viewer renders at `scale: 2`, so `pageSize` is 2× points. Divide by the render scale before storing, or every PDF calibration is off by exactly 2× |
| 3D | one world unit of the **loaded GLB** | That is `convertedStorageKey`, not the original upload |

### Schema

```sql
CREATE TABLE IF NOT EXISTS file_calibrations (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  page_number INT NOT NULL DEFAULT 0,       -- 0 = not a paged file
  mm_per_unit DOUBLE PRECISION NOT NULL CHECK (mm_per_unit > 0),
  set_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (file_id, page_number)
);

CREATE INDEX IF NOT EXISTS file_calibrations_file_id_idx ON file_calibrations(file_id);

ALTER TABLE files ADD COLUMN IF NOT EXISTS measure_unit TEXT DEFAULT NULL;
```

Two deliberate choices. **Per page**, because a multi-sheet PDF genuinely has different scales per
sheet — a 1:50 plan and a 1:20 detail in one document. And **`page_number NOT NULL DEFAULT 0`**
rather than nullable: Postgres treats NULLs as distinct inside a UNIQUE constraint, so a nullable
column would silently permit duplicate calibration rows for the same image, and whichever row the
read ordered first would win.

Display unit is file-scoped and single-valued, so it is a nullable column on `files` rather than a
third table.

The migration goes in `lib/migrations/` with the next free number, and is mirrored into
`lib/schema.sql` — both, as every prior migration in this repo does.

### API

One route, `PATCH /api/files/[id]/measure`, a sibling to `part-colors`, taking
`{ calibration?, unit? }` so there is one gate in one place:

- `unit` → requires `canComment`
- `calibration` where none exists for that page → requires `canComment` (a reviewer can unblock
  themselves)
- `calibration` where one already exists → requires `canTransform` (only owner/collaborator
  overwrites numbers everyone else reads)

Reads fold into `GET /api/files` as `file.calibrations` and `file.measureUnit`, exactly like
`partColors`: one query per version, and critically the **same fail-soft `try/catch`**. That
endpoint is load-bearing for file listing app-wide, migrations here are applied by hand, and this
repo has forgotten one twice. An unrun migration must degrade to "measure tool unavailable", never
to a file-listing outage.

### Cross-cutting obligation

A 3D calibration is anchored to the loaded GLB's scale. If a file's `converted_storage_key` is ever
reassigned — a STEP whose client-side tessellation failed, later replaced by a CloudConvert result
with an unrelated scale — the calibration becomes silently wrong. `part_colors` has exactly this
hazard and handles it by deleting its rows alongside the reassignment in
`app/api/conversions/webhook/route.ts`. `file_calibrations` must be deleted in the same place, for
the same reason, tolerating its own failure the same way.

## Coordinate chains

### 3D

Points are stored in **model-frame** coordinates, like comment pins, so a measurement travels with
a moved or rotated object instead of floating where it was placed.

Vertex snap comes from the raycast hit's own `face` plus the hit object's position attribute:
nearest of the three triangle vertices, accepted within 12px on screen. No precomputed structures,
which matters because the model is drawn as merged `BatchedMesh` batches.

**Spike this first.** three's `BatchedMesh` raycast returns a `batchId`, and face/vertex data being
reachable per-hit needs confirming before the design depends on it. If it is not reachable, the
fallback is free surface points in v1 with snapping deferred — not a larger detour into deriving
geometry.

### Image

```
stage px  ──bgFit──▶  snapshot px  ──img rect at freeze──▶  natural px
```

`bgFit` in `AnnotationCanvas` is already computed and already used for this class of reasoning by
the native-resolution capture path. The second step requires `captureViewerSnapshot` to report the
fitted `<img>` rect and natural size alongside the data URL — a small return-shape change.

Both steps live in `imageSpace.ts` under test, because this is exactly the arithmetic that fails
silently: a wrong factor here produces plausible numbers that are simply wrong.

## Build order

1. `lib/measure/` and its tests — units, geometry, gesture, calibration. Nothing visible depends on
   this step, which is what makes it the safest place to settle the arithmetic.
2. The `BatchedMesh` vertex-snap spike. It is the one unknown that can change the 3D design, so it
   resolves before anything is built on top of it.
3. Migration, `PATCH /api/files/[id]/measure`, and the `GET /api/files` fold-in — including the
   `converted_storage_key` deletion in the conversions webhook.
4. Toolbar: the Measure button, its sub-bar, the units chip, the disabled states.
5. 3D surface: picking, in-scene rendering, snapshot verification.
6. PDF surface.
7. Image surface, including the `captureViewerSnapshot` return-shape change.

Steps 5 to 7 are independent of one another once 1 to 4 have landed.

## Edge cases

- Zero-length linear and collinear or zero-leg angles are discarded on commit, matching the `> 3px`
  validity tests in `endDraw`.
- Calibrate rejects non-numeric, zero and negative input in the panel; the `CHECK` constraint backs
  that up against a malformed direct request.
- Escape cancels a pending gesture. Switching PDF pages mid-gesture cancels it — the second click
  would otherwise land on a different sheet.
- Switching files clears all measurements, alongside the existing snapshot/annotating reset.
- **Video and unsupported types** — Measure is hidden. A moving frame has no stable intrinsic space.
- **Viewer role** (`canComment: false`) — may measure a calibrated file, may not calibrate;
  Calibrate renders disabled.
- **Attachment annotation session** — marking up a pasted screenshot, which has no file id, so
  there is nowhere to store a calibration and no scale to resolve. Linear is disabled there;
  Angular still works. Easy to miss, since that session otherwise looks exactly like an image one.
- **Migration not yet run** — reads fail soft to "no calibrations" so file listing survives, and
  the tool reports "Measurement isn't available yet" rather than accepting a calibration that
  silently vanishes.
- **Cross-sectioned model** — measurement line and label materials receive the active clipping
  planes, so a measurement clips with the model instead of hanging in cut-away space.

## Testing

New `scripts/tests/measure*.test.mjs`, following the existing convention: `node --test`, importing
`../../lib/measure/*.ts` by relative path.

- `units` — formatting and precision per unit, round-tripping through mm.
- `calibration` — `mmPerUnitFrom` arithmetic, the format assumption table, and `resolveScale`'s
  three-way `calibrated`/`assumed`/`unknown` result.
- `geometry` — distance and angle in 2D and 3D, including the degenerate cases above.
- `gesture` — 2 clicks commits a linear, 3 commits an angle, cancel at any point leaves nothing.
- `imageSpace` — the stage → snapshot → natural-pixel chain, with a letterboxed `bgFit` and a
  non-1 device pixel ratio.

### Browser verification (required, not optional)

A 3D measurement that renders correctly but vanishes from the snapshot passes every unit test
above. So, in a real browser:

1. Place a measurement in 3D, orbit, confirm it stays anchored to the geometry.
2. Start a draw session and confirm the measurement is present in the captured JPEG.
3. Calibrate a PDF and confirm the reading matches a known dimension on the sheet.
4. Calibrate an image, reload the file, confirm the calibration survived and still reads correctly
   at a different zoom.

## Rollback

Production is the only environment. The migration is additive — one new table, one nullable column
— so rolling back the app code leaves both harmlessly unused. There is no destructive step and
nothing to un-migrate under pressure.
