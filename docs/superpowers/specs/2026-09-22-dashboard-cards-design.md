# Dashboard cards: project cards, a docked packages panel, and Trash in the bottom-right

**Date:** 2026-09-22
**Status:** Design, approved for planning
**Source:** `~/Desktop/design_handoff_dashboard_cards/` (README + `Dashboard cards.dc.html`). That bundle is a reference, not code to port.

---

## What changes

The dashboard's project list (one full-width row per project, packages expanding inline) becomes a grid of project cards. Selecting a card opens a **Packages panel** docked on the right edge; the grid narrows and reflows around it. The **Activity rail** (AI summary over the feed) moves from the right edge to the left. **Trash** moves from the bottom-left corner to the bottom-right.

No API, query, or schema change. No migration. Every number on the screen still derives from the `/api/home` payload through `lib/home.ts`, so it stays scoped to what the viewer may see.

## Decisions that differ from the handoff

Settled with the user on 2026-09-22. Do not relitigate.

1. **Trash is at the bottom right, not in the rail footer.** The handoff puts it under the Activity panel. It belongs at the bottom-right of the **card-grid column**, anchored to that column rather than to the window. When the Packages panel opens, the column narrows and Trash glides left with it, ending just left of the panel. It never sits on top of the panel.
2. **Card reflow uses a glide driven by resizing, not the README's FLIP-on-commit.** The prototype's FLIP never fires. Its panel animates `width` over 520ms, so at commit time nothing has moved yet: the snapshot and the post-commit measurement agree, and no card animates. Confirmed in a browser at 1440px: with no transform running, card 3 jumped from (951,150) to (396,429) between 87ms and 154ms into the open. See "Motion" for the replacement.
3. **The grid uses `auto-fill`, not `auto-fit`.** With `auto-fit` a lone project's card stretches across the whole column (≈900px wide at 1440px), because empty tracks collapse. The prototype hides this with twelve sample projects; real accounts often have one to three. `auto-fill` keeps empty tracks, so a card stays card-sized. The `min(220px,100%)` floor stays, and it still collapses to one column when both side panels are open.
4. **The filter row keeps its existing visibility rule.** `showFilterRow` hides the pills unless the viewer has both an owned and an invited project. The handoff always draws them; the rule is deliberate and tested.
5. **The manage button is visible at rest**, as the handoff draws it. The row's hover-only treatment (`0b1b7c5`) was a fix for the row's cramped geometry, and cards don't have that constraint.
6. **Existing entry points survive.** The avatar stack still opens `ProjectPanel` on its people view. The manage button still opens it on the packages view. "Add a package" still shows only to owners and coordinators.

## Layout

### lg and up (≥1024px): three columns

| Column | Width | Notes |
|---|---|---|
| Activity rail (left) | `clamp(264px, (100vw − 32px) × 0.28, 356px)` open, `0` closed | Rendered only when there are notifications (unchanged) |
| Card grid (centre) | `flex: 1`, `min-width: 240px` | The only column that scrolls with the project count |
| Packages panel (right) | `clamp(280px, (100vw − 32px) × 0.30, 372px)` selected, `0` otherwise | |

The handoff writes the side widths as `clamp(…, 28%, …)`. They are expressed in `vw` here so the **inner** element of each side column can be given the same fixed open width. The wrapper animates `width` with `overflow: hidden` while the inner content keeps its open width, so nothing inside reflows during the slide. `100vw − 32px` is the body row's width: the shell's 12px padding on each side plus the body's 4px on each side. The page itself never scrolls at this size (`h-screen`), so `100vw` carries no page scrollbar.

The centre column is a flex column that scrolls. Its last child is a `sticky bottom-0` row with `margin-top: auto` that holds Trash, right-aligned:

- **Short grid:** the auto margin pushes the row to the column's bottom edge.
- **Long grid:** the row sticks to the bottom of the scroll area while the cards scroll under it.

The row sits inside the scroll container's content box, so Trash lines up with the cards' right edge and can never land on the scrollbar. An absolutely-positioned button on a non-scrolling wrapper can't guarantee either. The row itself takes space at the end of the content, so the last row of cards always scrolls clear of it, and no spacer is needed.

### Below lg: stacked, with the panel as an overlay

The grid comes first and the rail stacks below it. This is today's behaviour, including the load-bearing `flex-none` fix documented in `app/page.tsx`. The Packages panel becomes a `fixed` overlay inside the shell's 12px gutter: full height, `width: min(372px, 100vw − 24px)`. It slides in from the right with `transform` and has no scrim. Stacked below a long grid, it would open where nobody could see it. Trash here is `fixed bottom-3 right-3 z-30`, because below lg the column is not a fixed-height scroller, so a sticky row would scroll away with the grid once the page scrolls past it into the rail. The overlay sits above Trash (z-40).

### Welcome screen

No grid, so Trash is `fixed bottom-3 right-3 z-30`. The existing guard is unchanged: the button appears only when `/api/trash` has something in it (see the `dashboardIsEmpty` effect).

## Components

