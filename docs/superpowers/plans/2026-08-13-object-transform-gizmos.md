# Object Transform Gizmos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let owner / coordinator / uploader move and rotate a 3D object in the portal viewport with a drag gizmo, persisted per file, with comment pins following the object.

**Architecture:** A per-file transform (position + Euler rotation) stored in six float columns on `files`, applied to a group that wraps `<Center>` in the viewer. Comment pins are reinterpreted from world space to model space — which needs no data migration, because every pin that exists was placed at the identity transform. Permission is a new `canTransform` capability enforced server-side.

**Tech Stack:** Next.js 14, React 18, `@react-three/fiber` 8.18, `@react-three/drei` 9.122 (`TransformControls`), `three` 0.169, TypeScript 5, Postgres via `@neondatabase/serverless`. Tests run on `node --test scripts/tests/*.mjs`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-13-object-transform-gizmos-design.md`

## Global Constraints

- No new npm dependencies. `TransformControls` is already in the installed `@react-three/drei`.
- Operations are **move and rotate only**. No scale.
- `canTransform` is true for **owner, coordinator, uploader**; false for viewer and commenter. It is a **separate flag from `canUpload`**, never an alias.
- **The server is the authority.** The PATCH route enforces `canTransform`; the client flag only decides whether to render the gizmo.
- Rotation is **Euler angles in radians, XYZ order** (three.js's default). State the order anywhere it is read or written.
- Migrations are **additive only** — `ADD COLUMN IF NOT EXISTS`, nothing dropped or rewritten — matching `lib/migrations/001-redesign.sql`.
- The transform group **wraps `<Center>`**, never the reverse. `<Center>` re-centres its contents, so a transform inside it is measured and cancelled out.
- Ground, axes, contact shadow and camera framing derive from the model's **untransformed** frame (`S`). Moving the object must not move the scene.
- Docs under `docs/superpowers/` are deliberately untracked — edit them, never `git add` them.
- Never `git add -A`, `git add .`, or `git commit -a`. Commit explicit paths. `design_handoff_portal_view/`, `docs/superpowers/` and `stiko_handoff/` stay untracked.

### Coordinate frames (referenced throughout)

- **`S` — model frame.** Inside the transform group, after `<Center>`. Comment pins are stored here; scene furniture is sized from here.
- **World.** `S` with the user transform applied: `world = transformRef.matrixWorld · S`.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `lib/objectTransform.ts` | Create | The transform type, validation, and world↔model conversion. Pure. |
| `scripts/tests/objectTransform.test.mjs` | Create | Unit tests for the above. |
| `lib/migrations/002-object-transform.sql` | Create | Six additive columns on `files`. |
| `lib/types.ts` | Modify | `FileRecord` gains `transform`. |
| `app/api/files/route.ts` | Modify | Select and expose the transform columns. |
| `lib/capabilities.ts` | Create | The pure role→capability matrix, dependency-free so Node can test it. |
| `lib/access.ts` | Modify | Re-export the matrix; `Access extends Capabilities`; add `canTransform`. |
| `scripts/tests/access.test.mjs` | Create | The permission matrix, tested without a database. |
| `app/api/files/[id]/transform/route.ts` | Create | PATCH endpoint, access-checked and validated. |
| `components/viewers/TransformGizmo.tsx` | Create | drei `TransformControls` wired to the transform group. |
| `components/viewers/ModelViewerInner.tsx` | Modify | Apply the transform; measure in `S`; convert pins; host the gizmo. |
| `components/viewers/ViewerContainer.tsx` | Modify | Thread the transform props through. (`ModelViewer.tsx` spreads props, so it needs no edit.) |
| `app/portal/[id]/page.tsx` | Modify | Read `canTransform`, own the gizmo mode, save on release. |

---

### Task 1: Transform maths

**Files:**
- Create: `lib/objectTransform.ts`
- Test: `scripts/tests/objectTransform.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface ObjectTransform { position: [number, number, number]; rotation: [number, number, number] }`, `IDENTITY_TRANSFORM`, `isValidTransform(value: unknown): value is ObjectTransform`, `matrixFor(t: ObjectTransform): THREE.Matrix4`, `modelToWorld(point: [number,number,number], t: ObjectTransform): [number,number,number]`, `worldToModel(point: [number,number,number], t: ObjectTransform): [number,number,number]`. Tasks 4, 5 and 6 all consume these.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/objectTransform.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  IDENTITY_TRANSFORM,
  isValidTransform,
  modelToWorld,
  worldToModel,
} from '../../lib/objectTransform.ts';

const close = (a, b, msg) =>
  assert.ok(a.every((v, i) => Math.abs(v - b[i]) < 1e-9), `${msg}: ${a} !== ${b}`);

test('the identity transform leaves a point exactly where it was', () => {
  // This is the guarantee that every comment pin already in the database stays
  // correct when its coordinates are reinterpreted from world space to model space.
  for (const p of [[0, 0, 0], [1, 2, 3], [-8660.25, 0.5, 1385.64]]) {
    close(modelToWorld(p, IDENTITY_TRANSFORM), p, 'modelToWorld moved a point');
    close(worldToModel(p, IDENTITY_TRANSFORM), p, 'worldToModel moved a point');
  }
});

test('translation moves a point by the offset', () => {
  const t = { position: [10, -5, 2], rotation: [0, 0, 0] };
  close(modelToWorld([1, 1, 1], t), [11, -4, 3], 'translate');
  close(worldToModel([11, -4, 3], t), [1, 1, 1], 'untranslate');
});

test('a quarter turn about Y maps +X onto -Z', () => {
  // Pins live on geometry, so getting the rotation sense wrong puts every pin on
  // the opposite side of the object — visually plausible and completely wrong.
  const t = { position: [0, 0, 0], rotation: [0, Math.PI / 2, 0] };
  close(modelToWorld([1, 0, 0], t), [0, 0, -1], 'rotate +X');
  close(modelToWorld([0, 0, 1], t), [1, 0, 0], 'rotate +Z');
});

test('rotation is applied before translation, not after', () => {
  // Composition order is silent when it is wrong: the object still moves, just to
  // the wrong place once it is also rotated.
  const t = { position: [10, 0, 0], rotation: [0, Math.PI / 2, 0] };
  close(modelToWorld([1, 0, 0], t), [10, 0, -1], 'compose order');
});

test('world and model conversions round-trip under a combined transform', () => {
  const t = { position: [3, -7, 11], rotation: [0.3, -1.1, 2.4] };
  for (const p of [[0, 0, 0], [5, 5, 5], [-100, 2, 40]]) {
    close(worldToModel(modelToWorld(p, t), t), p, 'round trip');
  }
});

test('an Euler rotation survives the quaternion round-trip the gizmo performs', () => {
  // The gizmo reads back a quaternion and converts it to Euler XYZ before saving; the
  // viewer converts those stored angles back to a rotation. If writer and reader ever
  // disagree on the order, orientation is silently corrupted — it looks like a bad
  // model rather than a bug. Emulating that round-trip here makes it fail loudly.
  const rotation = [0.4, -0.9, 1.3];
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation, 'XYZ'));
  const back = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  close([back.x, back.y, back.z], rotation, 'euler round trip');
});

test('validation accepts a well-formed transform', () => {
  assert.equal(isValidTransform({ position: [0, 0, 0], rotation: [0, 0, 0] }), true);
  assert.equal(isValidTransform({ position: [1.5, -2, 3], rotation: [0.1, 0.2, 0.3] }), true);
});

test('validation rejects anything that would poison the column', () => {
  // A NaN reaching the database makes the object vanish from the viewport with no
  // error raised anywhere, which is the worst possible failure mode.
  const bad = [
    null,
    undefined,
    'nope',
    {},
    { position: [0, 0, 0] },
    { rotation: [0, 0, 0] },
    { position: [0, 0], rotation: [0, 0, 0] },
    { position: [0, 0, 0, 0], rotation: [0, 0, 0] },
    { position: [0, 0, Number.NaN], rotation: [0, 0, 0] },
    { position: [0, 0, 0], rotation: [Number.POSITIVE_INFINITY, 0, 0] },
    { position: [0, 0, '1'], rotation: [0, 0, 0] },
  ];
  for (const value of bad) {
    assert.equal(isValidTransform(value), false, `accepted ${JSON.stringify(value)}`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module` for `lib/objectTransform.ts`.

