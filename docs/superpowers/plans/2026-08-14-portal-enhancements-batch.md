# Portal Enhancements Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four independent review-view enhancements — a brand-coloured loading cube, markup on a pending comment attachment, a hard reject for unsupported upload formats, and an optional "what changed" note when publishing a version.

**Architecture:** Two tasks add pure `lib/` modules with real unit tests (format whitelist, email body). Four tasks wire existing UI to them or extend the annotation session that already exists. Nothing new is invented for the markup feature — `AnnotationCanvas` already takes a background image and flattens it with the markup, so the attachment simply becomes that background.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, react-konva, `node --test` over TypeScript sources (Node v25 strips types natively).

## Global Constraints

- **Brand primary is `#5B60FF`.** Never `#004dff`, never `border-blue-600`. Face fill for the cube is `rgba(91, 96, 255, 0.2)`.
- **Tests are `node --test scripts/tests/*.mjs`,** importing `.ts` sources directly (e.g. `import { x } from '../../lib/x.ts'`). Only pure `lib/` modules are unit-tested — this repo has **no React test harness** (no jest, no RTL). UI tasks are verified by `npx tsc --noEmit` plus a browser check.
- **Booting the app locally** needs two throwaway env vars, because `middleware.ts` imports `lib/auth` → `lib/db`, which throws at module load without them:
  ```
  AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' npm run dev
  ```
  Never write a `.env.local` — it would shadow real config later.
- **Harness routes must live under `/portal/…`** — `middleware.ts` lets that prefix through unauthenticated, and a static segment beats the `[id]` dynamic one. After deleting a harness route, `rm -rf .next/types/app/portal/<name>` or `tsc --noEmit` fails on stale generated types.
- **`dwg` and `dxf` stay whitelisted** despite having no viewer and no conversion job. This is a decision, not an oversight — the import pipeline is next. Do not "fix" it.
- **UI copy says "package", never "portal".** Code identifiers say `portal`.
- **Every task ends green:** `npm test` must pass and `npx tsc --noEmit` must be clean before committing.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `lib/fileFormats.ts` | The single whitelist of uploadable extensions, plus the helpers that split a file list by it. Pure, no DOM, no React. |
| `scripts/tests/fileFormats.test.mjs` | Unit tests for the above. |
| `scripts/tests/email.test.mjs` | Unit tests for `newVersionEmail`'s optional note. |
| `components/ui/LoadingCube.tsx` | The brand loading indicator. Presentation only. |

**Modified:**

| File | Change |
| --- | --- |
| `app/globals.css` | Cube keyframes and face transforms, beside `.stiko-pin`. |
| `components/ui/FileDropzone.tsx` | Gate `addFiles()` on the whitelist; rejection banner. |
| `lib/email.ts` | `newVersionEmail` takes an optional changelog. |
| `components/portal/NewVersionDrawer.tsx` | Changelog no longer required. |
| `app/api/versions/publish/route.ts` | Changelog no longer required; stores NULL. |
| `components/portal/CommentComposer.tsx` | Image thumbnails become markup buttons. |
| `app/portal/[id]/page.tsx` | Attachment annotation session; four cube swaps. |
| `components/viewers/ViewerContainer.tsx` | One cube swap. |
| `components/portal/CommentsPanel.tsx` | One cube swap. |

**Task order:** 1 → 2 (2 consumes 1), 3 → 4 (4 consumes 3), 5 and 6 independent. Tasks 1–2, 3–4, 5, 6 are three independent tracks and may be done in any order relative to each other.

---

## Task 1: The format whitelist

**Files:**
- Create: `lib/fileFormats.ts`
- Test: `scripts/tests/fileFormats.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SUPPORTED_EXTENSIONS: ReadonlySet<string>` — lowercase, no leading dot
  - `extensionOf(filename: string): string`
  - `isSupportedFilename(filename: string): boolean`
  - `partitionBySupport<T>(files: T[], nameOf: (file: T) => string): { accepted: T[]; rejected: T[] }`
  - `ACCEPT_ATTRIBUTE: string`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/fileFormats.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED_EXTENSIONS,
  extensionOf,
  isSupportedFilename,
  partitionBySupport,
  ACCEPT_ATTRIBUTE,
} from '../../lib/fileFormats.ts';

// Mirrors the branches in components/viewers/ViewerContainer.tsx. Stated
// literally rather than imported so that quietly deleting a viewer branch
// breaks this test instead of silently narrowing the whitelist.
const VIEWABLE = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp',
  'mp4', 'webm', 'mov', 'avi', 'mkv',
  'pdf',
  'glb', 'gltf', 'obj', 'stl', '3ds', 'ply', 'dae', 'step', 'stp',
];