| File | Change |
|---|---|
| `components/home/ProjectCard.tsx` | **New.** Replaces `ProjectListRow`. |
| `components/home/PackagesPanel.tsx` | **New.** The docked/overlay panel and its package items. Replaces `PackageListRow`. |
| `components/home/RoleChip.tsx` | **New.** Moved out of `ProjectListRow` unchanged, and shared by the card. |
| `components/home/useGridGlide.ts` | **New.** The reflow motion hook (see Motion). |
| `components/home/ProjectGrid.tsx` | **New.** Owns the grid element and calls the hook. The hook has to live in the component that mounts the grid: the page renders a skeleton first, so an effect on the page would run before the grid exists and never run again. |
| `lib/gridGlide.ts` | **New.** Pure jump-detection maths for the hook, unit-tested. |
| `lib/home.ts` | Gains the label helpers the components currently inline (package meta line, count label, "N packages", "N open comments"), so they are tested once. |
| `components/home/ActivityRail.tsx` | Left side; the vw-based widths above; inner content holds its open width. |
| `components/home/ActivityFeedPanel.tsx` | Collapse chevron points left (rotated 180°), toward the edge it collapses to. |
| `components/home/ProjectSummaryPanel.tsx` | Timings to the handoff's 520ms (opacity 340ms), so it moves with the Packages panel. |
| `app/page.tsx` | New three-column layout, selection state, Trash placement. |
| `tailwind.config.ts` | Card tokens (below). |
| `ProjectListRow.tsx`, `ProjectListHeader.tsx`, `PackageListRow.tsx` | **Deleted.** `app/page.tsx` is their only importer. |

### ProjectCard

It shows only the project name, role pill, avatar stack (first 4, then `+N`), package count and manage button, with geometry, type and colours as in the handoff (§B3). Top to bottom: the name as `<h3>`, 17px/800, `text-wrap: pretty`; the role pill row; a `flex: 1` spacer; then the footer, with the avatars and count on the left and the manage button on the right.

**Structure.** The same layering `ProjectListRow` uses, for the same reason: a button can't contain a button. The select toggle is an absolutely-positioned `<button>` filling the card. The content sits above it in a `pointer-events-none` layer, and only the avatar-stack button and the manage button re-enable pointer events. Every one of these handlers calls `stopPropagation()`, because the page root deselects on background click. Without it, a click selects and then deselects in the same React batch, the bug `ab9222d` fixed on the rows.

**States.** Hover is CSS (`group-hover`), not React state. The border goes from 1px to 2px and the padding from 18px to 17px, so the content doesn't shift.

| State | Border | Padding | Shadow |
|---|---|---|---|
| Rest | 1px `card-line` | 18px | `card-rest` |
| Hover | 2px `card-line-hot` | 17px | `card-hover` |
| Selected | 2px `card-line-hot` | 17px | `card-selected` |

These properties transition over 320ms `cubic-bezier(.32,.72,0,1)`. The toggle has `aria-pressed={selected}` and an `aria-label` naming the project. Keyboard focus draws `shadow-stiko-focus` around the card.

### PackagesPanel

This is the handoff's Column C. The header carries the project name, then "Nothing open" or "N open comments" plus the project attention pill, then a close button. The sub-header has the "Packages" label and the avatar stack. The list follows, and then "Add a package".

- **Items.** Each package is a two-line button with a 3px `STATUS_ACCENT` left border. Line 1 is the name and the status chip; the chip is hidden when there is no version. Line 2 is the meta line, the attention pill and the count. Clicking an item goes to `/portal/{id}`. Hover lifts the shadow to `stiko-lift`.
- **Empty project.** Shows "No packages in this project yet."
- **Add a package.** Shown when `ownedByMe || myRole === 'coordinator'` (unchanged rule) and goes to `/new?project={id}`.
- **Avatar stack.** A button that opens `ProjectPanel` on the people view, the same as on the card.
- **Close.** Renders the **last** selected project while closing, the same `lastId` pattern `ProjectSummaryPanel` uses. Otherwise the panel empties before its slide-out has any frames.

### Tokens (`tailwind.config.ts`)

| Token | Value |
|---|---|
| `stiko.card-line` | `#AEB9F7` |
| `stiko.card-line-hot` | `#7480F2` |
| `stiko.manage-line` | `#E6E4FA` |
| `shadow-stiko-card-rest` | `0 0 12px rgba(28,32,48,0.045), 0 3px 10px rgba(28,32,48,0.045)` |
| `shadow-stiko-card-hover` | `0 0 16px rgba(28,32,48,0.06), 0 5px 16px rgba(28,32,48,0.065)` |
| `shadow-stiko-card-selected` | `0 0 18px rgba(28,32,48,0.07), 0 6px 20px rgba(28,32,48,0.08)` |

The existing `shadow-stiko-card` is left alone; it is still used elsewhere.

## State and behaviour

State lives in `app/page.tsx`, as today:

- `selected: string | null` (renamed from `expanded`)
- `lastId`, `filter`, `railOpen`
- the two `ProjectPanel` ids
- the trash flags

Behaviour:

- **Selecting a card** toggles `selected`. It also forces the rail open (unchanged, so the AI summary never animates open behind a hidden rail).
- **Clearing the selection.** Any of these clears it: re-clicking the card, the Packages panel ✕, the summary ✕, a background click, or **changing the filter**. The last one is new, from the handoff.
- **`railOpen`** still hydrates from localStorage in an effect, never as initial state.
- **Stat tiles and subline** both still count the filtered packages.

## Motion

All timings come from the handoff's table:

| What | Duration | Easing |
|---|---|---|
| Packages panel | `width` 520ms, `opacity` 380ms | `cubic-bezier(.32,.72,0,1)` |
| AI summary | 520ms, `opacity` 340ms | `cubic-bezier(.32,.72,0,1)` |
| Rail | 340ms | `cubic-bezier(.4,0,.2,1)` |
| Card states | 320ms | `cubic-bezier(.32,.72,0,1)` |

`visibility` always gets its own `0s` duration, delayed by the close duration. Sharing the other properties' duration keeps a closed panel focusable for twice as long.

**Grid glide (`useGridGlide`).** A `ResizeObserver` on the grid fires on every frame of any width change: the Packages panel opening or closing, the rail toggling, a window resize. On each callback:

1. Read every `[data-glide]` card's **layout** position from `offsetLeft`/`offsetTop`. These ignore transforms, so an in-flight glide doesn't pollute the measurement.
2. Read the grid's column count from its resolved `grid-template-columns`. If the count is unchanged, the cards only **drifted**: every track narrowed a little and the cards followed. That is ordinary layout, already smooth, and is left alone. If the count changed, the cards **jumped** to new rows or columns, and every card whose layout position moved by 1px or more gets a WAAPI `translate(dx, dy) → none`, 520ms `cubic-bezier(.32,.72,0,1)`. The trigger is the column count, not a distance threshold. A card that stays in column 1 across a 4→3 change still moves by the change in track width (≈80px at 1440px), and one fast frame of drift can move a far-right card nearly as far, so no single distance separates the two cases.
3. If a card is already gliding when it jumps again, it starts from where it is **visually**: its old layout position plus its current in-flight translate, read from the computed transform. Then it cancels the old animation. Otherwise it snaps.
4. Store the new layout positions.

Cards with no previous position (first render, or appearing after a filter change) don't animate. Under `prefers-reduced-motion: reduce` the hook does nothing, and the side columns and the Packages overlay carry `.stiko-motion`. The ResizeObserver callback runs after layout and before paint, so a glide starts on the same frame as the jump, with no one-frame flash at the new position.

**Second trigger, found in the browser pass:** the grid itself moving. At 1440px, opening the Packages panel narrows the column until the header's filter buttons re-wrap onto a second row, and the whole grid drops 46px in one frame. So card positions include the grid's own `offsetTop`, and a vertical move of the grid of 1px or more counts as a jump alongside a column-count change. This needs the grid's offsetParent to be its scroll container or inside it, so the centre column is `position: relative`. With a scrollable offsetParent, `offsetTop` doesn't change as the column scrolls. The check is vertical only: the rail's slide moves the column's left edge continuously, which is drift.

`lib/gridGlide.ts` holds step 2's decision and step 3's arithmetic as pure functions, `columnCount` and `planGlides`. They take previous and next layout positions, whether the column count changed, and each in-flight card's current translate, and return the `{ key, dx, dy }` list to animate. They are tested without a DOM. The cards change without the grid resizing after a filter change or a reload. For those, a `MutationObserver` on the grid's children retakes the baseline as a microtask straight after React's commit, before the next layout, so no resize frame ever compares against positions from before the swap.

## Testing

- **Unit (`node --test`).** `lib/gridGlide.ts` cases: movement ignored when the column count is unchanged, moved cards glide when it changes, unmoved cards don't, new and removed keys, and in-flight offsets. Also the new `lib/home.ts` label helpers. `lib/` modules keep relative `.ts` imports and no `@/` alias (the `node --test` import rules).
- **Static.** `tsc --noEmit`, lint, the full suite, and the production build with dummy env vars for the six required settings.
- **Browser (required, not optional).** The signed-in local account has zero projects, so stub `/api/home` in `initScript` with 5+ projects mixing owned and invited, a project with no packages, and a package with no version. Check:
  - select and deselect, including background click and the filter change
  - the panel shows the last project while closing
  - Trash is bottom-right with the panel closed and glides left of the panel when it opens, never overlapping it
  - cards glide rather than jump (sample `getBoundingClientRect` across the open, as done against the prototype)
  - the rail toggle
  - 1 project → one card-sized card
  - the width where both panels are open and the grid is one column
  - below lg: overlay panel, fixed Trash, stacking order
  - the welcome screen with a stubbed non-empty `/api/trash`

## Shipping

Merging to `main` deploys to production; there is no staging. Rollback is `git revert -m 1 <merge>`, which is clean: there's no migration and no data written by this branch. Commit only named paths, never `git add -A`: the untracked handoff folders at the repo root must stay out.