- [ ] **Step 3: Write the implementation**

Create `lib/objectTransform.ts`:

```ts
import * as THREE from 'three';

/**
 * Where a 3D object has been placed in its package, and the conversions between the
 * model's own frame and the world.
 *
 * Comment pins are stored in the MODEL frame, so that moving an object carries its
 * comments with it. Everything already in the database was stored while the object was
 * at the identity transform, where the two frames coincide — which is why that
 * reinterpretation needs no data migration, and why the identity case is tested first.
 */

export interface ObjectTransform {
  position: [number, number, number];
  /** Euler angles in RADIANS, applied in three.js's default XYZ order. */
  rotation: [number, number, number];
}

export const IDENTITY_TRANSFORM: ObjectTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
};

function isFiniteTriple(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** Guards the API boundary: a non-finite value here would silently hide the object. */
export function isValidTransform(value: unknown): value is ObjectTransform {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ObjectTransform>;
  return isFiniteTriple(candidate.position) && isFiniteTriple(candidate.rotation);
}

export function matrixFor(transform: ObjectTransform): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...transform.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rotation, 'XYZ')),
    new THREE.Vector3(1, 1, 1),
  );
}

export function modelToWorld(
  point: [number, number, number],
  transform: ObjectTransform,
): [number, number, number] {
  const v = new THREE.Vector3(...point).applyMatrix4(matrixFor(transform));
  return [v.x, v.y, v.z];
}

export function worldToModel(
  point: [number, number, number],
  transform: ObjectTransform,
): [number, number, number] {
  // matrixFor returns a fresh matrix, so inverting in place is safe here.
  const v = new THREE.Vector3(...point).applyMatrix4(matrixFor(transform).invert());
  return [v.x, v.y, v.z];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 7 new tests, `# fail 0`.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx next lint --file lib/objectTransform.ts`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`.

- [ ] **Step 6: Commit**

```bash
git add lib/objectTransform.ts scripts/tests/objectTransform.test.mjs
git commit -m "feat(portal): object transform maths and validation

Comment pins move to the model frame so a moved object carries its
comments. The identity case is tested first: it is what makes the
reinterpretation of existing pin rows safe without a data migration."
```

---

### Task 2: Persistence

**Files:**
- Create: `lib/migrations/002-object-transform.sql`
- Modify: `lib/types.ts`
- Modify: `app/api/files/route.ts`

**Interfaces:**
- Consumes: `ObjectTransform` from `lib/objectTransform.ts` (Task 1).
- Produces: `FileRecord.transform: ObjectTransform`, populated by `GET /api/files?versionId=…`. Tasks 5 and 7 read it.

- [ ] **Step 1: Write the migration**

Create `lib/migrations/002-object-transform.sql`:

