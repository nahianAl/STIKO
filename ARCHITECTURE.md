# Stiko — Deployment Architecture

## Services

| Layer | Service |
|---|---|
| Frontend + API + Auth | Vercel (Next.js serverless functions) |
| Database | Neon (PostgreSQL, serverless driver) |
| File Storage | AWS S3 |
| Authentication | Auth.js (NextAuth v5) |

**Excluded (used in other projects):** Clerk, Cloudflare, Render.

---

## Auth Model

| Role | Auth Required | How They Access |
|---|---|---|
| Owner | Yes — Auth.js session | Signs up / logs in directly |
| Coordinator | Yes — Auth.js session | Added to `project_members` by owner → sees every portal in the project |
| Uploader | Yes — Auth.js session | Invite link → signup/login → portal access granted |
| Commenter | Yes — Auth.js session | Invite link → signup/login → portal access granted |
| Viewer | No | Direct portal URL, no login required |

---

## Route Protection

```
/                          → owner auth required
/project/[id]              → owner auth required
/portal/[id]               → public (viewer) OR authenticated (owner/commenter)
/portal/[id]/submit        → auth required + uploader role for that portal
/invite/[token]            → public (pre-auth landing page)
```

---

## S3 Bucket Structure

```
{bucket}/
  uploads/{projectId}/{portalId}/{versionId}/{filename}
  snapshots/{uuid}.{ext}          # flat, no project/portal segment — see Deletion below
```

### Deletion

Deleting a file, version, portal or project now removes its objects from the bucket too, via `deleteObjects` in `lib/s3.ts` — previously only the Neon rows went away, and the bucket kept growing forever. Cleanup runs after those rows are gone, never before: a storage failure at that point strands an object rather than turning a completed delete into an error response, and the reverse order risks the opposite failure — a file still listed with its bytes already gone.

All four scopes gather their keys through the same helper, `storageKeysForFiles` in `lib/access.ts`, so none of them can quietly diverge on what "this file's objects" means. It collects two kinds of object: the upload itself and its optimized viewer variant.

Annotation snapshots (`comments.snapshot_url`) and comment attachments (`comments.attachments[].storageKey`) also go unreachable once their file's comments cascade, but are deliberately **not** collected. Both namespaces are minted flat — `snapshots/{uuid}` and `comment-attachments/{uuid}`, no project or portal segment — and `/api/comments` stores whichever key the caller supplies, so collecting them would let a commenter name another package's object on their own comment and destroy it. They leak instead, as they did before deletion existed. Collection can resume once both namespaces carry a portal segment and the routes that mint them require a session — not before.

Objects orphaned by deletions made before this change are not recovered here; finding them would mean reasoning from bucket contents instead of the database.

---

## Data Flow

### Auth Flow
```
Browser → /api/auth/** (Auth.js on Vercel)
        → Neon: users, sessions, accounts tables
        ← JWT cookie set on browser
```

### Invite Flow (uploader + commenter only)
```
Owner sends invite
  → POST /api/invite
  → Neon: insert invite_tokens { token, portalId, role, email, expiresAt }
  ← returns /invite/{token}

Invitee opens /invite/{token}
  → redirected to login / signup page
  → on auth complete, token is consumed (usedAt set)
  → Neon: insert participants { portalId, userId, role }
  → redirected to portal (commenter) or submit page (uploader)
```

### File Upload Flow
Vercel serverless functions have a 4.5MB body limit. All file uploads bypass Vercel entirely using S3 presigned URLs — the client uploads directly to S3.

```
Client
  → POST /api/files/presign   (Vercel: generates S3 presigned PUT URL)
  ← { presignedUrl, storageKey }
  → PUT {presignedUrl}        (direct to S3, no Vercel in path)
  → POST /api/files/complete  (Vercel: writes FileRecord to Neon)
```

