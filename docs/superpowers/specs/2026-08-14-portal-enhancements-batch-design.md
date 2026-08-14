# Portal enhancements batch — design

**Date:** 2026-08-14

Four independent enhancements, bundled because each is small and none of them
touch the same code twice: a branded loading cube, markup on a pending comment
attachment, a hard reject for unsupported upload formats, and an optional
"what changed" note when publishing a version.

They share no state and can be built and reviewed in any order.

---

## 1 — Loading cube

### Why

Four loading indicators in the review view are `border-blue-600` rings. That
blue is not in the palette at all; the brand primary is `#5B60FF`. The rings are
also anonymous — nothing about them says Stiko.

The home and project screens deliberately use skeletons instead of spinners
("Skeleton — match the shape of the real content. No spinners." —
`components/ui/Primitives.tsx`). That call stands. This change replaces the
off-palette spinners that already exist; it does not introduce spinners where a
skeleton was chosen on purpose.

### Component

`components/ui/LoadingCube.tsx` — a rotating 3D cube built from six absolutely
positioned faces.

```tsx
export default function LoadingCube({ size = 44 }: { size?: number })
```

- Renders `<div className="stiko-cube" style={{ '--cube-size': `${size}px` }}>`
  wrapping six `<div>` faces.
- `role="status"` on the wrapper plus a visually hidden "Loading…" — a spinning
  box announces nothing to a screen reader on its own.

### CSS

Lives in `app/globals.css`, alongside `.stiko-pin` and the `.stiko-scrim`
family. Tailwind cannot express `transform-style: preserve-3d` plus six
per-face 3D transforms without turning into unreadable arbitrary-value soup,
and this file is already where the project keeps that kind of rule.

Three deliberate changes from the source snippet:

1. **Brand colours.** Face fill `rgba(91, 96, 255, 0.2)`, border
   `2px solid #5B60FF`.
2. **Size-independent depth.** The source hardcodes `translateZ(±22px)` for a
   44px cube. Driving both off `calc(var(--cube-size) / 2)` means a 28px cube
   still closes into a solid instead of gapping.
3. **Reduced motion.** `@media (prefers-reduced-motion: reduce)` drops the
   animation and holds the static tilted pose. A continuously tumbling 3D
   object is exactly the case that query exists for.

### Call sites

**Amended after review of the built feature.** The cube belongs to the review
viewport and nowhere else — it is that panel's signature, not a general-purpose
spinner. Two of the four originally planned call sites were withdrawn.

| File | What is loading | Size |
| --- | --- | --- |
| `app/portal/[id]/page.tsx` | first load, and the file list for a version | 44 |
| `components/viewers/ViewerContainer.tsx` | presigned URL fetch | 36 |

The first load no longer paints a bare indicator on a blank screen. The
three-panel shell renders immediately with the cube in the empty viewport,
which means the sidebar must not assert *"Submit your first version to get
started"* before it knows: it takes a `loading` prop and shows two skeleton
bars shaped like version cards instead. `DrawingTools` is gated on `!loading`
so a live toolbar never sits over the cube.

### Explicitly not replaced

- The comments panel keeps its small ring. It is a side panel, not the viewport.
- The 16px rings inside buttons (`CommentsPanel.tsx` send button, upload hint).
  A tumbling cube inside a 32px button is illegible.
- The home and project skeletons.

---

## 2 — Markup on a pending comment attachment

### Why

Attaching a screenshot to a comment and needing to circle something on it means
leaving Stiko for an image editor. The markup surface that would do this already
exists and is already mounted in the review view.

### What the user does

1. Attaches an image to the comment composer from their device.
2. Clicks its thumbnail.
3. The image fills the viewport with the full markup toolbar over it.
4. **Done** flattens the markup into the image and replaces that pending
   attachment. **Discard** leaves the original untouched.

### Why no new surface is needed

`AnnotationCanvas` already takes a `backgroundDataUrl`, letterboxes it to fit
the stage, and flattens background plus markup in `captureSnapshot()`. Today
that background is a screenshot of the viewer. Here it is the attached image.
Everything downstream — tools, colours, stroke width, select/move/scale/rotate,
eraser, Delete key — comes along unchanged.

### Changes

**`components/portal/CommentComposer.tsx`**

- New optional prop `onAnnotateFile?: (index: number) => void`.
- Image thumbnails become buttons with a hover pencil overlay and
  `title="Click to mark up"`.
- The existing ✕ remove button keeps working — it already sits above the
  thumbnail and gets `stopPropagation`.
- Non-image pending files stay inert. Nothing to mark up on a PDF chip.

**`app/portal/[id]/page.tsx`**

- New state `annotatingAttachmentIndex: number | null`.
- `handleAnnotateAttachment(index)` reads `composerFiles[index]`, converts it to
  a data URL, sets it as `viewerSnapshot`, sets `annotating`, and records the
  index. This is the same session the draw tools already start — only the
  background source differs.
- `handleAnnotationDone` branches on the index: set → **replace**
  `composerFiles[index]` with the captured result; null → append, as today.
- `endSession` clears the index, so Discard and a file switch both reset
  cleanly.
- The amber annotation banner reads *"Marking up &lt;filename&gt; — Done
  replaces the attachment"* while an attachment session is running.

### The one real edge case

When the selected package file is a PDF, `annotating` routes drawing into
`PDFKonvaViewer` rather than `AnnotationCanvas`. An attachment is not that PDF.
The render gate becomes:

```
annotating && (!isPDFFile || annotatingAttachmentIndex !== null)
```

so a local image always draws on `AnnotationCanvas`, whatever the selected file
happens to be.

### Out of scope

Already-posted attachments keep today's read-only `viewportImage` behaviour.
Editing them would mean mutating a posted comment, which no API supports.

---

## 3 — Reject unsupported upload formats

### Why

Nothing validates format anywhere — not the dropzone, not the presign route,
not the complete route. An unsupported file uploads successfully, registers as a
package file, and only fails at the very end, in the viewport, as
"Unsupported file type: .docx". The reviewer discovers it, not the uploader.

### Module

`lib/fileFormats.ts`, pure and dependency-free so it can be tested with
`node --test` like the other `lib/` modules.

```ts
export const SUPPORTED_EXTENSIONS: ReadonlySet<string>
export function isSupportedFilename(name: string): boolean
export function partitionBySupport<T>(
  files: T[],
  nameOf: (f: T) => string,
): { accepted: T[]; rejected: T[] }
```

Whitelist — the extensions `ViewerContainer` actually branches on, plus CAD:

- **Images** — png, jpg, jpeg, gif, webp, svg, bmp
- **Video** — mp4, webm, mov, avi, mkv
- **Documents** — pdf
- **3D** — glb, gltf, obj, stl, 3ds, ply, dae, step, stp
- **CAD** — dwg, dxf

**On dwg/dxf:** these have no viewer branch and no conversion path —
`createStepToGlbJob` is STEP-only. They are whitelisted anyway, by decision, so
the import pipeline work can land without a format gate to unpick first. Until
then they upload and download fine and the viewport shows the existing
unsupported-type message. The dropzone hint keeps advertising DWG.

### Wiring

The filter goes in `FileDropzone`'s `addFiles()` — the single funnel that
drag-drop, the file picker and the folder picker all already pass through.
Rejected files never enter the `files` array, so nothing downstream changes.

Both `<input type="file">` elements get an `accept` attribute so the OS picker
pre-filters. The JS filter still has to exist: drag-drop ignores `accept`
entirely.

### Reporting

An inline banner inside the dropzone, **not** a toast. A dropped folder can
reject forty files at once, and a bottom-left toast that self-destructs after
five seconds cannot carry that list. The banner:

- lists the rejected filenames with their extensions,
- persists until the next successful add,
- is dismissible.

The `hint` line gains the real supported list, so the rule is visible before a
file is picked rather than only after one is refused.

### Not validated

Comment attachments. Those are files a reviewer downloads, not files the viewer
renders — a .docx or .xlsx there is legitimate and useful.

---

## 4 — Optional "what changed"

### Why

The note is currently required in two places, each with a comment arguing it
must be. That call is being reversed: a version with a self-evident change, or
one being published under time pressure, should not be blocked on prose.

Both comments get rewritten to record the new reasoning rather than being
silently deleted.

### Changes

**`components/portal/NewVersionDrawer.tsx`**

- Delete the `if (!changelog.trim())` guard.
- `<Field label="What changed" hint="required">` → `hint="optional"`.
- Send `changelog: changelog.trim() || null`.
- Keep the helper line about where the note appears — it is now an incentive
  rather than a rule.

**`app/api/versions/publish/route.ts`**

- Drop the 400. Accept `string | null | undefined`.
- Store `NULL` rather than an empty string, so "no note" is one value in the
  database, not two.
- Pass `null` as the notification `excerpt` when there is no note.
- The file-count guard and the already-published guard are untouched. An empty
  version still cannot publish.

**`lib/email.ts`**

`newVersionEmail` currently renders `"${opts.changelog}"` unconditionally, so an
empty note would email a bare pair of quotes. The signature becomes
`changelog?: string | null` and the "What changed:" pair of lines is dropped
when absent, using the same `.filter(Boolean)` pattern the neighbouring template
in that file already uses.

### Verified: no other changes needed

Every display site already guards on null, and the column is already nullable:

- `app/page.tsx` (~L343)
- `app/project/[id]/page.tsx` (~L351)
- `components/home/PackageRow.tsx` (~L64)
- `app/invite/[token]/page.tsx` (~L227)
- `components/shell/NotificationTray.tsx` (~L178)
- `lib/schema.sql` — `changelog TEXT`, nullable

No migration. No display changes.

`app/new/page.tsx` defaults its changelog to `'First version'` and is a
different flow (creating a package, not publishing into one). It is left alone.

---

## Testing

Following the existing convention — pure logic in `lib/`, exercised by
`node --test scripts/tests/*.mjs`.

**`scripts/tests/fileFormats.test.mjs`**

- Every whitelisted extension is accepted, including dwg/dxf.
- Case-insensitive: `DRAWING.PDF` is accepted.
- A file with no extension is rejected.
- A dotfile (`.DS_Store`) is rejected.
- A double extension (`archive.tar.gz`) is judged on the last segment and
  rejected.
- `partitionBySupport` preserves input order within both output arrays and never
  drops a file from both.

**`scripts/tests/email.test.mjs`**

- `newVersionEmail` omits the "What changed" block for `null`, `undefined` and
  `''`, and emits no stray empty quotes.
- It includes the block, quoted, when a note is present.
- The subject line is unaffected either way.

The three UI-bound pieces — the cube, the thumbnail markup session, the dropzone
banner — are verified by running the app, per
`docs/superpowers/specs/` precedent for viewer work.