```sql
-- Object placement in the 3D viewer.
--
-- Additive only. Every existing file defaults to the identity transform, which is
-- also what makes reinterpreting comments.world_x/y/z from world space to model
-- space safe with no data migration: at identity the two frames are the same.
--
-- rotation_* are Euler angles in RADIANS, applied in three.js's default XYZ order.
-- A reader that assumes a different order will corrupt orientation in a way that
-- looks like a bad model rather than a bug.
ALTER TABLE files ADD COLUMN IF NOT EXISTS position_x FLOAT NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS position_y FLOAT NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS position_z FLOAT NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS rotation_x FLOAT NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS rotation_y FLOAT NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS rotation_z FLOAT NOT NULL DEFAULT 0;
```

Also add the same six columns to the `files` table in `lib/schema.sql`, immediately after `folder_path`, so a fresh database and a migrated one agree:

```sql
  position_x FLOAT NOT NULL DEFAULT 0,
  position_y FLOAT NOT NULL DEFAULT 0,
  position_z FLOAT NOT NULL DEFAULT 0,
  rotation_x FLOAT NOT NULL DEFAULT 0,
  rotation_y FLOAT NOT NULL DEFAULT 0,
  rotation_z FLOAT NOT NULL DEFAULT 0,
```

- [ ] **Step 2: Extend the file type**

In `lib/types.ts`, add the import at the top:

```ts
import type { ObjectTransform } from '@/lib/objectTransform';
```

and add this field to `FileRecord`, after `folderPath`:

```ts
  /** Where the object has been placed in the 3D viewer. Identity for non-3D files. */
  transform: ObjectTransform;
```

- [ ] **Step 3: Return the transform from the files API**

In `app/api/files/route.ts`, extend the SELECT to include the six columns, and map the rows before returning. Replace the `SELECT` list's final line (`created_at AS "createdAt"`) and what follows so the query reads:

```ts
    SELECT id, version_id AS "versionId", filename, storage_key AS "storageKey",
           file_size AS "fileSize", file_type AS "fileType",
           conversion_status AS "conversionStatus",
           converted_storage_key AS "convertedStorageKey",
           conversion_job_id AS "conversionJobId",
           folder_path AS "folderPath",
           position_x AS "positionX", position_y AS "positionY", position_z AS "positionZ",
           rotation_x AS "rotationX", rotation_y AS "rotationY", rotation_z AS "rotationZ",
           created_at AS "createdAt"
    FROM files WHERE version_id = ${versionId}
    ORDER BY folder_path ASC NULLS FIRST, created_at ASC
```

Then, before the response is returned, map each row into the shape `FileRecord` declares. Find where the query result is returned and reshape it:

```ts
  const files = rows.map((row) => {
    const { positionX, positionY, positionZ, rotationX, rotationY, rotationZ, ...file } = row;
    return {
      ...file,
      transform: {
        position: [positionX, positionY, positionZ],
        rotation: [rotationX, rotationY, rotationZ],
      },
    };
  });
```

and return `files` where the raw rows were returned. Read the file first — match the existing variable names and response shape rather than assuming them.

- [ ] **Step 4: Type-check, lint and test**

Run: `npx tsc --noEmit && npx next lint --file lib/types.ts --file app/api/files/route.ts && npm test`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/migrations/002-object-transform.sql lib/schema.sql lib/types.ts app/api/files/route.ts
git commit -m "feat(portal): persist per-file object transform

Six additive float columns defaulting to identity, so every existing file
is already in a valid state. Rotation is Euler XYZ in radians; the order is
stated in the migration because a mismatched reader corrupts orientation
in a way that looks like a bad model."
```

---

### Task 3: The permission

**Files:**
- Create: `lib/capabilities.ts`
- Modify: `lib/access.ts`
- Test: `scripts/tests/access.test.mjs`

**Correction applied during execution:** the matrix could not live in `lib/access.ts` as
originally written. That module opens with `import { sql } from '@/lib/db'`, and `@/` is a
TypeScript path alias resolved by Next's bundler, not by Node — so a `.mjs` test importing it
dies with `ERR_MODULE_NOT_FOUND`. The matrix therefore lives in a new dependency-free
`lib/capabilities.ts`, which `lib/access.ts` imports and re-exports so its public surface is
unchanged. The intent the spec approved — a permission matrix testable without a database — is
preserved exactly; only the file changed.

**Interfaces:**
- Consumes: nothing.
- Produces: `Access.canTransform: boolean`, and a pure `capabilitiesFor(role: EffectiveRole): Capabilities` where `interface Capabilities { canComment: boolean; canUpload: boolean; canTransform: boolean; canManagePeople: boolean }`. Task 4 enforces `canTransform`; Task 8 reads it client-side.

`getPackageAccess` is a database call, so the permission matrix is extracted into a pure function to be testable without one. The extraction must preserve today's values exactly for all five roles.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/access.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilitiesFor } from '../../lib/access.ts';

// Who may reposition an object everyone else reviews. Kept explicit rather than
// derived from canUpload: "may add a file" and "may change how everyone sees an
// existing one" are different powers that will drift apart.
const EXPECTED = {
  owner:       { canComment: true,  canUpload: true,  canTransform: true,  canManagePeople: true  },
  coordinator: { canComment: true,  canUpload: true,  canTransform: true,  canManagePeople: true  },
  uploader:    { canComment: true,  canUpload: true,  canTransform: true,  canManagePeople: false },
  commenter:   { canComment: true,  canUpload: false, canTransform: false, canManagePeople: false },
  viewer:      { canComment: false, canUpload: false, canTransform: false, canManagePeople: false },
};

test('every role gets exactly its documented capabilities', () => {
  for (const [role, expected] of Object.entries(EXPECTED)) {
    assert.deepEqual(capabilitiesFor(role), expected, `role ${role}`);
  }
});

test('only owner, coordinator and uploader can transform', () => {
  const allowed = Object.keys(EXPECTED).filter((r) => capabilitiesFor(r).canTransform);
  assert.deepEqual(allowed.sort(), ['coordinator', 'owner', 'uploader']);
});

test('viewers and commenters cannot transform', () => {
  // Stated separately from the matrix above so the intent survives a careless
  // edit to EXPECTED.
  assert.equal(capabilitiesFor('viewer').canTransform, false);
  assert.equal(capabilitiesFor('commenter').canTransform, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `capabilitiesFor` is not exported from `lib/access.ts`.

- [ ] **Step 3: Extract the matrix and add the capability**

In `lib/access.ts`, add `canTransform` to the `Access` interface:

```ts
export interface Access {
  role: EffectiveRole;
  /** Project members can see the project and all its packages. */
  isProjectMember: boolean;
  canComment: boolean;
  canUpload: boolean;
  /** May move or rotate a 3D object for everyone. Not an alias for canUpload. */
  canTransform: boolean;
  canManagePeople: boolean;
}
```

Add this exported type and function above `getPackageAccess`:

```ts
export type Capabilities = Omit<Access, 'role' | 'isProjectMember'>;

