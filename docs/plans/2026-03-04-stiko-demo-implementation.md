# Stiko Local Demo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a working local demo of Stiko — a portal-based file sharing, viewing, and commenting platform.

**Architecture:** Next.js 14 App Router with API routes persisting to local JSON files. File uploads stored to disk. 3-panel portal view with file viewers for PDF, images, video, and 3D GLB models.

**Tech Stack:** Next.js 14, React 18, TailwindCSS, @react-three/fiber, @react-three/drei, react-pdf, uuid

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `next.config.mjs`, `app/layout.tsx`, `app/globals.css`
- Create: `data/`, `public/uploads/`

**Step 1: Initialize Next.js project**

Run: `cd /Users/jjc4/Desktop/Stiko && npx create-next-app@14 . --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --use-npm`

Accept defaults. This creates the full scaffold.

**Step 2: Install dependencies**

Run:
```bash
npm install uuid react-pdf @react-three/fiber @react-three/drei three
npm install -D @types/uuid @types/three
```

**Step 3: Create data directories and seed files**

Create empty JSON array files:
- `data/projects.json` → `[]`
- `data/portals.json` → `[]`
- `data/participants.json` → `[]`
- `data/versions.json` → `[]`
- `data/files.json` → `[]`
- `data/comments.json` → `[]`
- `data/markups.json` → `[]`

Create upload directory:
- `public/uploads/.gitkeep`

**Step 4: Verify it runs**

Run: `npm run dev`
Expected: App starts on localhost:3000

**Step 5: Commit**

```bash
git init && git add -A && git commit -m "chore: scaffold Next.js project with dependencies"
```

---

### Task 2: Data Access Layer

**Files:**
- Create: `lib/db.ts`
- Create: `lib/types.ts`

**Step 1: Create types**

`lib/types.ts`:
```typescript
export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface Portal {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
}

export interface Participant {
  id: string;
  portalId: string;
  email: string;
  role: 'viewer' | 'commenter' | 'uploader';
  createdAt: string;
}

export interface Version {
  id: string;
  portalId: string;
  versionNumber: number;
  createdAt: string;
}

export interface FileRecord {
  id: string;
  versionId: string;
  filename: string;
  storageKey: string;
  fileSize: number;
  fileType: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  fileId: string;
  parentCommentId: string | null;
  content: string;
  xPosition: number | null;
  yPosition: number | null;
  author: string;
  createdAt: string;
}

export interface Markup {
  id: string;
  fileId: string;
  type: 'freehand' | 'line' | 'arrow' | 'rect';
  data: any; // path points, coordinates, etc.
  style: { color: string; strokeWidth: number };
  createdAt: string;
}
```

**Step 2: Create data access helpers**

`lib/db.ts`:
```typescript
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

function getFilePath(collection: string): string {
  return path.join(DATA_DIR, `${collection}.json`);
}

export function readCollection<T>(collection: string): T[] {
  const filePath = getFilePath(collection);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

export function writeCollection<T>(collection: string, data: T[]): void {
  const filePath = getFilePath(collection);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function addItem<T>(collection: string, item: T): T {
  const data = readCollection<T>(collection);
  data.push(item);
  writeCollection(collection, data);
  return item;
}

export function getById<T extends { id: string }>(collection: string, id: string): T | undefined {
  return readCollection<T>(collection).find(item => item.id === id);
}

export function updateItem<T extends { id: string }>(collection: string, id: string, updates: Partial<T>): T | undefined {
  const data = readCollection<T>(collection);
  const index = data.findIndex(item => item.id === id);
  if (index === -1) return undefined;
  data[index] = { ...data[index], ...updates };
  writeCollection(collection, data);
  return data[index];
}

export function deleteItem<T extends { id: string }>(collection: string, id: string): boolean {
  const data = readCollection<T>(collection);
  const filtered = data.filter(item => item.id !== id);
  if (filtered.length === data.length) return false;
  writeCollection(collection, filtered);
  return true;
}

export function filterBy<T>(collection: string, predicate: (item: T) => boolean): T[] {
  return readCollection<T>(collection).filter(predicate);
}
```

**Step 3: Commit**

```bash
git add lib/ && git commit -m "feat: add data access layer and type definitions"
```

---

### Task 3: API Routes — Projects & Portals

**Files:**
- Create: `app/api/projects/route.ts`
- Create: `app/api/projects/[id]/route.ts`
- Create: `app/api/portals/route.ts`
- Create: `app/api/portals/[id]/route.ts`

**Step 1: Projects CRUD API**

`app/api/projects/route.ts` — GET (list all), POST (create)
`app/api/projects/[id]/route.ts` — GET (single), DELETE

**Step 2: Portals CRUD API**

