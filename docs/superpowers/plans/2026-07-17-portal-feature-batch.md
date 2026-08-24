# Portal Feature Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship 8 portal-page features: insert-image annotation, delete-key erase, eraser cursor, comment edit/delete, 3D snapshot bg fix, auto-select-after-create, relocate Submit, and a header Share panel.

**Architecture:** Presentation + behavior changes on the existing Konva annotation stack, the comment CRUD path, the 3D snapshot path, and the header/version-panel/share UI. No new libraries. UI uses the existing `stiko` design tokens + gradient primary.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, react-konva, react-three-fiber, next-auth, Tailwind (stiko tokens).

## Global Constraints
- Repo has **NO test runner** (scripts: dev/build/start/lint). Do NOT add a test framework. Gate every task: `npx tsc --noEmit` + `npm run lint` clean; run `npm run build` with stubbed env at the end of the task (see below). Do NOT read `.env.local` or secrets. Do NOT boot the dev server (needs DB/auth).
- Stubbed build env (copy verbatim): `DATABASE_URL='postgresql://user:password@localhost:5432/stub?sslmode=require' AUTH_SECRET='stub-build-only-secret-not-a-real-key-000000000' NEXTAUTH_URL='http://localhost:3000' R2_ACCESS_KEY_ID='stub' R2_SECRET_ACCESS_KEY='stub' R2_BUCKET_NAME='stub' R2_ENDPOINT_URL='https://stub.r2.cloudflarestorage.com' npm run build`
- Gradient primary verbatim: `linear-gradient(135deg, #8094F5, #5B60FF)`. stiko tokens only for new UI.
- Preserve all existing behavior: annotation session lifecycle, draw/erase-by-click, comment pins, threads/replies/attachments, participants popover, panel collapse.
- Roles are exactly `viewer | commenter | uploader` (DB CHECK). `invite_tokens.email` is NOT NULL (send `''` for the general share link).
- Line numbers in this plan may have drifted — anchor edits on the quoted code strings; **read the file first** for integration tasks.
- Commit after each task on branch `portal-feature-batch` (create it off `main`). Do not touch `main`.

## File map
- `app/portal/[id]/page.tsx` — touched by Tasks 1, 4, 8, 9 (snapshot fix, submit wiring, auto-select wiring, insert-image handler).
- `app/api/comments/[id]/route.ts`, `lib/types.ts` — Task 2.
- `components/portal/CommentsPanel.tsx` — Task 3.
- `components/portal/FileTreeSidebar.tsx`, `components/portal/PortalTopBar.tsx` — Tasks 4, 5.
- `components/portal/ShareModal.tsx` (new) — Task 5.
- `lib/cursors.ts` (new), `components/markup/AnnotationCanvas.tsx`, `components/viewers/PDFKonvaViewer.tsx` — Task 6.
- annotation surfaces — Tasks 6, 7, 8, 9.
- `components/markup/useAnnotationObjects.ts`, `components/markup/AnnotationObjects.tsx` — Tasks 8, 9.
- `components/markup/DrawingTools.tsx`, `components/viewers/ViewerContainer.tsx` — Tasks 8, 9.

---

### Task 1: 3D snapshot background fix (#5)

**Files:** Modify `app/portal/[id]/page.tsx` (`captureViewerSnapshot`, the WebGL-canvas branch).

- [ ] **Step 1: Composite the WebGL canvas onto the viewer bg**

In `captureViewerSnapshot`, replace the canvas branch:
```tsx
  // WebGL canvas (3D models, PDF)
  const canvas = container.querySelector('canvas') as HTMLCanvasElement | null;
  if (canvas) {
    try {
      return canvas.toDataURL('image/jpeg', 0.92);
    } catch (e) {
      console.error('Canvas capture failed:', e);
    }
  }
```
with:
```tsx
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
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit && npm run lint` clean; run the stubbed `npm run build`.
- [ ] **Step 3: Commit** — `git commit -m "fix(portal): 3D annotation snapshot keeps its gray bg instead of black"`

---

### Task 2: Harden comment edit/delete + cascade + userId type (#4 server)