/**
 * What each role may do. Pure and exported so the permission matrix is testable
 * without a database — this is the security-relevant part of access control, and
 * it should not require a live connection to assert.
 */
export function capabilitiesFor(role: EffectiveRole): Capabilities {
  switch (role) {
    case 'owner':
    case 'coordinator':
      return { canComment: true, canUpload: true, canTransform: true, canManagePeople: true };
    case 'uploader':
      return { canComment: true, canUpload: true, canTransform: true, canManagePeople: false };
    case 'commenter':
      return { canComment: true, canUpload: false, canTransform: false, canManagePeople: false };
    case 'viewer':
      return { canComment: false, canUpload: false, canTransform: false, canManagePeople: false };
  }
}
```

Then rewrite the three return sites in `getPackageAccess` to use it, preserving their existing `isProjectMember` values:

```ts
  if (row.ownerId === userId) {
    return { role: 'owner', isProjectMember: true, ...capabilitiesFor('owner') };
  }

  if (row.memberRole === 'coordinator') {
    return { role: 'coordinator', isProjectMember: true, ...capabilitiesFor('coordinator') };
  }

  const guest = row.guestRole as PackageRole | null;
  if (!guest) return null;

  return { role: guest, isProjectMember: false, ...capabilitiesFor(guest) };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 3 new tests, `# fail 0`.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx next lint --file lib/access.ts`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`.

`tsc` is the check that the extraction preserved every field: any consumer destructuring `Access` still compiles, and the switch is exhaustive over `EffectiveRole`.

- [ ] **Step 6: Commit**

```bash
git add lib/access.ts scripts/tests/access.test.mjs
git commit -m "feat(portal): canTransform capability, and a testable permission matrix

Extracts the role -> capability mapping out of the database call so the
security-relevant part of access control can be asserted without a live
connection."
```

---

### Task 4: The write endpoint

**Files:**
- Create: `app/api/files/[id]/transform/route.ts`

**Interfaces:**
- Consumes: `isValidTransform` from `lib/objectTransform.ts` (Task 1); `getPackageAccess` and `portalForFile` from `lib/access.ts` (Task 3).
- Produces: `PATCH /api/files/[id]/transform` accepting `{ position: [x,y,z], rotation: [x,y,z] }` and returning `{ ok: true }`. Task 8 calls it.

A dedicated sub-route rather than a PATCH on `app/api/files/[id]/route.ts`, which today is a GET returning metadata — keeping the write path separate keeps its access check unambiguous.

- [ ] **Step 1: Write the route**

Create `app/api/files/[id]/transform/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess, portalForFile } from '@/lib/access';
import { isValidTransform } from '@/lib/objectTransform';

/**
 * Move or rotate a 3D object for everyone who opens the package.
 *
 * The client hides the gizmo for roles that may not do this, but that is
 * presentation only — this route is the actual boundary.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Resolve the package from the file rather than trusting anything in the body:
  // otherwise the file id is itself the capability.
  const portalId = await portalForFile(params.id);
  if (!portalId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const access = await getPackageAccess(session.user.id, portalId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canTransform) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!isValidTransform(body)) {
    // A non-finite value here would write NaN into the column and make the object
    // disappear from the viewport with no error surfaced anywhere.
    return NextResponse.json({ error: 'Invalid transform' }, { status: 400 });
  }

  const [px, py, pz] = body.position;
  const [rx, ry, rz] = body.rotation;

  await sql`
    UPDATE files
    SET position_x = ${px}, position_y = ${py}, position_z = ${pz},
        rotation_x = ${rx}, rotation_y = ${ry}, rotation_z = ${rz}
    WHERE id = ${params.id}
  `;

  return NextResponse.json({ ok: true });
}
```

Note the 404 rather than 403 when `getPackageAccess` returns null: someone with no access to the package must not learn that the file exists. That matches how the other routes in this codebase treat unknown access — read `app/api/files/route.ts` to confirm the convention before deviating from it.

- [ ] **Step 2: Type-check, lint and test**

Run: `npx tsc --noEmit && npx next lint --file "app/api/files/[id]/transform/route.ts" && npm test`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`, `# fail 0`.

- [ ] **Step 3: Commit**

```bash
git add "app/api/files/[id]/transform/route.ts"
git commit -m "feat(portal): PATCH endpoint for object transform

Resolves the package from the file so the file id is not itself the
capability, enforces canTransform, and rejects non-finite values before
they can write a NaN that would silently hide the object."
```

---

### Task 5: Apply the transform in the viewer

