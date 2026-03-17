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