**Files:** Modify `app/api/comments/[id]/route.ts`; modify `lib/types.ts`.

**Interfaces produced:** `PUT`/`DELETE /api/comments/[id]` require a session and only the owner (`user_id === session.user.id`) may mutate; DELETE cascades to direct replies. `Comment.userId?: string | null`.

- [ ] **Step 1: Add `userId` to the Comment type**

In `lib/types.ts`, in `interface Comment`, add the field right after `fileId: string;`:
```ts
  userId?: string | null;
```

- [ ] **Step 2: Rewrite the PUT/DELETE handlers**

Replace the entire body of `app/api/comments/[id]/route.ts` (keep the imports) with:
```ts
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { content } = await request.json();
  if (!content || !content.trim()) {
    return NextResponse.json({ error: 'Content is required' }, { status: 400 });
  }

  const existing = await sql`SELECT user_id FROM comments WHERE id = ${params.id}`;
  if (!existing[0]) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }
  // Only the comment's owner may edit (anonymous comments have no owner and are not editable).
  if (existing[0].user_id !== session.user.id) {
    return NextResponse.json({ error: 'Not authorized to edit this comment' }, { status: 403 });
  }

  const rows = await sql`
    UPDATE comments SET content = ${content.trim()}
    WHERE id = ${params.id}
    RETURNING id, file_id AS "fileId", user_id AS "userId",
              parent_comment_id AS "parentCommentId", content,
              x_position AS "xPosition", y_position AS "yPosition",
              world_x AS "worldX", world_y AS "worldY", world_z AS "worldZ",
              snapshot_url AS "snapshotUrl", author, created_at AS "createdAt"
  `;
  if (!rows[0]) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const existing = await sql`SELECT user_id FROM comments WHERE id = ${params.id}`;
  if (!existing[0]) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }
  if (existing[0].user_id !== session.user.id) {
    return NextResponse.json({ error: 'Not authorized to delete this comment' }, { status: 403 });
  }

  // Cascade: delete the comment and its direct replies.
  await sql`DELETE FROM comments WHERE id = ${params.id} OR parent_comment_id = ${params.id}`;
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit && npm run lint`; stubbed `npm run build`. (`session.user.id` already compiles today via `lib/auth.ts`; do not add a next-auth augmentation.)
- [ ] **Step 4: Commit** — `git commit -m "fix(api): comment edit/delete are owner-only (require session) + cascade replies"`

---

### Task 3: Comment edit & delete UI (#4 client)

**Files:** Modify `components/portal/CommentsPanel.tsx`; modify `app/portal/[id]/page.tsx` (pass a refresh callback).

**Consumes:** `Comment.userId` (Task 2). **Interfaces produced:** `CommentsPanel` gains `onCommentsChanged?: () => void`.

**Read `components/portal/CommentsPanel.tsx` fully first**, then:

- [ ] **Step 1: Read current user via session**

At the top of `CommentsPanel.tsx` add to the React import line `useMemo` is not needed; add the next-auth import:
```tsx
import { useSession } from 'next-auth/react';
```
Add `onCommentsChanged?: () => void;` to `CommentsPanelProps`. Inside `CommentsPanel(...)`, after the existing `useState`s, add:
```tsx
  const { data: session } = useSession();
  const currentUserId = (session?.user as { id?: string } | undefined)?.id ?? null;
```

- [ ] **Step 2: Thread ownership + change callback into `CommentItem`**

Where `CommentsPanel` maps `topLevelComments` to `<CommentItem ... />`, add two props: `currentUserId={currentUserId}` and `onChanged={onCommentsChanged}`. In the recursive replies `<CommentItem ... />` inside `CommentItem`, also pass `currentUserId={currentUserId}` and `onChanged={onChanged}` (thread them through `CommentItem`'s own props).

Add to `CommentItem`'s prop type: `currentUserId: string | null;` and `onChanged?: () => void;`.

- [ ] **Step 3: Add edit state + owner check in `CommentItem`**

Inside `CommentItem`, near its other `useState`s, add:
```tsx
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(comment.content);
  const [busy, setBusy] = useState(false);
  const canModify = !!comment.userId && comment.userId === currentUserId;

  const saveEdit = async () => {
    if (!editText.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/comments/${comment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editText.trim() }),
      });
      if (res.ok) { setIsEditing(false); onRefresh(); onChanged?.(); }
    } finally { setBusy(false); }
  };

  const deleteComment = async () => {
    if (busy || !window.confirm('Delete this comment?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/comments/${comment.id}`, { method: 'DELETE' });
      if (res.ok) { onRefresh(); onChanged?.(); }
    } finally { setBusy(false); }
  };