**Files:**
- Modify: `components/viewers/ModelViewerInner.tsx`
- Modify: `components/viewers/ViewerContainer.tsx`
- Verify unchanged: `components/viewers/ModelViewer.tsx`

**Interfaces:**
- Consumes: `ObjectTransform`, `IDENTITY_TRANSFORM` from `lib/objectTransform.ts` (Task 1); `FileRecord.transform` (Task 2).
- Produces: `ModelViewerInnerProps.transform?: ObjectTransform`, threaded through `ModelViewer` and `ViewerContainer` as `transform`. Task 7 adds the gizmo that mutates the same group.

- [ ] **Step 1: Wrap the model in a transform group**

In `components/viewers/ModelViewerInner.tsx`, add the import:

```tsx
import { IDENTITY_TRANSFORM, type ObjectTransform } from '@/lib/objectTransform';
```

Add to `ModelViewerInnerProps`:

```tsx
  /** Where the object has been placed. Identity when absent. */
  transform?: ObjectTransform;
```

Accept it in the component signature with a default:

```tsx
  transform = IDENTITY_TRANSFORM,
```

Add a ref next to `modelRef`:

```tsx
  const transformRef = useRef<THREE.Group>(null);
```

Then wrap `<Center>` — note the group is the PARENT, which is load-bearing:

```tsx
          {/* The transform group wraps <Center>, never the reverse: <Center> re-centres
              whatever it contains, so a transform applied inside it would be measured and
              cancelled out, and the object would spring back as it was dragged. */}
          <group
            ref={transformRef}
            position={transform.position}
            rotation={transform.rotation}
          >
            {/* Deliberately NOT <Center top>: comment pins are stored relative to the
                model, so moving the model would displace every pin saved before this
                change. The ground stack is offset down to the model's base instead. */}
            <Center>
              <group ref={modelRef}>
                <Model url={url} />
              </group>
            </Center>
          </group>
```

- [ ] **Step 2: Measure in the model frame, not world space**

`MeasureModel` currently calls `Box3.setFromObject`, which walks world matrices and would fold the user's transform into the bounds — making the ground chase the object and the camera re-frame on every drag.

Change `MeasureModel` to take the transform group and zero it for the duration of the measurement. Replace the component with:

```tsx
function MeasureModel({
  targetRef,
  transformRef,
  onMeasured,
}: {
  targetRef: React.RefObject<THREE.Object3D>;
  transformRef: React.RefObject<THREE.Object3D>;
  onMeasured: (bounds: ModelBounds) => void;
}) {
  useEffect(() => {
    const target = targetRef.current;
    const frame = transformRef.current;
    if (!target || !frame) return;

    // Measure in frame S — the model as loaded and centred, before the user's placement.
    // Applying the inverse afterwards would not do: inverting the world-space AABB of a
    // rotated box inflates it. Zeroing the transform and restoring it is exact.
    const position = frame.position.clone();
    const quaternion = frame.quaternion.clone();
    frame.position.set(0, 0, 0);
    frame.quaternion.identity();
    frame.updateWorldMatrix(true, true);

    const box = new THREE.Box3().setFromObject(target);

    frame.position.copy(position);
    frame.quaternion.copy(quaternion);
    frame.updateWorldMatrix(true, true);

    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());

    onMeasured({
      center: sphere.center.clone(),
      radius: sphere.radius,
      height: box.max.y - box.min.y,
    });
    // One-shot per model; the component is remounted by key when the url changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
```

and pass the new prop at its render site:

```tsx
          <MeasureModel key={url} targetRef={modelRef} transformRef={transformRef} onMeasured={setBounds} />
```

- [ ] **Step 3: Thread the prop through the wrappers**

`components/viewers/ModelViewer.tsx` needs **no change**: it types its props as `ModelViewerInnerProps` and spreads them straight through, so the new prop arrives without edits. Confirm that is still true before moving on rather than assuming it.

In `components/viewers/ViewerContainer.tsx`, add to `ViewerContainerProps`:

```tsx
  transform?: ObjectTransform;
```

with the import:

```tsx
import type { ObjectTransform } from '@/lib/objectTransform';
```

destructure `transform` in the component parameters, and pass it on the model branch:

```tsx
  if (MODEL_EXTENSIONS.includes(ext)) return <ModelViewer url={url} commentToolActive={commentToolActive} onSceneClick={onSceneClick} worldPins={worldPins} onPinPositionsUpdate={onPinPositionsUpdate} handleRef={modelViewerRef} transform={transform} />;
```

- [ ] **Step 4: Type-check, lint and test**

Run: `npx tsc --noEmit && npx next lint --file components/viewers/ModelViewerInner.tsx --file components/viewers/ViewerContainer.tsx && npm test`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add components/viewers/ModelViewerInner.tsx components/viewers/ViewerContainer.tsx
git commit -m "feat(portal): apply the persisted object transform in the viewer

The transform group wraps <Center> rather than sitting inside it, because
<Center> re-centres its contents and would cancel the placement out.

Bounds are measured with the transform temporarily zeroed so the ground,
axes and camera stay in the model's own frame instead of chasing the
object around."
```

---

### Task 6: Comment pins follow the object

**Files:**
- Modify: `components/viewers/ModelViewerInner.tsx`

**Interfaces:**
- Consumes: `modelToWorld`, `worldToModel` from `lib/objectTransform.ts` (Task 1); the `transform` prop (Task 5).
- Produces: nothing new. `onSceneClick` continues to report a point, but that point is now in the model frame.

Pins are stored in `comments.world_x/y/z` and re-projected each frame. Under this change those columns are reinterpreted as the model frame. Existing rows are already correct, because they were written at the identity transform.

- [ ] **Step 1: Add the import**

In `components/viewers/ModelViewerInner.tsx`:

```tsx
import { IDENTITY_TRANSFORM, modelToWorld, worldToModel, type ObjectTransform } from '@/lib/objectTransform';
```

(replacing the narrower import added in Task 5).

- [ ] **Step 2: Convert on placement**

`SceneInteraction` needs the transform. Add it to that component's props:

```tsx
  transform: ObjectTransform;
