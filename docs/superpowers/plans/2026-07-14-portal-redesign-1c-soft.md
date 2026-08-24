# Portal View Redesign (1C "Soft") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recreate the finalized 1C "Soft" visual design on the Portal View (`/portal/[id]`) pixel-accurately, reusing existing components and preserving every current feature.

**Architecture:** Presentation-only re-skin. A shared color helper (`lib/commentColors.ts`) becomes the single authority so pin fill = comment-card accent = avatar stay in sync. Tokens go into `tailwind.config.ts` under a `stiko` namespace; Manrope is loaded via `next/font` and scoped to the portal shell. The page shell becomes a floating-panel grid; each existing component (top bar, sidebar, toolbar, pins, comments, composer) is restyled while its props, state wiring, and handlers stay identical.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS 3, react-konva (PDF pins), next/font.

## Global Constraints

- **Scope guard:** Do NOT modify `components/ui/Header.tsx`, `components/ui/Button.tsx`, `app/globals.css` `body`, or any page outside `app/portal/[id]/*` and the portal/markup components listed. Dashboard and project pages must render unchanged.
- **Preserve functionality:** No change to data shapes, API routes, state, effects, refs, handlers, or the viewer/overlay/annotation render order. JSX/classNames only.
- **Font:** Manrope weights 400/500/600/700/800, applied via CSS variable to the portal shell root only.
- **Primary gradient (verbatim):** `linear-gradient(135deg, #8094F5, #5B60FF)`. Solid primary `#5B60FF`.
- **Palette pastels (swatch / dark-text / saturated-accent), verbatim:**
  - Yellow `#FFFCCE` / `#7A5E00` / `#FFCF2E`
  - Red `#FFE2E2` / `#B23A52` / `#FF6B6B`
  - Blue `#E2F2FF` / `#2f7fc4` / `#4A9FE0`
  - Green `#EDFFDA` / `#4B7A28` / `#7BC24A`
  - Purple `#EBE4FD` / `#6b4fc4` / `#9A82F0` (accent derived — README omits a purple accent)
- **Backgrounds:** app `#F6F8FE` · surface `#FFFFFF` · subtle/cards `#F6F8FE` · tint/selected `#F1F3FF` · idle badge `#EFEFF4`.
- **Text ramp:** primary `#1C2030` · secondary `#5A6076` · muted `#8A90A6` · faint `#A2A7B8` · placeholder `#C2C4CE`.
- **Borders:** `#F1F1F4` · `#E4E5EC` · `#EAEDF6` · `#C9CBD6`.
- **Radii:** panel 14px · buttons 10–11px · badges 9px · rows 10–11px · chips/swatches 6px · pins `50% 50% 50% 2px` · pills 20px.
- **Shadows:** panel `0 1px 3px rgba(28,32,48,0.05)` · primary `0 6px 16px -5px rgba(91,96,255,0.6)` · sheet `0 10px 34px -12px rgba(28,32,48,0.16)` · pin `0 4px 10px -2px rgba(0,0,0,0.2)`.
- **Automated gate every task:** `npx tsc --noEmit` passes and `npm run lint` passes. No test runner exists — do NOT add one.
- **Visual gate:** where a task changes rendered output, verify in the running app (`npm run dev`, open a portal) against `design_handoff_portal_view/STIKO Portal View.dc.html`. If the dev environment isn't runnable (auth/DB), compare the component's JSX to the mock's corresponding region.
- Commit after each task. Work on a branch (`portal-redesign-1c-soft`), not `main`.

---

## File map

- **Create** `lib/commentColors.ts` — palette + `paletteForKey` / `paletteForComment` (color authority). *(Task 1)*
- **Modify** `tailwind.config.ts` — `stiko` colors, shadows, radius, font family. **Create** `lib/fonts.ts` — Manrope. *(Task 2)*
- **Create** `components/portal/PortalTopBar.tsx` + **Create** `lib/portalFormat.ts` (`initialsFromEmail`). **Modify** `app/portal/[id]/page.tsx` — shell + top bar swap. *(Task 3)*
- **Create** `lib/fileChips.ts` (`getFileChip`). **Modify** `components/portal/FileTreeSidebar.tsx`. *(Task 4)*
- **Modify** `components/markup/DrawingTools.tsx` + one-line default color in `app/portal/[id]/page.tsx`. *(Task 5)*
- **Modify** `components/markup/CommentPin.tsx`, `components/markup/MarkupOverlay.tsx`, `components/viewers/PDFKonvaViewer.tsx`. *(Task 6)*
- **Modify** `components/portal/CommentsPanel.tsx`. *(Task 7)*
- **Modify** `components/portal/CommentComposer.tsx`. *(Task 8)*
- **Verify** end-to-end. *(Task 9)*

---

### Task 1: `lib/commentColors.ts` — color authority

**Files:**
- Create: `lib/commentColors.ts`

**Interfaces:**
- Produces:
  - `interface Pastel { name: string; swatch: string; dark: string; accent: string }`
  - `const PALETTE: Pastel[]` — length 5, order yellow, red, blue, green, purple.
  - `function paletteForKey(key: string): Pastel` — deterministic hash into `PALETTE`, total (any string resolves).
  - `function paletteForComment(c: { author: string }): Pastel` — `paletteForKey(c.author)`.

- [ ] **Step 1: Write the file**

