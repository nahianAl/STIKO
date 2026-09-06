# Auth Hardening Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three auth defects that no provider migration will fix, so they are gone before Stiko opens to users outside the core group.

**Architecture:** Each fix extracts its policy decision into a pure, testable function in `lib/` and leaves the route handler as thin wiring. This follows `lib/capabilities.ts`, which already holds access policy as pure logic that routes consume. No route handler or React component is unit-tested, because this project's test runner cannot do that — see Global Constraints.

**Tech Stack:** Next.js 14 App Router, TypeScript, Node's built-in test runner, Neon Postgres via `lib/db`, Cloudflare R2 via `lib/s3`.

## Global Constraints

- **Test runner:** `npm test` runs `node --test scripts/tests/*.mjs`. Tests are `.mjs`, import `.ts` modules directly (Node type-strips them), and use `node:test` + `node:assert/strict`.
- **No DOM or React testing library exists in this project. Do not add one.** Only pure logic is unit-tested.
- **Test files mirror the module name:** `lib/foo.ts` → `scripts/tests/foo.test.mjs`.
- **Comment style:** this codebase explains *why*, not *what*, and records the bug a guard exists to prevent. Match it. Look at `scripts/tests/access.test.mjs` and `middleware.ts` for the register.
- **Build env:** `npm run build` needs `DATABASE_URL`, `NEXTAUTH_SECRET`, `AUTH_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT_URL`, `R2_BUCKET_NAME`, `CLOUDCONVERT_API_KEY` to be set to anything non-empty.
- **`/api/*` routes listed in `PUBLIC_PATHS` must return JSON 401 themselves rather than being removed from the list.** Removing one makes middleware 307 to `/login`; `fetch` follows redirects, so the caller receives a 200 with HTML and believes it succeeded. This is documented in `middleware.ts` for `/api/versions` and it applies to `/api/snapshots` too.
- **Do not touch `lib/access.ts`.** It is the strongest code in the repo and none of these fixes need it.

---

### Task 1: Mandatory email sender

`lib/email.ts` falls back to `Stiko <noreply@stiko.app>` when `EMAIL_FROM` is unset. DNS on 2026-09-05 confirms **`stiko.app` does not resolve at all**, while the Resend-verified sending domain is `stiko.design`. So a deploy that loses `EMAIL_FROM` sends every message in the product from an address that cannot be verified, Resend rejects them, and `app/api/auth/forgot-password/route.ts` discards the delivery result — password resets fail silently while the UI says "check your email".

This mirrors the contract `lib/appUrl.ts` already sets: configuration is mandatory, and a missing value fails loudly instead of producing something plausible that never arrives.

**Files:**
- Modify: `lib/email.ts:31` (the `FROM` const) and the `sendEmail` body
- Test: `scripts/tests/email.test.mjs` (append; the file already exists and tests message bodies)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `emailFrom(): string` — throws if `EMAIL_FROM` is unset or blank. `sendEmail` keeps its existing signature `(message: EmailMessage) => Promise<EmailResult>` and its existing contract of never throwing.

- [ ] **Step 1: Write the failing test**

Append to `scripts/tests/email.test.mjs`. Add `emailFrom` to the existing import line at the top of the file, so it reads:

```js
import { newVersionEmail, emailFrom } from '../../lib/email.ts';
```

Then append:

```js
// EMAIL_FROM used to default to 'Stiko <noreply@stiko.app>'. stiko.app is not a
// domain Stiko owns and does not resolve, so that default silently broke every
// email in the product whenever the variable went missing — and password resets
// discard the delivery result, so nobody found out.
test('emailFrom refuses to invent a sender', () => {
  const saved = process.env.EMAIL_FROM;
  try {
    for (const value of [undefined, '', '   ']) {
      if (value === undefined) delete process.env.EMAIL_FROM;
      else process.env.EMAIL_FROM = value;

      assert.throws(() => emailFrom(), /EMAIL_FROM must be configured/, `value=${JSON.stringify(value)}`);
    }
  } finally {
    if (saved === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = saved;
  }
});

test('emailFrom returns the configured sender, trimmed', () => {
  const saved = process.env.EMAIL_FROM;
  try {
    process.env.EMAIL_FROM = '  Stiko <noreply@stiko.design>  ';
    assert.equal(emailFrom(), 'Stiko <noreply@stiko.design>');
  } finally {
    if (saved === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = saved;
  }
});

test('sendEmail reports undelivered rather than throwing when the sender is missing', async () => {
  // sendEmail's callers rely on an EmailResult, never a thrown error:
  // app/api/participants/route.ts surfaces result.delivered to the invite UI.
  // Making emailFrom throw must not turn that into a 500.
  const savedFrom = process.env.EMAIL_FROM;
  const savedKey = process.env.RESEND_API_KEY;
  try {
    delete process.env.EMAIL_FROM;
    process.env.RESEND_API_KEY = 'test-key-never-used';

    const { sendEmail } = await import('../../lib/email.ts');
    const result = await sendEmail({ to: 'a@b.com', subject: 's', body: 'b' });

    assert.equal(result.delivered, false);
    assert.match(result.reason, /sender/i);
  } finally {
    if (savedFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = savedFrom;
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="emailFrom|sender is missing"`

Expected: FAIL. The first two fail with `emailFrom is not a function` (or an import error); the third fails because `sendEmail` currently succeeds past the sender check.

- [ ] **Step 3: Write the implementation**

In `lib/email.ts`, replace the `FROM` constant at line 31:

```ts
const FROM = process.env.EMAIL_FROM ?? 'Stiko <noreply@stiko.app>';
```