```

- [ ] **Step 4: Render inline edit + Edit/Delete controls**

Replace the comment body line:
```tsx
        <p className="text-[12.5px] leading-[1.5] text-[#4A4F63]">{comment.content}</p>
```
with:
```tsx
        {isEditing ? (
          <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              value={editText}
              autoFocus
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') setIsEditing(false); }}
              className="w-full rounded-lg border border-stiko-border bg-white px-2.5 py-1.5 text-[12.5px] text-stiko-ink focus:border-stiko-primary focus:ring-1 focus:ring-stiko-primary outline-none"
            />
            <div className="flex items-center gap-2">
              <button onClick={saveEdit} disabled={busy || !editText.trim()} className="text-[11px] font-bold text-white px-3 py-1 rounded-lg disabled:opacity-40 transition-[filter] hover:brightness-[0.97]" style={{ background: 'linear-gradient(135deg, #8094F5, #5B60FF)' }}>Save</button>
              <button onClick={() => { setIsEditing(false); setEditText(comment.content); }} className="text-[11px] font-semibold text-stiko-muted hover:text-stiko-secondary">Cancel</button>
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] leading-[1.5] text-[#4A4F63]">{comment.content}</p>
        )}
```

Then, in the row that holds the Reply button (the `<div className="mt-1.5">` wrapping the Reply `<button>`), make it a flex row and add Edit/Delete when `canModify` and not editing. Change that wrapper to:
```tsx
            <div className="mt-1.5 flex items-center gap-3">
              <button
                onClick={(e) => { e.stopPropagation(); setShowReplyForm((v) => !v); }}
                className="text-[11px] font-bold text-stiko-primary hover:opacity-80 transition-opacity"
              >
                {showReplyForm ? 'Cancel' : 'Reply'}
              </button>
              {canModify && !isEditing && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); setIsEditing(true); setEditText(comment.content); }} className="text-[11px] font-semibold text-stiko-muted hover:text-stiko-secondary transition-colors">Edit</button>
                  <button onClick={(e) => { e.stopPropagation(); deleteComment(); }} className="text-[11px] font-semibold text-stiko-muted hover:text-[#B23A52] transition-colors">Delete</button>
                </>
              )}
            </div>
```
(If the current Reply markup differs slightly, preserve its existing `onClick`/label logic and only add the flex wrapper + the `canModify` Edit/Delete buttons.)

- [ ] **Step 5: Wire the page refresh so pins update too**

In `app/portal/[id]/page.tsx`, find the `<CommentsPanel ... />` render and add the prop:
```tsx
          onCommentsChanged={() => setCommentsRefreshKey((k) => k + 1)}
```
(`setCommentsRefreshKey` already exists and drives the page's pin `fetchComments`.)

- [ ] **Step 6: Verify** — `npx tsc --noEmit && npm run lint`; stubbed `npm run build`.
- [ ] **Step 7: Commit** — `git commit -m "feat(portal): commenters can edit/delete their own comments"`

---

### Task 4: Move "Submit new version" to the version panel bottom (#7)

**Files:** Modify `components/portal/PortalTopBar.tsx` (remove submit), `components/portal/FileTreeSidebar.tsx` (add bottom submit), `app/portal/[id]/page.tsx` (rewire prop).

- [ ] **Step 1: Remove the submit button from the header**

In `PortalTopBar.tsx`: remove `submitHref` from `PortalTopBarProps` and the destructure, and delete the submit `<Link href={submitHref} …>Submit new version</Link>`. The right cluster keeps only the avatar-stack block. (`Link` may become unused — if lint flags it, remove the import.)

- [ ] **Step 2: Add the submit button to the bottom of the version panel**

In `FileTreeSidebar.tsx`:
- Add `import Link from 'next/link';` at the top.
- Add `submitHref?: string;` to `FileTreeSidebarProps` and destructure it in the component params.
- In the **expanded** return, immediately BEFORE the panel's closing `</div>` (after the versions list `<div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto"> … </div>`), add:
```tsx
      {submitHref && (
        <Link
          href={submitHref}
          className="flex-shrink-0 flex items-center justify-center gap-2 text-white font-bold text-[13px] py-2.5 rounded-[11px] shadow-stiko-primary transition-[filter] hover:brightness-[0.97]"
          style={{ background: 'linear-gradient(135deg, #8094F5, #5B60FF)' }}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Submit new version
        </Link>
      )}
```
(The panel is `flex flex-col … gap-5`; the versions list is `flex-1`, so this button naturally pins to the bottom. Leave the collapsed rail unchanged — no submit there.)

