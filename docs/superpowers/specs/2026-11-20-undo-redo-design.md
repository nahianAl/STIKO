# Undo / redo — design

2026-11-20. Status: approved in conversation, not built.

## Problem

Stiko has no action history. Cmd+Z / Ctrl+Z does nothing in the viewer, so a slip — a stray
stroke, a deleted shape, a plane dragged off the cut you wanted, a model rotated the wrong way —
can only be fixed by redoing the work by hand. Undo/redo was explicitly deferred when annotation
editing shipped (2026-07-14) and never picked up.

## Decisions (user)

- **Scope:** markup, measurements, moving/rotating the 3D model, and cross-sectioning.
- **One timeline per file**, Figma-style: Z undoes your most recent action whatever kind it was.
  Opening a different file starts a fresh history.
- **Keyboard only.** No on-screen buttons.
- **Command history** (each step carries its own undo and redo) over whole-state snapshots,
  because the state lives in three different places: React state (markup, measurements, plane
  flags), the three.js scene (plane poses), and the server (model placement).

## Shortcuts

| Action | macOS | Windows / Linux |
|---|---|---|
| Undo | ⌘Z | Ctrl+Z |
| Redo | ⇧⌘Z | Ctrl+Shift+Z, Ctrl+Y |

Match on `e.metaKey || e.ctrlKey` and `e.key.toLowerCase()`, so either modifier works on either
platform and Shift's capital `Z` still matches. `preventDefault()` only when the shortcut is
actually handled.

The shortcut is **ignored** (left to the browser) when:

- focus is in an `input`, `textarea`, `select` or `contenteditable` — the comment composer, a
  rename field, the calibration panel, and the markup text editor (a textarea) keep the
  browser's own text undo;
- a modal dialog is open (`[aria-modal="true"]` in the document);
- a pointer is held down — mid-stroke, mid-drag, mid-gizmo-drag, mid-colour-picker-drag;
- a server step is still in flight (see Model placement).

## Architecture

### History core — `lib/undo/history.ts` (pure, tested)

A plain data structure with no React and no `@/` imports (node --test rule).

```ts
interface Step {
  domain: 'markup' | 'measure' | 'section' | 'model';
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}
```

- `record(step)` pushes onto the undo stack and **clears the redo stack**.
- `undo()` pops the newest step, runs its `undo`, moves it to the redo stack. `redo()` is the
  mirror image.
- A step whose `undo`/`redo` rejects stays where it was (not moved), and the error is returned to
  the caller.
- `dropDomain(domain)` removes every step of one domain from both stacks, preserving the order of
  the rest. Safe because the domains never share state: each domain's steps chain only among
  themselves.
- `clear()` empties both stacks.
- Capacity 200; the oldest step falls off.

### React wiring — `components/undo/UndoHistory.tsx`

`UndoHistoryProvider` owns one history instance and the keyboard listener, mounted by the portal
page around the viewer. `useUndoHistory()` gives domains `record` and `dropDomain`. The portal
page calls `clear()` whenever the selected file changes.

### Coalescing rule: one step per quiet moment

Recording at each mutation would split one gesture into many steps — a group transform fires
`transformend` once per node, a drag-erase deletes many objects, a colour drag restyles
continuously, typing writes through on every key. So the array-backed domains (markup,
measurements, plane flags) record by **checkpoint**, not per mutation:

- The domain keeps a `baseline` ref: its state at the last checkpoint.
- A checkpoint runs at a *quiet moment*: no pointer held anywhere in the window, and no markup
  text editor open. It is scheduled whenever the state changes or a quiet moment begins
  (pointer released, text editor closed), and runs one animation frame later if still quiet, so
  every `transformend`/`onChange` from the same gesture has landed first. A change made with no
  pointer held (Delete key, image insert) therefore records on the next frame.
- If the current array is not `===` the baseline, record `{ before: baseline, after: current }`
  and move the baseline. Undo sets the state back to `before`; redo to `after`.

The arrays are never mutated in place (every hook uses `prev.map`/`filter`/spread), so storing
references costs nothing and identity comparison is exact.

One small shared hook, `useCheckpointedState`, does this for all three; the markup and
measurement hooks use it internally instead of a bare `useState`.

**Programmatic resets do not record.** A file switch, a PDF page change, closing the
cross-section tool, and the end of an annotation session all reset state through a `reset`
path that moves the baseline without recording, and drop that domain's steps.

## Domains

### Markup — `useAnnotationObjects`

`objects` becomes checkpointed. One step covers: drawing a shape, inserting an image, erasing
(one step per click or per drag sweep), deleting the selection, moving/scaling/rotating one or
many objects, restyling from the toolbar or the text bar, resizing a text box, and one whole text
editing session (open → close, however many keys).

- **Selection is not history**, but after an undo/redo the selection is pruned to ids that still
  exist, so the Transformer never points at a missing node.
- A text box created and closed empty is already discarded by the caller; with no net change
  across the quiet moment, nothing is recorded.
- **Done** and **Discard** end the annotation session: `clear()` resets markup and the page
  calls `dropDomain('markup')`. The objects are gone (captured or discarded), so their steps
  cannot be replayed.