`app/api/portals/route.ts` — GET (list, filter by projectId query param), POST (create)
`app/api/portals/[id]/route.ts` — GET (single), DELETE

**Step 3: Verify with curl**

```bash
curl -X POST http://localhost:3000/api/projects -H "Content-Type: application/json" -d '{"name":"Test Project"}'
curl http://localhost:3000/api/projects
```

**Step 4: Commit**

```bash
git add app/api/ && git commit -m "feat: add projects and portals API routes"
```

---

### Task 4: API Routes — Versions, Files, Comments, Participants, Markups

**Files:**
- Create: `app/api/versions/route.ts`
- Create: `app/api/files/upload/route.ts`
- Create: `app/api/files/[id]/route.ts`
- Create: `app/api/comments/route.ts`
- Create: `app/api/comments/[id]/route.ts`
- Create: `app/api/participants/route.ts`
- Create: `app/api/participants/[id]/route.ts`
- Create: `app/api/markups/route.ts`
- Create: `app/api/markups/[id]/route.ts`

**Step 1: Versions API**

GET (filter by portalId), POST (auto-increment versionNumber)

**Step 2: Files upload API**

POST `/api/files/upload` — accepts multipart form data, saves file to `public/uploads/{versionId}/{filename}`, creates FileRecord.

GET `/api/files/[id]` — returns file metadata.

**Step 3: Comments API**

GET (filter by fileId), POST (create with position), DELETE

**Step 4: Participants API**

GET (filter by portalId), POST (create), DELETE

**Step 5: Markups API**

GET (filter by fileId), POST (create), DELETE

**Step 6: Commit**

```bash
git add app/api/ && git commit -m "feat: add versions, files, comments, participants, markups APIs"
```

---

### Task 5: Dashboard Page (Project List)

**Files:**
- Modify: `app/page.tsx`
- Create: `components/ui/Button.tsx`
- Create: `components/ui/Modal.tsx`
- Create: `components/ui/EmptyState.tsx`

**Step 1: Build shared UI components**

Button, Modal (for create dialogs), EmptyState.

**Step 2: Build Dashboard page**

- Lists all projects as cards
- "Create Project" button opens modal with name input
- Each project card links to `/project/[id]`
- Shows portal count per project

**Step 3: Verify**

Visit localhost:3000, create a project, see it listed.

**Step 4: Commit**

```bash
git add app/page.tsx components/ && git commit -m "feat: add dashboard page with project creation"
```

---

### Task 6: Project Page (Portal List)

**Files:**
- Create: `app/project/[id]/page.tsx`

**Step 1: Build Project page**

- Header with project name and back link
- Lists all portals for this project
- "Create Portal" button → modal with name input
- Each portal card shows version count, links to `/portal/[id]`
- "Invite Participant" option on each portal card

**Step 2: Commit**

```bash
git add app/project/ && git commit -m "feat: add project page with portal listing and creation"
```

---

### Task 7: Portal View — 3-Panel Layout

**Files:**
- Create: `app/portal/[id]/page.tsx`
- Create: `components/portal/VersionTimeline.tsx`
- Create: `components/portal/FileList.tsx`
- Create: `components/portal/CommentsPanel.tsx`
- Create: `components/portal/ParticipantsList.tsx`

**Step 1: Build the 3-panel layout**

Left panel (versions timeline), center (file viewer area), right (comments panel).
Use CSS grid or flexbox. Resizable is nice-to-have, fixed widths for now.

**Step 2: VersionTimeline component**

- Lists versions for portal, newest first
- Each shows: version number, date, "Submitted by" (anonymous for now)
- Click version → loads its files

**Step 3: FileList component**

- Shows files in selected version as clickable tabs/list
- Click file → loads in viewer

**Step 4: CommentsPanel component**

- Lists comments for selected file
- Threaded (replies nested under parent)
- "Add comment" input at bottom
- Each comment shows author, time, content

**Step 5: ParticipantsList component**

- Accessible via button/icon in portal header
- Shows invited participants with roles
- "Invite" form: email input + role dropdown

**Step 6: "Submit New Version" button**

Links to `/portal/[id]/submit`

**Step 7: Commit**

```bash
git add app/portal/ components/portal/ && git commit -m "feat: add 3-panel portal view with version timeline and comments"
```

---

### Task 8: Version Submit Page (File Upload)

**Files:**
- Create: `app/portal/[id]/submit/page.tsx`
- Create: `components/ui/FileDropzone.tsx`

**Step 1: Build FileDropzone**

- Drag-and-drop zone with click-to-browse fallback
- Shows list of selected files with names and sizes
- Remove button per file

**Step 2: Build Submit page**

- FileDropzone for selecting files
- "Submit Version" button
- On submit: POST to create version, then upload each file
- Redirect to portal view after success

**Step 3: Commit**