```ts
// lib/commentColors.ts
// Single source of truth for sticky-note pastel colors used by comment cards,
// avatars, and teardrop pins so a comment's pin, card accent, and avatar always match.

export interface Pastel {
  name: string;
  swatch: string; // pastel fill (swatch chip, pin fill, avatar bg)
  dark: string;   // dark text on the pastel (number in pin, initials in avatar)
  accent: string; // saturated variant (card left-accent border, markup stroke)
}

// Order matches the toolbar swatch order in the mock.
export const PALETTE: Pastel[] = [
  { name: 'yellow', swatch: '#FFFCCE', dark: '#7A5E00', accent: '#FFCF2E' },
  { name: 'red',    swatch: '#FFE2E2', dark: '#B23A52', accent: '#FF6B6B' },
  { name: 'blue',   swatch: '#E2F2FF', dark: '#2f7fc4', accent: '#4A9FE0' },
  { name: 'green',  swatch: '#EDFFDA', dark: '#4B7A28', accent: '#7BC24A' },
  { name: 'purple', swatch: '#EBE4FD', dark: '#6b4fc4', accent: '#9A82F0' },
];

/** Deterministic, total mapping of any string key to a palette entry. */
export function paletteForKey(key: string): Pastel {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function paletteForComment(c: { author: string }): Pastel {
  return paletteForKey(c.author || 'Anonymous');
}
```

- [ ] **Step 2: Verify compile + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/commentColors.ts
git commit -m "feat(portal): add pastel color authority for comments/pins/avatars"
```

---

### Task 2: Design tokens + Manrope font

**Files:**
- Modify: `tailwind.config.ts`
- Create: `lib/fonts.ts`

**Interfaces:**
- Produces: Tailwind classes `bg-stiko-app`, `bg-stiko-tint`, `bg-stiko-subtle`, `bg-stiko-idle`, `text-stiko-ink/secondary/muted/faint/placeholder`, `shadow-stiko-panel/primary/sheet/pin`, `rounded-panel`, `font-manrope`; and `import { manrope } from '@/lib/fonts'` exposing `manrope.variable`.

- [ ] **Step 1: Add the font module**

```ts
// lib/fonts.ts
import { Manrope } from 'next/font/google';

export const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
});
```

- [ ] **Step 2: Extend the Tailwind config**

Replace the `theme.extend` block in `tailwind.config.ts` with:

```ts
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        stiko: {
          app: "#F6F8FE",
          surface: "#FFFFFF",
          subtle: "#F6F8FE",
          tint: "#F1F3FF",
          idle: "#EFEFF4",
          ink: "#1C2030",
          secondary: "#5A6076",
          muted: "#8A90A6",
          faint: "#A2A7B8",
          placeholder: "#C2C4CE",
          primary: "#5B60FF",
          border: "#F1F1F4",
          divider: "#E4E5EC",
          sheet: "#EAEDF6",
        },
      },
      fontFamily: {
        manrope: ["var(--font-manrope)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        panel: "14px",
      },
      boxShadow: {
        "stiko-panel": "0 1px 3px rgba(28,32,48,0.05)",
        "stiko-primary": "0 6px 16px -5px rgba(91,96,255,0.6)",
        "stiko-sheet": "0 10px 34px -12px rgba(28,32,48,0.16)",
        "stiko-pin": "0 4px 10px -2px rgba(0,0,0,0.2)",
      },
    },
  },
```

- [ ] **Step 3: Verify compile + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (Font is imported/used in Task 3; tokens are used from Task 3 on.)

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.ts lib/fonts.ts
git commit -m "feat(portal): add stiko design tokens and Manrope font"
```

---

### Task 3: Portal shell + top bar

**Files:**
- Create: `lib/portalFormat.ts`
- Create: `components/portal/PortalTopBar.tsx`
- Modify: `app/portal/[id]/page.tsx` (imports, the returned JSX shell, remove the old `Header`/participants `rightContent`)

**Interfaces:**
- Consumes: `manrope` (Task 2), `paletteForKey` (Task 1), Tailwind `stiko` tokens (Task 2).
- Produces:
  - `initialsFromEmail(email: string): string` in `lib/portalFormat.ts`.
  - `<PortalTopBar project={Project|null} portal={Portal|null} participants={Participant[]} submitHref={string} />`.

- [ ] **Step 1: Add the initials helper**

```ts
// lib/portalFormat.ts
/** Two-letter initials from an email local-part: "dana.whitmore@x" -> "DW". */
export function initialsFromEmail(email: string): string {
  const local = (email.split('@')[0] || email || '?').trim();
  const parts = local.split(/[._\-+]/).filter(Boolean);
  const letters =
    parts.length >= 2
      ? parts[0][0] + parts[1][0]
      : local.slice(0, 2);
  return letters.toUpperCase();
}
```

- [ ] **Step 2: Build the top bar component**