- [ ] **Step 3: Rewire the page**

In `app/portal/[id]/page.tsx`: remove `submitHref={…}` from `<PortalTopBar …>` and add `submitHref={`/portal/${portalId}/submit`}` to `<FileTreeSidebar …>`.

- [ ] **Step 4: Verify** — `npx tsc --noEmit && npm run lint`; stubbed `npm run build`.
- [ ] **Step 5: Commit** — `git commit -m "feat(portal): move Submit new version to the bottom of the version panel"`

---

### Task 5: Header "Share" button + Share modal (#8)

**Files:** Create `components/portal/ShareModal.tsx`; modify `components/portal/PortalTopBar.tsx`; modify `app/portal/[id]/page.tsx` (pass `portalId`).

**Consumes:** `POST /api/participants { portalId, email, role } → { token }`.

- [ ] **Step 1: Create the Share modal**

```tsx
// components/portal/ShareModal.tsx
'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';

type Role = 'viewer' | 'commenter' | 'uploader';
const ROLES: Role[] = ['viewer', 'commenter', 'uploader'];
const GRADIENT = 'linear-gradient(135deg, #8094F5, #5B60FF)';

export default function ShareModal({ isOpen, onClose, portalId }: { isOpen: boolean; onClose: () => void; portalId: string }) {
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('commenter');
  const [linkRole, setLinkRole] = useState<Role>('viewer');
  const [busy, setBusy] = useState<'invite' | 'link' | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const createInvite = async (emailValue: string, role: Role): Promise<string | null> => {
    const res = await fetch('/api/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portalId, email: emailValue, role }),
    });
    if (!res.ok) return null;
    const { token } = await res.json();
    return `${window.location.origin}/invite/${token}`;
  };

  const handleInvite = async () => {
    if (!email.trim() || busy) return;
    setBusy('invite');
    try { setInviteLink(await createInvite(email.trim(), inviteRole)); } finally { setBusy(null); }
  };

  const handleShareLink = async () => {
    if (busy) return;
    setBusy('link');
    try { setShareLink(await createInvite('', linkRole)); } finally { setBusy(null); }
  };

  const copy = (value: string, which: string) => {
    navigator.clipboard.writeText(value);
    setCopied(which);
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
  };

  const selectCls = 'rounded-lg border border-stiko-border bg-white px-2.5 py-1.5 text-[12.5px] text-stiko-secondary capitalize focus:border-stiko-primary focus:ring-1 focus:ring-stiko-primary outline-none';
  const linkRow = (value: string, which: string) => (
    <div className="mt-2 flex items-center gap-2 rounded-lg bg-stiko-subtle p-2">
      <span className="flex-1 truncate text-[11.5px] text-stiko-secondary">{value}</span>
      <button onClick={() => copy(value, which)} className="text-[11px] font-bold text-stiko-primary hover:opacity-80">{copied === which ? 'Copied!' : 'Copy'}</button>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share portal">
      <div className="flex flex-col gap-5">
        {/* Invite by email */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-stiko-faint mb-2">Invite a participant</p>
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@email.com"
              className="flex-1 rounded-lg border border-stiko-border bg-white px-3 py-1.5 text-[12.5px] text-stiko-ink focus:border-stiko-primary focus:ring-1 focus:ring-stiko-primary outline-none"
            />
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} className={selectCls}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button onClick={handleInvite} disabled={!email.trim() || busy === 'invite'} className="text-white font-bold text-[12.5px] px-4 py-1.5 rounded-lg disabled:opacity-40 transition-[filter] hover:brightness-[0.97]" style={{ background: GRADIENT }}>
              {busy === 'invite' ? '…' : 'Create'}
            </button>
          </div>
          {inviteLink && linkRow(inviteLink, 'invite')}
          <p className="mt-1.5 text-[11px] text-stiko-faint">An invite link is generated — copy and send it to them.</p>
        </div>

        <div className="h-px bg-stiko-border" />

        {/* General share link */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-stiko-faint mb-2">Share a link</p>
          <div className="flex items-center gap-2">
            <select value={linkRole} onChange={(e) => setLinkRole(e.target.value as Role)} className={selectCls}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button onClick={handleShareLink} disabled={busy === 'link'} className="text-white font-bold text-[12.5px] px-4 py-1.5 rounded-lg disabled:opacity-40 transition-[filter] hover:brightness-[0.97]" style={{ background: GRADIENT }}>
              {busy === 'link' ? '…' : 'Create link'}
            </button>
          </div>
          {shareLink && linkRow(shareLink, 'link')}
          <p className="mt-1.5 text-[11px] text-stiko-faint">Anyone with the link can sign in and join as {linkRole}.</p>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Add the Share button to the header**

In `PortalTopBar.tsx`:
- Add `import { useState } from 'react';` (merge with existing react import) and `import ShareModal from './ShareModal';`.
- Add `portalId: string;` to `PortalTopBarProps` and destructure it.
- Add `const [showShare, setShowShare] = useState(false);` in the component.
- In the right cluster, after the avatar-stack block, add the Share button:
```tsx
        <button
          onClick={() => setShowShare(true)}
          className="flex items-center gap-2 text-white font-bold text-[13px] px-[18px] py-[10px] rounded-[11px] shadow-stiko-primary transition-[filter] hover:brightness-[0.97]"
          style={{ background: 'linear-gradient(135deg, #8094F5, #5B60FF)' }}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          Share
        </button>