Both steps now require a session and `canUpload` on the version's portal — previously neither checked auth at all. `/api/files/upload` derives the storage key's project and portal segments from the version server-side, never the request body; `/api/files/complete` re-derives that same key from the version and rejects the request if the caller's `storageKey` doesn't match.

### File Viewing Flow
Files are served directly from S3 (public-read on the uploads prefix). Vercel is not in the streaming path.

```
GET /api/files?versionId=x  (Vercel → Neon)
← FileRecord[] with storageKey

Viewer constructs URL:
  https://{bucket}.s3.{region}.amazonaws.com/{storageKey}

Video / image / PDF / GLB streamed directly from S3
```

### Comment + Snapshot Flow
```
Client composites snapshot + SVG markup (canvas, client-side)
  → POST /api/snapshots/presign  (Vercel: generates S3 presigned PUT URL)
  → PUT {presignedUrl}           (direct to S3)
  ← S3 URL

POST /api/comments  (Vercel)
  → INSERT into Neon comments with snapshotUrl, userId, position, content
```

### Deletion Flow
`canDeleteContent` in `lib/capabilities.ts` is pure — role plus two booleans in, yes/no out — testable with no database. `getFileDeleteDecision` and `getVersionDeleteDecision` in `lib/access.ts` call it to enforce deletion, resolving the booleans from Neon and returning the verdict with the storage keys to clean up. The GET handlers in `files/route.ts` and `versions/route.ts` call it too, only for the client's `canDelete` hint — never as the gate.

Owners and coordinators may delete any file or version. An uploader may delete their own file, but only before its version publishes. A version is never "own upload" — one version can hold files from several uploaders — so only owners and coordinators delete versions. Commenters and viewers can't delete anything. No trash, no undo.

Deleted version numbers are never reused: they already appear in comments, notifications, verdicts and sent mail, and renumbering would silently repoint those at different content.

```
DELETE /api/files/[id]     (Vercel: getFileDeleteDecision → Neon)
DELETE /api/versions/[id]  (Vercel: getVersionDeleteDecision → Neon)
  ← 404  no such row, or no access to its portal
  ← 403  caller can see the portal, but canDeleteContent said no
  → DELETE FROM files / versions   (Neon; comments and markups cascade)
  → deleteObjects(storageKeys)     (lib/s3.ts, after the row — see S3 Bucket Structure)
```

A 404 covers both "no such row" and "no access to its portal", so an id can't confirm something exists behind a boundary the caller can't cross; 403 only appears once the caller can already see the portal.

### Download Flow
`canDownloadFile` in `lib/capabilities.ts` holds the rule, in the same pure role-plus-booleans shape as `canDeleteContent`. `getFileDeleteDecision`'s sibling, `getFileDownloadDecision` in `lib/access.ts`, resolves those booleans from Neon and returns the verdict together with `storage_key` — never `converted_storage_key`: a download is the file as the uploader supplied it, not the copy the viewer prefers.

Owners and coordinators download anything, and an uploader always gets their own uploads back. Everyone else — including an uploader after someone else's file — needs `can_download` granted to them specifically. The grant is decided per person when they're invited and changeable afterwards from the portal's People page, so two commenters on the same portal can differ.

Share links are unaddressed by design — a link can be forwarded to anyone — so the grant is not something their UI omits, it's something the server refuses: `POST /api/participants` forces `can_download` false whenever `shareLink` is true, regardless of what the request body asked for. The same false is what gets copied into `participants.can_download` when the link is redeemed, and it stays there until an owner or coordinator changes it from the People page.

```
GET /api/files/[id]/download   (Vercel: getFileDownloadDecision → Neon)
  ← 401  no session
  ← 404  no such file, or no access to its portal
  ← 403  caller can see the portal, but canDownloadFile said no
  → getDownloadPresignedUrl(storage_key)   Content-Disposition: attachment
```