```tsx
// components/portal/PortalTopBar.tsx
'use client';

import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { paletteForKey } from '@/lib/commentColors';
import { initialsFromEmail } from '@/lib/portalFormat';

interface Project { id: string; name: string; createdAt: string }
interface Portal { id: string; projectId: string; name: string; createdAt: string }
interface Participant { id: string; portalId: string; email: string; role: string; createdAt: string }

interface PortalTopBarProps {
  project: Project | null;
  portal: Portal | null;
  participants: Participant[];
  submitHref: string;
}

const GRADIENT = 'linear-gradient(135deg, #8094F5, #5B60FF)';

export default function PortalTopBar({ project, portal, participants, submitHref }: PortalTopBarProps) {
  const [showParticipants, setShowParticipants] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showParticipants) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setShowParticipants(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showParticipants]);

  const shown = participants.slice(0, 3);
  const extra = participants.length - shown.length;

  return (
    <div className="h-[52px] flex-shrink-0 bg-white rounded-panel shadow-stiko-panel flex items-center justify-between px-[18px]">
      {/* Left cluster */}
      <div className="flex items-center gap-[14px]">
        <Link href="/" className="flex items-center gap-[9px]">
          <span
            className="w-[26px] h-[26px] rounded-lg flex items-center justify-center"
            style={{ background: GRADIENT }}
          >
            <span className="w-[11px] h-[11px] bg-white rounded-[3px] -rotate-[10deg]" />
          </span>
          <span className="font-extrabold text-[18px] tracking-[-0.02em] text-stiko-ink">Stiko</span>
        </Link>
        <div className="flex items-center gap-2 text-[13px] text-stiko-muted">
          <span>{project?.name ?? '…'}</span>
          <span className="text-stiko-[#C9CBD6]" style={{ color: '#C9CBD6' }}>›</span>
          <span className="text-stiko-ink font-semibold">{portal?.name ?? 'Loading…'}</span>
        </div>
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-3">
        <div className="relative" ref={popRef}>
          <button
            type="button"
            onClick={() => setShowParticipants((s) => !s)}
            className="flex items-center"
            title={`${participants.length} participant${participants.length === 1 ? '' : 's'}`}
          >
            {shown.map((p, i) => {
              const c = paletteForKey(p.email);
              return (
                <span
                  key={p.id}
                  className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[11px] font-bold"
                  style={{ background: c.swatch, color: c.dark, marginLeft: i === 0 ? 0 : -9 }}
                >
                  {initialsFromEmail(p.email)}
                </span>
              );
            })}
            {extra > 0 && (
              <span
                className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[11px] font-bold text-stiko-secondary bg-stiko-idle"
                style={{ marginLeft: shown.length ? -9 : 0 }}
              >
                +{extra}
              </span>
            )}
          </button>
          {showParticipants && (
            <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-stiko-border bg-white shadow-lg z-50">
              <div className="p-3 border-b border-stiko-border">
                <p className="text-xs font-bold text-stiko-ink">Participants</p>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {participants.length === 0 ? (
                  <p className="p-3 text-xs text-stiko-faint">No participants yet</p>
                ) : (
                  participants.map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-3 py-2 text-xs border-b border-stiko-border/60 last:border-0">
                      <span className="text-stiko-secondary truncate">{p.email}</span>
                      <span className="text-stiko-faint capitalize ml-2">{p.role}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <Link
          href={submitHref}
          className="text-white font-bold text-[13px] px-[18px] py-[10px] rounded-[11px] shadow-stiko-primary transition-[filter] hover:brightness-[0.97]"
          style={{ background: GRADIENT }}
        >
          Submit new version
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewire the page shell**

In `app/portal/[id]/page.tsx`:

(a) Add imports near the top with the other component imports:
```tsx
import PortalTopBar from '@/components/portal/PortalTopBar';
import { manrope } from '@/lib/fonts';
```
After swapping in `PortalTopBar` (steps c–d), the old `Header`, `Button`, and `Link` usages in this file are gone (the submit `Link` and participants `Button` moved into `PortalTopBar`; the annotation banner uses plain `<button>`). Remove whichever of `import Header`, `import Button`, `import Link` the lint step then flags as unused. Do not remove `dynamic`, `useParams`, or the viewer/markup imports.

(b) Delete the `showParticipants` state line (`const [showParticipants, setShowParticipants] = useState(false);`) — the popover now lives in `PortalTopBar`.

(c) Replace the outer wrapper and header. Change the top-level return wrapper from:
```tsx
  return (
    <div className="h-screen flex flex-col">
      <Header
        breadcrumbs={[ /* ... */ ]}
        rightContent={ /* participants + submit ... */ }
      />
```
to:
```tsx
  return (
    <div className={`${manrope.variable} font-manrope h-screen flex flex-col bg-stiko-app p-3 gap-3`}>
      <PortalTopBar
        project={project}
        portal={portal}
        participants={participants}
        submitHref={`/portal/${portalId}/submit`}
      />
```

(d) Replace the body grid wrapper. Change:
```tsx
      <div className={`flex-1 grid h-[calc(100vh-64px)] ${
        sidebarCollapsed && commentsCollapsed ? 'grid-cols-[48px_1fr_48px]' :
        sidebarCollapsed ? 'grid-cols-[48px_1fr_320px]' :
        commentsCollapsed ? 'grid-cols-[280px_1fr_48px]' :
        'grid-cols-[280px_1fr_320px]'
      }`}>
```
to:
```tsx
      <div className={`flex-1 grid gap-3 overflow-hidden min-h-0 ${
        sidebarCollapsed && commentsCollapsed ? 'grid-cols-[48px_1fr_48px]' :
        sidebarCollapsed ? 'grid-cols-[48px_1fr_340px]' :
        commentsCollapsed ? 'grid-cols-[272px_1fr_48px]' :
        'grid-cols-[272px_1fr_340px]'
      }`}>
```

(e) Wrap the center column as a floating panel stack. Change the center `<div className="flex flex-col h-full overflow-hidden bg-gray-50">` to:
```tsx
        <div className="flex flex-col gap-3 min-h-0 overflow-hidden">
```
and wrap the viewer area (`<div ref={viewerAreaRef} ...>`) so the canvas is its own white panel. Change:
```tsx
          <div ref={viewerAreaRef} className="relative flex-1 overflow-hidden">
```
to:
```tsx
          <div ref={viewerAreaRef} className="relative flex-1 overflow-hidden bg-white rounded-panel shadow-stiko-panel">
```
Add the hatch backdrop as the first child inside that viewer-area div, before `{renderFileViewer()}`:
```tsx
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'repeating-linear-gradient(45deg, #F6F8FE 0 16px, #FBFCFF 16px 32px)' }} />
```
(The live viewers render above this backdrop; when a real document is loaded it covers the hatch, matching the mock's placeholder-sheet treatment.)

> Note: `DrawingTools` becomes its own 52px panel in Task 5; `FileTreeSidebar` and `CommentsPanel` become white panels in their own tasks. For this task, wrap them minimally so the layout holds: the sidebar/comments components still carry their own `bg-white` (added in their tasks). No functional change here.

- [ ] **Step 4: Verify compile + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (fix any now-unused import warnings by removing them).

- [ ] **Step 5: Visual check**

Run `npm run dev`, open a portal (`/portal/<id>`). Confirm: light `#F6F8FE` background with a floating white top bar showing the gradient logo mark, "Stiko", `project › portal` breadcrumb, avatar stack (opens participants popover), and the gradient "Submit new version" button linking to `/submit`. Compare against the top bar in `STIKO Portal View.dc.html`.

