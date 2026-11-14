# Pricing Page, Plan Limits and Upgrade Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the Free plan's 2-project / 2 GiB limits on the server, turn every refusal into an upgrade dialog, and add a public `/pricing` page and a Settings → Plan & billing page.

**Architecture:** Pure limit rules in `lib/planLimits.ts`; a server-only gate in `lib/planGate.ts` that loads the project OWNER's usage and returns a 402 payload; routes call the gate before writing. The client recognises the 402 with `lib/planLimitClient.ts` and opens one `UpgradeDialog`, mounted once in the root layout and opened by a window event. Limits are on only while billing is on (`billingEnabled()`).

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind (`stiko-*` tokens), Neon `sql` tagged template, stripe-node v23, `@aws-sdk/client-s3` on R2, `node --test` with `--experimental-strip-types` (via `npm test`).

**Spec:** `docs/superpowers/specs/2026-11-13-pricing-and-plan-limits-design.md`

## Global Constraints

- Free = 2 projects, 2 GiB; Standard = unlimited projects, 100 GiB. Read from `PLANS` in `lib/plans.ts`; never type a number into UI.
- Prices are read from `PRICE_DISPLAY` in `lib/billing.ts` (`$20` / "Billed monthly"; `$18` / "Billed $216 yearly").
- Refusal = HTTP **402** with body `{ error, code: 'plan_limit', limit: 'projects' | 'storage', isOwner, used, max, adding }`.
- Limits apply only when `billingEnabled()` is true.
- Storage and project count are always the **project owner's** (`projects.owner_id`), never the caller's.
- UI copy says "Package"/"Submission", never "Portal"/"version". Customers must never see "Ergonic".
- Tested lib modules: no `@/` imports, and import `lib/queries`/`lib/plans` as `import type` only (node --test import rules).
- Never `git add -A`; commit explicit paths. Work on branch `feature/pricing-plan-limits`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `lib/planLimits.ts` | create | Pure rules + the 402 payload type |
| `scripts/tests/planLimits.test.mjs` | create | Tests for the rules |
| `lib/planGate.ts` | create | Server: load owner usage, decide, build the 402 response |
| `app/api/projects/route.ts` | modify | Gate project creation |
| `lib/trashQueries.ts` | modify | `projectOwnerForRestore()` helper |
| `app/api/trash/restore/route.ts` | modify | Gate project restore |
| `lib/s3.ts` | modify | `headObjectSize()` |
| `app/api/files/upload/route.ts` | modify | Require `fileSize`, gate storage, sign length |
| `app/api/files/complete/route.ts` | modify | Record HeadObject size |
| `app/api/comments/attachments/route.ts` | modify | Gate storage |
| `lib/planLimitClient.ts` | create | `readPlanLimit()`, `openUpgradeDialog()`, event name |
| `components/billing/UpgradeDialog.tsx` | create | The dialog + `UpgradeDialogHost` |
| `components/billing/checkout.ts` | create | `startCheckout()` / `openPortal()` shared by every button |
| `app/layout.tsx` | modify | Mount the host |
| `components/home/NewProjectModal.tsx`, `app/new/page.tsx`, `components/home/TrashPanel.tsx`, `lib/uploadAttachment.ts` | modify | Open the dialog on 402 |
| `components/ui/UploadProgress.tsx`, `lib/useUpload.ts` | modify | `blocked` state; stop the batch |
| `components/portal/NewVersionDrawer.tsx` | modify | Storage-full message |
| `lib/stripe.ts` | modify | `subscriptionSummary()` |
| `lib/billing.ts` | modify | `BillingStatusPayload` type (moved from the component) |
| `app/api/billing/status/route.ts` | modify | Add `plan`, `limitsEnforced`, renewal fields |
| `components/shell/BillingActions.tsx` | modify | Use shared checkout helpers + payload type |
| `components/settings/accountRail.ts` | create | One rail definition for all account settings pages |
| `app/settings/billing/page.tsx` | create | Plan & billing page |
| `app/settings/account/page.tsx`, `app/settings/notifications/page.tsx` | modify | Use the shared rail |
| `components/shell/AvatarMenu.tsx` | modify | "Compare plans" + "Plan & billing" links |
| `lib/routeAccess.ts`, `scripts/tests/routeAccess.test.mjs` | modify | `/pricing` public, exact |
| `app/pricing/page.tsx` | create | Pricing page |
| `components/home/PlanBanner.tsx` | create | Dashboard banner |
| `app/page.tsx` | modify | Banner + post-checkout toast |

---

### Task 1: Pure limit rules

**Files:**
- Create: `lib/planLimits.ts`
- Test: `scripts/tests/planLimits.test.mjs`

**Interfaces:**
- Produces:
  - `limitsEnforced(env?: Record<string, string|undefined>): boolean`
  - `canCreateProject(plan: Pick<Plan,'maxProjects'>, activeProjectCount: number): boolean`
  - `canAddBytes(plan: Pick<Plan,'storageBytes'>, usedBytes: number, addBytes: number): boolean`
  - `type PlanLimitKind = 'projects' | 'storage'`
  - `interface PlanLimitPayload { error: string; code: 'plan_limit'; limit: PlanLimitKind; isOwner: boolean; used: number; max: number; adding: number }`
  - `isPlanLimitPayload(v: unknown): v is PlanLimitPayload`

- [ ] **Step 1: Write the failing test** — `scripts/tests/planLimits.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  limitsEnforced,
  canCreateProject,
  canAddBytes,
  isPlanLimitPayload,
} from '../../lib/planLimits.ts';

const GIB = 1024 ** 3;
const FREE = { maxProjects: 2, storageBytes: 2 * GIB };
const STANDARD = { maxProjects: null, storageBytes: 100 * GIB };

test('limits follow the billing kill switch', () => {
  assert.equal(limitsEnforced({}), false);
  assert.equal(limitsEnforced({ BILLING_ENABLED: 'true' }), false);
  assert.equal(limitsEnforced({ BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_x' }), true);
});

test('Free allows a 1st and 2nd project, refuses the 3rd', () => {
  assert.equal(canCreateProject(FREE, 0), true);
  assert.equal(canCreateProject(FREE, 1), true);
  assert.equal(canCreateProject(FREE, 2), false);
  assert.equal(canCreateProject(FREE, 5), false);
});

test('Standard never refuses a project', () => {
  assert.equal(canCreateProject(STANDARD, 0), true);
  assert.equal(canCreateProject(STANDARD, 10_000), true);
});

test('storage: exactly at the limit is allowed, one byte over is not', () => {
  assert.equal(canAddBytes(FREE, 0, 2 * GIB), true);
  assert.equal(canAddBytes(FREE, GIB, GIB), true);
  assert.equal(canAddBytes(FREE, GIB, GIB + 1), false);
  assert.equal(canAddBytes(FREE, 3 * GIB, 1), false);
  assert.equal(canAddBytes(STANDARD, 3 * GIB, GIB), true);
});

test('storage: a non-finite or negative claim is refused', () => {
  assert.equal(canAddBytes(FREE, 0, Number.NaN), false);
  assert.equal(canAddBytes(FREE, 0, -1), false);
  assert.equal(canAddBytes(FREE, 0, Number.POSITIVE_INFINITY), false);
});

test('recognises a 402 body and nothing else', () => {
  assert.equal(
    isPlanLimitPayload({ code: 'plan_limit', limit: 'storage', isOwner: true, used: 1, max: 2, adding: 1, error: 'x' }),
    true
  );
  assert.equal(isPlanLimitPayload({ code: 'plan_limit', limit: 'seats' }), false);
  assert.equal(isPlanLimitPayload({ error: 'Forbidden' }), false);
  assert.equal(isPlanLimitPayload(null), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --experimental-strip-types scripts/tests/planLimits.test.mjs`
Expected: FAIL — `Cannot find module '…/lib/planLimits.ts'`.

- [ ] **Step 3: Implement** — `lib/planLimits.ts`:

```ts
/**
 * What the Free plan refuses, as pure rules.
 *
 * Pure and dependency-free so node --test can import it: no `@/` alias, and
 * Plan is a type-only import. The server gate (lib/planGate.ts) loads usage and
 * calls these; nothing here knows about the database or HTTP.
 */
import type { Plan } from './plans';

/**
 * Limits are on only while billing is on. With the kill switch thrown nobody
 * can lift a limit by paying, so enforcing one would trap people. Mirrors
 * billingEnabled() in lib/billing.ts; duplicated rather than imported so this
 * module stays free of value imports.
 */
export function limitsEnforced(env: Record<string, string | undefined> = process.env): boolean {
  return env.BILLING_ENABLED === 'true' && !!env.STRIPE_SECRET_KEY;
}

/** Trashed projects are not counted; the caller passes the active count. */
export function canCreateProject(plan: Pick<Plan, 'maxProjects'>, activeProjectCount: number): boolean {
  if (plan.maxProjects === null) return true;
  return activeProjectCount < plan.maxProjects;
}

/** Exactly at the limit is allowed. A nonsense claim is refused, not waved through. */
export function canAddBytes(plan: Pick<Plan, 'storageBytes'>, usedBytes: number, addBytes: number): boolean {
  if (!Number.isFinite(addBytes) || addBytes < 0) return false;
  return usedBytes + addBytes <= plan.storageBytes;
}

export type PlanLimitKind = 'projects' | 'storage';

/** The body of every 402. The client turns it into the upgrade dialog. */
export interface PlanLimitPayload {
  error: string;
  code: 'plan_limit';
  limit: PlanLimitKind;
  /** False when the caller is a collaborator on someone else's project. */
  isOwner: boolean;
  /** Projects: active count. Storage: bytes used (trash included). */
  used: number;
  max: number;
  /** Storage: bytes this request wanted to add. Projects: 1. */
  adding: number;
}

export function isPlanLimitPayload(v: unknown): v is PlanLimitPayload {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return o.code === 'plan_limit' && (o.limit === 'projects' || o.limit === 'storage');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test --experimental-strip-types scripts/tests/planLimits.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/planLimits.ts scripts/tests/planLimits.test.mjs
git commit -m "feat(plans): pure Free-plan limit rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Server gate + project limits

**Files:**
- Create: `lib/planGate.ts`
- Modify: `app/api/projects/route.ts:26-38`
- Modify: `lib/trashQueries.ts` (add one exported function)
- Modify: `app/api/trash/restore/route.ts`

**Interfaces:**
- Consumes: Task 1 (`limitsEnforced`, `canCreateProject`, `canAddBytes`, `PlanLimitPayload`); `getAccountUsage(userId): Promise<AccountUsage>` from `lib/queries.ts`.
- Produces:
  - `projectLimitRefusal(ownerId: string, callerId: string): Promise<PlanLimitPayload | null>`
  - `storageLimitRefusal(ownerId: string, callerId: string, addBytes: number): Promise<PlanLimitPayload | null>`
  - `planLimitResponse(p: PlanLimitPayload): NextResponse` (status 402)
  - `projectOwnerForRestore(userId: string, projectId: string): Promise<string | null>` in `lib/trashQueries.ts`

- [ ] **Step 1: Create `lib/planGate.ts`**

```ts
import 'server-only';
import { NextResponse } from 'next/server';
import { getAccountUsage } from '@/lib/queries';
import {
  canAddBytes,
  canCreateProject,
  limitsEnforced,
  type PlanLimitPayload,
} from '@/lib/planLimits';
import { formatBytes } from '@/lib/design';

/**
 * The server side of the Free-plan limits. Every check is against the project
 * OWNER's plan and usage: a collaborator uploading into someone's project
 * spends the owner's storage, because the owner is the one who pays.
 *
 * Returns null when the request may proceed.
 */
export async function projectLimitRefusal(
  ownerId: string,
  callerId: string
): Promise<PlanLimitPayload | null> {
  if (!limitsEnforced()) return null;
  const usage = await getAccountUsage(ownerId);
  if (canCreateProject(usage.plan, usage.projects.count)) return null;
  const max = usage.plan.maxProjects ?? 0;
  return {
    error: `The Free plan includes ${max} projects. Upgrade to Standard for unlimited projects.`,
    code: 'plan_limit',
    limit: 'projects',
    isOwner: ownerId === callerId,
    used: usage.projects.count,
    max,
    adding: 1,
  };
}

export async function storageLimitRefusal(
  ownerId: string,
  callerId: string,
  addBytes: number
): Promise<PlanLimitPayload | null> {
  if (!limitsEnforced()) return null;
  const usage = await getAccountUsage(ownerId);
  if (canAddBytes(usage.plan, usage.storage.totalBytes, addBytes)) return null;
  return {
    error: `This needs ${formatBytes(addBytes)}, and the ${usage.plan.label} plan's ${formatBytes(
      usage.plan.storageBytes
    )} has ${formatBytes(Math.max(0, usage.plan.storageBytes - usage.storage.totalBytes))} left.`,
    code: 'plan_limit',
    limit: 'storage',
    isOwner: ownerId === callerId,
    used: usage.storage.totalBytes,
    max: usage.plan.storageBytes,
    adding: addBytes,
  };
}

/** 402 Payment Required: the client recognises the body by its `code`. */
export function planLimitResponse(p: PlanLimitPayload): NextResponse {
  return NextResponse.json(p, { status: 402 });
}
```

Check before moving on: `grep -n "export function formatBytes" lib/design.ts` must print one line. `lib/design.ts` is already imported by client components, so it is safe on the server too.

- [ ] **Step 2: Gate `POST /api/projects`** — replace the body of `POST` in `app/api/projects/route.ts` (lines 26-38) with:

```ts
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // The creator is always the owner, so owner and caller are the same person.
  const refusal = await projectLimitRefusal(session.user.id, session.user.id);
  if (refusal) return planLimitResponse(refusal);

  const { name } = await request.json();
  const id = uuidv4();
  const rows = await sql`
    INSERT INTO projects (id, owner_id, name)
    VALUES (${id}, ${session.user.id}, ${name})
    RETURNING id, owner_id AS "ownerId", name, created_at AS "createdAt"
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
```

and add to the imports: `import { planLimitResponse, projectLimitRefusal } from '@/lib/planGate';`

- [ ] **Step 3: Add `projectOwnerForRestore` to `lib/trashQueries.ts`** (append at the end of the file):

```ts
/**
 * The owner of a trashed project the caller may restore, or null.
 *
 * Same scope as restoreFromTrash's project branch (owner or coordinator), so
 * the plan gate never reveals a project the restore itself would 404 on.
 * Restoring counts against the OWNER's project limit, not the coordinator's.
 */
export async function projectOwnerForRestore(userId: string, projectId: string): Promise<string | null> {
  const rows = await sql`
    SELECT pr.owner_id AS "ownerId"
    FROM projects pr
    LEFT JOIN project_members pm
      ON pm.project_id = pr.id AND pm.user_id = ${userId}
    WHERE pr.id = ${projectId}
      AND pr.deleted_at IS NOT NULL
      AND (pr.owner_id = ${userId} OR pm.role = 'coordinator')
  `;
  return (rows[0]?.ownerId as string | undefined) ?? null;
}
```

Before writing it, read `restoreFromTrash`'s project branch (`lib/trashQueries.ts` ~lines 162-200) and copy its exact WHERE scope (the role column/value for coordinators, and any expiry condition) into this query so the two can never disagree. If `sql` is not already imported at the top of that file, it is (`restoreFromTrash` uses it).

- [ ] **Step 4: Gate project restore** — in `app/api/trash/restore/route.ts`, inside the `try` and before `restoreFromTrash(...)`:

```ts
    if (kind === 'project') {
      const ownerId = await projectOwnerForRestore(session.user.id, id);
      // null falls through: restoreFromTrash returns 'not-found' and the
      // existing 404 copy applies, so this cannot be used to probe.
      if (ownerId) {
        const refusal = await projectLimitRefusal(ownerId, session.user.id);
        if (refusal) return planLimitResponse(refusal);
      }
    }
```

Imports: `import { projectOwnerForRestore, restoreFromTrash } from '@/lib/trashQueries';` and `import { planLimitResponse, projectLimitRefusal } from '@/lib/planGate';`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/planGate.ts app/api/projects/route.ts lib/trashQueries.ts app/api/trash/restore/route.ts
git commit -m "feat(plans): refuse a 3rd Free project on create and restore

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(The route behaviour is proven against Postgres in Task 9's PGlite run.)

---

### Task 3: Storage limits on uploads and attachments

**Files:**
- Modify: `lib/s3.ts` (imports line 1; add a function)
- Modify: `app/api/files/upload/route.ts`
- Modify: `app/api/files/complete/route.ts`
- Modify: `app/api/comments/attachments/route.ts`
- Modify: `lib/useUpload.ts:169-182` (send `fileSize`)

**Interfaces:**
- Consumes: Task 2 `storageLimitRefusal`, `planLimitResponse`.
- Produces: `headObjectSize(storageKey: string): Promise<number | null>` in `lib/s3.ts`. Upload route now requires `fileSize` (positive integer) in its body.

- [ ] **Step 1: `headObjectSize` in `lib/s3.ts`** — add `HeadObjectCommand` to the import on line 1, then append:

```ts
/**
 * The stored size of an object, or null if it does not exist.
 *
 * What /api/files/complete records, so the storage meter and the plan limit
 * count bytes R2 actually holds rather than whatever the client claimed.
 */
export async function headObjectSize(storageKey: string): Promise<number | null> {
  try {
    const out = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: storageKey }));
    return typeof out.ContentLength === 'number' ? out.ContentLength : null;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw err;
  }
}
```

- [ ] **Step 2: Upload route** — in `app/api/files/upload/route.ts`:

1. Destructure `fileSize` from the body: `const { versionId, filename, contentType, fileSize } = await request.json();`
2. After the existing `versionId`/`filename` 400, add:

```ts
  // Required, and signed into the PUT below, so the size the plan check
  // approves is the size R2 accepts. Without it the check would be advisory.
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    return NextResponse.json({ error: 'fileSize must be a positive integer' }, { status: 400 });
  }
```

3. Add the owner to the version lookup:

```ts
  const versionRows = await sql`
    SELECT po.id AS "portalId", po.project_id AS "projectId", pr.owner_id AS "ownerId"
    FROM versions v
    JOIN portals po ON po.id = v.portal_id
    JOIN projects pr ON pr.id = po.project_id
    WHERE v.id = ${versionId}
  `;
```

4. After the `canUpload` 403, add:

```ts
  // The OWNER's storage, not the uploader's: collaborators are free, and the
  // owner is the one who pays for the space.
  const refusal = await storageLimitRefusal(versionRows[0].ownerId, session.user.id, fileSize);
  if (refusal) return planLimitResponse(refusal);
```

5. Sign the length into the original's URL: `const presignedUrl = await getUploadPresignedUrl(storageKey, contentType, 3600, fileSize);`
6. Imports: `import { planLimitResponse, storageLimitRefusal } from '@/lib/planGate';`

Leave the variant URL unsigned and uncounted: variants were never counted by `getAccountUsage` (spec §3).

- [ ] **Step 3: Send `fileSize` from the client** — in `lib/useUpload.ts`, the presign body (line ~175) becomes:

```ts
          body: JSON.stringify({
            versionId: ctx.versionId,
            projectId: ctx.projectId,
            portalId: ctx.portalId,
            filename: entry.file.name,
            contentType: entry.file.type || 'application/octet-stream',
            // Signed into the PUT URL; must equal the body putOnce sends.
            fileSize: entry.file.size,
          }),
```

`putOnce` already sends `xhr.send(file)`, so the body length equals `file.size`. Zero-byte files now get a 400; that is acceptable (an empty file is not a submission).

- [ ] **Step 4: Complete route records the stored size** — in `app/api/files/complete/route.ts`, after the `storageKey !== expectedKey` 400 and before the INSERT:

```ts
  // Record what R2 holds, not what the client says. The PUT URL was signed
  // with the approved length, so these normally agree; when the HEAD itself
  // fails (not a 404), fall back to the claim rather than failing an upload
  // that has already landed — the signed length still bounds the real size.
  let storedSize: number | null;
  try {
    storedSize = await headObjectSize(storageKey);
  } catch (err) {
    console.error('[files/complete] HEAD failed, using the declared size', err);
    storedSize = Number.isFinite(Number(fileSize)) ? Number(fileSize) : null;
  }
  if (storedSize === null) {
    return NextResponse.json({ error: 'The upload was not found in storage' }, { status: 400 });
  }
```

then use `${storedSize}` instead of `${fileSize}` in the INSERT VALUES. Import: `import { headObjectSize } from '@/lib/s3';`

- [ ] **Step 5: Attachments route** — in `app/api/comments/attachments/route.ts`, after the `canComment` 403 and before building `storageKey`:

```ts
  // Attachments live in the file's project and count toward its OWNER's storage
  // (getAccountUsage sums comments.attachments sizes under owned files).
  const ownerRows = await sql`
    SELECT pr.owner_id AS "ownerId"
    FROM files f
    JOIN versions v ON v.id = f.version_id
    JOIN portals po ON po.id = v.portal_id
    JOIN projects pr ON pr.id = po.project_id
    WHERE f.id = ${validated.fileId}
  `;
  const ownerId = ownerRows[0]?.ownerId as string | undefined;
  if (ownerId) {
    const refusal = await storageLimitRefusal(ownerId, session.user.id, validated.size);
    if (refusal) return planLimitResponse(refusal);
  }
```

Imports: add `import { sql } from '@/lib/db';` if absent, and `import { planLimitResponse, storageLimitRefusal } from '@/lib/planGate';`

- [ ] **Step 6: Typecheck and run all tests**

Run: `npx tsc --noEmit -p . && npm test`
Expected: tsc clean; all tests pass (count = previous 885 + 6 from Task 1).

- [ ] **Step 7: Commit**

```bash
git add lib/s3.ts app/api/files/upload/route.ts app/api/files/complete/route.ts app/api/comments/attachments/route.ts lib/useUpload.ts
git commit -m "feat(plans): enforce Free storage on uploads and attachments

The upload route now requires fileSize, checks it against the project
owner's storage, and signs it into the PUT URL. Complete records the size
R2 reports instead of the client's claim.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Upgrade dialog, checkout helpers, and wiring the 402s

**Files:**
- Create: `lib/planLimitClient.ts`, `components/billing/checkout.ts`, `components/billing/UpgradeDialog.tsx`
- Modify: `app/layout.tsx`, `components/home/NewProjectModal.tsx`, `app/new/page.tsx`, `components/home/TrashPanel.tsx`, `lib/uploadAttachment.ts`, `components/shell/BillingActions.tsx`

**Interfaces:**
- Consumes: `PlanLimitPayload`, `isPlanLimitPayload` (Task 1); `formatBytes` from `@/lib/design`; `PRICE_DISPLAY`, `BillingInterval` from `@/lib/billing`; `Modal` (`isOpen,onClose,title,subtitle?,footer?,width?`); `Button` (`variant: primary|secondary|ghost|danger`, `size: sm|md|lg`).
- Produces:
  - `readPlanLimit(res: Response): Promise<PlanLimitPayload | null>` (reads a clone; caller can still read `res`)
  - `openUpgradeDialog(p: PlanLimitPayload | null): void` (`null` = generic "See what Standard adds")
  - `UPGRADE_EVENT = 'stiko:upgrade'`
  - `class PlanLimitError extends Error { payload: PlanLimitPayload }`
  - `startCheckout(interval: BillingInterval): Promise<void>` and `openPortal(): Promise<void>` — both throw `Error(message)` on failure and navigate on success.
  - `<UpgradeDialogHost />` (default export of `UpgradeDialog.tsx`)

- [ ] **Step 1: `lib/planLimitClient.ts`**

```ts
'use client';

import { isPlanLimitPayload, type PlanLimitPayload } from '@/lib/planLimits';

export const UPGRADE_EVENT = 'stiko:upgrade';

/** A 402 plan-limit body, or null for any other response. Reads a clone. */
export async function readPlanLimit(res: Response): Promise<PlanLimitPayload | null> {
  if (res.status !== 402) return null;
  const body = await res.clone().json().catch(() => null);
  return isPlanLimitPayload(body) ? body : null;
}

/** Opens the one UpgradeDialog mounted in the root layout. */
export function openUpgradeDialog(payload: PlanLimitPayload | null): void {
  window.dispatchEvent(new CustomEvent(UPGRADE_EVENT, { detail: payload }));
}

/** Thrown by helpers whose callers only catch; carries the 402 body. */
export class PlanLimitError extends Error {
  payload: PlanLimitPayload;
  constructor(payload: PlanLimitPayload) {
    super(payload.error);
    this.name = 'PlanLimitError';
    this.payload = payload;
  }
}
```

- [ ] **Step 2: `components/billing/checkout.ts`** — moves the fetch-and-navigate logic out of `BillingActions` so every button shares it:

```ts
'use client';

import type { BillingInterval } from '@/lib/billing';

async function follow(endpoint: string, body?: object): Promise<void> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new Error(data.error ?? 'Something went wrong.');
  window.location.assign(data.url);
}