with:

```ts
/**
 * The sender address for outbound mail.
 *
 * Deliberately has no fallback. The previous default was
 * `Stiko <noreply@stiko.app>` — a domain Stiko does not own and which does not
 * resolve — so a deploy that lost EMAIL_FROM sent every message from an address
 * Resend cannot verify. Invitations surfaced that through `delivered`; password
 * resets discarded it and told the user to check their inbox.
 *
 * Same contract as lib/appUrl.ts: configuration is mandatory, and a missing
 * value fails loudly rather than producing something plausible that never lands.
 *
 * Must be on the Resend-verified domain, which is stiko.design.
 */
export function emailFrom(): string {
  const from = process.env.EMAIL_FROM;
  if (!from || !from.trim()) {
    throw new Error(
      'EMAIL_FROM must be configured before Stiko can send email, ' +
        'and must be on the Resend-verified domain (stiko.design).'
    );
  }
  return from.trim();
}
```

Then, inside `sendEmail`, immediately after the existing `RESEND_API_KEY` guard block, add:

```ts
  // emailFrom throws by design, but sendEmail's contract is to return a result.
  // app/api/participants/route.ts reads result.delivered to tell the invite UI
  // whether mail actually left; letting this escape would turn a misconfiguration
  // into a 500 on a route that otherwise degrades honestly.
  let from: string;
  try {
    from = emailFrom();
  } catch (err) {
    console.error('[email] no sender configured', err);
    return { delivered: false, reason: 'No sender address configured' };
  }
```

Finally, in the `fetch` body, change `from: FROM,` to `from,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`

Expected: PASS, all files. The pre-existing message-body tests in `email.test.mjs` must still pass — they do not touch the sender.

- [ ] **Step 5: Update the env example so the requirement is discoverable**

In `.env.local.example`, move `EMAIL_FROM` out of the commented-optional block and mark it required alongside `RESEND_API_KEY`:

```
# Email delivery. RESEND_API_KEY is optional — without it, invitations,
# notifications and password resets are logged rather than sent, and the UI says
# so instead of claiming mail went out.
#
# EMAIL_FROM is REQUIRED whenever RESEND_API_KEY is set, and must be on the
# Resend-verified domain (stiko.design). There is deliberately no fallback: the
# old default pointed at stiko.app, which Stiko does not own, so a missing value
# silently broke every email in the product.
# RESEND_API_KEY=
# EMAIL_FROM=Stiko <noreply@stiko.design>
```

- [ ] **Step 6: Commit**

```bash
git add lib/email.ts scripts/tests/email.test.mjs .env.local.example
git commit -m "fix: require EMAIL_FROM instead of defaulting to a domain we don't own

The fallback was noreply@stiko.app. That domain does not resolve, and the
Resend-verified sending domain is stiko.design, so any deploy that lost
EMAIL_FROM sent every message from an address Resend rejects. Invitations
surfaced that via delivered; password resets discarded it and told the user
to check their inbox.

emailFrom() now throws when unset, matching lib/appUrl.ts. sendEmail catches
it and still returns an EmailResult, because app/api/participants/route.ts
reads delivered to drive the invite UI and must not start 500ing."
```

**Deployment note — do not skip.** `EMAIL_FROM` must be set in Vercel production **before** this ships, or all email stops instead of failing over to the broken default. Verify it is present and on `stiko.design`, then deploy.

---

### Task 2: Authenticate and bound the snapshot upload

`app/api/snapshots/route.ts` takes a base64 data URL from anyone and writes it to R2. It has no `auth()` call, no size cap, and a content-type group of `[\w/+-]+` that accepts `text/html`. Anything stored in R2 is served back, so an attacker-chosen content type is a stored-XSS primitive, and the missing cap is an unmetered write into your bucket.

The route stays listed in `PUBLIC_PATHS` — see Global Constraints — and gains a JSON 401 of its own.

**Files:**
- Create: `lib/snapshotUpload.ts`
- Create: `scripts/tests/snapshotUpload.test.mjs`
- Modify: `app/api/snapshots/route.ts` (whole file)
- Modify: `middleware.ts` (comment only, on the `'/api/snapshots'` entry)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `parseSnapshotDataUrl(dataUrl: unknown): SnapshotParse`, where `SnapshotParse` is `{ ok: true; contentType: 'image/jpeg' | 'image/png'; buffer: Buffer; extension: 'jpg' | 'png' }` or `{ ok: false; reason: 'malformed' | 'unsupported_type' | 'too_large' }`. Also exports `MAX_SNAPSHOT_BYTES: number`.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/snapshotUpload.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSnapshotDataUrl, MAX_SNAPSHOT_BYTES } from '../../lib/snapshotUpload.ts';

const jpeg = (body) => `data:image/jpeg;base64,${body}`;

test('a well-formed JPEG snapshot is accepted and decoded', () => {
  const payload = Buffer.from('pretend-jpeg-bytes').toString('base64');
  const result = parseSnapshotDataUrl(jpeg(payload));

  assert.equal(result.ok, true);
  assert.equal(result.contentType, 'image/jpeg');
  assert.equal(result.extension, 'jpg');
  assert.equal(result.buffer.toString(), 'pretend-jpeg-bytes');
});

test('PNG is accepted and gets the png extension', () => {
  const payload = Buffer.from('pretend-png-bytes').toString('base64');
  const result = parseSnapshotDataUrl(`data:image/png;base64,${payload}`);

  assert.equal(result.ok, true);
  assert.equal(result.extension, 'png');
});

