# Portal View Redesign (Direction 1C "Soft") — Design

**Date:** 2026-07-14
**Status:** Approved (design), pending implementation plan
**Scope:** Visual/presentation redesign of the Portal View (`/portal/[id]`) — the 3-panel screen (versions/files · canvas · comments). Presentation only; no data shapes, routes, or product behavior change.

---

## Problem

The Portal View is fully functional but visually generic (dark full-width header, gray file tree, dropdown-heavy toolbar, flat comment list). Design has delivered a **high-fidelity, finalized** redesign — Direction **1C "Soft"** (reference: lottielab.com): a light `#F6F8FE` app background with floating white rounded panels separated by 12px gaps, a periwinkle→indigo primary, sticky-note pastel accents, and the Manrope typeface.

## Goal

Recreate the 1C mock **pixel-accurately** in the existing Next.js (App Router) + React + TS + Tailwind codebase, reusing established patterns and components, while **keeping every current feature working** (versions, folder file tree, drawing/annotation toolbar, 2D/PDF/3D comment pins, comment threads/attachments, composer, participants, submit route, panel collapse).

**Visual source of truth:** `design_handoff_portal_view/README.md` (exact colors, spacing, radii, typography, per-element specs) and `STIKO Portal View.dc.html` (the reference render). This spec does **not** restate every token — it defines *how* that spec maps onto the existing code and records the integration decisions.

---

## Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Scope | **Portal page only.** Manrope + `#F6F8FE` + new top bar are scoped to the portal shell. Shared `components/ui/Header` and `Button` and all other pages are left untouched. Pieces can be promoted to a global system later. |
| 2 | Files panel | **Keep the nested folder tree** (`folderPath`), restyled to the soft look with filetype chips. Flat portals look like the mock; foldered portals still work. |
| 3 | Toolbar toolset | **Keep stroke-width control + Eraser** (existing functionality) in addition to the mock's 7 tools + 5 swatches. |
| 4 | Markup stroke color | **Pastel swatch, saturated stroke.** Swatch chip and teardrop pin fill use the pastel; the actual markup stroke uses that pastel's **saturated accent** (e.g. `#FFFCCE` → `#FFCF2E`) so lines stay visible on the white document. |
| 5 | Top bar | **Bespoke in-page top bar**, not the shared dark `Header`. |
| 6 | Breadcrumb | `project › portal` only (drop the "Dashboard" crumb from the mock); the logo mark still links home. |
| 7 | Participants | Mock's **avatar stack** replaces the "Participants (N)" button; clicking the stack opens the **existing participants popover** (functionality preserved). |
| 8 | Count pill | "{n} open" uses the **top-level comment count** — there is no open/resolved status in the data model. |
| 9 | Panel collapse | **Kept** (existing feature); collapse toggles restyled as subtle chevrons, panels default expanded. |
| 10 | Color source | New shared helper maps each comment → a pastel set so **pin fill = card accent = avatar** stay in sync; replaces the current name-`hashColor`. |

---

## Architecture

### Foundations

**Manrope font** — loaded via `next/font/google` (weights 400/500/600/700/800), exposed as a CSS variable and applied to the **portal shell root only** (not `globals.css` / `body`). Other pages keep their current font.

**Design tokens in `tailwind.config.ts`** — add a `stiko` namespace so classes read cleanly and stay consistent:
- `colors.stiko`: `app #F6F8FE`, `surface #FFFFFF`, `subtle #F6F8FE`, `tint #F1F3FF`, `idle #EFEFF4`; the 5 pastels + their `-dark` text + `-accent` saturated variants; text ramp (`#1C2030`, `#5A6076`, `#8A90A6`, `#A2A7B8`, `#C2C4CE`); borders (`#F1F1F4`, `#E4E5EC`, `#EAEDF6`, `#C9CBD6`); primary `#5B60FF`.
- `boxShadow.stiko`: `panel`, `primary`, `sheet`, `pin`.
- `borderRadius`: `panel: 14px`.
- A reusable primary-gradient (utility class in a small `@layer` addition scoped by usage, or an inline `bg-[linear-gradient(...)]`).

One-off values (e.g. specific paddings, the hatch backdrop) use Tailwind arbitrary values inline.

**`lib/commentColors.ts` (new)** — the single color authority:
```
paletteFor(key: string | Comment) → {
  swatch, dark, accent          // e.g. #FFFCCE / #7A5E00 / #FFCF2E
}
```
Deterministic: keyed by a comment's placed swatch color when it has one, else hashed from author name into the 5-pastel palette. Consumed by `CommentPin` (HTML), `PDFKonvaViewer` (Konva), `CommentsPanel` (card accent + avatar), and the avatar stack. Removes `hashColor`/`AVATAR_COLORS` from `CommentsPanel`.

### Layout shell — `app/portal/[id]/page.tsx`

The outer frame becomes the floating-panel model. Only JSX/classes change; **all state, effects, data fetching, handlers, refs, and the render-order of viewer/overlay/annotation layers stay identical.**

```
<div class="h-screen flex flex-col bg-stiko-app p-3 gap-3" style={font var}>
  <TopBar ... />                                         // 52px panel
  <div class="flex-1 grid grid-cols-[272px_1fr_340px] gap-3 overflow-hidden">
    <FileTreeSidebar ... />                              // white panel, rounded-panel, shadow-panel
    <div class="flex flex-col gap-3 min-h-0">            // center column
      <DrawingTools ... />                               // 52px toolbar panel
      <div class="flex-1 relative rounded-panel bg-white shadow-panel overflow-hidden">
        {hatch backdrop}
        {viewer / MarkupOverlay / AnnotationCanvas / viewportImage — unchanged wiring}
      </div>
    </div>
    <CommentsPanel ... composer={<CommentComposer .../>} />
  </div>
</div>
```

