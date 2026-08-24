# 3D Object Transform Gizmos — Design

**Date:** 2026-08-13
**Status:** Approved (design), pending implementation plan
**Scope:** Move and rotate a 3D object in the portal viewport with a drag gizmo, persisted per file, restricted to owner / coordinator / uploader. Comment pins move with the object.

---

## Why

An uploaded model arrives in whatever orientation and position its authoring tool exported. A chair may be lying on its side, a part may be rotated 90° from how it will be reviewed. Today the only remedy is to re-export and re-upload. The people who own or supply the file should be able to seat it correctly in the scene, once, for everyone.

---

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Operations | **Move and rotate only.** No scale — it silently changes the apparent dimensions of a design people are approving. |
| 2 | Who can transform | **owner, coordinator, uploader.** Not commenter, not viewer. Coordinator is included because it already has `canUpload`: someone trusted to replace a file outright should be able to nudge it. |
| 3 | Saving | **Auto-save on drag release.** No explicit Save/Reset, no unsaved state to lose. |
| 4 | Comment pins | **Pins follow the object.** A pin on a chair leg stays on the chair leg. |
| 5 | Persistence | Six float columns on `files`; one transform per file, visible to everyone. |
| 6 | The scene | Ground, axes and camera framing derive from the model's **untransformed** frame. Moving the object moves it *within* a fixed scene. |

---

## Architecture

### Permissions

`lib/access.ts` already returns a capability object from `getPackageAccess(userId, portalId)`:

```ts
export interface Access {
  role: EffectiveRole;          // 'owner' | 'coordinator' | 'viewer' | 'commenter' | 'uploader'
  isProjectMember: boolean;
  canComment: boolean;
  canUpload: boolean;
  canManagePeople: boolean;
}
```

It gains `canTransform: boolean` — true for owner, coordinator and uploader; false for viewer and commenter. It is `true` in exactly the cases `canUpload` is today, but is kept a **separate flag** rather than reusing `canUpload`, because "may add a file" and "may alter how everyone sees an existing file" are different permissions that will drift apart.

**The server is the authority.** The PATCH route calls `getPackageAccess` and rejects anyone without `canTransform`. The client reads the same flag purely to decide whether to render the gizmo — never as the check itself.

No new client plumbing is needed: `app/portal/[id]/page.tsx` already fetches `/api/portals/[id]/access` and reads `info.access.canUpload` into state. `canTransform` arrives through the same response.

### Persistence

Additive migration `lib/migrations/002-object-transform.sql`, following the `001-redesign.sql` convention (`ADD COLUMN IF NOT EXISTS`, nothing dropped or rewritten):

```sql
ALTER TABLE files ADD COLUMN IF NOT EXISTS position_x FLOAT NOT NULL DEFAULT 0;
-- … position_y, position_z, rotation_x, rotation_y, rotation_z
```

Rotation is **Euler angles in radians, XYZ order** — three.js's default. The order is stated in the migration and in the code that reads it, because a mismatched Euler order silently corrupts orientation in a way that looks like a modelling error rather than a bug.

Defaulting every column to `0` is what makes the whole feature backwards compatible: every existing file is already at the identity transform.

Two consequences of storing this per file row, both intended:

- **A new version starts at identity.** A version's files are new rows, so a model carefully seated in v1 comes back unrotated in v2. Carrying the transform forward would mean guessing that two files represent the same object, which nothing in the schema asserts. Out of scope here; worth revisiting if it proves annoying in practice.
- **The columns exist on every file row**, including images, PDFs and video. Only the 3D viewer reads them; for everything else they stay at zero and are ignored.

### API

`PATCH /api/files/[id]/transform`, body `{ position: [x, y, z], rotation: [x, y, z] }`.

The route resolves the file's package by walking `files → versions → portals`, calls `getPackageAccess`, and returns 403 unless `canTransform`. It validates that all six values are finite numbers — a NaN reaching the column would make the object vanish from the viewport with no error anywhere.

A sub-route rather than a PATCH on the existing `app/api/files/[id]/route.ts`, which today is a GET returning file metadata. Keeping the write path separate keeps its access check unambiguous.

---

### Where the transform group sits

The transform group **wraps `<Center>`**, not the other way round:

```
<group ref={transformRef}>        ← persisted position + rotation
  <Center>                        ← normalises the model to the origin
    <group ref={modelRef}>
      <Model url={url} />
```