// The old regex group was [\w/+-]+. Everything written to R2 is served back, so
// a caller-chosen content type is stored XSS on our own origin.
test('a non-image content type is refused, not stored', () => {
  const payload = Buffer.from('<script>alert(1)</script>').toString('base64');

  for (const type of ['text/html', 'image/svg+xml', 'application/javascript']) {
    const result = parseSnapshotDataUrl(`data:${type};base64,${payload}`);
    assert.equal(result.ok, false, type);
    assert.equal(result.reason, 'unsupported_type', type);
  }
});

test('anything that is not a base64 data URL is malformed', () => {
  for (const input of [
    'https://example.com/x.jpg',
    'data:image/jpeg,not-base64-at-all',
    '',
    null,
    undefined,
    42,
    {},
  ]) {
    const result = parseSnapshotDataUrl(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.reason, 'malformed', JSON.stringify(input));
  }
});

test('an oversized payload is refused', () => {
  // Four base64 characters carry three bytes, so this is deliberately just past
  // the cap without allocating anything near it in the test itself.
  const chars = Math.ceil(((MAX_SNAPSHOT_BYTES + 1024) * 4) / 3);
  const result = parseSnapshotDataUrl(jpeg('A'.repeat(chars)));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too_large');
});

test('the cap is a real bound, not a placeholder', () => {
  assert.equal(typeof MAX_SNAPSHOT_BYTES, 'number');
  assert.ok(MAX_SNAPSHOT_BYTES > 0 && MAX_SNAPSHOT_BYTES <= 16 * 1024 * 1024);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="snapshot|JPEG|PNG|oversized|malformed|content type"`

Expected: FAIL — `Cannot find module '../../lib/snapshotUpload.ts'`.

- [ ] **Step 3: Write the implementation**

Create `lib/snapshotUpload.ts`:

```ts
/**
 * Parsing and bounds for viewport snapshot uploads.
 *
 * Kept out of the route so it can be tested: this project's runner
 * (`node --test scripts/tests/*.mjs`) cannot exercise a Next.js route handler.
 *
 * The route this serves used to accept a data URL from anyone, with a content
 * type matched by `[\w/+-]+` and no size limit. Everything written to R2 is
 * served back to browsers, so a caller-chosen `text/html` was stored XSS on our
 * own origin, and the missing cap was an unmetered write into the bucket.
 */

/** Snapshots are viewport captures. These are the only two types the client produces. */
const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png' } as const;

type AllowedType = keyof typeof ALLOWED;

/**
 * 8 MB decoded. A 4K viewport JPEG lands well under 2 MB, so this is generous
 * enough not to reject legitimate captures and small enough to bound the write.
 */
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export type SnapshotParse =
  | { ok: true; contentType: AllowedType; buffer: Buffer; extension: 'jpg' | 'png' }
  | { ok: false; reason: 'malformed' | 'unsupported_type' | 'too_large' };

/** Shape check only — the type is validated separately so we can say which failed. */
const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

export function parseSnapshotDataUrl(dataUrl: unknown): SnapshotParse {
  if (typeof dataUrl !== 'string') return { ok: false, reason: 'malformed' };

  const match = dataUrl.match(DATA_URL);
  if (!match) return { ok: false, reason: 'malformed' };

  const contentType = match[1];
  const base64 = match[2];

  if (!(contentType in ALLOWED)) return { ok: false, reason: 'unsupported_type' };

  // Bound the size from the encoded length before decoding. Buffer.from on a
  // 200 MB base64 string allocates 150 MB before there is any chance to reject
  // it, which turns the cap into the very exhaustion it exists to prevent.
  // Four base64 characters carry three bytes.
  if (Math.floor((base64.length * 3) / 4) > MAX_SNAPSHOT_BYTES) {
    return { ok: false, reason: 'too_large' };
  }

  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_SNAPSHOT_BYTES) return { ok: false, reason: 'too_large' };

  const type = contentType as AllowedType;
  return { ok: true, contentType: type, buffer, extension: ALLOWED[type] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`

Expected: PASS, all files.

- [ ] **Step 5: Wire the route**

Replace the whole of `app/api/snapshots/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { auth } from '@/lib/auth';
import { s3, BUCKET } from '@/lib/s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { parseSnapshotDataUrl } from '@/lib/snapshotUpload';

export async function POST(request: NextRequest) {
  // This route stays listed in middleware's PUBLIC_PATHS and does its own auth,
  // returning JSON rather than a redirect. Removing it from that list would make
  // middleware 307 to /login; fetch follows redirects, so the caller would get a
  // 200 of HTML and believe the upload succeeded. Same reasoning as /api/versions.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { dataUrl } = await request.json();

  const parsed = parseSnapshotDataUrl(dataUrl);
  if (!parsed.ok) {
    const status = parsed.reason === 'too_large' ? 413 : 400;
    const message = {
      malformed: 'dataUrl must be a base64 image data URL',
      unsupported_type: 'Snapshots must be JPEG or PNG',
      too_large: 'Snapshot is too large',
    }[parsed.reason];

    return NextResponse.json({ error: message }, { status });
  }

  const storageKey = `snapshots/${uuidv4()}.${parsed.extension}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: storageKey,
      Body: parsed.buffer,
      ContentType: parsed.contentType,
    })
  );

  return NextResponse.json({ storageKey }, { status: 201 });
}
```

- [ ] **Step 6: Document why the middleware entry stays**

In `middleware.ts`, replace the bare `'/api/snapshots',` entry with:

```ts
  // Listed here so an unauthenticated POST gets the route's own JSON 401 rather
  // than a 307 to /login — fetch follows redirects, and the caller would read the
  // resulting HTML 200 as a successful upload. The route calls auth() itself.
  '/api/snapshots',
```

- [ ] **Step 7: Verify the build still compiles**

Run: `npm run build`

Expected: build completes. If it fails on missing env vars, set the stubs listed in Global Constraints and re-run.

- [ ] **Step 8: Commit**

```bash
git add lib/snapshotUpload.ts scripts/tests/snapshotUpload.test.mjs app/api/snapshots/route.ts middleware.ts
git commit -m "fix: authenticate snapshot uploads and bound what they can store

The route accepted a base64 data URL from anyone, with no auth() call, no
size cap, and a content-type group of [\\w/+-]+ that matched text/html.
Everything written to R2 is served back, so a caller-chosen content type was
stored XSS on our own origin.

Parsing moves to lib/snapshotUpload.ts so it can be tested — the route
handler itself cannot be, under node --test. The route keeps its PUBLIC_PATHS
entry and returns its own JSON 401, because removing it would 307 to /login
and fetch would read the HTML as success."
```

---

### Task 3: Bind an addressed invitation to the address it was sent to

`app/api/invite/[token]/route.ts` POST never compares `invite.email` to the signed-in user, so whoever opens the link first joins the package. This matters more now that invitations actually go out by email, and much more once accounts belong to strangers.

Share links (`multi_use`) are exempt **by design** — they carry no address, are walked by many people deliberately, and are bounded by expiry and revocation instead. Breaking that would break the feature.

The comparison is case-insensitive. `forgot-password` already matches on `lower(email)` while login matches exactly, and that inconsistency is the leading suspect for the reported password-recovery failure. A case-sensitive check here would inherit the same bug.

**Files:**
- Create: `lib/inviteBinding.ts`
- Create: `scripts/tests/inviteBinding.test.mjs`
- Modify: `app/api/invite/[token]/route.ts` (the POST handler, after the expiry check around line 151)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `canRedeemInvite(opts: { inviteEmail: string | null; multiUse: boolean; signedInEmail: string }): { ok: true } | { ok: false; reason: 'wrong_account' }`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/inviteBinding.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRedeemInvite } from '../../lib/inviteBinding.ts';

test('the addressed recipient can redeem their own invitation', () => {
  const result = canRedeemInvite({
    inviteEmail: 'dana@consultant.com',
    multiUse: false,
    signedInEmail: 'dana@consultant.com',
  });

  assert.deepEqual(result, { ok: true });
});

// The gap this closes: an addressed invitation was a bearer token, so a forwarded
// link let whoever opened it first join the package as the invited role.
test('someone else holding the link cannot redeem an addressed invitation', () => {
  const result = canRedeemInvite({
    inviteEmail: 'dana@consultant.com',
    multiUse: false,
    signedInEmail: 'marcus@builder.com',
  });

  assert.deepEqual(result, { ok: false, reason: 'wrong_account' });
});

// Login matches email exactly while forgot-password matches lower(email). A
// case-sensitive check here would inherit that bug and lock out the very person
// the invitation was addressed to.
test('the address comparison ignores case and surrounding space', () => {
  for (const [inviteEmail, signedInEmail] of [
    ['Dana@Consultant.com', 'dana@consultant.com'],
    ['dana@consultant.com', 'DANA@CONSULTANT.COM'],
    ['  dana@consultant.com  ', 'dana@consultant.com'],
  ]) {
    assert.deepEqual(
      canRedeemInvite({ inviteEmail, multiUse: false, signedInEmail }),
      { ok: true },
      `${inviteEmail} vs ${signedInEmail}`
    );
  }
});

// Share links are exempt by design — they carry no address, are handed around
// deliberately, and are bounded by expiry and revocation instead. Binding them
// would remove the feature.
test('a share link is redeemable by anyone signed in', () => {
  for (const inviteEmail of [null, 'ignored@example.com']) {
    assert.deepEqual(
      canRedeemInvite({ inviteEmail, multiUse: true, signedInEmail: 'anyone@anywhere.com' }),
      { ok: true },
      `inviteEmail=${inviteEmail}`
    );
  }
});

test('an addressed invitation with no recorded address stays redeemable', () => {
  // Older rows predate addressed invitations. Refusing them would lock existing
  // users out of packages they were legitimately invited to.
  assert.deepEqual(
    canRedeemInvite({ inviteEmail: null, multiUse: false, signedInEmail: 'dana@consultant.com' }),
    { ok: true }
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="invitation|share link|address comparison"`

Expected: FAIL — `Cannot find module '../../lib/inviteBinding.ts'`.

- [ ] **Step 3: Write the implementation**

Create `lib/inviteBinding.ts`:

```ts
/**
 * Who may redeem an invitation token.
 *
 * An addressed invitation used to be a bearer token: POST /api/invite/[token]
 * checked expiry, revocation and single use, but never compared the invitation's
 * address to the person redeeming it. A forwarded link therefore admitted
 * whoever opened it first, with the invited role.
 *
 * Kept out of the route so it can be tested — this project's runner cannot
 * exercise a Next.js route handler.
 */

export type InviteRedemption = { ok: true } | { ok: false; reason: 'wrong_account' };

export function canRedeemInvite(opts: {
  inviteEmail: string | null;
  multiUse: boolean;
  signedInEmail: string;
}): InviteRedemption {
  // A share link is walked by many people by design and carries no address; it
  // ends by expiring or being revoked. Binding it to one identity would delete
  // the feature. Rows predating addressed invitations have no email either, and
  // refusing those would lock people out of packages they were really invited to.
  if (opts.multiUse || !opts.inviteEmail) return { ok: true };

  // Case-insensitive deliberately. Login matches email exactly while
  // forgot-password matches lower(email), so `Dana@Co.com` and `dana@co.com` can
  // both exist in the wild. A case-sensitive check here would refuse the actual
  // recipient.
  const invited = opts.inviteEmail.trim().toLowerCase();
  const signedIn = opts.signedInEmail.trim().toLowerCase();

  return invited === signedIn ? { ok: true } : { ok: false, reason: 'wrong_account' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`

Expected: PASS, all files.

- [ ] **Step 5: Wire the route**

In `app/api/invite/[token]/route.ts`, in the POST handler, insert the following immediately after the expiry check (`if (new Date(invite.expires_at as string) < new Date()) { ... }`) and **before** the single-use check:

```ts
  // An addressed invitation is not a bearer token. Without this, a forwarded link
  // admitted whoever opened it first, as the invited role. The address is read
  // from the database rather than from the session, because the session's shape
  // is about to change under the WorkOS migration and users.email is the value
  // the invitation was actually addressed against.
  const meRows = await sql`SELECT email FROM users WHERE id = ${session.user.id}`;
  const myEmail = meRows[0]?.email as string | undefined;
  if (!myEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const redemption = canRedeemInvite({
    inviteEmail: (invite.email as string | null) ?? null,
    multiUse: invite.multi_use === true,
    signedInEmail: myEmail,
  });

  if (!redemption.ok) {
    // The invited address is deliberately NOT returned. Screen 3o names the
    // address the visitor is signed in as — which they already know — and never
    // discloses who the invitation was for.
    return NextResponse.json({ error: 'wrong_account' }, { status: 403 });
  }
```

Add the import at the top of the file, alongside the existing imports:

```ts
import { canRedeemInvite } from '@/lib/inviteBinding';
```

- [ ] **Step 6: Handle the 403 on the invite page**

`app/invite/[token]/page.tsx` already translates the route's error codes for the reader — the `accept` handler builds a `SAID` map in its `else` branch (around line 78). `session` is already in scope from `useSession()` at line 53, and `session?.user?.email` is already rendered at line 163, so no new imports or hooks are needed.

Add one entry to that existing map:

```tsx
      const SAID: Record<string, string> = {
        used: 'This invitation has already been used. Ask for a new one.',
        expired: 'This invitation has expired. Ask for a new one.',
        revoked: 'This invitation was revoked.',
        not_found: 'This invitation no longer exists.',
        // Spec screen 3o. The overwhelmingly common cause is being signed in as
        // the wrong work identity, so name the account the visitor is actually
        // using — a generic 403 leaves them stuck with no idea why. The address
        // the invitation was sent to is deliberately never shown.
        wrong_account:
          `This invitation was sent to a different address. You're signed in as ` +
          `${session?.user?.email ?? 'another account'} — use Switch below to change accounts.`,
      };
```

"Switch below" refers to the existing `signOut({ callbackUrl: `/invite/${token}` })` control already on this screen, which returns here after signing out with the token preserved.

- [ ] **Step 7: Verify the build compiles**

Run: `npm run build`

Expected: build completes.

- [ ] **Step 8: Commit**

```bash
git add lib/inviteBinding.ts scripts/tests/inviteBinding.test.mjs "app/api/invite/[token]/route.ts" "app/invite/[token]/page.tsx"
git commit -m "fix: bind an addressed invitation to the address it was sent to

POST /api/invite/[token] checked expiry, revocation and single use but never
compared invite.email to the person redeeming it, so a forwarded link admitted
whoever opened it first with the invited role.

Share links (multi_use) stay exempt by design — they carry no address and are
bounded by expiry and revocation instead. Rows predating addressed invitations
have no email and stay redeemable for the same reason.

The comparison is case-insensitive: login matches email exactly while
forgot-password matches lower(email), so both casings exist in the wild and a
strict check would refuse the actual recipient."
```

---

## Verification before calling this done

- [ ] `npm test` passes in full, not just the new files.
- [ ] `npm run build` completes.
- [ ] `EMAIL_FROM` is confirmed set in Vercel production, on `stiko.design`, **before** Task 1 ships.
- [ ] Manual check, signed out: `POST /api/snapshots` with any body returns a JSON 401, not an HTML redirect. Confirm the response `content-type` is `application/json`.
- [ ] Manual check, signed in as a user the invite was **not** addressed to: opening the invite link and accepting returns 403 and the page shows the switch-account message rather than joining the package.
- [ ] Manual check: a share link still admits a second, different signed-in user.

## Out of scope

Deferred to the WorkOS migration plan, deliberately, so this batch stays shippable on its own:

- Rate limiting, MFA, session revocation, email verification, password policy — all bought with the provider.
- The email-casing bug itself. Task 3 works around it with a case-insensitive comparison; the permanent fix is the `lower(email)` unique index in the migration's Phase 1.
- The `forgot-password` route discarding `sendEmail`'s `delivered` flag. Task 1 removes the silent-failure *cause*; surfacing delivery failures to the user is a UI change that belongs with the auth rework.

---

# Addendum: Tasks 4 and 5

Added 2026-09-05 after the whole-branch review, which found that Task 2 hardened a route with no callers while the live upload path was left open, and that Task 3's case-insensitive comparison is bypassable through case-sensitive signup. Both findings were verified independently before this addendum was written.

### Task 4: Authenticate and bound the live attachment upload

`app/api/comments/attachments/route.ts` mints a presigned R2 PUT URL from `filename` and `contentType` supplied by the caller. It has **no `auth()` call at all**, no size limit, and no content-type restriction. It is exempt from middleware because `'/api/comments'` in `PUBLIC_PATHS` is a prefix match that also covers `/api/comments/attachments`.

This is the live path: `lib/uploadAttachment.ts:5` calls it, and both `components/portal/CommentsPanel.tsx:123` and `app/portal/[id]/page.tsx:1296,1316` use it. `/api/snapshots`, hardened in Task 2, has no callers — `ARCHITECTURE.md:259` records it as legacy.

Anyone on the internet can currently mint unlimited write URLs into the bucket. That is the defect this task closes.

**Deliberate scope limits, so this does not become a functional regression:**

- The file input in `components/portal/CommentsPanel.tsx:224-229` has **no `accept` attribute**. Comment attachments are arbitrary files by design — drawings, PDFs, spreadsheets. **Do not impose an image-only allow-list**; it would break the feature. Reject only the types that are dangerous *because a browser renders them*.
- R2 serves objects from the bucket's own host, not `stiko.design`, so stored HTML is XSS against the bucket origin rather than a user's Stiko session. That is why the type rule here is narrow while `lib/snapshotUpload.ts` is a strict allow-list: that route stores only viewport captures and can afford to be strict.

**Files:**
- Create: `lib/attachmentUpload.ts`
- Create: `scripts/tests/attachmentUpload.test.mjs`
- Modify: `app/api/comments/attachments/route.ts` (whole file)
- Modify: `lib/uploadAttachment.ts` (send `size`, and surface failures)
- Modify: `lib/s3.ts` (`getUploadPresignedUrl` takes an optional `contentLength`)

**Interfaces:**
- Consumes: nothing from Tasks 1-3.
- Produces: `validateAttachmentRequest(input: unknown): AttachmentValidation`, where `AttachmentValidation` is `{ ok: true; filename: string; contentType: string; size: number; extension: string }` or `{ ok: false; reason: 'malformed' | 'unsupported_type' | 'too_large' }`. Also exports `MAX_ATTACHMENT_BYTES: number` and `BLOCKED_CONTENT_TYPES: ReadonlySet<string>`.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/attachmentUpload.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAttachmentRequest,
  MAX_ATTACHMENT_BYTES,
} from '../../lib/attachmentUpload.ts';

const ok = (over) => ({
  filename: 'section-detail.pdf',
  contentType: 'application/pdf',
  size: 1024,
  ...over,
});

test('a normal document attachment is accepted', () => {
  const result = validateAttachmentRequest(ok());

  assert.equal(result.ok, true);
  assert.equal(result.contentType, 'application/pdf');
  assert.equal(result.size, 1024);
  assert.equal(result.extension, '.pdf');
});

// Comment attachments are arbitrary files by design — the file input carries no
// `accept` attribute. An image-only allow-list here would delete the feature.
test('arbitrary document types stay allowed', () => {
  for (const contentType of [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'application/zip',
    'model/step',
  ]) {
    const result = validateAttachmentRequest(ok({ contentType }));
    assert.equal(result.ok, true, contentType);
  }
});

// Narrow deny-list: only the types dangerous because a browser renders them.
test('browser-rendering types are refused', () => {
  for (const contentType of [
    'text/html',
    'image/svg+xml',
    'application/xhtml+xml',
    'TEXT/HTML',
    'text/html; charset=utf-8',
  ]) {
    const result = validateAttachmentRequest(ok({ contentType }));
    assert.equal(result.ok, false, contentType);
    assert.equal(result.reason, 'unsupported_type', contentType);
  }
});

test('an oversized attachment is refused', () => {
  const result = validateAttachmentRequest(ok({ size: MAX_ATTACHMENT_BYTES + 1 }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too_large');
});

test('a size exactly at the cap is accepted', () => {
  const result = validateAttachmentRequest(ok({ size: MAX_ATTACHMENT_BYTES }));
  assert.equal(result.ok, true);
});

test('a missing, non-numeric, zero or negative size is malformed', () => {
  // The declared size is what bounds the presigned URL. Without it there is no
  // cap at all, so it must be required rather than defaulted.
  for (const size of [undefined, null, '1024', 0, -1, 1.5, NaN, Infinity]) {
    const result = validateAttachmentRequest(ok({ size }));
    assert.equal(result.ok, false, String(size));
    assert.equal(result.reason, 'malformed', String(size));
  }
});

test('a missing or non-string filename or contentType is malformed', () => {
  for (const over of [
    { filename: undefined },
    { filename: '' },
    { filename: 42 },
    { contentType: undefined },
    { contentType: '' },
    { contentType: 99 },
  ]) {
    const result = validateAttachmentRequest(ok(over));
    assert.equal(result.ok, false, JSON.stringify(over));
    assert.equal(result.reason, 'malformed', JSON.stringify(over));
  }
});

test('a non-object input is malformed', () => {
  for (const input of [null, undefined, 'x', 42, []]) {
    const result = validateAttachmentRequest(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.reason, 'malformed', JSON.stringify(input));
  }
});

test('the extension is derived from the filename and never invented', () => {
  assert.equal(validateAttachmentRequest(ok({ filename: 'a.PDF' })).extension, '.PDF');
  assert.equal(validateAttachmentRequest(ok({ filename: 'no-extension' })).extension, '');
  assert.equal(validateAttachmentRequest(ok({ filename: 'a.b.c' })).extension, '.c');
});

// The storage key is built from this extension. A path separator or a space in
// it would let the caller steer the object outside its namespace.
test('a filename cannot smuggle a path segment through the extension', () => {
  for (const filename of ['a.pdf/../../evil', 'a./../x', 'a. x']) {
    const result = validateAttachmentRequest(ok({ filename }));
    if (result.ok) {
      assert.ok(!result.extension.includes('/'), filename);
      assert.ok(!result.extension.includes('\\'), filename);
      assert.ok(!result.extension.includes(' '), filename);
    }
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="attachment"`

Expected: FAIL — `Cannot find module '../../lib/attachmentUpload.ts'`.

- [ ] **Step 3: Write the implementation**

Create `lib/attachmentUpload.ts`:

```ts
/**
 * Validation and bounds for comment attachment uploads.
 *
 * The route this serves used to mint a presigned R2 PUT URL from a filename and
 * content type supplied by anyone at all — no auth() call, no size limit, no
 * type restriction. It is exempt from middleware because '/api/comments' in
 * PUBLIC_PATHS is a prefix match that also covers '/api/comments/attachments'.
 * That made it an unauthenticated, unmetered write into the bucket.
 *
 * Kept out of the route so it can be tested: this project's runner
 * (`node --test scripts/tests/*.mjs`) cannot exercise a Next.js route handler.
 */

/**
 * Types refused because a browser RENDERS them, which would make a stored file
 * an XSS payload on whatever origin serves it.
 *
 * Deliberately a narrow deny-list rather than an allow-list. The comment
 * attachment input (components/portal/CommentsPanel.tsx) has no `accept`
 * attribute — arbitrary documents are the feature — so an allow-list here would
 * break it. lib/snapshotUpload.ts can afford a strict allow-list because it
 * stores only viewport captures.
 */
export const BLOCKED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/xml',
  'text/xml',
]);

/** 25 MB. Comfortably above a large drawing PDF or a phone photo. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type AttachmentValidation =
  | { ok: true; filename: string; contentType: string; size: number; extension: string }
  | { ok: false; reason: 'malformed' | 'unsupported_type' | 'too_large' };

export function validateAttachmentRequest(input: unknown): AttachmentValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'malformed' };
  }

  const { filename, contentType, size } = input as Record<string, unknown>;

  if (typeof filename !== 'string' || !filename) return { ok: false, reason: 'malformed' };
  if (typeof contentType !== 'string' || !contentType) return { ok: false, reason: 'malformed' };

  // Required, not defaulted: the declared size is what bounds the presigned URL,
  // so accepting a request without one would leave no cap at all.
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
    return { ok: false, reason: 'malformed' };
  }

  // Compare on the bare media type: 'text/html; charset=utf-8' is still HTML,
  // and casing is not significant in a media type.
  const bare = contentType.split(';')[0].trim().toLowerCase();
  if (BLOCKED_CONTENT_TYPES.has(bare)) return { ok: false, reason: 'unsupported_type' };

  if (size > MAX_ATTACHMENT_BYTES) return { ok: false, reason: 'too_large' };

  // The storage key is built from this, so it must not be able to carry a path
  // segment out of the namespace.
  const dot = filename.lastIndexOf('.');
  const raw = dot === -1 ? '' : filename.slice(dot);
  const extension = /[/\\ ]/.test(raw) ? '' : raw;

  return { ok: true, filename, contentType, size, extension };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`

Expected: PASS, all files.

- [ ] **Step 5: Let the presigner carry a length**

In `lib/s3.ts`, change `getUploadPresignedUrl` to accept an optional length:

```ts
// Generate a presigned URL for a direct client → R2 PUT upload.
//
// When contentLength is given it is signed into the URL, so the client cannot
// PUT a body of a different size than the one the server approved. Without it
// the size check is advisory only: the caller declares a size, gets a URL, and
// could then upload anything.
export async function getUploadPresignedUrl(
  storageKey: string,
  contentType: string,
  expiresIn = 300, // 5 minutes
  contentLength?: number
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    ContentType: contentType,
    ...(contentLength !== undefined ? { ContentLength: contentLength } : {}),
  });
  return getSignedUrl(s3, command, { expiresIn });
}
```

- [ ] **Step 6: Verify the length is actually signed, and report what you find**

This is a verification step, not an assumption. Run this and read the output:

```bash
node --input-type=module -e "
process.env.R2_ACCESS_KEY_ID='test';
process.env.R2_SECRET_ACCESS_KEY='test';
process.env.R2_ENDPOINT_URL='https://example.r2.cloudflarestorage.com';
process.env.R2_BUCKET_NAME='b';
const { getUploadPresignedUrl } = await import('./lib/s3.ts');
const url = await getUploadPresignedUrl('k', 'application/pdf', 300, 1234);
const signed = new URL(url).searchParams.get('X-Amz-SignedHeaders');
console.log('SignedHeaders:', signed);
console.log('content-length signed:', String(signed).includes('content-length'));
"
```

Record the exact output in your report.

- If `content-length signed: true`, the cap is enforced by R2 — say so.
- If `false`, the cap is **advisory only**: a client could request a small size and then PUT a large body. Report status **DONE_WITH_CONCERNS** and say so plainly. Do not attempt to redesign the upload flow to fix it; that is a larger decision than this task.

Either way the `auth()` call and the type rule still stand, and they are the substance of this fix.

- [ ] **Step 7: Wire the route**

Replace the whole of `app/api/comments/attachments/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { auth } from '@/lib/auth';
import { getUploadPresignedUrl } from '@/lib/s3';
import { validateAttachmentRequest } from '@/lib/attachmentUpload';

export async function POST(request: NextRequest) {
  // This route had no auth() call at all, and middleware does not cover it:
  // '/api/comments' in PUBLIC_PATHS is a prefix match, so this path inherited
  // the exemption meant for the comments API. Anyone on the internet could mint
  // unlimited presigned write URLs into the bucket.
  //
  // It stays under that exemption and returns JSON rather than redirecting, for
  // the same reason as /api/versions: fetch follows a 307 to /login and reads
  // the resulting HTML 200 as success.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validated = validateAttachmentRequest(await request.json());
  if (!validated.ok) {
    const status = validated.reason === 'too_large' ? 413 : 400;
    const message = {
      malformed: 'filename, contentType and a positive integer size are required',
      unsupported_type: 'That file type cannot be attached',
      too_large: 'Attachment is too large',
    }[validated.reason];

    return NextResponse.json({ error: message }, { status });
  }

  const storageKey = `comment-attachments/${uuidv4()}${validated.extension}`;

  const presignedUrl = await getUploadPresignedUrl(
    storageKey,
    validated.contentType,
    300,
    validated.size
  );

  return NextResponse.json({ presignedUrl, storageKey }, { status: 200 });
}
```

- [ ] **Step 8: Send the size from the client, and surface failures**

In `lib/uploadAttachment.ts`, change the presign request body from:

```ts
    body: JSON.stringify({ filename: file.name, contentType: file.type }),
```

to:

```ts
    // The server signs this length into the presigned URL, so it must match the
    // body actually PUT below.
    body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
```

Then make failures visible. The existing code destructures the response without checking it, so a 401 or 413 yields `presignedUrl: undefined` and a confusing downstream error. Immediately after the presign `fetch`, before the destructure, add:

```ts
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Could not prepare the upload (${res.status})`);
  }
```

And change the PUT from `await fetch(presignedUrl, {...})` to capture and check its response:

```ts
  const put = await fetch(presignedUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });

  if (!put.ok) {
    throw new Error(`Upload failed (${put.status})`);
  }
```

- [ ] **Step 9: Verify the build compiles**

Run: `npm run build`

Expected: build completes.

- [ ] **Step 10: Commit**

```bash
git add lib/attachmentUpload.ts scripts/tests/attachmentUpload.test.mjs app/api/comments/attachments/route.ts lib/uploadAttachment.ts lib/s3.ts
git commit -m "fix: authenticate and bound the live comment attachment upload"
```

Use this full commit message body:

```
/api/comments/attachments minted a presigned R2 PUT URL from a caller-supplied
filename and content type with no auth() call, no size limit and no type
restriction. Middleware did not cover it: '/api/comments' in PUBLIC_PATHS is a
prefix match that also matched this path. Anyone on the internet could mint
unlimited write URLs into the bucket.

This is the live upload path - lib/uploadAttachment.ts calls it from both the
comments panel and the annotation flow. /api/snapshots, hardened earlier in
this branch, has no callers and ARCHITECTURE.md records it as legacy.

The type rule is a narrow deny-list, not an allow-list: the attachment input
has no accept attribute and arbitrary documents are the feature. Only types a
browser renders are refused. The declared size is signed into the presigned URL
so the client cannot PUT a larger body than the server approved.
```

---

### Task 5: Match email case-insensitively at signup

`app/api/auth/signup/route.ts:13` checks `WHERE email = ${email}`, which is case-sensitive in Postgres. `app/api/auth/forgot-password/route.ts:17` already matches `lower(email)`.

On its own that is a duplicate-account hygiene problem. Combined with Task 3 it becomes an authorization bypass: `canRedeemInvite` compares addresses case-insensitively, so someone holding a forwarded invitation addressed to `dana@co.com` can register `DANA@co.com` — a distinct row, since signup's check is case-sensitive — sign in, and redeem it. The invited address is not secret; `GET /api/invite/[token]` is public and returns it.

This does not close the bypass entirely — without email verification an attacker can still register the exact address if it is unregistered, which is deferred to the WorkOS migration. It closes the path that works against recipients who **already have an account**, which is the one Task 3 opened.

**Files:**
- Modify: `app/api/auth/signup/route.ts:13`

**Interfaces:**
- Consumes: nothing. Produces: nothing. A one-line query change.

- [ ] **Step 1: Make the change**

In `app/api/auth/signup/route.ts`, replace:

```ts
  const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
```

with:

```ts
  // Case-insensitive, matching app/api/auth/forgot-password/route.ts. A
  // case-sensitive check let DANA@co.com be registered alongside dana@co.com as
  // a separate account — which, since lib/inviteBinding.ts compares addresses
  // case-insensitively, was enough to redeem an invitation addressed to the
  // other one. The permanent fix is the lower(email) unique index in the WorkOS
  // migration; this closes the hole until that lands.
  const existing = await sql`SELECT id FROM users WHERE lower(email) = lower(${email})`;
```

- [ ] **Step 2: Verify the suite and build still pass**

Run: `npm test && npm run build`

Expected: PASS and a completed build. No test covers this route — it is a database query in a route handler, which this project's runner cannot exercise. Do not add a test framework to cover it.

- [ ] **Step 3: Commit**

```bash
git add app/api/auth/signup/route.ts
git commit -m "fix: match email case-insensitively when checking for an existing account"
```

Use this full commit message body:

```
signup checked email equality case-sensitively while forgot-password already
matched lower(email). That let DANA@co.com exist as a separate account from
dana@co.com.

Combined with the invitation binding added earlier in this branch - which
compares addresses case-insensitively - that was an authorization bypass: a
forwarded invitation addressed to dana@co.com could be redeemed by registering
the same address in a different case. The invited address is not secret; the
public GET on the invite token returns it.

The permanent fix is the lower(email) unique index in the WorkOS migration,
which is now a deploy-ordering dependency rather than cleanup.
```