```
- Render the modal at the end of the component's returned JSX (before the outer closing tag):
```tsx
      <ShareModal isOpen={showShare} onClose={() => setShowShare(false)} portalId={portalId} />
```

- [ ] **Step 3: Pass `portalId` from the page**

In `app/portal/[id]/page.tsx`, add `portalId={portalId}` to `<PortalTopBar …>`.

- [ ] **Step 4: Verify** — `npx tsc --noEmit && npm run lint`; stubbed `npm run build`.
- [ ] **Step 5: Commit** — `git commit -m "feat(portal): header Share button opens invite / share-link panel"`

---

### Task 6: Eraser cursor (#3)

**Files:** Create `lib/cursors.ts`; modify `components/markup/AnnotationCanvas.tsx`, `components/viewers/PDFKonvaViewer.tsx`.

- [ ] **Step 1: Define the cursor**

```ts
// lib/cursors.ts
// A periwinkle eraser-shaped cursor (readable on both the dark image/3D canvas and the light PDF).
export const ERASER_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%235B60FF' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 20H7L3 16a2 2 0 0 1 0-3l9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8'/%3E%3Cline x1='8' y1='9' x2='15' y2='16'/%3E%3C/svg%3E\") 4 18, auto";
```

- [ ] **Step 2: Use it in AnnotationCanvas**

Add `import { ERASER_CURSOR } from '@/lib/cursors';` at the top. Change:
```tsx
  const cursor = activeTool === 'pointer' ? 'default' : activeTool === 'eraser' ? 'not-allowed' : 'crosshair';
```
to:
```tsx
  const cursor = activeTool === 'pointer' ? 'default' : activeTool === 'eraser' ? ERASER_CURSOR : 'crosshair';