```bash
git add app/portal/ components/ui/FileDropzone.tsx && git commit -m "feat: add version submission with drag-and-drop file upload"
```

---

### Task 9: File Viewers — Image & Video

**Files:**
- Create: `components/viewers/ImageViewer.tsx`
- Create: `components/viewers/VideoViewer.tsx`
- Create: `components/viewers/ViewerContainer.tsx`

**Step 1: ViewerContainer**

Wrapper that picks the right viewer based on file type. Also hosts the markup overlay.

**Step 2: ImageViewer**

- Renders image with zoom (scroll wheel) and pan (click-drag)
- Uses CSS transforms on a container

**Step 3: VideoViewer**

- HTML5 `<video>` with native controls
- Accepts any browser-supported format

**Step 4: Commit**

```bash
git add components/viewers/ && git commit -m "feat: add image and video viewers with zoom/pan"
```

---

### Task 10: File Viewer — PDF

**Files:**
- Create: `components/viewers/PDFViewer.tsx`
- Modify: `next.config.mjs` (webpack config for pdf.js worker)

**Step 1: Configure pdf.js worker**

react-pdf needs the PDF.js worker configured. Add webpack config in next.config.mjs to handle the worker file.

**Step 2: PDFViewer component**

- Renders PDF pages using react-pdf's Document and Page components
- Page navigation (prev/next + page number display)
- Zoom controls

**Step 3: Commit**

```bash
git add components/viewers/PDFViewer.tsx next.config.mjs && git commit -m "feat: add PDF viewer with page navigation and zoom"
```

---

### Task 11: File Viewer — 3D GLB/glTF

**Files:**
- Create: `components/viewers/ModelViewer.tsx`

**Step 1: ModelViewer component**

- Uses @react-three/fiber Canvas
- Loads GLB/glTF with useGLTF from drei
- OrbitControls for rotate/zoom/pan
- Basic lighting (ambient + directional)
- Grid helper for ground reference

**Step 2: Commit**

```bash
git add components/viewers/ModelViewer.tsx && git commit -m "feat: add 3D GLB/glTF viewer with orbit controls"
```

---

### Task 12: Markup Overlay & Drawing Tools

**Files:**
- Create: `components/markup/MarkupOverlay.tsx`
- Create: `components/markup/DrawingTools.tsx`
- Create: `components/markup/CommentPin.tsx`

**Step 1: MarkupOverlay**

- SVG overlay positioned absolutely over the viewer
- Renders existing markups (lines, arrows, rects, freehand paths)
- Renders comment pins at their x,y positions
- Click on overlay in "comment mode" → place new pin → show text input

**Step 2: DrawingTools toolbar**

- Tool selector: pointer, comment, freehand, line, arrow, rectangle
- Color picker (preset colors)
- Stroke width selector (thin/medium/thick)
- Active tool highlighted

**Step 3: CommentPin**

- Small numbered circle at x,y position
- Click to highlight corresponding comment in panel
- Hover to show preview

**Step 4: Commit**

```bash
git add components/markup/ && git commit -m "feat: add markup overlay with drawing tools and comment pins"
```

---

### Task 13: Wire Everything Together

**Files:**
- Modify: `app/portal/[id]/page.tsx`
- Modify: `components/viewers/ViewerContainer.tsx`

**Step 1: Connect viewer selection to file list clicks**

When user clicks a file in FileList, ViewerContainer renders the correct viewer.

**Step 2: Connect markup overlay to viewer**

Overlay sits on top of ViewerContainer. Drawing tools control overlay mode. Comments from overlay save via API and appear in CommentsPanel.

**Step 3: Connect comment pins to comments panel**

Click pin → scroll to comment. Click comment → highlight pin.

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: wire up portal view - viewers, markup, and comments integration"
```

---

### Task 14: Polish & Navigation

**Files:**
- Modify: `app/layout.tsx`
- Create: `components/ui/Header.tsx`
- Create: `components/ui/Breadcrumbs.tsx`

**Step 1: App header**

Logo/name, breadcrumb navigation (Dashboard > Project > Portal).

**Step 2: Clean up styling**

Consistent Tailwind styling across all pages. Dark/light neutral palette. Proper spacing, hover states, transitions.

**Step 3: Empty states**

- No projects → "Create your first project"
- No portals → "Create your first portal"
- No versions → "Submit your first version"
- No comments → "Click on the file to add a comment"

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add navigation, header, breadcrumbs, and polish styling"
```

---

## Execution Order

Tasks 1-4 are foundational (scaffold, data layer, APIs).
Tasks 5-8 are page structure (dashboard, project, portal, upload).
Tasks 9-12 are viewers and markup (the hard parts).
Tasks 13-14 are integration and polish.

Total: 14 tasks, sequential dependency chain.
