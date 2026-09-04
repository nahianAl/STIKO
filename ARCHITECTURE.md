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
  snapshots/{projectId}/{portalId}/{uuid}.jpg
```

### Deletion

Deleting a file, version, package or project now removes its objects from the bucket too, via `deleteObjects` in `lib/s3.ts` — previously only the Neon rows went away, and the bucket kept growing forever. Cleanup runs after those rows are gone, never before: a storage failure at that point strands an object rather than turning a completed delete into an error response, and the reverse order risks the opposite failure — a file still listed with its bytes already gone.

All four scopes gather their keys through the same helper, `storageKeysForFiles` in `lib/access.ts`, so none of them can quietly diverge on what "this file's objects" means. It walks four kinds of object: the upload itself, its optimized viewer variant, any annotation snapshot named in `comments.snapshot_url`, and any comment attachment named in `comments.attachments[].storageKey`. The last two matter because comments cascade with the file — once those rows are gone, nothing in the database names those objects, so they must be collected before the delete runs, not after.

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

Both steps are now authorized. Before this branch, neither `/api/files/upload` (the presign step above) nor `/api/files/complete` checked for a session at all — either would act for any caller who knew a version id. Both now require a session and `canUpload` on the version's package, and the storage key's project and package segments are derived from the version server-side rather than taken from the request body, so an uploader on one package cannot write objects under another's prefix.

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
`canDeleteContent` in `lib/capabilities.ts` holds the whole policy and touches no database — it takes a role plus two booleans (own upload, version published) and returns yes or no, so it can be asserted by a test with no live connection. `getFileDeleteDecision` and `getVersionDeleteDecision` in `lib/access.ts` are its only callers: they resolve those facts from Neon and hand back the verdict together with the storage keys cleanup will need once the row is gone.

Owners and coordinators may delete any file or version. An uploader may delete their own file only up to the moment its version publishes — deleting a file cascades every comment and markup on it, so this is the power to erase someone else's review work, not just tidy up one's own, and the window closes the instant anyone else could have opened the file. A version is never "own upload": one version can hold files from several uploaders, so only owners and coordinators may take down a whole version. Commenters and viewers never delete anything. There is no trash and no undo.

Version numbers are never reused once a version is gone. They already appear in comments, notifications, verdicts and mail already sent, so closing the gap by renumbering would silently repoint all of those at different content — the gap is permanent instead.

```
DELETE /api/files/[id]     (Vercel: getFileDeleteDecision → Neon)
DELETE /api/versions/[id]  (Vercel: getVersionDeleteDecision → Neon)
  ← 404  no such row, or no access to its package
  ← 403  caller can see the package, but canDeleteContent said no
  → DELETE FROM files / versions   (Neon; comments and markups cascade)
  → deleteObjects(storageKeys)     (lib/s3.ts, after the row — see S3 Bucket Structure)
```

A 404 covers "no such row" and "no access to its package" alike, so an id can never be used to confirm something exists behind a boundary the caller cannot cross; a 403 only appears once the caller can already see the package.

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