- Two surfaces own an instance (`AnnotationCanvas`, `PDFKonvaViewer`), and only one is mounted
  at a time, so each records into the shared history through the hook.

### Measurements — `useMeasurements`

`measurements` becomes checkpointed. A step covers: placing a linear or angular measurement,
deleting one (eraser), and recolouring one.

- The half-placed gesture (`pending`, hover point) is not history. The measure tools are
  click-click, so the pointer is up between clicks and the shortcut is live there. An undo
  between the first and second click **only cancels the pending gesture** (restarting it, as
  `cancel` + `begin` do today) and consumes no step; the next undo walks history as normal.
- **Calibration is excluded.** It is a saved per-file setting (`PATCH /api/files/[id]/measure`),
  overwriting an existing one needs `canTransform`, and the API has no "remove calibration" call
  to undo a first calibration with. It is changed by calibrating again. The display unit is
  excluded for the same reason.
- `clearMeasurements` on the portal page (file switch, page change, stage resize) uses the reset
  path.

### Cross-section — portal page `sectionSlots` + scene poses

Two kinds of step:

1. **Flags** — switching a plane on/off and flipping it. `sectionSlots` is checkpointed like the
   arrays above.
2. **Pose** — one step per gizmo drag on a plane. `TransformGizmo` reports drag start and end
   (its existing `onMouseDown`/`onMouseUp`) through a new optional `onDragEnd(before, after)`
   for the plane target: the plane group's `position` and `quaternion` cloned at mouse-down
   and at mouse-up. Undo/redo copy the stored pose back onto the plane's `Object3D` (via the
   `objectRef` registry ModelViewerInner already keeps). The frame loop reads world matrices
   off the widgets, so the cut follows with no React render.

A drag that ends where it started records nothing.

**Closing the cross-section tool** resets the slots through the reset path and calls
`dropDomain('section')`: the planes it would replay are gone. Hiding a plane with its number button does *not* drop anything:
the widget stays mounted precisely so the pose survives.

### Model placement — `handleTransformCommit`

Recorded only after the PATCH succeeds, as `{ before: the file's previous transform, after: the
new one }`, so a failed save never enters history. Only someone with `canTransform` can drag the
model, so nobody else ever holds these steps.

- **Undo/redo re-save** through the same PATCH, so everyone sees the model go back. A local-only
  undo would leave the screen disagreeing with the stored placement, and the next comment pin
  would be saved against the wrong frame — the exact failure the existing rollback comment in
  `handleTransformCommit` is there to prevent.
- The re-save path is a variant of `handleTransformCommit` that does not record.
- While that PATCH is in flight, further undo/redo is ignored (no out-of-order saves).
- **On failure** the existing fallback snaps the model back to its persisted placement, the step
  stays on its stack, and a toast says "Couldn't undo — the model position wasn't saved."
- Last writer wins: undo overwrites whatever is stored, even if another reviewer moved the model
  since. Live updates are not merged, so there is no change feed to check against; this matches
  how a normal move behaves today.

## Not recorded

Selection, camera (orbit/pan/zoom/views), tool changes, colour/stroke picks with nothing
selected, parts-panel visibility and colours, comments (posted/edited/deleted — server-side, with
their own edit/delete), verdicts (already offer Undo in a toast), renames, trash, calibration,
display unit.

## Testing

- `scripts/tests/undo-history.test.mjs` — the pure core: record clears redo; undo/redo ordering;
  capacity 200; `dropDomain` keeps the order of the rest; a rejecting step stays put.
- `scripts/tests/undo-checkpoint.test.mjs` — the coalescing decision as a pure function: no step
  when `before === after`; one step for N mutations inside one quiet window; reset moves the
  baseline without a step.
- Browser pass on production build (`build` + `start`; the dev server cannot load pdf.js):
  - PDF: draw 3 shapes, Z×3 removes them in reverse, ⇧Z×3 restores; group-move 2 objects is one
    step; drag-erase across 3 is one step; type a word in a text box, close it, Z removes the
    text edit in one go; Z inside the open text box only undoes text.
  - Image: same sweep on the snapshot surface. (Ending an image session clears its
    measurements too — that is existing behaviour — so they leave history with it.)
  - 3D: a measurement placed before a markup session still undoes after Done, because 3D
    measurements survive the session.
  - 3D: rotate the model, Z puts it back and a reload shows the old placement; turn on plane 1,
    drag it, flip it, Z×3 walks back flip → drag → on.
  - Typing in the comment composer: ⌘Z undoes text, not the viewer.

## Files

New: `lib/undo/history.ts`, `lib/undo/checkpoint.ts`, `components/undo/UndoHistory.tsx`,
`components/undo/useCheckpointedState.ts`, two test files.
Changed: `useAnnotationObjects.ts`, `useMeasurements.ts`, `AnnotationCanvas.tsx`,
`PDFKonvaViewer.tsx`, `TransformGizmo.tsx`, `ModelViewerInner.tsx`, `app/portal/[id]/page.tsx`.

## Rollback

Client-only, no migration, no new API route. Revert the merge commit and push.
