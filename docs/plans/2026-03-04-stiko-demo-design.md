# Stiko Local Demo — Design

## Architecture

**Next.js 14 (App Router)** with API routes that read/write JSON files to a local `data/` directory. This gives us:
- Real API routes that map 1:1 to future backend endpoints
- File uploads stored to `public/uploads/` (served statically)
- JSON files in `data/` as the "database" — one file per table (`portals.json`, `versions.json`, `files.json`, `comments.json`, `projects.json`, `participants.json`)
- A data access layer with functions like `getPortals()`, `createVersion()` etc. — later swapped for real DB queries

## Data Model

Follows the spec closely:

```
Project → Portals → Versions → Files → Comments
                  → Participants
```

- **Projects** — id, name, createdAt
- **Portals** — id, projectId, name, createdAt
- **Participants** — id, portalId, email, role (viewer/commenter/uploader)
- **Versions** — id, portalId, versionNumber, createdAt
- **Files** — id, versionId, filename, storageKey, fileSize, fileType, createdAt
- **Comments** — id, fileId, parentCommentId, content, xPosition, yPosition, createdAt, author
- **Markups** — id, fileId, type (freehand/line/arrow/rect), data (JSON path/coords), style (color/strokeWidth), createdAt

## Pages

| Route | Purpose |
|---|---|
| `/` | Dashboard — list projects |
| `/project/[id]` | Project view — list portals |
| `/portal/[id]` | **Core 3-panel view** — versions (left), file viewer (center), comments (right) |
| `/portal/[id]/submit` | Upload files to create new version |

## File Viewers

- **PDF** — `react-pdf` (wraps PDF.js), multi-page with page switcher
- **Images** — Native `<img>` with zoom/pan (CSS transforms)
- **Video** — HTML5 `<video>` with standard controls
- **3D (GLB/glTF)** — `@react-three/fiber` + `@react-three/drei` for orbit controls, lighting

## Markup & Comments

- Transparent canvas overlay on top of file viewers (using HTML Canvas or SVG)
- Click anywhere → place comment pin with text input
- Drawing tools: freehand, line, arrow, rectangle
- Style options: color picker, stroke width
- All stored as JSON in `markups.json` and `comments.json`

## Sharing (UI only)

- "Invite" form on portal page — enter email, select role
- Stored in `participants.json`
- Participant list displayed in portal view
- No actual email sent

## Tech Stack

- Next.js 14 (App Router)
- React 18
- TailwindCSS
- `@react-three/fiber` + `@react-three/drei` (3D)
- `react-pdf` (PDF viewing)
- `uuid` (ID generation)

## Folder Structure

```
stiko/
├── app/
│   ├── page.tsx                    # Dashboard
│   ├── project/[id]/page.tsx       # Project → portals list
│   ├── portal/[id]/page.tsx        # 3-panel portal view
│   ├── portal/[id]/submit/page.tsx # Upload/submit version
│   └── api/
│       ├── projects/               # CRUD
│       ├── portals/                # CRUD
│       ├── versions/               # Create + list
│       ├── files/                  # Upload + metadata
│       ├── comments/               # CRUD
│       ├── markups/                # CRUD
│       └── participants/           # CRUD
├── components/
│   ├── viewers/                    # PDFViewer, ImageViewer, VideoViewer, ModelViewer
│   ├── markup/                     # MarkupOverlay, DrawingTools
│   ├── portal/                     # VersionTimeline, CommentsPanel, FileList
│   └── ui/                         # Shared UI components
├── lib/
│   └── db.ts                       # JSON file read/write helpers
├── data/                           # JSON "database" files
└── public/uploads/                 # Uploaded files
```

## Decisions

- No authentication for demo — all actions are anonymous
- JSON file persistence — swappable for PostgreSQL later
- Participants/roles stored but not enforced (no auth to enforce against)
- Seed data not included — user creates everything from scratch
- Email sharing is UI-only — no emails sent