```

and inside `handlePointerDown`, where the hit point is reported, convert it into the model frame first. Replace the body of the `for` loop's `if` block:

```tsx
        if (hit.object instanceof THREE.Mesh || hit.object instanceof THREE.SkinnedMesh) {
          const point = hit.point;
          const projected = point.clone().project(camera);
          const screenPercent = {
            x: ((projected.x + 1) / 2) * 100,
            y: ((1 - projected.y) / 2) * 100,
          };
          // Stored relative to the model, so the pin travels with it when it is moved.
          const local = worldToModel([point.x, point.y, point.z], transform);
          onSceneClick({ x: local[0], y: local[1], z: local[2] }, screenPercent);
          break;
        }
```

Add `transform` to the `useCallback` dependency array.

- [ ] **Step 3: Convert on projection**

In the same component's `useFrame` pin-projection loop, apply the transform on the way out. Replace the line that seeds the vector:

```tsx
    for (const pin of worldPins) {
      const world = modelToWorld([pin.worldX, pin.worldY, pin.worldZ], transform);
      tempVec3.current.set(world[0], world[1], world[2]);
      tempVec3.current.project(camera);
```

- [ ] **Step 4: Pass the transform in**

At the `SceneInteraction` render site, add:

```tsx
            transform={transform}
```

- [ ] **Step 5: Type-check, lint and test**

Run: `npx tsc --noEmit && npx next lint --file components/viewers/ModelViewerInner.tsx && npm test`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add components/viewers/ModelViewerInner.tsx
git commit -m "feat(portal): comment pins are stored relative to the model

A pin on a chair leg stays on the chair leg when the chair is moved. The
stored columns are reinterpreted rather than migrated: every pin already in
the database was placed at the identity transform, where the model frame and
the world frame coincide."
```

---

### Task 7: The gizmo

**Files:**
- Create: `components/viewers/TransformGizmo.tsx`
- Modify: `components/viewers/ModelViewerInner.tsx`, `components/viewers/ViewerContainer.tsx`

**Interfaces:**
- Consumes: the transform group ref (Task 5); `ObjectTransform` (Task 1).
- Produces: `TransformGizmo` taking `{ targetRef: React.RefObject<THREE.Object3D>; mode: 'translate' | 'rotate'; onCommit: (t: ObjectTransform) => void }`, plus new props `transformMode?: 'translate' | 'rotate' | null` and `onTransformCommit?: (t: ObjectTransform) => void` threaded through `ModelViewerInner`, `ModelViewer` and `ViewerContainer`. Task 8 supplies them.

- [ ] **Step 1: Write the component**

Create `components/viewers/TransformGizmo.tsx`:

```tsx
'use client';

import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';
import type { ObjectTransform } from '@/lib/objectTransform';

/**
 * Move/rotate handles for the loaded object.
 *
 * Only ever mounted for a role that may transform — a viewer or commenter never has
 * this in their scene graph at all. That is presentation, not enforcement: the PATCH
 * route is the actual boundary.
 */
export default function TransformGizmo({
  targetRef,
  mode,
  onCommit,
}: {
  targetRef: React.RefObject<THREE.Object3D>;
  mode: 'translate' | 'rotate';
  onCommit: (transform: ObjectTransform) => void;
}) {
  if (!targetRef.current) return null;

  return (
    <TransformControls
      object={targetRef.current}
      mode={mode}
      // Auto-save on release. drei suspends the default OrbitControls for the duration
      // of a drag, so orbiting and dragging cannot fight each other.
      onMouseUp={() => {
        const target = targetRef.current;
        if (!target) return;
        // Euler XYZ to match how the columns are read and written.
        const euler = new THREE.Euler().setFromQuaternion(target.quaternion, 'XYZ');
        onCommit({
          position: [target.position.x, target.position.y, target.position.z],
          rotation: [euler.x, euler.y, euler.z],
        });
      }}
    />
  );
}
```

- [ ] **Step 2: Render it, gated on a mode being set**

In `components/viewers/ModelViewerInner.tsx`, add the import:

```tsx
import TransformGizmo from './TransformGizmo';
```

Add to `ModelViewerInnerProps`:

```tsx
  /** Set to a mode to show the move/rotate gizmo. Null or absent hides it entirely. */
  transformMode?: 'translate' | 'rotate' | null;
  onTransformCommit?: (transform: ObjectTransform) => void;
```

Accept both in the component signature, then render the gizmo after `<OrbitControls makeDefault />`, outside `<Suspense>` so it is not torn down while a model loads:

```tsx
        {transformMode && onTransformCommit && bounds && (
          <TransformGizmo
            targetRef={transformRef}
            mode={transformMode}
            onCommit={onTransformCommit}
          />
        )}
```

Gating on `bounds` guarantees the model has loaded and `transformRef.current` exists before the gizmo tries to attach to it.

- [ ] **Step 3: Thread both props through the wrappers**

In `components/viewers/ViewerContainer.tsx`, add to `ViewerContainerProps`:

```tsx
  transformMode?: 'translate' | 'rotate' | null;
  onTransformCommit?: (transform: ObjectTransform) => void;
```

destructure both, and pass them on the model branch alongside `transform`:

```tsx
  if (MODEL_EXTENSIONS.includes(ext)) return <ModelViewer url={url} commentToolActive={commentToolActive} onSceneClick={onSceneClick} worldPins={worldPins} onPinPositionsUpdate={onPinPositionsUpdate} handleRef={modelViewerRef} transform={transform} transformMode={transformMode} onTransformCommit={onTransformCommit} />;
```

`ModelViewer.tsx` needs no change — it spreads props.

- [ ] **Step 4: Type-check, lint and test**

Run: `npx tsc --noEmit && npx next lint --file components/viewers/TransformGizmo.tsx --file components/viewers/ModelViewerInner.tsx --file components/viewers/ViewerContainer.tsx && npm test`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add components/viewers/TransformGizmo.tsx components/viewers/ModelViewerInner.tsx components/viewers/ViewerContainer.tsx
git commit -m "feat(portal): move/rotate gizmo for the 3D object

drei TransformControls attached to the transform group, saving on drag
release. Mounted only when a mode is set, which the page only does for a
role that may transform."
```

---

### Task 8: Wire it into the portal page

**Files:**
- Modify: `app/portal/[id]/page.tsx`
- Modify: `components/markup/DrawingTools.tsx`

**Interfaces:**
- Consumes: `canTransform` from `/api/portals/[id]/access` (Task 3); `PATCH /api/files/[id]/transform` (Task 4); the `transform`, `transformMode` and `onTransformCommit` props on `ViewerContainer` (Tasks 5 and 7); `FileRecord.transform` (Task 2).
- Produces: nothing.

- [ ] **Step 1: Read the capability**

`app/portal/[id]/page.tsx` already fetches the access endpoint and stores `canUpload`. Find that fetch — it reads `info?.access?.canUpload` — and add a sibling state and assignment:

```tsx
  const [canTransform, setCanTransform] = useState(false);
```

and in the same `.then`, set both:

```tsx
      .then((info) => {
        setCanUpload(Boolean(info?.access?.canUpload));
        setCanTransform(Boolean(info?.access?.canTransform));
      })
```

Read the surrounding code first and match its existing shape — do not restructure the fetch.

- [ ] **Step 2: Own the gizmo mode**

Add state near the other viewer state:

```tsx
  // null hides the gizmo. Only ever set for a role that may transform.
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | null>(null);
```

Reset it whenever the selected file changes, by adding this line to the existing effect keyed on `[selectedFileId]` that already clears `viewerSnapshot`, `annotating` and the rest:

```tsx
    setTransformMode(null);
```

- [ ] **Step 3: Save on commit**

Add this callback near the other handlers:

```tsx
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
      }
    },
    [selectedFileId]
  );