**What this does not stop.** The grant gates the control and this endpoint, not the bytes. `ViewerContainer` fetches a presigned URL unconditionally, for `convertedStorageKey ?? storageKey` — the `isViewable` check runs after that fetch and only decides what gets rendered with the result. Most files have no converted variant, so that URL usually names the original outright — and where a variant does exist, the same ungated call fetches it instead. Anyone who can view a file can therefore already save it from the browser's network tab, whatever `can_download` says. A real wall would mean proxying every view through the app server instead of straight from the bucket — deliberately not done here.

### Metadata Reads / Writes
```
All project / portal / version / comment / markup CRUD
  → /api/** (Vercel serverless)
  → Neon via @neondatabase/serverless driver (connection pooling built in)
```

---

## Neon Schema

### Auth.js managed tables
```sql
users               (id, name, email, emailVerified, image)
accounts            (userId, provider, providerAccountId, ...)
sessions            (sessionToken, userId, expires)
verification_tokens (identifier, token, expires)
```

### Application tables
```sql
invite_tokens (
  id, token, portal_id, role, email, expires_at, used_at, created_at
)

projects (
  id, owner_id, name, created_at
)

portals (
  id, project_id, name, created_at
)

participants (
  id, portal_id, user_id, role, created_at
)

versions (
  id, portal_id, version_number, created_at
)

files (
  id, version_id, filename, storage_key, file_size, file_type, created_at
)

comments (
  id, file_id, user_id, parent_comment_id,
  content, x_position, y_position, snapshot_url, created_at
)

markups (
  id, file_id, type, data, style, created_at
)
```

---

## Full Architecture Diagram

```
Browser
  ├── Auth (owner / uploader / commenter)
  │     → /api/auth/**           Vercel (Auth.js)
  │     → Neon                   users, sessions, accounts
  │
  ├── Invite flow
  │     → /api/invite/**         Vercel
  │     → Neon                   invite_tokens, participants
  │
  ├── Metadata reads / writes
  │     → /api/**                Vercel serverless
  │     → Neon                   projects, portals, versions,
  │                              files, comments, markups
  │
  ├── File uploads  (bypasses Vercel body limit)
  │     → /api/files/presign     Vercel → S3 presigned URL
  │     → PUT directly to S3     client → S3
  │     → /api/files/complete    Vercel → Neon
  │
  ├── Snapshot uploads
  │     → /api/snapshots/presign Vercel → S3 presigned URL
  │     → PUT directly to S3     client → S3
  │     → snapshotUrl saved in   Neon comments
  │
  └── File viewing / streaming
        → public S3 URLs         direct, no Vercel in path
```

---

## Migration Notes

- **Existing data:** Start fresh. No migration of test JSON data.
- **Local `/public/uploads`:** Replaced entirely by S3. `storageKey` in the files table becomes a full S3 object key.
- **`/data/*.json` flat files:** Replaced entirely by Neon. The `lib/db.ts` helper is replaced by SQL queries via `@neondatabase/serverless`.
- **Snapshot API route (`/api/snapshots`):** Currently writes to local disk. Replaced by presign → direct S3 upload flow.
- **`005-file-deletion.sql`:** Adds `files.uploaded_by`, backfilled from `versions.created_by` for existing rows so the uploader-delete window has an owner to check against. Apply before deploying code that reads the column.
- **`007-download-authorization.sql`:** Adds `can_download` to `participants` and `invite_tokens`, both defaulting false. Apply before deploying code that reads them.

---

## Implementation Order

1. Set up Neon — create schema, configure `@neondatabase/serverless` driver
2. Set up Auth.js — email/password + session storage in Neon
3. Migrate API routes from JSON flat files → SQL (Neon)
4. Set up S3 bucket — configure CORS, public-read policy for uploads prefix
5. Replace local file upload with presigned URL flow
6. Replace snapshot local write with presigned URL flow
7. Add Next.js middleware for route protection
8. Build invite token flow (`/invite/[token]` page + API)