/** Stripe Checkout for Standard. If already paying, the server returns the portal instead. */
export function startCheckout(interval: BillingInterval): Promise<void> {
  return follow('/api/billing/checkout', { interval });
}

export function openPortal(): Promise<void> {
  return follow('/api/billing/portal');
}
```

Then in `components/shell/BillingActions.tsx` replace the body of `go()` with calls to these: `go` becomes

```ts
  async function go(key: string, run: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await run();
      // Leave the spinner on: the page is navigating away.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(null);
    }
  }
```

and the three call sites become `go('portal', openPortal)` and `go(interval, () => startCheckout(interval))`. Import `{ startCheckout, openPortal } from '@/components/billing/checkout'`.

- [ ] **Step 3: `components/billing/UpgradeDialog.tsx`**

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { formatBytes } from '@/lib/design';
import { PRICE_DISPLAY, type BillingInterval } from '@/lib/billing';
import { PLANS } from '@/lib/plans';
import type { PlanLimitPayload } from '@/lib/planLimits';
import { UPGRADE_EVENT } from '@/lib/planLimitClient';
import { startCheckout } from './checkout';

function headline(p: PlanLimitPayload | null): { title: string; subtitle: string } {
  const standard = PLANS.standard;
  const perks = `Standard gives you ${formatBytes(standard.storageBytes)} and unlimited projects.`;
  if (!p) return { title: 'Upgrade to Standard', subtitle: perks };
  if (!p.isOwner) {
    return {
      title: p.limit === 'storage' ? 'This project is out of storage' : 'This project is at its limit',
      subtitle:
        p.limit === 'storage'
          ? "The project's owner is on the Free plan and has used its storage. Ask them to upgrade to Standard."
          : "The project's owner is on the Free plan and has used its projects. Ask them to upgrade to Standard.",
    };
  }
  if (p.limit === 'projects') {
    return { title: `You've used your ${p.max} Free projects`, subtitle: perks };
  }
  const left = Math.max(0, p.max - p.used);
  return {
    title: 'Not enough storage',
    subtitle: `This needs ${formatBytes(p.adding)} — you have ${formatBytes(left)} left of ${formatBytes(
      p.max
    )}. ${perks}`,
  };
}