test('every format the viewer can actually render is accepted', () => {
  for (const ext of VIEWABLE) {
    assert.equal(isSupportedFilename(`drawing.${ext}`), true, `.${ext}`);
  }
});

test('dwg and dxf are accepted even though nothing renders them yet', () => {
  // A decision, not an oversight: the import pipeline lands next, and gating
  // them now would mean unpicking the gate then. They upload and download;
  // the viewport shows its unsupported-type message.
  assert.equal(isSupportedFilename('plan.dwg'), true);
  assert.equal(isSupportedFilename('plan.dxf'), true);
});

test('extension matching ignores case', () => {
  assert.equal(isSupportedFilename('DRAWING.PDF'), true);
  assert.equal(isSupportedFilename('Model.GLB'), true);
});

test('office and archive formats are rejected', () => {
  for (const name of ['spec.docx', 'costs.xlsx', 'deck.pptx', 'bundle.zip', 'notes.txt']) {
    assert.equal(isSupportedFilename(name), false, name);
  }
});

test('a file with no extension is rejected', () => {
  assert.equal(extensionOf('README'), '');
  assert.equal(isSupportedFilename('README'), false);
});

test('a dotfile has no extension and is rejected', () => {
  // '.DS_Store' is a hidden file, not a file of type DS_Store. macOS puts one
  // in every folder, so a dropped folder hits this on the very first try.
  assert.equal(extensionOf('.DS_Store'), '');
  assert.equal(isSupportedFilename('.DS_Store'), false);
});

test('a double extension is judged on its last segment', () => {
  assert.equal(extensionOf('archive.tar.gz'), 'gz');
  assert.equal(isSupportedFilename('archive.tar.gz'), false);
  assert.equal(isSupportedFilename('model.final.glb'), true);
});

test('a dot in a folder name is not mistaken for an extension', () => {
  // FileDropzone carries paths like "Rev1.2/sheet", and lastIndexOf('.') over
  // the whole path would read the extension as "2/sheet".
  assert.equal(extensionOf('Rev1.2/sheet'), '');
  assert.equal(extensionOf('Rev1.2/sheet.pdf'), 'pdf');
});

test('partitionBySupport splits without losing or reordering anything', () => {
  const files = [
    { name: 'a.pdf' },
    { name: 'b.docx' },
    { name: 'c.glb' },
    { name: 'd.zip' },
    { name: 'e.png' },
  ];
  const { accepted, rejected } = partitionBySupport(files, (f) => f.name);

  assert.deepEqual(accepted.map((f) => f.name), ['a.pdf', 'c.glb', 'e.png']);
  assert.deepEqual(rejected.map((f) => f.name), ['b.docx', 'd.zip']);
  assert.equal(accepted.length + rejected.length, files.length);
});

test('partitionBySupport handles the all-accepted and all-rejected cases', () => {
  const ok = partitionBySupport([{ name: 'a.pdf' }], (f) => f.name);
  assert.deepEqual(ok.rejected, []);

  const bad = partitionBySupport([{ name: 'a.docx' }], (f) => f.name);
  assert.deepEqual(bad.accepted, []);
});