```

- [ ] **Step 3: Use it in PDFKonvaViewer**

Add `import { ERASER_CURSOR } from '@/lib/cursors';` at the top. In the `cursorStyle` expression, replace the eraser branch `annotating && activeTool === 'eraser' ? 'not-allowed'` with `annotating && activeTool === 'eraser' ? ERASER_CURSOR`.

- [ ] **Step 4: Verify** — `npx tsc --noEmit && npm run lint`; stubbed `npm run build`.
- [ ] **Step 5: Commit** — `git commit -m "feat(portal): eraser tool shows an eraser cursor"`

---

### Task 7: Delete-key erases the selected object (#2)

**Files:** Modify `components/markup/AnnotationCanvas.tsx`, `components/viewers/PDFKonvaViewer.tsx`.

**Guard helper (inline in both):** ignore when a text input is focused.

- [ ] **Step 1: AnnotationCanvas keydown**

Add this effect inside `AnnotationCanvas` (after the tool-change selection-clear effect):
```tsx
  // Delete/Backspace removes the selected object (unless typing in the text popup).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (ann.selectedId) { e.preventDefault(); ann.deleteObject(ann.selectedId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ann.selectedId, ann.deleteObject]);
```

- [ ] **Step 2: PDFKonvaViewer keydown**

Add the same effect inside `PDFKonvaViewer`, but gated on `annotating` (the PDF surface is always mounted):
```tsx
  // Delete/Backspace removes the selected annotation object during a session (not while typing).
  useEffect(() => {
    if (!annotating) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (ann.selectedId) { e.preventDefault(); ann.deleteObject(ann.selectedId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [annotating, ann.selectedId, ann.deleteObject]);
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit && npm run lint`; stubbed `npm run build`.
- [ ] **Step 4: Commit** — `git commit -m "feat(portal): Delete key erases the selected annotation object"`

---

### Task 8: Auto-select the object after each action (#6)

**Files:** Modify `components/markup/useAnnotationObjects.ts`, `components/markup/AnnotationCanvas.tsx`, `components/viewers/PDFKonvaViewer.tsx`, `components/viewers/ViewerContainer.tsx`, `app/portal/[id]/page.tsx`.

**Interfaces produced:** `endDraw(): string | null`, `addText(...): string | null` (return the new object id, and select it); surfaces gain `onObjectCreated?: () => void`.

- [ ] **Step 1: Return + select the new object in the hook**

In `useAnnotationObjects.ts`:
- `endDraw`: after `setObjects((prev) => [...prev, obj]);` add `setSelectedId(obj.id);` then `return obj.id;`. At the two early returns (`if (!d) return;` and `if (!valid) return;`) change to `return null;`. So `endDraw` returns `string | null`.
- `addText`: change `if (!text.trim()) return;` to `return null;`; after `setObjects((prev) => [...prev, o]);` add `setSelectedId(o.id);` then `return o.id;`.

- [ ] **Step 2: AnnotationCanvas — fire onObjectCreated**

Add `onObjectCreated?: () => void;` to `AnnotationCanvasProps` and destructure it. Change the Stage handlers:
```tsx
          onMouseUp={() => { if (ann.endDraw()) onObjectCreated?.(); }}
          onMouseLeave={() => { if (ann.endDraw()) onObjectCreated?.(); }}
```
Change `submitText`:
```tsx
  const submitText = () => {
    if (textPopup && textInput.trim()) {
      const id = ann.addText(textPopup, textInput, color, strokeWidth);
      if (id) onObjectCreated?.();
    }
    setTextPopup(null); setTextInput('');
  };
```

- [ ] **Step 3: PDFKonvaViewer — fire onObjectCreated**

Add `onObjectCreated?: () => void;` to `PDFKonvaViewerProps` and destructure it in the component params. Change the Stage handlers:
```tsx
              onMouseUp={() => { if (ann.endDraw()) onObjectCreated?.(); }}
              onMouseLeave={() => { if (ann.endDraw()) onObjectCreated?.(); }}
```
Change `submitText`:
```tsx
    const submitText = useCallback(() => {
      if (textPopup && textInput.trim()) {
        const id = ann.addText({ x: textPopup.px, y: textPopup.py }, textInput, color, strokeWidth);
        if (id) onObjectCreated?.();
      }
      setTextPopup(null); setTextInput('');
    }, [textPopup, textInput, color, strokeWidth, ann, onObjectCreated]);
```

- [ ] **Step 4: Thread onObjectCreated through ViewerContainer**

**Read `components/viewers/ViewerContainer.tsx`.** Add `onObjectCreated?: () => void;` to its props, destructure it, and pass `onObjectCreated={onObjectCreated}` down to `<PDFKonvaViewer … />` (alongside the existing `activeTool`/`annotating`/`pdfViewerRef` props).

- [ ] **Step 5: Wire the page to switch to Pointer**

In `app/portal/[id]/page.tsx`: pass `onObjectCreated={() => setActiveTool('pointer')}` to BOTH `<ViewerContainer … />` (which forwards to PDF) and `<AnnotationCanvas … />`.

- [ ] **Step 6: Verify** — `npx tsc --noEmit && npm run lint`; stubbed `npm run build`.
- [ ] **Step 7: Commit** — `git commit -m "feat(portal): auto-select each annotation object after it's created"`

---

### Task 9: Insert-image annotation tool (#1)

**Files:** Modify `components/markup/useAnnotationObjects.ts`, `components/markup/AnnotationObjects.tsx`, `components/markup/AnnotationCanvas.tsx`, `components/viewers/PDFKonvaViewer.tsx`, `components/markup/DrawingTools.tsx`, `app/portal/[id]/page.tsx`.

**Consumes:** the auto-select machinery from Task 8. **Interfaces produced:** `addImage(p, src, width, height): string`; surfaces' imperative handles gain `insertImage(file: File): void`; `DrawingTools` gains `onInsertImage: () => void`.

- [ ] **Step 1: Model — add the image object type**

In `useAnnotationObjects.ts`:
- Change `export type AnnotationObjectType = 'freehand' | 'line' | 'arrow' | 'rect' | 'text';` to add `| 'image'`.
- In `interface AnnotationObject`, add `src: string;` (put it after `text: string; fontSize: number;`).
- In `base(...)`, add `src: '',` to the returned object literal.
- Add this creator (after `addText`):
```tsx
  const addImage = useCallback((p: { x: number; y: number }, src: string, width: number, height: number) => {
    const o = base('image', '#000000', 0);
    o.x = p.x; o.y = p.y; o.src = src; o.width = width; o.height = height;
    setObjects((prev) => [...prev, o]);
    setSelectedId(o.id);
    return o.id;
  }, []);
```
- Add `addImage` to the hook's returned object.

- [ ] **Step 2: Render the image object**

In `AnnotationObjects.tsx`:
- Change the react-konva import to include Image: `import { Line, Arrow, Rect, Text, Image as KonvaImage, Transformer } from 'react-konva';`
- Change the react import to include state: `import { useEffect, useRef, useState } from 'react';`
- Add a loader component above `AnnotationObjects`:
```tsx
function ImageObj({ obj, common }: { obj: AnnotationObject; common: React.ComponentProps<typeof KonvaImage> }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!obj.src) return;
    const i = new window.Image();
    i.onload = () => setImg(i);
    i.src = obj.src;
  }, [obj.src]);
  if (!img) return null;
  return <KonvaImage {...common} image={img} width={obj.width} height={obj.height} />;
}
```
- In `renderObj`'s `switch`, add before `default`:
```tsx
      case 'image':
        return <ImageObj key={obj.id} obj={obj} common={common} />;