```

- [ ] **Step 4: Pass everything to the viewer**

At the `<ViewerContainer ... />` render site, add three props:

```tsx
            transform={selectedFile.transform}
            transformMode={canTransform ? transformMode : null}
            onTransformCommit={handleTransformCommit}
```

Passing `null` for the mode when `canTransform` is false is what keeps the gizmo out of a viewer's scene entirely.

- [ ] **Step 5: Add the toolbar control**

In `components/markup/DrawingTools.tsx`, add three props to `DrawingToolsProps`:

```tsx
  /** Only true for a 3D file and a role that may transform. Hides the group entirely. */
  showTransformTools?: boolean;
  transformMode?: 'translate' | 'rotate' | null;
  onTransformModeChange?: (mode: 'translate' | 'rotate' | null) => void;
```

Destructure them in the component parameters alongside `onInsertImage`:

```tsx
  showTransformTools = false,
  transformMode = null,
  onTransformModeChange,
```

Then render the group immediately after the "Insert image" button's closing `</button>`, reusing the existing `slot()` helper so it matches the neighbouring buttons exactly:

```tsx
        {/* Move / rotate the object itself. 3D only, and only for a role that may. */}
        {showTransformTools && onTransformModeChange && (
          <>
            <button
              title="Move object"
              onClick={() => onTransformModeChange(transformMode === 'translate' ? null : 'translate')}
              className={slot(transformMode === 'translate')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M2 12h20" />
                <path d="M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3" />
              </svg>
            </button>
            <button
              title="Rotate object"
              onClick={() => onTransformModeChange(transformMode === 'rotate' ? null : 'rotate')}
              className={slot(transformMode === 'rotate')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
            </button>
          </>
        )}
```

Clicking the active mode again clears it back to `null`, matching how the drawing tools toggle themselves off.

Then in `app/portal/[id]/page.tsx`, pass them at the existing `<DrawingTools ... />` render site:

```tsx
          showTransformTools={canTransform && is3DFile}
          transformMode={transformMode}
          onTransformModeChange={setTransformMode}
```

`is3DFile` is already computed on that page.

- [ ] **Step 6: Type-check, lint and test**

Run: `npx tsc --noEmit && npx next lint && npm test`
Expected: no `tsc` output, `✔ No ESLint warnings or errors`, `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add "app/portal/[id]/page.tsx" components/markup/DrawingTools.tsx
git commit -m "feat(portal): move/rotate controls in the viewer toolbar

The gizmo mode is only ever set for a role with canTransform, so a viewer
or commenter never has the handles in their scene. Saving updates the local
file list too, so a re-render does not snap the object back."
```

---

### Task 9: Verification and cleanup

**Files:**
- Create then delete (never committed): `scripts/make-sample-stl.mjs`, `public/uploads/sample-*.stl`, `app/portal/dev-gizmo/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: nothing.

- [ ] **Step 1: Verify the migration applies**

Run: `npm run migrate` against a database with `DATABASE_URL` set.
Expected: `002-object-transform.sql` applies and is recorded in `schema_migrations`. Re-running is a no-op.

If no database is available, say so plainly in the final report rather than implying this ran — and note that `ADD COLUMN IF NOT EXISTS` makes it re-runnable by construction.

- [ ] **Step 2: Build the dev harness**

Create `scripts/make-sample-stl.mjs`, writing a closed cylinder as binary STL:

```js
import fs from 'node:fs';
import path from 'node:path';
const REPO = process.cwd();
const THREE = await import(path.join(REPO, 'node_modules/three/build/three.module.js'));
const OUT = path.join(REPO, 'public/uploads');
fs.mkdirSync(OUT, { recursive: true });
const geom = new THREE.CylinderGeometry(100, 100, 200, 48, 1, false).toNonIndexed();
const pos = geom.getAttribute('position');
const n3 = pos.count / 3;
const buf = Buffer.alloc(84 + n3 * 50);
buf.write('sample'.padEnd(80, ' '), 0, 80, 'ascii');
buf.writeUInt32LE(n3, 80);
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3();
let o = 84;
for (let i = 0; i < n3; i++) {
  a.fromBufferAttribute(pos, i * 3); b.fromBufferAttribute(pos, i * 3 + 1); c.fromBufferAttribute(pos, i * 3 + 2);
  nrm.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
  for (const v of [nrm, a, b, c]) { buf.writeFloatLE(v.x, o); buf.writeFloatLE(v.y, o + 4); buf.writeFloatLE(v.z, o + 8); o += 12; }
  buf.writeUInt16LE(0, o); o += 2;
}
fs.writeFileSync(path.join(OUT, 'sample-medium.stl'), buf);
console.log('sample written');
```

Run: `node scripts/make-sample-stl.mjs`

Create `app/portal/dev-gizmo/page.tsx`, which drives the viewer directly with local state in place of the database:

```tsx
'use client';

import { useState } from 'react';
import ModelViewer from '@/components/viewers/ModelViewer';
import { IDENTITY_TRANSFORM, type ObjectTransform } from '@/lib/objectTransform';

export default function DevGizmoPage() {
  const [transform, setTransform] = useState<ObjectTransform>(IDENTITY_TRANSFORM);
  const [mode, setMode] = useState<'translate' | 'rotate' | null>('translate');

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <ModelViewer
        url="/uploads/sample-medium.stl"
        transform={transform}
        transformMode={mode}
        onTransformCommit={setTransform}
      />
      <div style={{ position: 'absolute', top: 8, left: 8, font: '12px monospace', zIndex: 10 }}>
        <button onClick={() => setMode('translate')}>move</button>
        <button onClick={() => setMode('rotate')}>rotate</button>
        <button onClick={() => setMode(null)}>off</button>
        <pre>{JSON.stringify(transform)}</pre>
      </div>
    </div>
  );
}
```

Samples must live under `public/uploads/` specifically: `middleware.ts`'s matcher excludes `uploads`, so the file is served raw. Anywhere else in `public/` it is redirected to `/login` and the STL loader parses HTML.

- [ ] **Step 3: Run the dev server**

Run: `AUTH_SECRET=dev-only DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' npm run dev`

Both are required even though this page queries nothing: `middleware.ts` imports `lib/auth` → `lib/db`, which throws at module load without `DATABASE_URL`. Supply them inline — do **not** create a `.env.local`.

- [ ] **Step 4: Check the gizmo**

Open `http://localhost:3000/portal/dev-gizmo` and confirm:
1. Move handles appear on the object; dragging moves it and the readout updates on release.
2. Switching to rotate shows rotation rings; dragging rotates it.
3. **The ground, axes and contact shadow stay put** while the object moves — they must not chase it.
4. **The camera does not re-frame** during or after a drag.
5. Setting the mode to `off` removes the handles entirely.
6. Orbiting still works, and dragging a handle does not also orbit the camera.

- [ ] **Step 5: Check that pins ride along**

Extend the harness page to arm the comment tool and record placed pins, then verify a pin placed before a move is still on the same feature after it:

```tsx
        commentToolActive
        onSceneClick={(p) => setPins((prev) => [...prev, { id: String(prev.length), worldX: p.x, worldY: p.y, worldZ: p.z }])}
        worldPins={pins}
        onPinPositionsUpdate={setPinPositions}
```

with `const [pins, setPins] = useState<{ id: string; worldX: number; worldY: number; worldZ: number }[]>([])` and a `pinPositions` state. Log the projected screen position, place a pin on a recognisable feature, move the object, and confirm the projected position tracks that feature rather than staying still.

- [ ] **Step 6: Delete the harness**

```bash
rm -rf app/portal/dev-gizmo public/uploads scripts/make-sample-stl.mjs .next/types/app/portal/dev-gizmo
```

Deleting the route without clearing its generated types leaves `tsc` failing on a stale `.next/types` entry.

- [ ] **Step 7: Full verification**

Run: `npm test && npx tsc --noEmit && npx next lint`
Expected: `# fail 0`, no `tsc` output, `✔ No ESLint warnings or errors`.

Then a production build, which needs the env set:

```bash
DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db?sslmode=require' AUTH_SECRET=x NEXTAUTH_URL=http://localhost:3000 \
R2_ACCESS_KEY_ID=x R2_SECRET_ACCESS_KEY=x R2_BUCKET_NAME=x R2_ENDPOINT_URL=https://e.r2.cloudflarestorage.com \
npm run build
```

Expected: `✓ Compiled successfully` and all routes generated. A pre-existing warning about `bcryptjs` in the Edge Runtime is expected and unrelated.

- [ ] **Step 8: Confirm the tree is clean**

Run: `git status --short`
Expected: no `dev-gizmo`, `sample-*.stl` or `make-sample-stl.mjs` entries. The pre-existing untracked `design_handoff_portal_view/`, `docs/superpowers/` and `stiko_handoff/` are expected and must be left alone.