test('the accept attribute lists every supported extension, dotted', () => {
  const parts = ACCEPT_ATTRIBUTE.split(',');
  assert.equal(parts.length, SUPPORTED_EXTENSIONS.size);
  for (const part of parts) {
    assert.match(part, /^\.[a-z0-9]+$/);
    assert.equal(SUPPORTED_EXTENSIONS.has(part.slice(1)), true, part);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | tail -20`

Expected: FAIL — `Cannot find module '.../lib/fileFormats.ts'`.

- [ ] **Step 3: Write the implementation**

Create `lib/fileFormats.ts`:

```ts
/**
 * Which upload formats the review view can do something with.
 *
 * There were three lists before this one and no gate anywhere:
 * ViewerContainer branches on its own extension arrays, fileChips.ts colours a
 * slightly different set, and the dropzone hint copy named a fourth. An
 * unsupported file uploaded fine, registered as a package file, and only
 * failed at the very end — in the viewport, for the reviewer rather than the
 * person who uploaded it. The dropzone gates on THIS list.
 */

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
const VIDEO = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
const DOCUMENT = ['pdf'];
const MODEL = ['glb', 'gltf', 'obj', 'stl', '3ds', 'ply', 'dae', 'step', 'stp'];

// No viewer branch and no conversion job — createStepToGlbJob is STEP-only.
// Whitelisted deliberately so the import pipeline work lands without a format
// gate to unpick first. Until then these upload and download normally and the
// viewport shows its unsupported-type message.
const CAD = ['dwg', 'dxf'];

export const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  ...IMAGE,
  ...VIDEO,
  ...DOCUMENT,
  ...MODEL,
  ...CAD,
]);

/**
 * The lowercased extension without its dot, or '' when there isn't one.
 *
 * Two cases the naive `split('.').pop()` gets wrong, and both actually occur:
 * a leading dot is a hidden file rather than an extension ('.DS_Store' lands in
 * every dropped macOS folder), and the dropzone carries paths, so a dot in a
 * folder name ('Rev1.2/sheet') must not be read as one.
 */
export function extensionOf(filename: string): string {
  const base = filename.slice(filename.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function isSupportedFilename(filename: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extensionOf(filename));
}

/** Split a list in two, preserving input order within each side. */
export function partitionBySupport<T>(
  files: T[],
  nameOf: (file: T) => string
): { accepted: T[]; rejected: T[] } {
  const accepted: T[] = [];
  const rejected: T[] = [];
  for (const file of files) {
    if (isSupportedFilename(nameOf(file))) accepted.push(file);
    else rejected.push(file);
  }
  return { accepted, rejected };
}

/**
 * For an <input type="file"> accept attribute, so the OS picker pre-filters.
 * Belt and braces only — drag-and-drop ignores `accept` entirely, which is why
 * partitionBySupport still has to run on every path.
 */
export const ACCEPT_ATTRIBUTE = Array.from(SUPPORTED_EXTENSIONS)
  .map((ext) => `.${ext}`)
  .join(',');
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -20`

Expected: PASS, with the total count risen from 96 to 107.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add lib/fileFormats.ts scripts/tests/fileFormats.test.mjs
git commit -m "feat(upload): one whitelist of supported upload formats"
```

---

## Task 2: Reject unsupported files at the dropzone

**Files:**
- Modify: `components/ui/FileDropzone.tsx`

**Interfaces:**
- Consumes: `partitionBySupport`, `extensionOf`, `ACCEPT_ATTRIBUTE` from `lib/fileFormats.ts` (Task 1).
- Produces: nothing new. `FileDropzone`'s public props are unchanged, so `app/new/page.tsx` and `NewVersionDrawer.tsx` both get the gate for free.

- [ ] **Step 1: Import the whitelist**

In `components/ui/FileDropzone.tsx`, after the `FileChip` import at line 4:

```tsx
import { FileChip } from './Primitives';
import {
  ACCEPT_ATTRIBUTE,
  extensionOf,
  partitionBySupport,
} from '@/lib/fileFormats';
```

- [ ] **Step 2: Gate `addFiles` and track what was refused**

Replace the `isDragging` state declaration and the `addFiles` callback (lines 81–88) with:

```tsx
  const [isDragging, setIsDragging] = useState(false);
  // Names refused by the last add, shown until the next one. Drag-drop, the
  // file picker and the folder picker all funnel through addFiles, so this is
  // the only gate the feature needs.
  const [rejected, setRejected] = useState<string[]>([]);

  const addFiles = useCallback(
    (newFiles: FileWithPath[]) => {
      const { accepted, rejected: refused } = partitionBySupport(
        newFiles,
        (f) => f.file.name
      );
      setRejected(refused.map((f) => f.file.name));
      if (accepted.length > 0) onFilesChange([...files, ...accepted]);
    },
    [files, onFilesChange]
  );
```

- [ ] **Step 3: Tell the OS picker, and tell the user before they pick**

Change the default `hint` on line 76 to name the real list:

```tsx
  hint = 'Folders keep their structure · PDF, DWG, DXF, GLB, STEP, OBJ, STL, images, video',
```

Add `accept` to the **file** input (around line 231). Leave the folder input without it — `webkitdirectory` plus `accept` hides non-matching files inside a folder in some browsers, which makes a folder look empty; the JS gate covers that path anyway.

```tsx
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          onChange={handleFileInput}
          className="hidden"
        />
```

- [ ] **Step 4: Render the rejection banner**

Insert this directly after the closing `</div>` of the drop target (after line 246, before the `{files.length > 0 && (` block):

```tsx
      {rejected.length > 0 && (
        <div
          role="alert"
          className="mt-3 rounded-[10px] px-[13px] py-[11px] text-[12.5px]"
          style={{ background: '#FFE2E2', color: '#B23A52' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold">
                {rejected.length === 1
                  ? '1 file can’t be added'
                  : `${rejected.length} files can’t be added`}
              </p>
              <p className="mt-[3px] leading-[1.5]">
                Stiko can’t open{' '}
                {rejected.length === 1 ? 'this format' : 'these formats'} yet.
                Everything else was added.
              </p>
              <ul className="mt-[6px] flex flex-col gap-[2px]">
                {rejected.slice(0, 5).map((name, i) => (
                  <li key={`${name}-${i}`} className="truncate font-medium">
                    {name}
                    <span className="ml-1 opacity-70">
                      ({extensionOf(name) ? `.${extensionOf(name)}` : 'no extension'})
                    </span>
                  </li>
                ))}
                {rejected.length > 5 && (
                  <li className="opacity-70">+{rejected.length - 5} more</li>
                )}
              </ul>
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={(e) => {
                e.stopPropagation();
                setRejected([]);
              }}
              className="shrink-0 opacity-60 transition hover:opacity-100"
            >
              <svg
                className="h-[15px] w-[15px]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
              >
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
```

A banner rather than a toast on purpose: a dropped folder can refuse forty files at once, and the toast at `components/ui/Toast.tsx` is bottom-left and self-destructs after five seconds.

- [ ] **Step 5: Type-check and test**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -8`

Expected: no tsc output; 107 tests pass.

- [ ] **Step 6: Verify in the browser**

```bash
AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' npm run dev
```

Open `http://localhost:3000/new`. Confirm all four:
1. Dropping a `.docx` alongside a `.pdf` adds only the PDF and shows the banner naming the `.docx`.
2. Dismissing the banner hides it; dropping a supported file next clears it too.
3. The browse-files picker only offers supported types.
4. Dropping a folder containing `.DS_Store` refuses that file by name rather than crashing.

- [ ] **Step 7: Commit**

```bash
git add components/ui/FileDropzone.tsx
git commit -m "feat(upload): refuse unsupported formats at the dropzone"
```

---

## Task 3: An optional note in the new-version email

**Files:**
- Modify: `lib/email.ts` (the `newVersionEmail` function, ~line 101)
- Test: `scripts/tests/email.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `newVersionEmail(opts: { publisherName: string; packageName: string; versionNumber: number; changelog?: string | null; link: string }): Omit<EmailMessage, 'to'>` — the `changelog` field becomes optional and nullable. Task 4 relies on this.

`lib/email.ts` reads only `process.env.EMAIL_FROM` at module scope, with a fallback, so it imports cleanly into a test.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/email.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newVersionEmail } from '../../lib/email.ts';

const BASE = {
  publisherName: 'Dana',
  packageName: 'Level 3 Framing',
  versionNumber: 4,
  link: 'https://stiko.example/portal/abc',
};

test('a note is quoted under a "What changed" heading', () => {
  const mail = newVersionEmail({ ...BASE, changelog: 'Shear tabs added at grid line 4' });

  assert.match(mail.body, /What changed:/);
  assert.match(mail.body, /"Shear tabs added at grid line 4"/);
  assert.match(mail.body, /Review it here: https:\/\/stiko\.example\/portal\/abc/);
});

test('no note means no heading and no stray empty quotes', () => {
  // The note became optional on 2026-08-14. Before that this function
  // interpolated unconditionally, so a missing note emailed a bare "".
  for (const changelog of [null, undefined, '', '   ']) {
    const mail = newVersionEmail({ ...BASE, changelog });

    assert.doesNotMatch(mail.body, /What changed/, `changelog=${JSON.stringify(changelog)}`);
    assert.doesNotMatch(mail.body, /""/, `changelog=${JSON.stringify(changelog)}`);
    assert.match(mail.body, /Dana published version 4 of Level 3 Framing\./);
    assert.match(mail.body, /Review it here: https:\/\/stiko\.example\/portal\/abc/);
  }
});

test('the subject line is the same with or without a note', () => {
  const withNote = newVersionEmail({ ...BASE, changelog: 'Anything' });
  const without = newVersionEmail({ ...BASE, changelog: null });

  assert.equal(withNote.subject, without.subject);
  assert.equal(
    withNote.subject,
    'Version 4 of Level 3 Framing is ready to review'
  );
});

test('a note is trimmed before it is quoted', () => {
  const mail = newVersionEmail({ ...BASE, changelog: '  Trimmed  ' });
  assert.match(mail.body, /"Trimmed"/);
});

test('the body keeps a blank line before the review link either way', () => {
  // Readability of the plain-text mail: without the blank line the link runs
  // straight onto the sentence above it.
  const withNote = newVersionEmail({ ...BASE, changelog: 'Anything' });
  const without = newVersionEmail({ ...BASE, changelog: null });

  assert.match(withNote.body, /\n\nReview it here:/);
  assert.match(without.body, /\n\nReview it here:/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/email.test.mjs 2>&1 | tail -20`

Expected: FAIL on "no note means no heading and no stray empty quotes" — the current body always contains `What changed:` and, with an empty note, `""`.

- [ ] **Step 3: Write the implementation**

Replace `newVersionEmail` in `lib/email.ts` (lines 101–124) with:

```ts
export function newVersionEmail(opts: {
  publisherName: string;
  packageName: string;
  versionNumber: number;
  /**
   * Optional since 2026-08-14. When absent the whole "What changed" block is
   * dropped — interpolating it unconditionally emailed a bare pair of quotes.
   */
  changelog?: string | null;
  link: string;
}): Omit<EmailMessage, 'to'> {
  const note = opts.changelog?.trim();

  // Built by pushing rather than filter(Boolean) like inviteEmail above: the
  // blank separators here are meaningful, and filter(Boolean) eats them.
  const lines = [
    `${opts.publisherName} published version ${opts.versionNumber} of ${opts.packageName}.`,
  ];
  if (note) lines.push(``, `What changed:`, `"${note}"`);
  lines.push(``, `Review it here: ${opts.link}`);

  return {
    subject: `Version ${opts.versionNumber} of ${opts.packageName} is ready to review`,
    body: lines.join('\n'),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -8`

Expected: PASS, with five more tests than before this task (112 if Tasks 1–2 already landed, 101 if not).

- [ ] **Step 5: Commit**

```bash
git add lib/email.ts scripts/tests/email.test.mjs
git commit -m "feat(email): drop the What changed block when there is no note"
```

---

## Task 4: Make the "what changed" note optional

**Files:**
- Modify: `components/portal/NewVersionDrawer.tsx` (lines 88–99, 199–211)
- Modify: `app/api/versions/publish/route.ts` (lines 8–31, 66–70, 96–130)

**Interfaces:**
- Consumes: `newVersionEmail` accepting `changelog?: string | null` (Task 3).
- Produces: nothing new. `POST /api/versions/publish` now accepts a body whose `changelog` is `string | null | undefined`.

Both files carry comments arguing the note *must* be required. Rewrite them to record the new reasoning — do not delete them silently.

- [ ] **Step 1: Drop the client-side guard**

In `components/portal/NewVersionDrawer.tsx`, replace the opening of `publish` (lines 88–99) with:

```tsx
  const publish = async () => {
    setError(null);

    // The note is optional: a self-evident change, or a publish under time
    // pressure, should not be blocked on prose. Files are still required —
    // an empty version is the half-version reviewers must never receive.
    if (files.length === 0) {
      setError('Add at least one file.');
      return;
    }
```

- [ ] **Step 2: Send null rather than an empty string**

In the same file, line 137 inside `finishPublish`:

```tsx
      body: JSON.stringify({
        versionId,
        changelog: changelog.trim() || null,
        notify,
      }),
```

"No note" must be one value in the database, not two.

- [ ] **Step 3: Relabel the field**

Replace the `Field` block (lines 199–211) with:

```tsx
        <Field label="What changed" hint="optional">
          <Textarea
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            rows={3}
            autoFocus
            className="min-h-[78px]"
            placeholder="Shear tabs added at grid line 4"
          />
        </Field>
        <p className="-mt-3 text-[11.5px] text-stiko-faint">
          Shown on the version and in the notification your reviewers receive.
        </p>
```

Only `hint` changes. The helper line stays — it is now an incentive rather than a rule.

- [ ] **Step 4: Drop the server-side 400**

In `app/api/versions/publish/route.ts`, replace the doc comment and the guard (lines 8–31) with:

```ts
/**
 * Publish a draft version.
 *
 * This is the atomic step from 2d — the version becomes visible to reviewers
 * only once, with every file already registered. A partial upload never
 * publishes, because the client only calls this after all files land.
 *
 * The changelog was required until 2026-08-14 and is now optional. What is
 * still enforced is that the version has files: a note is a courtesy, an empty
 * version is a bug reviewers have to chase.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { versionId, changelog, notify = true } = await request.json();

  // One representation of "no note" — NULL. Every display site already guards
  // on null, so an empty string would be a second, unguarded one.
  const note =
    typeof changelog === 'string' && changelog.trim() ? changelog.trim() : null;
```

- [ ] **Step 5: Store and forward the nullable note**

Three call sites in the same file, all currently `changelog.trim()`.

The UPDATE (lines 66–70):

```ts
  await sql`
    UPDATE versions
    SET published_at = NOW(), changelog = ${note}
    WHERE id = ${versionId}
  `;
```

The notification excerpt (around line 102) — the surrounding `INSERT` is unchanged, only the `excerpt` value:

```ts
          ${`Version ${version.versionNumber} published in ${packageName}`},
          ${note}, ${link}
```

The email options (around line 126):

```ts
          ...newVersionEmail({
            publisherName: session.user.name ?? 'Someone',
            packageName,
            versionNumber: Number(version.versionNumber),
            changelog: note,
            link,
          }),
```

The `notifications.excerpt` column is `TEXT` and nullable, and `NotificationTray.tsx` already renders it as `{row.excerpt && …}`. No migration.

- [ ] **Step 6: Type-check and test**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -8`

Expected: no tsc output; 112 tests pass.

- [ ] **Step 7: Verify the reverse case still works**

Read `app/new/page.tsx` line 157 and confirm it still reads `changelog: changelog.trim() || 'First version'`. That flow creates a package rather than publishing into one and is deliberately untouched — this step is a check, not an edit.

- [ ] **Step 8: Commit**

```bash
git add components/portal/NewVersionDrawer.tsx app/api/versions/publish/route.ts
git commit -m "feat(portal): the what-changed note is now optional"
```

---

## Task 5: The loading cube

**Files:**
- Create: `components/ui/LoadingCube.tsx`
- Modify: `app/globals.css`
- Modify: `app/portal/[id]/page.tsx` (lines ~649, ~714)
- Modify: `components/viewers/ViewerContainer.tsx` (line ~98)
- Modify: `components/portal/CommentsPanel.tsx` (line ~579)

**Interfaces:**
- Consumes: nothing.
- Produces: `default export LoadingCube({ size?: number; label?: string })` from `@/components/ui/LoadingCube`. Default size 44, default label `'Loading…'`.

- [ ] **Step 1: Add the CSS**

Append to `app/globals.css`:

```css
/* Loading cube — six faces folded into a solid, tumbling on two axes.
   Lives here rather than in Tailwind classes for the same reason .stiko-pin
   does: preserve-3d plus six per-face 3D transforms has no readable utility
   form. The depth offsets come off --cube-size instead of the source
   snippet's hardcoded 22px, so a 28px cube still closes at the seams. */
.stiko-cube {
  position: relative;
  width: var(--cube-size, 44px);
  height: var(--cube-size, 44px);
  transform-style: preserve-3d;
  animation: stiko-cube-tumble 2s infinite ease;
}
.stiko-cube > div {
  position: absolute;
  width: 100%;
  height: 100%;
  background-color: rgba(91, 96, 255, 0.2);
  border: 2px solid #5b60ff;
}
.stiko-cube > div:nth-of-type(1) {
  transform: translateZ(calc(var(--cube-size, 44px) / -2)) rotateY(180deg);
}
.stiko-cube > div:nth-of-type(2) {
  transform: rotateY(-270deg) translateX(50%);
  transform-origin: top right;
}
.stiko-cube > div:nth-of-type(3) {
  transform: rotateY(270deg) translateX(-50%);
  transform-origin: center left;
}
.stiko-cube > div:nth-of-type(4) {
  transform: rotateX(90deg) translateY(-50%);
  transform-origin: top center;
}
.stiko-cube > div:nth-of-type(5) {
  transform: rotateX(-90deg) translateY(50%);
  transform-origin: bottom center;
}
.stiko-cube > div:nth-of-type(6) {
  transform: translateZ(calc(var(--cube-size, 44px) / 2));
}

@keyframes stiko-cube-tumble {
  0% {
    transform: rotate(45deg) rotateX(-25deg) rotateY(25deg);
  }
  50% {
    transform: rotate(45deg) rotateX(-385deg) rotateY(25deg);
  }
  100% {
    transform: rotate(45deg) rotateX(-385deg) rotateY(385deg);
  }
}

/* A continuously tumbling 3D object is precisely what this query is for. Hold
   the static pose — the cube still reads as "something is happening" because
   it only ever appears while something is. */
@media (prefers-reduced-motion: reduce) {
  .stiko-cube {
    animation: none;
    transform: rotate(45deg) rotateX(-25deg) rotateY(25deg);
  }
}
```

- [ ] **Step 2: Write the component**

Create `components/ui/LoadingCube.tsx`:

```tsx
/**
 * The brand loading indicator: a cube tumbling in Stiko primary.
 *
 * Replaces the ad-hoc `border-blue-600` rings in the review view — that blue
 * was never in the palette. The home and project screens keep their skeletons;
 * "match the shape of the real content, no spinners" was a deliberate call
 * there and this does not overturn it.
 *
 * The 3D transforms live in app/globals.css as .stiko-cube.
 */
import type { CSSProperties } from 'react';

export default function LoadingCube({
  size = 44,
  label = 'Loading…',
}: {
  size?: number;
  /** Announced to screen readers. Say what is loading when you know. */
  label?: string;
}) {
  return (
    <div role="status" aria-live="polite">
      <div
        className="stiko-cube"
        // A spinning box conveys nothing on its own, so the visible element is
        // hidden from the accessibility tree and the label carries the meaning.
        aria-hidden="true"
        style={{ '--cube-size': `${size}px` } as CSSProperties}
      >
        <div />
        <div />
        <div />
        <div />
        <div />
        <div />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
```

- [ ] **Step 3: Build a throwaway harness route and look at it**

Create `app/portal/__cube/page.tsx`:

```tsx
import LoadingCube from '@/components/ui/LoadingCube';

export default function CubeHarness() {
  return (
    <div className="flex min-h-screen items-center justify-center gap-16 bg-stiko-app">
      <LoadingCube size={28} />
      <LoadingCube size={36} />
      <LoadingCube size={44} />
    </div>
  );
}
```

Run:

```bash
AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' npm run dev
```

Open `http://localhost:3000/portal/__cube` and confirm: three solid cubes tumbling in `#5B60FF`, no gaps at the seams on the 28px one, no clipping. Then set "Reduce motion" in macOS System Settings → Accessibility → Display and reload: the cubes should hold still, tilted, not vanish or flatten.

- [ ] **Step 4: Delete the harness**

```bash
rm -rf app/portal/__cube .next/types/app/portal/__cube
```

The second path matters — a stale generated type file breaks `tsc --noEmit` after the route is gone.

- [ ] **Step 5: Swap the portal page's two spinners**

In `app/portal/[id]/page.tsx`, add the import beside the other component imports near line 10:

```tsx
import LoadingCube from '@/components/ui/LoadingCube';
```

Replace the file-list spinner (line ~649):

```tsx
    if (filesLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <LoadingCube label="Loading files…" />
        </div>
      );
    }
```

Replace the first-load spinner (line ~714):

```tsx
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingCube label="Loading package…" />
      </div>
    );
  }
```

- [ ] **Step 6: Swap the viewer's spinner**

In `components/viewers/ViewerContainer.tsx`, add to the imports near line 8:

```tsx
import LoadingCube from '@/components/ui/LoadingCube';
```

Replace the block at line ~95:

```tsx
  if (!url) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <LoadingCube size={36} label="Loading file…" />
      </div>
    );
  }
```

- [ ] **Step 7: Swap the comments panel's spinner**

In `components/portal/CommentsPanel.tsx`, add to the imports near line 8:

```tsx
import LoadingCube from '@/components/ui/LoadingCube';
```

Replace the loading branch at line ~577:

```tsx
        ) : loading ? (
          <div className="flex items-center justify-center py-8">
            <LoadingCube size={28} label="Loading comments…" />
          </div>
```

Leave the two small rings inside buttons in this file (the send button at ~line 257 and the upload hint at ~line 281) exactly as they are — a tumbling cube inside a 32px button is illegible.

- [ ] **Step 8: Type-check and test**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -8`

Expected: no tsc output; test count unchanged from whatever the previous task left it at.

- [ ] **Step 9: Confirm no blue rings survive in the review view**

Run: `grep -rn "border-blue-600" app components`

Expected: no matches.

- [ ] **Step 10: Commit**

```bash
git add components/ui/LoadingCube.tsx app/globals.css app/portal/\[id\]/page.tsx components/viewers/ViewerContainer.tsx components/portal/CommentsPanel.tsx
git commit -m "feat(ui): brand loading cube in place of the off-palette spinners"
```

---

## Task 6: Mark up a pending comment attachment

**Files:**
- Modify: `components/portal/CommentComposer.tsx` (props block lines 5–21, thumbnail block lines 63–86)
- Modify: `app/portal/[id]/page.tsx` (state ~line 192, effects ~line 504, handlers ~line 583–627, render ~line 668, ~756, ~846, ~891)

**Interfaces:**
- Consumes: `AnnotationCanvasHandle` (`captureSnapshot`, `clear`, `hasObjects`, `insertImage`) and `dataUrlToFile(dataUrl: string, filename: string): Promise<File>`, both already in the file.
- Produces: `CommentComposer` gains one optional prop, `onAnnotateFile?: (index: number) => void`.

No new drawing surface is built. `AnnotationCanvas` already accepts a `backgroundDataUrl`, letterboxes it, and flattens background plus markup in `captureSnapshot()`. Today that background is a screenshot of the viewer; here it is the attached image.

- [ ] **Step 1: Make the composer thumbnails clickable**

In `components/portal/CommentComposer.tsx`, add the prop to the interface (after `onFilesChange` on line 9):

```tsx
  pendingFiles: File[];
  onFilesChange: (files: File[]) => void;
  /** Open an attached image for markup. Absent = thumbnails are inert. */
  onAnnotateFile?: (index: number) => void;
```

Add it to the destructured params on lines 19–20:

```tsx
export default function CommentComposer({
  text, onTextChange, pendingFiles, onFilesChange, onAnnotateFile,
  tagging, hasTag, onClearTag, onSubmit, submitting, inputRef,
}: CommentComposerProps) {
```

- [ ] **Step 2: Give the image thumbnail a markup affordance**

Replace the `{url ? (…) : (…)}` ternary inside the preview map (lines 67–74) with:

```tsx
              {url ? (
                <button
                  type="button"
                  onClick={() => onAnnotateFile?.(i)}
                  disabled={!onAnnotateFile}
                  title="Click to mark up"
                  className="relative block h-14 w-14 overflow-hidden rounded-lg border border-stiko-border disabled:cursor-default"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={file.name} className="h-full w-full object-cover" />
                  {onAnnotateFile && (
                    <span className="absolute inset-0 flex items-center justify-center bg-stiko-ink/50 text-white opacity-0 transition-opacity hover:opacity-100">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </span>
                  )}
                </button>
              ) : (
                <div className="h-14 w-14 rounded-lg bg-white border border-stiko-border flex items-center justify-center text-[9px] text-stiko-muted">
                  {file.name.split('.').pop()}
                </div>
              )}
```

Non-image attachments stay inert — there is nothing to mark up on a PDF chip. The ✕ remove button already sits above this and keeps working.

- [ ] **Step 3: Add the session state to the portal page**

In `app/portal/[id]/page.tsx`, beside the other annotation state (after line 192):

```tsx
  const [annotating, setAnnotating] = useState(false);
  // Index into composerFiles while marking up an attachment the user has picked
  // but not yet posted. Null means the session is the ordinary one over the
  // viewer. It decides three things: which surface draws, whether Done replaces
  // or appends, and what the banner says.
  const [annotatingAttachment, setAnnotatingAttachment] = useState<number | null>(null);
```

- [ ] **Step 4: Start a session with the attachment as the background**

Add after `startAnnotationSession` (after line 475):

```tsx
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
```

- [ ] **Step 5: Make Done replace rather than append**

Replace `endSession` and `handleAnnotationDone` (lines 583–607) with:

```tsx
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
```

- [ ] **Step 6: Reset the index when the file changes**

In the file-change reset effect (after line 507's `setAnnotating(false);`):

```tsx
    setAnnotating(false);
    setAnnotatingAttachment(null);
```

- [ ] **Step 7: Route the render gates through the index**

Three gates in the same file. The live-viewer hide test (line ~668):

```tsx
    // Only swap the live viewer out once a snapshot actually replaced it — if the capture
    // failed there is nothing behind the annotation surface, and hiding it blanks the viewport.
    // An attachment session always has a background, and always hides the viewer.
    const annotatingOnCanvas = annotating && (!isPDFFile || annotatingAttachment !== null);
    const isHidden = (annotatingOnCanvas && !!viewerSnapshot) || !!viewportImage;
```

The `annotating` prop passed to `ViewerContainer` (line ~693) — the PDF must not enter drawing mode underneath an attachment session:

```tsx
            annotating={annotating && annotatingAttachment === null}
```

The `AnnotationCanvas` render gate (line ~846):

```tsx
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
```

- [ ] **Step 8: Say what Done will do**

Replace the banner's message span (lines 757–760):

```tsx
              <span className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                {annotatingAttachment !== null
                  ? `Marking up ${composerFiles[annotatingAttachment]?.name ?? 'attachment'} — Done replaces the attachment`
                  : 'Annotating — draw on the file, then attach it to a comment'}
              </span>
```

- [ ] **Step 9: Wire the composer**

Add the prop to the `CommentComposer` element (after line 896's `onFilesChange`):

```tsx
              pendingFiles={composerFiles}
              onFilesChange={setComposerFiles}
              onAnnotateFile={handleAnnotateAttachment}
```

- [ ] **Step 10: Type-check and test**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -8`

Expected: no tsc output; tests pass.

- [ ] **Step 11: Verify in the browser**

This one needs a real package with a file, so it needs a working database — run it against whatever environment you normally develop against rather than the throwaway `DATABASE_URL`. Open a package, attach a PNG to the comment composer, and confirm all six:

1. Hovering the thumbnail shows the pencil overlay; clicking opens the image full-viewport with the markup toolbar over it.
2. Drawing then **Done** returns you to the live viewer, and the composer thumbnail now shows the marked-up image under the name `<original>-markup.jpg`.
3. **Discard** leaves the original thumbnail untouched.
4. The banner names the file and says Done replaces the attachment.
5. Repeat all of the above with a **PDF** as the selected package file — this is the case the gates in Step 7 exist for. The PDF must not appear behind the attachment, and Done must not write onto the PDF.
6. A non-image attachment (say a `.pdf`) is still inert — no pencil, no click.

- [ ] **Step 12: Commit**

```bash
git add components/portal/CommentComposer.tsx app/portal/\[id\]/page.tsx
git commit -m "feat(portal): mark up an attached image before posting the comment"
```

---

## Done

Run the full gate once more:

```bash
npm test && npx tsc --noEmit && npm run build
```

Then use `superpowers:finishing-a-development-branch` to decide how `portal-enhancements-batch` gets integrated.