```

- [ ] **Step 3: AnnotationCanvas — insertImage handle**

Add `insertImage: (file: File) => void;` to `AnnotationCanvasHandle`. In `useImperativeHandle`, add:
```tsx
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
```

- [ ] **Step 4: PDFKonvaViewer — insertImage handle**

Add `insertImage: (file: File) => void;` to `PDFKonvaViewerHandle`. In `useImperativeHandle`, add (placement in page coords):
```tsx
      insertImage: (file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
          const src = reader.result as string;
          const im = new window.Image();
          im.onload = () => {
            const maxW = pageSize.width * 0.5;
            const maxH = pageSize.height * 0.5;
            const scale = Math.min(maxW / im.width, maxH / im.height, 1);
            const w = im.width * scale;
            const h = im.height * scale;
            ann.addImage({ x: (pageSize.width - w) / 2, y: (pageSize.height - h) / 2 }, src, w, h);
          };
          im.src = src;
        };
        reader.readAsDataURL(file);
      },
```

- [ ] **Step 5: Toolbar — Insert image button**

In `DrawingTools.tsx`: add `onInsertImage: () => void;` to `DrawingToolsProps` and destructure it. Add a button right after the `TOOL_ORDER.map(...)` block (before the Stroke-width dropdown):
```tsx
        {/* Insert image (action, not a mode) */}
        <button title="Insert image" onClick={onInsertImage} className={slot(false)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </button>
```

- [ ] **Step 6: Page — session start refactor + file input + wiring**

In `app/portal/[id]/page.tsx`:
- Add a ref near the other refs: `const imageInputRef = useRef<HTMLInputElement>(null);`
- Add a session-start helper (place near the annotation effects). Reuse the existing snapshot logic:
```tsx
  const startAnnotationSession = useCallback(() => {
    if (annotating) return;
    setAnnotating(true);
    if (!isPDFFile) {
      const container = viewerAreaRef.current;
      setViewerSnapshot(container ? captureViewerSnapshot(container) : null);
    }
  }, [annotating, isPDFFile]);
```
- Update the existing effect that starts a session on draw tools to delegate to it (find the effect that does `setAnnotating(true)` on `DRAW_TOOLS.includes(activeTool)`), replacing its body with:
```tsx
  useEffect(() => {
    if (!DRAW_TOOLS.includes(activeTool)) return;
    startAnnotationSession();
  }, [activeTool, startAnnotationSession]);
```
- Add the insert-image handlers:
```tsx
  const handleInsertImage = () => {
    startAnnotationSession();     // ensure a session (captures the snapshot for non-PDF)
    imageInputRef.current?.click();
  };

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const surface = isPDFFile ? pdfKonvaRef.current : annotationCanvasRef.current;
    surface?.insertImage(file);
    setActiveTool('pointer');
  };
