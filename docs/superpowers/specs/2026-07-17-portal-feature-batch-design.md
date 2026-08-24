# Portal Feature Batch — Design

**Date:** 2026-07-17
**Status:** Approved (design), pending implementation plan
**Scope:** Eight portal-page features across the Konva annotation stack, the 3D snapshot path, comment CRUD, and the header/version-panel/share UI. All UI adheres to the existing "1C Soft" design system (stiko tokens, gradient primary, Manrope).

---

## Features & locked decisions

| # | Feature | Decision |
|---|---------|----------|
| 1 | Insert-image annotation | An **action button** in the toolbar's annotation group (NOT a tool mode). Click → start the annotation session (snapshot) → open a local file picker → the image is placed centered on top of the snapshot as a normal Konva object (move/scale/rotate/erase), auto-selected, and baked into the Done JPEG. Works on all annotatable types (image/PDF/3D/video). |
| 2 | Delete-key erases selection | `keydown` Delete/Backspace on each Konva surface deletes the selected object; suppressed while the text-entry input is focused. |
| 3 | Eraser cursor | When the eraser tool is active, the canvas cursor becomes a custom eraser-SVG data-URI cursor (replaces `not-allowed`). |
| 4 | Comment edit & delete by owner | Client shows Edit (inline) + Delete only when `comment.userId === session.user.id`. Uses existing `PUT`/`DELETE /api/comments/[id]`. **Server hardened** (require session; owner-only; block anonymous edits by non-owners) and **cascade-deletes replies**. |
| 5 | 3D snapshot bg not black | In `captureViewerSnapshot`, composite the transparent WebGL canvas onto the viewer's real bg `#f0f0f0` before JPEG encoding. 3D-only. |
| 6 | Auto-select after each action | `endDraw()`/`addText()`/`addImage()` select the new object; each surface then flips `activeTool` to `pointer` (via a callback to the page) so the selection is visible. Tradeoff: drawing another shape needs re-picking the tool. |
| 7 | Move "Submit new version" | Remove from the header; render as a gradient-primary button pinned to the **bottom of the version panel** (`FileTreeSidebar`), linking to `/portal/[id]/submit`. Hidden when the panel is collapsed. |
| 8 | Header "Share" | New Share button in the old submit spot opens a soft modal: **Invite by email** (email + role → create invite token → show copyable `…/invite/{token}`) and **Share link** (role → copyable invite link, `email:''`). Both call `POST /api/participants`. Roles: viewer/commenter/uploader. |

---

## Architecture notes

### Annotation stack (features 1, 2, 3, 6)
Two Konva surfaces share one model:
- `components/markup/useAnnotationObjects.ts` — object model (`objects`, `draft`, `selectedId`, CRUD).
- `components/markup/AnnotationObjects.tsx` — renders objects + a single `Transformer`.
- `components/markup/AnnotationCanvas.tsx` — non-PDF surface (background = captured JPEG).
- `components/viewers/PDFKonvaViewer.tsx` — PDF surface (background = live PDF page).
- `app/portal/[id]/page.tsx` — session lifecycle, `activeTool`, snapshot capture, Done/Discard.

Key facts driving the design:
- Selection only shows in `pointer` mode; a per-surface effect clears `selectedId` whenever `activeTool !== 'pointer'`. So **auto-select requires switching the tool to `pointer`** after creating an object (done via a new `onObjectCreated` callback the page wires to `setActiveTool('pointer')`).
- Flatten-on-Done is `stage.toDataURL()` over the whole stage, so **any Konva node (including an inserted image) is baked in automatically** — no special Done handling.
- **Insert-image is an action, not a tool** → it does NOT enter the `AnnTool`/`ToolType` unions (avoids syncing four copies). It's exposed via a new `insertImage(file)` on each surface's imperative handle, invoked from the page after ensuring a session is active. Triggering the file picker stays within the toolbar-button user gesture.

### Comments (feature 4)
`GET /api/comments` already returns `userId` per row; the `Comment` TS type must add `userId?: string | null`. The client reads `useSession()` (SessionProvider already wraps the app) and needs a `types/next-auth.d.ts` augmentation so `session.user.id` is typed. Mutations happen inside `CommentsPanel`; a new callback refreshes the page's pin copy (`commentsRefreshKey`) so viewport pins stay in sync. Server `[id]` route hardened + cascade delete of `parent_comment_id = id`.

### 3D snapshot (feature 5)
`captureViewerSnapshot`'s canvas branch (`app/portal/[id]/page.tsx`) currently does `canvas.toDataURL('image/jpeg')` on a transparent WebGL buffer → JPEG flattens transparency to black. Fix: draw the canvas onto an offscreen 2D canvas pre-filled with `#f0f0f0` (mirrors the existing `img`/`video` branches), then encode. The canvas branch is only hit by the 3D viewer (PDF uses its own capture; image/video use their own branches).

### Share/invite (features 7, 8)
`POST /api/participants { portalId, email, role }` inserts an `invite_tokens` row (7-day expiry) and returns `{ token }`; the link is `${origin}/invite/{token}`. `invite_tokens.email` is `NOT NULL` → the general share link sends `email: ''`. No email is sent (matches decision). Submit moves to `FileTreeSidebar` bottom; Share modal built on `components/ui/Modal.tsx` restyled to soft tokens (or a soft wrapper).

---

## Data flow / preservation
No change to the annotation session lifecycle, viewer wiring, comment fetch/refresh contracts, or routes beyond what's listed. Existing features preserved (drawing/erase-by-click, pins, threads/replies/attachments, participants popover, collapse). New server behavior: hardened comment ownership + reply cascade.

## Testing / verification
No test runner (unchanged). Gate per task: `npx tsc --noEmit` + `npm run lint` + `npm run build` (stubbed env). UI-bearing tasks additionally visually verified via a faithful static browser preview (as used for the sidebar) where the live app can't be driven (needs DB/auth). Functional flows (annotate/insert-image/delete-key/edit-comment/share) confirmed by code-reading against the maps; live QA is the user's (app needs DB/auth/seeded portal).

## Build sequence (one plan, sequential tasks)
5 (3D bg) → 4-server → 4-client → 7 (submit move) → 8 (share) → 3 (eraser cursor) → 2 (delete key) → 6 (auto-select) → 1 (insert image). Annotation-stack features last, in dependency order (6 adds `onObjectCreated`; 1 builds on the same surfaces).

## Out of scope
Email sending; public no-login portal links; who-may-invite authorization changes; re-theming the 3D viewer bg; tests/framework.