- [ ] **Step 6: Commit**

```bash
git add app/portal/[id]/page.tsx components/portal/PortalTopBar.tsx lib/portalFormat.ts
git commit -m "feat(portal): floating-panel shell + soft top bar"
```

---

### Task 4: FileTreeSidebar restyle (versions, files, chips)

**Files:**
- Create: `lib/fileChips.ts`
- Modify: `components/portal/FileTreeSidebar.tsx`

**Interfaces:**
- Consumes: Tailwind `stiko` tokens.
- Produces: `getFileChip(filename: string, fileType: string): { label: string; bg: string; text: string }`.

- [ ] **Step 1: Add the filetype-chip helper**

```ts
// lib/fileChips.ts
export interface FileChip { label: string; bg: string; text: string }

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'tif', 'tiff'];
const VIDEO = ['mp4', 'mov', 'webm', 'avi', 'mkv'];
const MODEL = ['glb', 'gltf', 'step', 'stp', 'obj', 'stl', '3ds', 'ply', 'dae'];
const CAD = ['dwg', 'dxf'];

/** Map a file to a colored type chip per the 1C spec. */
export function getFileChip(filename: string, fileType: string): FileChip {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (fileType === 'application/pdf' || ext === 'pdf') return { label: 'PDF', bg: '#FFE2E2', text: '#B23A52' };
  if (CAD.includes(ext)) return { label: 'DWG', bg: '#EDFFDA', text: '#4B7A28' };
  if (MODEL.includes(ext)) return { label: ext.toUpperCase(), bg: '#EBE4FD', text: '#6b4fc4' };
  if (fileType.startsWith('image/') || IMAGE.includes(ext)) return { label: 'IMG', bg: '#E2F2FF', text: '#2f7fc4' };
  if (fileType.startsWith('video/') || VIDEO.includes(ext)) return { label: 'VID', bg: '#FFFCCE', text: '#7A5E00' };
  return { label: (ext || 'FILE').toUpperCase().slice(0, 4), bg: '#EFEFF4', text: '#5A6076' };
}
```

- [ ] **Step 2: Restyle the sidebar container + sections**

In `components/portal/FileTreeSidebar.tsx`, import the helper at top:
```tsx
import { getFileChip } from '@/lib/fileChips';
```

Replace the main expanded `return (...)` (the `<div className="flex flex-col h-full bg-white border-r border-gray-200">...` block) with the soft version. Container + Versions section + Files section:

```tsx
  return (
    <div className="flex flex-col h-full bg-white rounded-panel shadow-stiko-panel p-[18px_14px] gap-5 overflow-hidden">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-stiko-faint">Versions</span>
        {onToggleCollapse && (
          <button onClick={onToggleCollapse} title="Collapse" className="p-1 rounded-lg text-stiko-faint hover:bg-stiko-subtle transition-colors">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
        )}
      </div>

      {/* Versions list */}
      <div className="flex flex-col gap-[5px]">
        {versions.length === 0 ? (
          <p className="text-[13px] text-stiko-faint py-2">Submit your first version to get started</p>
        ) : (
          versions.map((version) => {
            const isSelected = version.id === selectedVersionId;
            const isCurrent = version.versionNumber === maxVersion;
            return (
              <button
                key={version.id}
                onClick={() => onSelectVersion(version.id)}
                className={`w-full flex items-center gap-[10px] px-3 py-[10px] rounded-[11px] text-left transition-colors ${isSelected ? 'bg-stiko-tint' : 'hover:bg-stiko-subtle'}`}
              >
                <span
                  className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center flex-shrink-0 text-[12px] font-extrabold"
                  style={isCurrent
                    ? { background: 'linear-gradient(135deg, #8094F5, #5B60FF)', color: '#fff' }
                    : { background: '#EFEFF4', color: '#5A6076' }}
                >
                  V{version.versionNumber}
                </span>
                <span className="min-w-0">
                  <span className={`block text-[13px] ${isCurrent ? 'font-bold text-stiko-ink' : 'font-semibold text-stiko-secondary'}`}>
                    {isCurrent ? 'Current' : `Version ${version.versionNumber}`}
                  </span>
                  <span className="block text-[11px] text-stiko-muted">{formatDate(version.createdAt)}</span>
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Files section */}
      {selectedVersionId && (
        <div className="flex flex-col gap-[10px] min-h-0">
          <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-stiko-faint">Files</span>
          <div className="flex flex-col gap-1 overflow-y-auto">
            {files.length === 0 ? (
              <p className="text-[12px] text-stiko-faint">No files in this version</p>
            ) : (
              <>
                {tree.folders.map((folder) => (
                  <FolderItem key={folder.path} folder={folder} selectedFileId={selectedFileId} onSelectFile={onSelectFile} depth={0} />
                ))}
                {tree.rootFiles.map((file) => (
                  <FileItem key={file.id} file={file} isSelected={file.id === selectedFileId} onSelect={() => onSelectFile(file.id)} depth={0} />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
```

Add `maxVersion` inside the component body (before the collapsed check), near `const tree = useMemo(...)`:
```tsx
  const maxVersion = versions.reduce((m, v) => Math.max(m, v.versionNumber), 0);
```

> `formatDate` already exists in the file — reuse it (it renders e.g. "Jul 12, 09:00"; acceptable, matches "date" line). No change to `formatDate`.

- [ ] **Step 3: Restyle `FileItem` with the chip**