```
- Add the hidden input inside the returned JSX (e.g. just inside the root wrapper div):
```tsx
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
```
- Pass `onInsertImage={handleInsertImage}` to `<DrawingTools … />`.

- [ ] **Step 7: Verify** — `npx tsc --noEmit && npm run lint`; stubbed `npm run build`.
- [ ] **Step 8: Commit** — `git commit -m "feat(portal): insert-image annotation tool (place a local image on the snapshot)"`

---

### Task 10: End-to-end verification

- [ ] **Step 1:** `npx tsc --noEmit && npm run lint && <stubbed> npm run build` — all clean.
- [ ] **Step 2: Static visual check** of the new/changed UI (Share modal, relocated Submit button, comment Edit/Delete controls, new toolbar Insert-image button + eraser cursor) via a faithful preview where feasible; otherwise confirm markup against the design system.
- [ ] **Step 3: Code-read functional sweep** — confirm: insert-image starts a session + adds a selected image; Delete key erases selection; eraser cursor set on both surfaces; comment edit/delete guarded by ownership + cascade; 3D snapshot composites `#f0f0f0`; auto-select flips to Pointer; Submit at panel bottom; Share creates invite links.
- [ ] **Step 4:** Commit any cleanup.

## Self-review notes
- **Coverage:** #5→T1, #4→T2/T3, #7→T4, #8→T5, #3→T6, #2→T7, #6→T8, #1→T9. All spec decisions mapped.
- **Type consistency:** `addImage`/`insertImage`/`onObjectCreated`/`onInsertImage`/`onCommentsChanged`/`Comment.userId`/`AnnotationObject.src` are defined in the task that introduces them and consumed consistently. `endDraw`/`addText` return `string | null` (T8) and T9's `addImage` returns `string` — surfaces only branch on truthiness.
- **Ordering:** T8 precedes T9 (T9 relies on the tool→pointer + select behavior). T6/T7 are independent small annotation changes. T2 precedes T3 (userId type).