/** Mounted once in the root layout; opened by openUpgradeDialog(). */
export default function UpgradeDialogHost() {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<PlanLimitPayload | null>(null);
  const [busy, setBusy] = useState<BillingInterval | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      setPayload((e as CustomEvent<PlanLimitPayload | null>).detail ?? null);
      setError(null);
      setBusy(null);
      setOpen(true);
    };
    window.addEventListener(UPGRADE_EVENT, onOpen);
    return () => window.removeEventListener(UPGRADE_EVENT, onOpen);
  }, []);

  const { title, subtitle } = headline(payload);
  const canPay = !payload || payload.isOwner;

  const pay = async (interval: BillingInterval) => {
    setBusy(interval);
    setError(null);
    try {
      await startCheckout(interval);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(null);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={() => busy === null && setOpen(false)}
      title={title}
      subtitle={subtitle}
      width={460}
      footer={
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/pricing"
            onClick={() => setOpen(false)}
            className="text-[12.5px] font-semibold !text-stiko-secondary hover:!text-stiko-ink"
          >
            See plans
          </Link>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy !== null}>
            {canPay ? 'Not now' : 'OK'}
          </Button>
        </div>
      }
    >
      {canPay && (
        <div className="grid grid-cols-2 gap-2">
          {(['month', 'year'] as const).map((interval) => (
            <button
              key={interval}
              disabled={busy !== null}
              onClick={() => pay(interval)}
              className="rounded-[12px] border border-stiko-border px-4 py-3 text-left transition hover:border-stiko-primary hover:bg-stiko-tint disabled:opacity-60"
            >
              <div className="text-[10px] font-extrabold uppercase tracking-label text-stiko-primary">
                {interval === 'month' ? 'Monthly' : 'Yearly'}
              </div>
              <div className="text-[16px] font-bold text-stiko-ink">
                {busy === interval ? 'Opening…' : `${PRICE_DISPLAY[interval].perMonth}/mo`}
              </div>
              <div className="text-[11px] text-stiko-muted">{PRICE_DISPLAY[interval].note}</div>
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-[12px] text-red-600">{error}</p>}
    </Modal>
  );
}
```

Check before using: `lib/billing.ts` and `lib/plans.ts` have no server-only imports (both are pure; `BillingActions` already imports types from `lib/billing`). `PRICE_DISPLAY` is a plain object, safe in the client bundle.

- [ ] **Step 4: Mount the host** — `app/layout.tsx`, inside `<ToastProvider>`:

```tsx
          <ToastProvider>
            {children}
            <UpgradeDialogHost />
          </ToastProvider>
```

Import: `import UpgradeDialogHost from "@/components/billing/UpgradeDialog";` (match the file's double-quote style).

- [ ] **Step 5: New project modal** — `components/home/NewProjectModal.tsx`, in `create()` replace `if (!res.ok) throw new Error(String(res.status));` with:

```ts
      const limit = await readPlanLimit(res);
      if (limit) {
        setSaving(false);
        onClose();
        openUpgradeDialog(limit);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
```

Import: `import { openUpgradeDialog, readPlanLimit } from '@/lib/planLimitClient';`

- [ ] **Step 6: `/new` page** — `app/new/page.tsx` line ~119, replace `if (!res.ok) throw new Error('Could not create the project');` with:

```ts
        const limit = await readPlanLimit(res);
        if (limit) {
          // Nothing was created yet, so compose is the right place to land.
          openUpgradeDialog(limit);
          setPhase('compose');
          return;
        }
        if (!res.ok) throw new Error('Could not create the project');
```

Same import as Step 5.

- [ ] **Step 7: Trash restore** — `components/home/TrashPanel.tsx`, in `restore()` immediately after the `setBusy(...)` that removes the key and before `if (!res.ok)`:

```ts
    const limit = await readPlanLimit(res);
    if (limit) {
      openUpgradeDialog(limit);
      return;
    }
```

Same import.

- [ ] **Step 8: Comment attachments** — `lib/uploadAttachment.ts`, in `uploadFile`, replace the `if (!res.ok) { … }` block with:

```ts
  const limit = await readPlanLimit(res);
  if (limit) {
    openUpgradeDialog(limit);
    throw new PlanLimitError(limit);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Could not prepare the upload (${res.status})`);
  }
```

Import: `import { openUpgradeDialog, PlanLimitError, readPlanLimit } from '@/lib/planLimitClient';`

Then check the two callers (`components/portal/CommentsPanel.tsx`, `app/portal/[id]/page.tsx`): `grep -n "uploadFile(" components/portal/CommentsPanel.tsx "app/portal/[id]/page.tsx"`. For each catch around `uploadFile`, if it toasts the error, skip the toast when `err instanceof PlanLimitError` (the dialog already explains). If a failed attachment currently aborts posting the comment, change it to drop the attachment and keep the text, so the spec's "comment text stays" holds. Show the exact diff you made in the commit message body.

- [ ] **Step 9: Typecheck, test, commit**

Run: `npx tsc --noEmit -p . && npm test`
Expected: clean; all pass.

```bash
git add lib/planLimitClient.ts components/billing/checkout.ts components/billing/UpgradeDialog.tsx app/layout.tsx components/home/NewProjectModal.tsx app/new/page.tsx components/home/TrashPanel.tsx lib/uploadAttachment.ts components/shell/BillingActions.tsx components/portal/CommentsPanel.tsx "app/portal/[id]/page.tsx"
git commit -m "feat(plans): upgrade dialog on every plan-limit refusal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Only stage the two portal files if Step 8 changed them.)

---

### Task 5: Uploads stop the batch when storage is full

**Files:**
- Modify: `components/ui/UploadProgress.tsx`
- Modify: `lib/useUpload.ts`
- Modify: `components/portal/NewVersionDrawer.tsx`, `app/new/page.tsx`

**Interfaces:**
- Consumes: Task 4 `readPlanLimit`, `openUpgradeDialog`, `PlanLimitError`.
- Produces: `UploadState` gains `'blocked'`; `useUpload()` returns `anyBlocked: boolean` (for rendering) and `wasBlocked(): boolean` (reads the ref, for messages right after an `await`) in addition to existing fields. `anyFailed` stays "state === 'failed'" only. `retryFailed()` re-runs `failed` AND `blocked` items.

- [ ] **Step 1: `blocked` in `UploadProgress.tsx`**

- Type: `export type UploadState = 'pending' | 'uploading' | 'optimizing' | 'done' | 'failed' | 'blocked';`
- Track colour: treat `blocked` like `failed` but grey: `item.state === 'blocked' ? '#F1F1F4' : …` inserted before the `failed` branch in both the `track` expression and the fill-colour expression; fill width 100% for `blocked` as for `failed`.
- Status text: where `item.state === 'failed'` renders its label/retry button (line ~61), add a sibling:

```tsx
          {item.state === 'blocked' && (
            <span className="text-[11.5px] font-semibold text-stiko-muted">Not uploaded — storage full</span>
          )}
```

No retry button for `blocked` (the batch retry covers it after space is freed).

- [ ] **Step 2: Stop the batch in `useUpload.ts`**

1. Add a ref beside the others: `const blockedRef = useRef(false);`
2. In `uploadOne`, after `const presignRes = await fetch('/api/files/upload', …)` and before `if (!presignRes.ok)`:

```ts
        const limit = await readPlanLimit(presignRes);
        if (limit) throw new PlanLimitError(limit);
```

3. In `uploadOne`'s `catch (err)`:

```ts
      } catch (err) {
        if (err instanceof PlanLimitError) {
          patch(entry.path, { state: 'blocked' });
          // One dialog per batch, however many workers hit the wall at once.
          if (!blockedRef.current) {
            blockedRef.current = true;
            openUpgradeDialog(err.payload);
          }
          return false;
        }
        console.error(`Upload failed for ${entry.path}`, err);
        patch(entry.path, { state: 'failed' });
        return false;
      }
```

4. In `runPool`'s worker, stop pulling once blocked, and mark what is left:

```ts
      const worker = async () => {
        for (;;) {
          if (blockedRef.current) return;
          const next = queue.shift();
          if (!next) return;
          results.push(await uploadOne(next));
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker)
      );

      if (blockedRef.current) {
        for (const left of queue) patch(left.path, { state: 'blocked' });
        results.push(false);
      }

      return results.every(Boolean);
```

5. Reset the flag at the start of `runPool` (`blockedRef.current = false;` as its first line) so a retry after freeing space runs again.
6. `retryFailed` filter becomes `.filter((i) => i.state === 'failed' || i.state === 'blocked')`.
7. Return value: add `const anyBlocked = items.some((i) => i.state === 'blocked');` and include `anyBlocked` in the returned object.
8. Imports: `import { openUpgradeDialog, PlanLimitError, readPlanLimit } from '@/lib/planLimitClient';`

- [ ] **Step 3: Callers say why** — in both `components/portal/NewVersionDrawer.tsx` (the `if (!ok)` after start/retryFailed) and `app/new/page.tsx` (the `if (!ok)` after `upload.start`), choose the message:

```ts
        setError(
          upload.anyBlocked
            ? 'Storage is full, so some files weren’t uploaded. Upgrade or free up space, then retry them.'
            : 'Some files didn’t upload. Retry them — nothing is published until they all land.'
        );
```

`upload.anyBlocked` is read from the hook's state after `await`, which may lag one render. To avoid that, compute it from the same source the hook used: in `useUpload`, make `start`/`retryFailed` resolve `false` as today and additionally expose `wasBlocked(): boolean` returning `blockedRef.current`; use `upload.wasBlocked()` in these two messages instead of `upload.anyBlocked`. (Keep `anyBlocked` for rendering.)

In `NewVersionDrawer.tsx` the footer button label currently checks `upload.anyFailed`; change to `upload.anyFailed || upload.anyBlocked` so a blocked batch shows "Retry failed files" rather than "Publish", and `retryFailed` re-runs the blocked files.

- [ ] **Step 4: Typecheck, test, commit**

Run: `npx tsc --noEmit -p . && npm test`

```bash
git add components/ui/UploadProgress.tsx lib/useUpload.ts components/portal/NewVersionDrawer.tsx app/new/page.tsx
git commit -m "feat(plans): a full Free storage stops the upload batch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Billing status with plan and renewal, and Settings → Plan & billing

**Files:**
- Modify: `lib/billing.ts`, `lib/stripe.ts`, `app/api/billing/status/route.ts`, `components/shell/BillingActions.tsx`
- Create: `components/settings/accountRail.ts`, `app/settings/billing/page.tsx`
- Modify: `app/settings/account/page.tsx`, `app/settings/notifications/page.tsx`, `components/shell/AvatarMenu.tsx`

**Interfaces:**
- Produces:
  - In `lib/billing.ts`:
    ```ts
    export interface BillingStatusPayload {
      action: BillingAction;
      plan?: PlanId;
      limitsEnforced?: boolean;
      hasBillingHistory?: boolean;
      prices?: Record<BillingInterval, { perMonth: string; note: string }>;
      subscription?: { status: string; interval: BillingInterval | null; renewsAt: string | null; cancelAtPeriodEnd: boolean };
    }
    ```
    `BillingActions.tsx` re-exports it: `export type { BillingStatusPayload } from '@/lib/billing';` (keeps AvatarMenu's import working).
  - In `lib/stripe.ts`: `subscriptionSummary(subscriptionId: string): Promise<BillingStatusPayload['subscription']>`
  - `ACCOUNT_RAIL` in `components/settings/accountRail.ts`.

- [ ] **Step 1: Payload type in `lib/billing.ts`** — append the interface above (it uses only types already in the file plus `PlanId`, imported as a type on line 12). Delete the interface from `BillingActions.tsx` and add the re-export line.

- [ ] **Step 2: `subscriptionSummary` in `lib/stripe.ts`** — append:

```ts
/**
 * Renewal facts for the Plan & billing page, read live from Stripe.
 *
 * In API 2026-09-30 the period end lives on the subscription ITEM, not the
 * subscription. Verify with: node -e "require('stripe')" is not enough — check
 * node_modules/stripe/types/SubscriptionItems.d.ts for current_period_end
 * before relying on it, and fall back to the subscription's own field if the
 * item lacks it.
 */
export async function subscriptionSummary(
  subscriptionId: string
): Promise<BillingStatusPayload['subscription']> {
  const sub = await stripe().subscriptions.retrieve(subscriptionId);
  const item = sub.items.data[0];
  const periodEnd =
    (item as unknown as { current_period_end?: number })?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    null;
  const recurring = item?.price?.recurring?.interval;
  return {
    status: sub.status,
    interval: recurring === 'month' || recurring === 'year' ? recurring : null,
    renewsAt: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end || !!sub.cancel_at,
  };
}
```

Add `type BillingStatusPayload` to the existing `@/lib/billing` import. Run `grep -n "current_period_end" node_modules/stripe/types/SubscriptionItems.d.ts node_modules/stripe/types/Subscriptions.d.ts` and, if the field is typed on the item, drop the `as unknown` casts for that line.

- [ ] **Step 3: Status route** — `app/api/billing/status/route.ts`, the `try` block becomes:

```ts
  try {
    const user = await getUserBilling(session.user.id);
    if (!user) return NextResponse.json({ action: 'none' });
    const plan = planFor(user.plan).id;
    const action = billingActionFor({ enabled, plan, subscriptionStatus: user.stripeSubscriptionStatus });

    // Renewal facts are a nicety: a Stripe hiccup omits them, never fails the call.
    let subscription: BillingStatusPayload['subscription'];
    if (user.stripeSubscriptionId) {
      subscription = await subscriptionSummary(user.stripeSubscriptionId).catch((err) => {
        console.error('[api/billing/status] subscription', err instanceof Error ? err.message : err);
        return undefined;
      });
    }

    const payload: BillingStatusPayload = {
      action,
      plan,
      limitsEnforced: limitsEnforced(),
      hasBillingHistory: !!user.stripeCustomerId,
      prices: PRICE_DISPLAY,
      subscription,
    };
    return NextResponse.json(payload);
  } catch (err) {
```

Also change the disabled early return to `return NextResponse.json({ action: 'none', limitsEnforced: false });`. Imports: `type BillingStatusPayload` from `@/lib/billing`, `subscriptionSummary` from `@/lib/stripe`, `limitsEnforced` from `@/lib/planLimits`.

- [ ] **Step 4: Shared rail** — `components/settings/accountRail.ts`:

```ts
/** The Account settings rail, shared so a new page is added in one place. */
export const ACCOUNT_RAIL = [
  { key: 'profile', label: 'Profile', href: '/settings/account' },
  { key: 'password', label: 'Password', href: '/settings/password' },
  { key: 'billing', label: 'Plan & billing', href: '/settings/billing' },
  { key: 'notifications', label: 'Notifications', href: '/settings/notifications' },
];
```

In `app/settings/account/page.tsx` and `app/settings/notifications/page.tsx`, delete the local `const RAIL = [...]`, import `ACCOUNT_RAIL`, and pass `items={ACCOUNT_RAIL}`. (Keep the existing Password entry exactly as it was; it is out of scope.)

- [ ] **Step 5: `app/settings/billing/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SettingsShell, SettingsCard } from '@/components/settings/SettingsShell';
import { ACCOUNT_RAIL } from '@/components/settings/accountRail';
import UsageMeters, { type UsagePayload } from '@/components/shell/UsageMeters';
import Button from '@/components/ui/Button';
import { openPortal, startCheckout } from '@/components/billing/checkout';
import type { BillingInterval, BillingStatusPayload } from '@/lib/billing';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Settings → Plan & billing. */
export default function BillingSettings() {
  const [status, setStatus] = useState<BillingStatusPayload | null>(null);
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [usageFailed, setUsageFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/billing/status')
      .then((r) => (r.ok ? r.json() : { action: 'none' }))
      .then(setStatus)
      .catch(() => setStatus({ action: 'none' }));
    fetch('/api/me/usage')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setUsage)
      .catch(() => setUsageFailed(true));
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(null);
    }
  };

  const sub = status?.subscription;
  const planLabel = usage?.plan.label ?? (status?.plan === 'standard' ? 'Standard' : 'Free');

  let renewal: string | null = null;
  if (sub?.renewsAt) {
    const cadence = sub.interval === 'year' ? 'Yearly' : sub.interval === 'month' ? 'Monthly' : null;
    renewal = sub.cancelAtPeriodEnd
      ? `Cancels on ${formatDate(sub.renewsAt)}`
      : `Renews on ${formatDate(sub.renewsAt)}${cadence ? ` · ${cadence}` : ''}`;
  }

  return (
    <SettingsShell
      crumbs={[{ label: 'Settings' }, { label: 'Account' }]}
      railLabel="Account"
      items={ACCOUNT_RAIL}
      active="billing"
    >
      <SettingsCard heading="Plan" description={renewal ?? undefined}>
        <div className="flex items-center gap-2">
          <span className="rounded-chip bg-stiko-tint px-[8px] py-[4px] text-[11px] font-extrabold uppercase tracking-label text-stiko-primary">
            {planLabel}
          </span>
          <Link href="/pricing" className="text-[12.5px] font-semibold !text-stiko-secondary hover:!text-stiko-ink">
            Compare plans
          </Link>
        </div>

        {sub?.status === 'past_due' && (
          <p className="rounded-[10px] bg-[#FFF5F5] px-3 py-2 text-[12.5px] font-semibold text-[#B23A52]">
            Your last payment failed. Update your card in Manage billing to keep Standard.
          </p>
        )}

        <div className="-mx-4 rounded-[12px] border border-stiko-border">
          <UsageMeters usage={usage} failed={usageFailed} />
        </div>

        {status?.action === 'upgrade' && (
          <div className="flex flex-wrap gap-2">
            {(['month', 'year'] as BillingInterval[]).map((interval) => (
              <Button
                key={interval}
                variant={interval === 'year' ? 'primary' : 'secondary'}
                disabled={busy !== null}
                onClick={() => run(interval, () => startCheckout(interval))}
              >
                {busy === interval
                  ? 'Opening…'
                  : `Upgrade ${interval === 'month' ? 'monthly' : 'yearly'} · ${status.prices?.[interval].perMonth}/mo`}
              </Button>
            ))}
            {status.hasBillingHistory && (
              <Button variant="ghost" disabled={busy !== null} onClick={() => run('portal', openPortal)}>
                {busy === 'portal' ? 'Opening…' : 'Billing history'}
              </Button>
            )}
          </div>
        )}

        {status?.action === 'manage' && (
          <div>
            <Button variant="secondary" disabled={busy !== null} onClick={() => run('portal', openPortal)}>
              {busy === 'portal' ? 'Opening…' : 'Manage billing'}
            </Button>
            <p className="mt-2 text-[11.5px] text-stiko-muted">Change plan, update your card, see invoices or cancel.</p>
          </div>
        )}

        {error && <p className="text-[12px] text-red-600">{error}</p>}
      </SettingsCard>
    </SettingsShell>
  );
}
```

- [ ] **Step 6: Avatar menu links** — in `components/shell/AvatarMenu.tsx`, the settings block becomes:

```tsx
        <div className="border-t border-stiko-border p-2">
          <MenuLink href="/settings/account" onClick={() => setOpen(false)}>
            Account settings
          </MenuLink>
          <MenuLink href="/settings/billing" onClick={() => setOpen(false)}>
            Plan & billing
          </MenuLink>
          <MenuLink href="/pricing" onClick={() => setOpen(false)}>
            Compare plans
          </MenuLink>
          <MenuLink href="/settings/notifications" onClick={() => setOpen(false)}>
            Notifications
          </MenuLink>
        </div>
```

- [ ] **Step 7: Typecheck, test, commit**

Run: `npx tsc --noEmit -p . && npm test`

```bash
git add lib/billing.ts lib/stripe.ts app/api/billing/status/route.ts components/shell/BillingActions.tsx components/settings/accountRail.ts app/settings/billing/page.tsx app/settings/account/page.tsx app/settings/notifications/page.tsx components/shell/AvatarMenu.tsx
git commit -m "feat(billing): Settings → Plan & billing with renewal date

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Public pricing page

**Files:**
- Modify: `lib/routeAccess.ts:67-71`, `scripts/tests/routeAccess.test.mjs`
- Create: `app/pricing/page.tsx`

**Interfaces:**
- Consumes: `useAuthSession()` → `{ data, status: 'loading'|'authenticated'|'unauthenticated' }` from `@/lib/authClient`; `BillingStatusPayload` (Task 6); `startCheckout`, `openPortal` (Task 4); `PLANS`; `PRICE_DISPLAY`; `Shell`, `TopBar`, `Column` from `@/components/ui/Shell`; `AvatarMenu`.

- [ ] **Step 1: Failing route test** — add to `scripts/tests/routeAccess.test.mjs` (follow the file's existing import of `routeDecision`):

```js
test('/pricing is public, exactly', () => {
  assert.equal(routeDecision('/pricing', false), 'pass');
  assert.equal(routeDecision('/pricing-admin', false), 'login');
  assert.equal(routeDecision('/pricingx', false), 'login');
});
```

Run: `node --test --experimental-strip-types scripts/tests/routeAccess.test.mjs` → FAIL on the first assert.

- [ ] **Step 2: Make it pass** — in `lib/routeAccess.ts`, after the webhook line:

```ts
  // Visitors compare plans before they have an account. Exact, for the same
  // prefix reason as above.
  if (pathname === '/pricing') return 'pass';
```

Run the test again → PASS.

- [ ] **Step 3: `app/pricing/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell, TopBar, Column } from '@/components/ui/Shell';
import AvatarMenu from '@/components/shell/AvatarMenu';
import Button from '@/components/ui/Button';
import { useAuthSession } from '@/lib/authClient';
import { PLANS } from '@/lib/plans';
import { PRICE_DISPLAY, type BillingInterval, type BillingStatusPayload } from '@/lib/billing';
import { formatBytes } from '@/lib/design';
import { openPortal, startCheckout } from '@/components/billing/checkout';

const SIGNUP = `/signup?${new URLSearchParams({ callbackUrl: '/pricing' })}`;

export default function PricingPage() {
  const { status: authStatus } = useAuthSession();
  const signedIn = authStatus === 'authenticated';
  const [interval, setInterval] = useState<BillingInterval>('year');
  const [billing, setBilling] = useState<BillingStatusPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    fetch('/api/billing/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setBilling(d))
      .catch(() => {});
  }, [signedIn]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  const free = PLANS.free;
  const standard = PLANS.standard;
  const onStandard = billing?.plan === 'standard';
  const price = PRICE_DISPLAY[interval];

  // Standard card's button, by viewer state (spec §1).
  let standardCta: React.ReactNode;
  if (!signedIn) {
    standardCta = <Link href={SIGNUP} className="block"><Button className="w-full">Get Standard</Button></Link>;
  } else if (onStandard) {
    standardCta =
      billing?.action === 'manage' ? (
        <Button variant="secondary" className="w-full" disabled={busy} onClick={() => run(openPortal)}>
          {busy ? 'Opening…' : 'Manage billing'}
        </Button>
      ) : (
        <Button variant="secondary" className="w-full" disabled>Current plan</Button>
      );
  } else if (billing && billing.action === 'none') {
    standardCta = <Button variant="secondary" className="w-full" disabled>Coming soon</Button>;
  } else {
    standardCta = (
      <Button className="w-full" disabled={busy || !billing} onClick={() => run(() => startCheckout(interval))}>
        {busy ? 'Opening…' : 'Upgrade'}
      </Button>
    );
  }

  const freeCta = !signedIn ? (
    <Link href={SIGNUP} className="block"><Button variant="secondary" className="w-full">Start free</Button></Link>
  ) : (
    <Button variant="secondary" className="w-full" disabled>{onStandard ? 'Free' : 'Current plan'}</Button>
  );

  return (
    <Shell>
      <TopBar
        right={
          signedIn ? (
            <AvatarMenu />
          ) : (
            <Link href="/login" className="text-[13px] font-bold !text-stiko-secondary hover:!text-stiko-ink">
              Sign in
            </Link>
          )
        }
      />
      <Column width={860}>
        <div className="py-10 text-center">
          <h1 className="text-[30px] font-extrabold text-stiko-ink">Plans</h1>
          <p className="mt-2 text-[14px] text-stiko-muted">Collaborators are always free. Only the project owner needs a plan.</p>

          <div className="mt-6 inline-flex rounded-pill bg-white p-1 shadow-stiko-panel" role="tablist">
            {(['month', 'year'] as const).map((i) => (
              <button
                key={i}
                role="tab"
                aria-selected={interval === i}
                onClick={() => setInterval(i)}
                className={`rounded-pill px-4 py-[7px] text-[12.5px] font-bold transition ${
                  interval === i ? 'bg-stiko-tint text-stiko-ink' : 'text-stiko-muted hover:text-stiko-ink'
                }`}
              >
                {i === 'month' ? 'Monthly' : 'Yearly · save 10%'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <PlanCard
            name={free.label}
            price="$0"
            note="Free forever"
            features={[`${free.maxProjects} projects`, `${formatBytes(free.storageBytes)} storage`, 'Unlimited collaborators']}
            cta={freeCta}
          />
          <PlanCard
            highlight
            name={standard.label}
            price={`${price.perMonth}/mo`}
            note={price.note}
            features={['Unlimited projects', `${formatBytes(standard.storageBytes)} storage`, 'Unlimited collaborators']}
            cta={standardCta}
          />
        </div>
        {error && <p className="mt-3 text-center text-[12.5px] text-red-600">{error}</p>}

        <dl className="mx-auto mt-10 max-w-[560px] space-y-4 pb-12 text-[13px]">
          <Faq q="Do collaborators need to pay?" a="No. Reviewers and collaborators you invite are free on every plan. Storage and projects count against the project owner." />
          <Faq q="Can I cancel?" a="Any time, from Plan & billing. You keep Standard until the end of the period you paid for." />
          <Faq q="What if I go over a Free limit?" a="Nothing is deleted. You can still view, comment and download; you just can't add projects or upload until you're back under the limit or upgrade." />
        </dl>
      </Column>
    </Shell>
  );
}

function PlanCard({
  name, price, note, features, cta, highlight = false,
}: {
  name: string; price: string; note: string; features: string[]; cta: React.ReactNode; highlight?: boolean;
}) {
  return (
    <section
      className={`flex flex-col rounded-panel bg-white px-6 py-6 shadow-stiko-panel ${
        highlight ? 'ring-2 ring-stiko-primary' : ''
      }`}
    >
      <h2 className="text-[15px] font-extrabold text-stiko-ink">{name}</h2>
      <div className="mt-3 text-[28px] font-extrabold text-stiko-ink">{price}</div>
      <div className="text-[12px] text-stiko-muted">{note}</div>
      <ul className="my-5 flex-1 space-y-2 text-[13px] text-stiko-secondary">
        {features.map((f) => (
          <li key={f} className="flex gap-2"><span className="text-stiko-primary">✓</span>{f}</li>
        ))}
      </ul>
      {cta}
    </section>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <dt className="font-bold text-stiko-ink">{q}</dt>
      <dd className="mt-1 text-stiko-muted">{a}</dd>
    </div>
  );
}
```

Checks before committing:
- `Button` already accepts and merges `className` (verified: `components/ui/Button.tsx:15,51,70`).
- `Column`'s `width` is a number in px (it is: `width: number`).
- "save 10%": $216 vs $240 is exactly 10%. If prices ever change this label must too — derive it if `PRICE_DISPLAY` gains numeric amounts; for now it is a literal tied to the spec's prices.
- `formatBytes(2 * 1024 ** 3)` must print "2 GB" (check `lib/design.ts`); if it prints "2.0 GB" or "2 GiB", that is what the meters already show — keep it consistent, don't special-case.

- [ ] **Step 4: Test, typecheck, commit**

Run: `npx tsc --noEmit -p . && npm test`

```bash
git add lib/routeAccess.ts scripts/tests/routeAccess.test.mjs app/pricing/page.tsx
git commit -m "feat(billing): public /pricing page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Dashboard banner and post-checkout toast

**Files:**
- Create: `components/home/PlanBanner.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `/api/billing/status` (`plan`, `limitsEnforced`), `/api/me/usage` (`AccountUsage`), `openUpgradeDialog(null)`, `useToast().toast(message)`.

- [ ] **Step 1: `components/home/PlanBanner.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { openUpgradeDialog } from '@/lib/planLimitClient';
import { formatBytes } from '@/lib/design';
import type { AccountUsage } from '@/lib/queries';
import type { BillingStatusPayload } from '@/lib/billing';

const DISMISS_KEY = 'stiko:plan-banner-dismissed';

/**
 * A slim nudge for Free owners near a limit. Checks billing first and only
 * then pays for the usage query, so Standard accounts never run it.
 */
export default function PlanBanner() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY)) return;
    } catch {}
    let cancelled = false;
    (async () => {
      const status: BillingStatusPayload | null = await fetch('/api/billing/status')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!status || status.plan !== 'free' || !status.limitsEnforced) return;
      const usage: AccountUsage | null = await fetch('/api/me/usage')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!usage || cancelled) return;
      const { plan, storage, projects } = usage;
      if (projects.max !== null && projects.count >= projects.max) {
        setMessage(`You're using ${projects.count} of ${projects.max} Free projects.`);
      } else if (storage.totalBytes >= plan.storageBytes * 0.8) {
        setMessage(`You've used ${formatBytes(storage.totalBytes)} of ${formatBytes(plan.storageBytes)} storage.`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!message) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {}
    setMessage(null);
  };

  return (
    <div className="flex items-center gap-3 rounded-panel bg-stiko-tint px-4 py-[10px] text-[12.5px] text-stiko-ink">
      <span className="flex-1">{message}</span>
      <button onClick={() => openUpgradeDialog(null)} className="font-bold text-stiko-primary hover:underline">
        Upgrade
      </button>
      <Link href="/pricing" className="font-semibold !text-stiko-secondary hover:!text-stiko-ink">
        See plans
      </Link>
      <button onClick={dismiss} aria-label="Dismiss" className="text-stiko-muted hover:text-stiko-ink">
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Mount it and add the toast in `app/page.tsx`**

1. Find where the populated dashboard renders below `<TopBar …/>` (read the JSX return; the banner goes directly under the TopBar, only in the populated / first-run branches — not in the error or skeleton branch). Render `<PlanBanner />` there.
2. Post-checkout toast — add near the other effects:

```tsx
  const { toast } = useToast();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('billing');
    if (!result) return;
    if (result === 'success') toast("You're on Standard");
    // Strip the param so a refresh doesn't repeat the toast.
    router.replace('/');
  }, [router, toast]);
```

If `app/page.tsx` already destructures `useToast()`, reuse it instead of adding a second call. Imports: `PlanBanner` from `@/components/home/PlanBanner`, `useToast` from `@/components/ui/Toast` (if not present).

Note: the webhook may land a second after the return redirect. `/api/billing/return` already syncs the subscription before redirecting, so the plan is Standard by the time the dashboard loads; the banner therefore will not show for a fresh subscriber.

- [ ] **Step 3: Typecheck, test, commit**

Run: `npx tsc --noEmit -p . && npm test`

```bash
git add components/home/PlanBanner.tsx app/page.tsx
git commit -m "feat(plans): dashboard plan banner and post-checkout toast

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Verification

No production DB, no staging. Three layers.

- [ ] **Step 1: Full static checks**

Run: `npx tsc --noEmit -p . && npm test && npm run lint && npm run build`
Expected: all pass. Record the test count.

- [ ] **Step 2: PGlite route harness** — rebuild in the session scratchpad per the `stiko-pglite-sql-harness` memory (PGlite + loader hook; stubs for `@/lib/db`, `@/lib/auth`, `server-only`, `@/lib/s3` with `getUploadPresignedUrl` returning `'https://r2.test/put?len=' + contentLength` and `headObjectSize` returning a configurable value). Set `process.env.BILLING_ENABLED='true'` and `STRIPE_SECRET_KEY='sk_test_x'`. Seed: owner A (free), collaborator B (participant with canUpload on A's package), user C (standard). Assert:
  1. A creates projects 1 and 2 → 201; 3rd → 402 `{limit:'projects', isOwner:true, used:2, max:2}`.
  2. A trashes one, creates another (2 active) → 201; restoring the trashed one → 402.
  3. C creates a 3rd project → 201.
  4. Upload presign for A's version with `fileSize: 2 GiB - used` → 200 and URL carries the length; `+1` byte → 402 `{limit:'storage', isOwner:true}`.
  5. Same over-limit presign as B → 402 with `isOwner:false`.
  6. Missing / zero / `"12"` (string) `fileSize` → 400.
  7. Complete with `headObjectSize` stub returning 1234 and body `fileSize: 99` → row `file_size = 1234`; stub returning null → 400.
  8. Attachment presign over the limit → 402.
  9. With `BILLING_ENABLED` unset, cases 1, 4 and 8 all succeed.
  Close PGlite at the end (`pg.close()`) or node will not exit.

- [ ] **Step 3: Browser pass** on `npm run build && npm run start` (not `next dev`; see the local-visual-verification memory for sign-in and the `/api/home` stub):
  - `/pricing` signed out: both cards, toggle changes $20 ↔ $18, "Get Standard" goes to `/signup?callbackUrl=%2Fpricing`.
  - `/pricing` signed in on Free: Upgrade present; signed in on hand-granted Standard: "Current plan".
  - `/settings/billing`: plan badge, meters, buttons match the plan; rail shows "Plan & billing" active.
  - With billing env on locally and a Free test user at 2 projects: New project → dialog with Monthly/Yearly; See plans → `/pricing`.
  - Avatar menu: "Plan & billing" and "Compare plans" links work.

- [ ] **Step 4: Fix anything found, re-run Step 1, commit fixes with explicit paths.**

---

### Task 10: Go-live (handed to the user; nothing here is done by the agent without being asked)

1. **Grant existing accounts Standard** — must run BEFORE the merge deploys, or co-founder accounts with >2 projects are blocked. One paste block, Terminal, `~/Desktop/STIKO-main`:

```bash
cd ~/Desktop/STIKO-main && DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`UPDATE users SET plan = 'standard' WHERE plan = 'free' AND stripe_subscription_id IS NULL RETURNING email\`
  .then(r => console.log('granted Standard to', r.length, 'accounts'));
"
```

2. **Merge and push** (user, or agent only if explicitly asked):

```bash
git checkout main && git pull --ff-only && git merge --no-ff feature/pricing-plan-limits -m "merge: pricing page, plan limits and upgrade prompts" && git push origin main && git branch -d feature/pricing-plan-limits
```

3. **Webflow**: after the deploy is live, repoint the 15 Pricing links on www.stiko.design to `https://app.stiko.design/pricing` via the Webflow MCP, then publish (see the `stiko-webflow-marketing-site` memory for the publish traps).

4. **Rollback**: delete `BILLING_ENABLED` in Vercel and redeploy (buttons hide and limits switch off together); or `git revert -m 1 <merge sha> && git push origin main`.