This ordering is load-bearing. `<Center>` re-centres whatever it contains on every content change, so a transform applied *inside* it would be measured and immediately cancelled out — the object would spring back as the user dragged it.

That gives three frames, named here because the rest of the document depends on them:

- **Model frame `S`** — inside the transform group, after `<Center>`. This is the frame comment pins are stored in, and the frame the scene furniture is sized from.
- **World** — `S` with the user transform applied. `world = transformRef.matrixWorld · S`.
- Converting the other way is `transformRef.matrixWorld` inverted, which is the single matrix every conversion below uses.

---

## Comment pins: from world space to model space

This is the part of the design that carries real risk, and the reason it is cheap is a coincidence worth stating plainly.

Pins are stored in `comments.world_x/y/z` and re-projected to the screen every frame. If the object moves and the pins do not, every existing comment on that object points at empty space.

The fix is to treat those coordinates as **model space** rather than world space:

- **Placing a pin:** the raycast returns a world-space hit. Convert it into the model's frame by applying the inverse of the object's transform before saving.
- **Drawing a pin:** apply the object's transform to the stored coordinate before projecting it to the screen.

**No data migration is required.** Every pin that exists today was placed while the object was at the identity transform, where model space and world space are the same thing. Those rows are already correct under the new interpretation. The identity case is what makes this safe, and it is covered by a test rather than left as an assumption.

---

## The scene does not follow the object

Ground, axes, contact shadow and camera framing all derive from `ModelBounds`, measured from the model's **untransformed** frame. The user transform is applied to a group *inside* that frame, so it moves the object relative to a fixed scene rather than dragging the floor along with it.

Concretely, the measurement must be expressed in frame `S`, not in world space. `Box3.setFromObject` walks world matrices, so it returns world bounds; converting them into `S` means applying the inverted `transformRef.matrixWorld`. Skip that step and the user's transform folds back into the bounds, so the ground chases the object and the camera re-frames on every drag.

**Consequence, intended:** a rotated object can end up floating above the ground or cutting into it. That is what SketchUp does, and it is the honest depiction — the object really is where it has been put. Re-seating it automatically would silently overrule a placement the user just made.

---

## The gizmo

drei's `TransformControls` (already installed), in a new `components/viewers/TransformGizmo.tsx`:

- `mode` toggles between `translate` and `rotate` from a control in the existing viewer toolbar.
- Mounted **only** when `canTransform`; a viewer or commenter never has it in their scene graph at all.
- `onMouseUp` fires the save. drei disables the default OrbitControls for the duration of a drag, so orbiting and dragging cannot fight.

It attaches to the same group that carries the persisted transform, so what the user drags and what gets saved are the same object.

**Already handled by earlier work:** the gizmo's own handles are `Mesh`-derived and sit near the model, but comment-pin raycasting was scoped to the model group in `497da1d`, so the handles cannot swallow pin clicks.

---

## Testing

**Unit** (`node --test`, the repo's runner). The pure pieces:
- World↔model conversion round-trips for a range of transforms.
- **The identity case explicitly**: a pin stored under the old world-space interpretation projects to the same screen position under the new model-space one. This is the assertion that guarantees existing comments are unaffected.
- Euler round-trip through the six stored floats, so an order mismatch fails loudly.
- Transform validation rejects NaN, Infinity and missing components.

**Access** gets direct coverage: `canTransform` is true for owner/coordinator/uploader and false for viewer/commenter.

**Visual pass** via the dev harness: gizmo appears for a permitted role and not otherwise, move and rotate behave, the object keeps its placement across a reload, and a pin placed before a move is still on the same feature after it.

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Two uploaders move the same object concurrently | Last write wins. Accepted — the alternative is locking or merge UI, disproportionate for a rare case with a trivially visible outcome. |
| Annotation snapshots predate a move | Inherent: snapshots are baked images. A markup taken before a move keeps showing the old placement, which is correct — it records what the reviewer saw. |
| A NaN transform hides the object with no visible error | The API rejects non-finite values, and the viewer falls back to identity for anything unusable. |
| Euler order mismatch between writer and reader | Order stated in the migration and the reader, and pinned by a round-trip test. |
| A rotated object intersects the ground | Intended, see above. Named here so it is not later mistaken for a bug. |