Collapse logic adapts to the grid: collapsed panels shrink to a narrow rail (existing behavior), gaps preserved. The annotation-mode banner is restyled to the soft palette but keeps its Discard/Done actions.

### Components

**Top bar** — new small component (e.g. `components/portal/PortalTopBar.tsx`), rendered by the page. Left: CSS logo (gradient rounded square + rotated white inner square) + "Stiko" wordmark (links `/`) + breadcrumb `project › portal`. Right: avatar stack (participants → initials from email local-part, pastel-mapped, up to 3 + "+N"; clickable → existing participants popover state lifted or kept in the page) + gradient "Submit new version" `Link` to `/portal/[id]/submit`. Loading/empty states handled (portal/project may be null while fetching).

**`FileTreeSidebar`** — two sections with uppercase 11px labels:
- *Versions*: rows with 30px badge + two-line label + date. Two orthogonal states: (a) **latest** version (max `versionNumber`, "the current one") gets the **gradient** badge and title "Current"; older versions get the `#EFEFF4` badge and title "Version {n}". (b) The **selected** row (which may or may not be the latest) gets the `#F1F3FF` background. In the mock these coincide (V4 is both current and selected). Uses real `versions[]`; empty state kept.
- *Files*: folder tree preserved (`FolderItem`/`FileItem` recursion, expand/collapse). Rows get a **filetype chip** (PDF/GLB/IMG/DWG/…, color-by-type from README) + filename; selected row `#F6F8FE` bold. Collapsed-rail state restyled.

**`DrawingTools`** — flat centered row of 36px slots, active = `#F1F3FF` bg + `#5B60FF` icon, idle icons `#8A90A6`. Order: Pointer · **Pin** · Freehand · Line · Arrow · Rect · Text · Eraser · divider · 5 pastel swatches (selected = periwinkle ring) · compact stroke-width control. The **Pin** slot drives the existing `tagging` toggle (`onToggleTagging`); shape tools become inline slots (no shapes dropdown). Swatch `onColorChange` sets pin/markup color; the value handed to the drawing layer is the **saturated accent** of the chosen pastel, while swatch UI and pin fill show the pastel. Icons rebuilt as inline SVG per the README.

**Comment pins** — teardrop everywhere:
- `CommentPin` (HTML, image/3D/video): CSS teardrop `rounded-[50%_50%_50%_2px]`, 28px, pastel fill + `shadow-pin` + dark-color number; active/pending states preserved (pending stays a distinct pulsing marker).
- `PDFKonvaViewer` (Konva): pins recolored from `commentColors` — pastel fill, dark number, kept as a rounded Konva shape (radius/scale math unchanged). Active highlight preserved.

**`CommentsPanel`** — header "Comments" + "{n} open" tint pill. Cards: `#F6F8FE`, `rounded-xl`, `padding 13px`, **left accent border** (`border-l-[3px]`, accent from `commentColors`), pastel avatar + name + right-aligned time. Threading, tag-number↔pin linking, reply forms, attachments/snapshots all preserved (restyled). "{n} replies" affordance styled per mock. Collapsed rail restyled.

**`CommentComposer`** — soft `#F6F8FE` inner box, `rounded-xl`. Text input (placeholder "Add a comment…"), author input, attach, tag chip, file previews kept. Footer row: "◎ Pin to file" (drives existing `tagging` toggle) + gradient **Send**. Disabled/submitting states preserved.

---

## Data flow

Unchanged. The page still fetches portal→project, participants, versions, files (on version change), and comments (on file change / refresh key). All handlers (`handleSelectVersion`, `handleComposerSubmit`, tag placement, annotation done/discard, pin/card click linking) are reused as-is. The redesign only re-skins the components those handlers render into.

## Error / edge handling

- Null portal/project/versions/files during load → existing loaders/empty states, restyled.
- Foldered vs flat file lists both render (tree preserved).
- Participants empty → avatar stack renders nothing (or just the count in the popover); no crash.
- Unknown file extension → neutral chip.
- Pastel mapping is total (hash fallback), so every comment/pin/avatar always resolves a color.

## Testing / verification

Manual verification in the running app (no automated UI tests exist for this screen). After each build step, drive the affected flow:
- Load a portal → top bar, breadcrumb, avatar stack, versions, files render per mock.
- Select versions/files → selection styles + canvas reload.
- Each viewer type: **PDF** (Konva pins + page nav), **image** (zoom/pan + HTML pins), **3D** (orbit + projected pins).
- Toolbar: pick each tool, swatch changes stroke color (saturated) + pin fill (pastel); stroke-width + eraser still work; annotation Done attaches snapshot.
- Comments: card accent = pin = avatar color; hover/click card↔pin linking; reply; attachment preview; post via composer (with/without pin).
- Submit button → `/submit`. Participants popover opens from avatar stack. Panel collapse works.
- Confirm dashboard/project pages are visually unchanged (scope guard).

## Build sequence

1. Tokens (`tailwind.config.ts`) + Manrope + `lib/commentColors.ts`.
2. Shell + `PortalTopBar` (page layout, panels, gaps).
3. `FileTreeSidebar` (versions + files restyle).
4. `DrawingTools` (flat toolbar, pin slot, swatches, saturated-stroke mapping).
5. Pins: `CommentPin` teardrop + `PDFKonvaViewer` recolor.
6. `CommentsPanel` (cards, accents, avatars, pill).
7. `CommentComposer`.
8. Verify all three viewer types + comment flows in the running app.

## Out of scope

- Global rollout of the design system (other pages, shared Header/Button).
- Any data-model change (e.g. real open/resolved comment status).
- New features beyond the mock (the toolbar keeps existing extras; nothing new added).