Replace the `FileItem` component's returned button with:
```tsx
  const chip = getFileChip(file.filename, file.fileType);
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-[10px] px-[11px] py-[9px] rounded-[10px] text-left transition-colors ${isSelected ? 'bg-stiko-subtle' : 'hover:bg-stiko-subtle'}`}
      style={{ paddingLeft: `${11 + depth * 14}px` }}
    >
      <span className="text-[9px] font-extrabold px-[6px] py-[4px] rounded-md flex-shrink-0" style={{ background: chip.bg, color: chip.text }}>
        {chip.label}
      </span>
      <span className={`truncate text-[13px] ${isSelected ? 'font-bold text-stiko-ink' : 'font-medium text-stiko-secondary'}`}>
        {file.filename}
      </span>
    </button>
  );
```
Remove the now-unused `iconType`/`FileIcon` usage inside `FileItem` (keep `FileIcon`/`getFileIcon` defined if `FolderItem` still needs a folder glyph — see next step; otherwise they may become unused and must be deleted to satisfy lint).

- [ ] **Step 4: Restyle `FolderItem` rows (soft)**

Replace the `FolderItem` toggle button className/markup with the soft style (keep the expand logic and recursion unchanged):
```tsx
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-[11px] py-[9px] rounded-[10px] text-[13px] font-medium text-stiko-secondary hover:bg-stiko-subtle transition-colors"
        style={{ paddingLeft: `${11 + depth * 14}px` }}
      >
        <svg className={`h-3 w-3 text-stiko-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-[9px] font-extrabold px-[6px] py-[4px] rounded-md flex-shrink-0" style={{ background: '#EFEFF4', color: '#5A6076' }}>DIR</span>
        <span className="truncate">{folder.name}</span>
      </button>
```
(Removing the yellow folder SVG in favor of a neutral "DIR" chip keeps the row visually consistent with file chips. If `getFileIcon`/`FileIcon`/`getFileIcon` are now unused, delete them so lint passes.)

- [ ] **Step 5: Restyle the collapsed rail**

Replace the collapsed `return` block's outer div classes:
```tsx
      <div className="flex flex-col items-center h-full bg-white rounded-panel shadow-stiko-panel py-3 px-1">
```
and its toggle button classes to `text-stiko-muted hover:bg-stiko-subtle rounded-lg`. Keep the count logic.

- [ ] **Step 6: Verify compile + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. Delete any dead `FileIcon`/`getFileIcon` code flagged by lint.

- [ ] **Step 7: Visual check**

Reload the portal. Confirm the left panel shows the "VERSIONS" label, gradient "V{max} / Current" badge with `#F1F3FF` selected row, older "Version N" idle badges, "FILES" label, and files with colored type chips; folders (if any) still expand. Compare to the mock's left panel.

- [ ] **Step 8: Commit**

```bash
git add components/portal/FileTreeSidebar.tsx lib/fileChips.ts
git commit -m "feat(portal): soft versions + files sidebar with type chips"
```

---

### Task 5: DrawingTools restyle (flat toolbar, pin slot, swatches, saturated stroke)

**Files:**
- Modify: `components/markup/DrawingTools.tsx`
- Modify: `app/portal/[id]/page.tsx` (one line: default `drawingColor`)

**Interfaces:**
- Consumes: `PALETTE` (Task 1), `stiko` tokens.
- Produces: unchanged `DrawingToolsProps` signature. Swatch click calls `onColorChange(pastel.accent)`; selected swatch = the one whose `.accent === color`.

- [ ] **Step 1: Default the active color to the red accent (match mock's selected swatch)**

In `app/portal/[id]/page.tsx`, change:
```tsx
  const [drawingColor, setDrawingColor] = useState('#ef4444');
```
to:
```tsx
  const [drawingColor, setDrawingColor] = useState('#FF6B6B'); // red-pastel accent; matches default toolbar swatch
```

- [ ] **Step 2: Rewrite `DrawingTools` markup as the flat soft toolbar**

Replace the entire returned JSX (`return ( <div className="flex items-center gap-3 px-3 py-1.5 bg-white border-b border-gray-200 flex-shrink-0"> ... </div> )`) with a centered 52px panel. Keep the component's props, `useDropdown` (used only for stroke now), `SHAPE_TOOLS`, `STANDALONE_TOOLS`, `STROKE_PRESETS`, and add `import { PALETTE } from '@/lib/commentColors';` at top. Replace `COLOR_PRESETS` usage with `PALETTE`.

New render:
```tsx
  // A flat, single-select tool row. Pointer/Freehand/Text/Eraser + inline Line/Arrow/Rect.
  const TOOL_ORDER: { id: ToolType; label: string; icon: React.ReactNode }[] = [
    STANDALONE_TOOLS[0], // pointer
    STANDALONE_TOOLS[1], // freehand
    ...SHAPE_TOOLS,      // line, arrow, rect
    STANDALONE_TOOLS[2], // text
    STANDALONE_TOOLS[3], // eraser
  ];

  const slot = (active: boolean) =>
    `w-9 h-9 rounded-[10px] flex items-center justify-center transition-colors ${
      active ? 'bg-stiko-tint text-stiko-primary' : 'text-stiko-muted hover:bg-stiko-tint'
    }`;

  return (
    <div className="h-[52px] flex-shrink-0 bg-white rounded-panel shadow-stiko-panel flex items-center justify-center">
      <div className="flex items-center gap-[3px]">
        {/* Pin (comment tag) */}
        <button title="Comment pin" onClick={onToggleTagging} className={slot(tagging)}>
          <span className="w-[13px] h-[13px] rounded-[4px_4px_4px_0] border-2 border-current" />
        </button>

        {/* Tools */}
        {TOOL_ORDER.map((tool) => (
          <button
            key={tool.id}
            title={tool.label}
            onClick={() => onToolChange(activeTool === tool.id ? 'pointer' : tool.id)}
            className={slot(activeTool === tool.id)}
          >
            {tool.icon}
          </button>
        ))}

        {/* Stroke width (compact popover) */}
        <div ref={strokes.ref} className="relative">
          <button title="Stroke width" onClick={() => strokes.setOpen(!strokes.open)} className={slot(false)}>
            <svg width="16" height="16" viewBox="0 0 16 16"><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" /></svg>
          </button>
          {strokes.open && (
            <div className="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-lg border border-stiko-border py-1.5 px-2 z-50 flex flex-col gap-1">
              {STROKE_PRESETS.map((s) => (
                <button
                  key={s.value}
                  title={s.label}
                  onClick={() => { onStrokeWidthChange(s.value); strokes.setOpen(false); }}
                  className={`flex items-center justify-center w-20 h-6 rounded-lg transition-colors ${strokeWidth === s.value ? 'bg-stiko-tint text-stiko-primary' : 'text-stiko-muted hover:bg-stiko-subtle'}`}
                >
                  <svg width="32" height="12" viewBox="0 0 32 12"><line x1="2" y1="6" x2="30" y2="6" stroke="currentColor" strokeWidth={s.value} strokeLinecap="round" /></svg>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-[22px] bg-stiko-divider mx-[6px]" />

        {/* Pastel swatches — sets pin color (pastel) + markup stroke (saturated accent) */}
        <div className="flex items-center gap-[6px]">
          {PALETTE.map((p) => {
            const selected = color === p.accent;
            return (
              <button
                key={p.name}
                title={p.name}
                onClick={() => onColorChange(p.accent)}
                className="w-[18px] h-[18px] rounded-md transition-transform hover:scale-105"
                style={{ background: p.swatch, boxShadow: selected ? '0 0 0 2px #fff, 0 0 0 3.5px #5B60FF' : undefined }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
```
Delete the now-unused `shapes`/`colors` dropdown state (`const shapes = useDropdown();` `const colors = useDropdown();`), the `shapeToolIds`/`isShapeActive`/`activeShapeTool` lines, and the `COLOR_PRESETS` constant if no longer referenced. Keep `const strokes = useDropdown();`.

> The pointer icon uses `fill="currentColor"`; in the active tint slot it renders `#5B60FF` (filled cursor). Idle tools inherit `text-stiko-muted`. This matches the mock (active pointer filled periwinkle, idle icons gray).

- [ ] **Step 3: Verify compile + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (remove all dead code flagged).

- [ ] **Step 4: Visual + functional check**

Reload the portal. Confirm the toolbar is a centered 52px panel: Pin · Pointer · Freehand · Line · Arrow · Rect · Text · Eraser · stroke · divider · 5 pastel swatches (red ringed by default). Click a draw tool → it highlights (`#F1F3FF` + periwinkle icon); draw on the canvas → the stroke uses the saturated accent (visible on white). Click Pin → tagging arms (crosshair on canvas). Eraser + stroke-width still work.

- [ ] **Step 5: Commit**

```bash
git add components/markup/DrawingTools.tsx app/portal/[id]/page.tsx
git commit -m "feat(portal): flat soft toolbar with pastel swatches + saturated stroke"
```

---

### Task 6: Teardrop comment pins (HTML + Konva)

**Files:**
- Modify: `components/markup/CommentPin.tsx`
- Modify: `components/markup/MarkupOverlay.tsx` (pass per-comment color to `CommentPin`)
- Modify: `components/viewers/PDFKonvaViewer.tsx` (recolor Konva pins from palette)

**Interfaces:**
- Consumes: `paletteForComment` (Task 1).
- Produces: `CommentPin` gains `fill: string` and `textColor: string` props.

- [ ] **Step 1: Teardrop `CommentPin`**

Update `CommentPinProps` and the non-pending render in `components/markup/CommentPin.tsx`:
```tsx
interface CommentPinProps {
  index: number;
  x: number;
  y: number;
  isActive: boolean;
  onClick: () => void;
  isPending?: boolean;
  fill?: string;      // pastel swatch color
  textColor?: string; // dark number color
}
```
Add defaults in the destructure: `fill = '#FFE2E2', textColor = '#B23A52'`. Replace the non-pending `<div className="w-6 h-6 ...">` block with:
```tsx
        <div
          className={`w-7 h-7 flex items-center justify-center text-[12px] font-extrabold transition-transform ${isActive ? 'scale-110' : 'hover:scale-105'}`}
          style={{
            background: fill,
            color: textColor,
            borderRadius: '50% 50% 50% 2px',
            boxShadow: isActive
              ? '0 4px 10px -2px rgba(0,0,0,0.25), 0 0 0 2px #fff, 0 0 0 4px #5B60FF'
              : '0 4px 10px -2px rgba(0,0,0,0.2)',
          }}
        >
          {index}
        </div>
```
Keep the pending marker branch, but recolor it to periwinkle soft (optional): change `bg-blue-400`/`bg-blue-600` to `bg-[#8094F5]`/`bg-[#5B60FF]`.

- [ ] **Step 2: Feed palette color from `MarkupOverlay`**

In `components/markup/MarkupOverlay.tsx`, import at top:
```tsx
import { paletteForComment } from '@/lib/commentColors';
```
In the `positionalComments.map(...)` render, compute the color and pass it:
```tsx
          const c = paletteForComment(comment);
          return (
            <CommentPin
              key={comment.id}
              index={idx + 1}
              x={pinX}
              y={pinY}
              isActive={activeCommentId === comment.id}
              isPending={comment.id === pendingCommentId}
              fill={c.swatch}
              textColor={c.dark}
              onClick={() => onCommentPinClick(comment)}
            />
          );
```

- [ ] **Step 3: Recolor Konva PDF pins**

Open `components/viewers/PDFKonvaViewer.tsx` and read lines ~390–445 (the "Comment Pins" block). It currently renders per pin: an active halo `<Circle ... fill="#3b82f6" opacity={0.25} />`, a main `<Circle radius={pinRadius} ... />` (a blue fill), and a `<Text>` number. Import the palette at top:
```tsx
import { paletteForComment } from '@/lib/commentColors';
```
Inside the pin map, before rendering, compute:
```tsx
                  const pal = paletteForComment(comment);
```
Then set the main pin circle `fill={pal.swatch}`, its `stroke="#fff"` (keep a white ring for legibility), the number `<Text ... fill={pal.dark} />`, and the active-state halo `fill={pal.accent}` (was `#3b82f6`). Keep all geometry (`pinRadius`, offsets, `onClick`/`onTap`) unchanged. Match the property names already present in the file — only change the color literals `#3b82f6` (and any `fill="white"` on the number if present) to the palette values.

> The Konva pin stays a circle (a true CSS teardrop isn't worth a custom Konva `Path` here); the pastel fill + dark number is what makes it read as part of the set and match the comment card. This is an intentional, spec-consistent simplification for the canvas renderer.

- [ ] **Step 4: Verify compile + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Visual check across viewer types**

- **Image/3D file:** pins are pastel teardrops with dark numbers; active pin shows the periwinkle ring.
- **PDF file:** pins are pastel circles with dark numbers on the page; clicking still selects.
- A given comment's pin color equals the color it will get in the comments panel (verified fully in Task 7).

- [ ] **Step 6: Commit**

```bash
git add components/markup/CommentPin.tsx components/markup/MarkupOverlay.tsx components/viewers/PDFKonvaViewer.tsx
git commit -m "feat(portal): teardrop pastel comment pins across viewers"
```

---

### Task 7: CommentsPanel restyle

**Files:**
- Modify: `components/portal/CommentsPanel.tsx`

**Interfaces:**
- Consumes: `paletteForComment` (Task 1). Removes local `AVATAR_COLORS`/`hashColor`.

- [ ] **Step 1: Swap color source**

In `components/portal/CommentsPanel.tsx`, delete `AVATAR_COLORS` and `hashColor`, and import:
```tsx
import { paletteForComment } from '@/lib/commentColors';
```
Keep `getInitials`, `timeAgo`, `isImageType`, `formatFileSize`.

- [ ] **Step 2: Restyle the panel container + header**

Replace the main `return (<div className="flex flex-col h-full bg-white border-l border-gray-200">` … header block down to the comment-list `<div className="flex-1 overflow-y-auto px-4 py-2">` with:
```tsx
  return (
    <div className="flex flex-col h-full bg-white rounded-panel shadow-stiko-panel overflow-hidden">
      {/* Header */}
      <div className="px-[18px] py-4 border-b border-stiko-border flex items-center justify-between">
        <span className="text-[15px] font-extrabold text-stiko-ink">Comments</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-stiko-primary bg-stiko-tint px-[9px] py-[3px] rounded-[20px]">
            {topLevelComments.length} open
          </span>
          {onToggleCollapse && (
            <button onClick={onToggleCollapse} title="Collapse comments" className="p-1 rounded-lg text-stiko-faint hover:bg-stiko-subtle transition-colors">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto p-[14px] flex flex-col gap-[10px]">
```
(`topLevelComments` is already computed above the return — the reference is valid. Ensure the list wrapper closing tags still match: the previous `divide-y` container becomes this gap-stacked column — remove the inner `<div className="divide-y divide-gray-100">` wrapper and render cards directly into this flex column.)

Update the empty/loading branches to soft text colors (`text-stiko-faint`), and render each top-level comment as a card (next step). The composer footer block at the bottom becomes:
```tsx
      {fileId && composer && (
        <div className="border-t border-stiko-border p-[14px]">{composer}</div>
      )}
```

- [ ] **Step 3: Restyle `CommentItem` as a soft card**

In `CommentItem`, compute the palette and wrap the card. Replace the top of the component's return:
```tsx
  const pal = paletteForComment(comment);
  const attachments = comment.attachments ?? [];
  const hasPosition = comment.xPosition !== null && comment.yPosition !== null;

  return (
    <div id={`comment-${comment.id}`} className={hasPosition && onClick ? 'cursor-pointer' : ''}>
      <div
        onClick={hasPosition && onClick ? () => onClick(comment) : undefined}
        className="rounded-xl p-[13px] transition-colors"
        style={{ background: '#F6F8FE', borderLeft: `3px solid ${pal.accent}`, outline: isActive ? '2px solid #5B60FF' : 'none' }}
      >
        {/* Header: avatar + name + tag# + time */}
        <div className="flex items-center gap-2 mb-[7px]">
          <div className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[9px] font-extrabold flex-shrink-0" style={{ background: pal.swatch, color: pal.dark }}>
            {getInitials(comment.author)}
          </div>
          <span className="font-bold text-[12.5px] text-stiko-ink truncate">{comment.author}</span>
          {tagNumber != null && (
            <span title={`Tag ${tagNumber}`} className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex-shrink-0" style={{ background: pal.swatch, color: pal.dark }}>
              {tagNumber}
            </span>
          )}
          <span className="text-[10px] text-stiko-faint ml-auto flex-shrink-0">{timeAgo(comment.createdAt)}</span>
        </div>

        {/* Body */}
        <p className="text-[12.5px] leading-[1.5] text-[#4A4F63]">{comment.content}</p>
```
Keep the existing snapshot `<img>`, `attachments.map(...)`, and reply button JSX that follow — but restyle the reply button className to `text-[11px] font-bold text-stiko-primary hover:opacity-80 transition-opacity` and the wrapper `mt-1.5`. Close the inner `</div>` after the reply button and keep the existing reply-form and replies blocks (restyle the replies container to `ml-9 border-l-2 border-stiko-border pl-3`).

- [ ] **Step 4: Restyle the collapsed rail**

Replace the collapsed `return` outer div classes with `flex flex-col items-center h-full bg-white rounded-panel shadow-stiko-panel py-3 px-1` and toggle button to `text-stiko-muted hover:bg-stiko-subtle rounded-lg`.

- [ ] **Step 5: Verify compile + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Visual check — color parity**

Reload the portal on a file with positioned comments. Confirm each card has a `#F6F8FE` background, a left accent border, a pastel avatar, and that **the card's accent + avatar match that comment's pin color** in the canvas. Hover/click a card → its pin highlights (existing linking preserved). Header shows "Comments" + "{n} open" pill.

- [ ] **Step 7: Commit**

```bash
git add components/portal/CommentsPanel.tsx
git commit -m "feat(portal): soft comment cards with accent borders + palette parity"
```

---

### Task 8: CommentComposer restyle

**Files:**
- Modify: `components/portal/CommentComposer.tsx`

**Interfaces:**
- Consumes: `stiko` tokens. Props unchanged.

- [ ] **Step 1: Restyle the composer**

Wrap the composer body in the soft inner box and restyle inputs/Send. Replace the outer `<div className="space-y-2">` with `<div className="bg-stiko-subtle rounded-xl p-3 flex flex-col gap-[10px]">`. Restyle:
- Author input → `w-full rounded-lg border border-stiko-border bg-white px-3 py-1.5 text-xs text-stiko-secondary focus:border-stiko-primary focus:ring-1 focus:ring-stiko-primary outline-none transition-colors`.
- Text input → same border/focus treatment, `text-[12.5px]`, `bg-white`, placeholder "Add a comment…".
- Tag chip → `bg-stiko-tint border border-stiko-primary/30 text-stiko-primary` with the pin glyph.
- Bottom row: replace the raw attach/send row so it reads as `justify-between` with a left "◎ Pin to file" affordance and the gradient Send:
```tsx
      <div className="flex items-center justify-between">
        {/* Left: pin-to-file status (reflects toolbar Pin/tagging state) + attach */}
        <div className="flex items-center gap-3">
          <span className={`text-[11px] font-semibold ${tagging || hasTag ? 'text-stiko-primary' : 'text-stiko-muted'}`}>
            ◎ Pin to file
          </span>
          <button onClick={() => fileInputRef.current?.click()} className="text-stiko-muted hover:text-stiko-secondary transition-colors" title="Attach file">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
          </button>
        </div>
        <button
          onClick={onSubmit}
          disabled={submitting || !canSend}
          className="text-white font-bold text-[12.5px] px-[18px] py-2 rounded-[10px] disabled:opacity-40 transition-[filter] hover:brightness-[0.97]"
          style={{ background: 'linear-gradient(135deg, #8094F5, #5B60FF)' }}
        >
          {submitting ? 'Sending…' : 'Send'}
        </button>
      </div>
```
Keep the author input, tag chip, tagging hint, file-input (`fileInputRef`), and file-preview blocks (restyle preview borders to `border-stiko-border`). The `fileInputRef` `<input type="file" hidden>` and its `onChange` stay exactly as in the current file.

> "◎ Pin to file" is a status/affordance label reflecting the parent `tagging`/`hasTag` state (the actual arming lives on the toolbar Pin tool, per the wiring). Keep the text input's Enter-to-send handler and `canSend` logic intact.

- [ ] **Step 2: Verify compile + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Visual + functional check**

Reload the portal. Composer is a soft `#F6F8FE` box with author + "Add a comment…" inputs, "◎ Pin to file" + attach on the left, gradient Send on the right. Type a comment → Send posts it and it appears as a card. Arm Pin on the toolbar, click the canvas → tag chip/hint appears; Send posts with the pin.

- [ ] **Step 4: Commit**

```bash
git add components/portal/CommentComposer.tsx
git commit -m "feat(portal): soft comment composer with gradient send"
```

---

### Task 9: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full-screen visual diff**

Run `npm run dev`, open a portal, and compare the whole screen side-by-side with `design_handoff_portal_view/STIKO Portal View.dc.html` (open the file in a second tab). Confirm: 12px gaps, floating white panels, `#F6F8FE` background, Manrope everywhere in the portal, top bar / left panel / toolbar / canvas / comments / composer all match.

- [ ] **Step 2: Functional regression sweep**

Exercise each preserved feature and confirm no regression:
- Select each version → files reload; select each file → canvas loads.
- PDF: page nav + pins; Image: zoom/pan + pins; 3D: orbit + projected pins.
- Draw with each tool (saturated stroke), change stroke width, erase an object, Done → snapshot attaches to composer.
- Place a pin (Pin tool → click canvas), Send → new comment + numbered pin; card accent = pin.
- Reply to a comment; open an attachment; participants popover from the avatar stack; Submit new version → `/submit`; collapse/expand both side panels.

- [ ] **Step 3: Scope guard**

Open the dashboard (`/`) and a project page — confirm they look **unchanged** (no Manrope, no `#F6F8FE` shell, original Header intact).

- [ ] **Step 4: Final gate + commit (if any cleanup)**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass. Commit any final cleanup:
```bash
git add -A
git commit -m "chore(portal): finalize 1C soft redesign"
```

---

## Self-review notes

- **Spec coverage:** Foundations→Task 2; color authority→Task 1; shell+top bar→Task 3; files/versions/tree→Task 4; toolbar+swatches+saturated stroke→Task 5; teardrop pins (HTML+Konva)→Task 6; comment cards/pill/avatars→Task 7; composer→Task 8; preserved-functionality + scope guard→Task 9. All locked decisions (§ spec) map to a task.
- **Type consistency:** `paletteForKey`/`paletteForComment`/`PALETTE`/`Pastel` used identically in Tasks 1/3/5/6/7. `CommentPin` `fill`/`textColor` defined in Task 6 Step 1 and passed in Step 2. `getFileChip` signature stable across Task 4. `initialsFromEmail` defined Task 3 Step 1, used Step 2.
- **No new test runner** (repo has none); automated gate is `tsc --noEmit` + `lint` (+ `build` at the end), visual/functional gate is the running app vs the mock — consistent with the spec's testing section.
