'use client';

import React, { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import {
  Avatar,
  RolePill,
  SectionLabel,
  TagChip,
} from '@/components/ui/Primitives';
import AccessEditor from '@/components/people/AccessEditor';
import { AddPeopleModal } from '@/components/people/AddPeopleModal';
import { relativeTime } from '@/lib/design';
import { projectRoster } from '@/lib/projectRoster';
import type { ProjectPackage } from '@/lib/projectOverview';

type Role = 'viewer' | 'commenter' | 'uploader';

/** Same normalisation projectRoster.ts uses internally (not exported), so a
 *  pending invite's email lines up with a roster key built the same way. */
const norm = (email: string) => (email ?? '').trim().toLowerCase();

interface GuestRow {
  /** RosterEntry.key — users.id for an accepted person, the lower-cased
   *  email for someone who has never accepted anywhere. */
  key: string;
  name: string;
  email: string;
  company: string | null;
  /** Whether this person has an accepted row on ANY package. False here does
   *  not mean every cell of theirs is an invite — see roleForCell below. */
  pending: boolean;
  /** Earliest invite timestamp across this person's still-open invites.
   *  Only meaningful when `pending` is true. */
  pendingSince?: string;
}

/** What one (guest, package) cell actually is, checked directly against that
 *  package's own people/pending lists rather than trusting the row's overall
 *  `pending` flag.
 *
 *  lib/projectRoster.ts documents exactly why this split matters: someone who
 *  has accepted on one package can still have a separate, still-open invite
 *  on another. That second invite is folded into their accepted roster row
 *  (so they are not shown twice), but the per-package truth is not lost — the
 *  docs say plainly that it is this matrix's job to read `pkg.pending`
 *  directly. Deciding a cell's pending-ness from `g.pending` instead would
 *  read an accepted person's still-open invite as ordinary accepted access,
 *  and opening AccessEditor on it would send `pending: false` with their real
 *  `userId` against a package they have not accepted — GET /api/participants
 *  would find no row and the editor would show its load error.
 *
 *  Matched on email, not `g.key`: `g.key` is `RosterEntry.key`, which
 *  lib/projectRoster.ts sets to `users.id` for anyone who has accepted on ANY
 *  package — comparing that to a normalised email could never match, so the
 *  invited branch used to be reachable only for guests who had never
 *  accepted anywhere (a case the row's own `pending` flag already covered).
 *  Matching `norm(i.email)` against `norm(g.email)` instead reaches the case
 *  this function exists for: an accepted person with a separate, still-open
 *  invite on a different package.
 *
 *  The returned `email` is the invite's (or participant's) own raw address,
 *  not `g.email` — for a pending guest `g.email` is projectRoster's
 *  normalised key, and passing that on to AccessEditor would send a
 *  lower-cased address to routes that match email case-sensitively. */
function roleForCell(
  g: GuestRow,
  pkg: ProjectPackage
): { role: Role; invited: boolean; email: string } | null {
  const accepted = pkg.people.find((p) => p.id === g.key);
  if (accepted)
    return { role: accepted.role as Role, invited: false, email: accepted.email };
  const invited = pkg.pending.find((i) => norm(i.email) === norm(g.email));
  return invited
    ? { role: invited.role as Role, invited: true, email: invited.email }
    : null;
}

/**
 * 4a — the team & access matrix.
 *
 * This is not administrative housekeeping. A package is a permission boundary,
 * so this screen is how a coordinator avoids showing the client the
 * consultant's markup. The footer sentence is the point of the whole thing.
 *
 * The grid used to hold its own tiny role menu and know nothing of pending
 * invites. It now builds its row set from `projectRoster` (Task 1) — so a
 * pending invitee gets a row of their own — and delegates all cell editing to
 * `AccessEditor` (Task 3), the one editor that also knows resend and revoke.
 *
 * A cell that already carries a role opens `AccessEditor`. An em-dash cell
 * does not: `AccessEditor` loads an existing (person x package) row and now
 * errors when there is none, and the write it would otherwise send —
 * `POST /api/participants/role` with a real role — is an
 * `UPDATE participants SET role` that matches zero rows for a non-participant
 * and still returns `{ok:true}`, a silent no-op. Granting fresh access is an
 * invitation, so an em-dash click opens `AddPeopleModal` instead, pre-scoped
 * to the package that cell belongs to (see the note by its mount point below
 * for what "pre-scoped" does and does not cover).
 */
export function TeamMatrix({
  members,
  packages,
  onChanged,
  onAddPeople,
  offsetLeft = 0,
  onSubSurfaceChange,
}: {
  members: {
    id: string;
    name: string;
    email: string;
    company: string | null;
    role: string;
    isYou: boolean;
  }[];
  packages: ProjectPackage[];
  onChanged: () => void;
  onAddPeople: () => void;
  /** Distance from the positioned ancestor's left edge, passed straight
   *  through to AccessEditor's own `offsetLeft` (and from there to Drawer's).
   *  This matrix is a child of whatever panel mounts it — it cannot see what
   *  is to its left, so per Drawer's own doc the caller owns that arithmetic.
   *  Defaults to 0 for a mount with nothing beside it. */
  offsetLeft?: number;
  /** Called whenever this matrix's own sub-surfaces (AccessEditor or
   *  AddPeopleModal) open or close. Drawer registers an unconditional
   *  `document` Escape handler, so a container that mounts this matrix inside
   *  its own Escape-closeable surface must fold this into its own
   *  `closeOnEscape` guard — otherwise one Escape press closes both this
   *  matrix's sub-surface and the container itself. */
  onSubSurfaceChange?: (open: boolean) => void;
}) {
  const [editing, setEditing] = useState<{
    personId: string;
    portalId: string;
  } | null>(null);
  // The package an em-dash click grants fresh access to. A separate piece of
  // state from `editing`: that cell has no row yet, so there is nothing for
  // AccessEditor to open, and this is a different component (AddPeopleModal)
  // with a different prop shape (no person to identify at all — see below).
  const [addInvitePkg, setAddInvitePkg] = useState<ProjectPackage | null>(
    null
  );

  // This matrix is only ever mounted by a caller that has already confirmed
  // the viewer can manage the project (ProjectPeopleDrawer.tsx gates on its
  // own `canManage` before rendering this at all). Re-deriving it here rather
  // than assuming it — from the same members list the caller already hands
  // in, the same way ProjectPeopleDrawer itself derives it from the project
  // record — means AccessEditor is never handed a hardcoded `true`: a future
  // caller that mounts this for a non-manager still gets an honest value.
  const canManage = members.some(
    (m) => m.isYou && (m.role === 'owner' || m.role === 'coordinator')
  );

  // One row per guest — accepted or pending — built from projectRoster
  // (Task 1) rather than from accepted people alone, so an invitee who has
  // never accepted anywhere still gets a row. Company and "earliest invited"
  // are not carried by RosterEntry, so they are gathered here in a second
  // pass over the same packages the roster itself was built from.
  const roster = projectRoster(packages);

  const companyByKey = new Map<string, string>();
  const pendingSinceByKey = new Map<string, string>();
  for (const pkg of packages) {
    for (const p of pkg.people) {
      if (p.company && !companyByKey.has(p.id)) companyByKey.set(p.id, p.company);
    }
    for (const inv of pkg.pending) {
      const key = norm(inv.email);
      const seen = pendingSinceByKey.get(key);
      if (!seen || new Date(inv.createdAt).getTime() < new Date(seen).getTime()) {
        pendingSinceByKey.set(key, inv.createdAt);
      }
    }
  }

  const guestList: GuestRow[] = roster.map((entry) => ({
    key: entry.key,
    name: entry.name,
    email: entry.email,
    company: entry.pending ? null : (companyByKey.get(entry.key) ?? null),
    pending: entry.pending,
    pendingSince: entry.pending ? pendingSinceByKey.get(entry.key) : undefined,
  }));

  // Resolved fresh on every render from `editing`, rather than captured once
  // when the cell was clicked — so if `onChanged()` causes packages/members to
  // refetch mid-edit, the drawer keeps reading the current row instead of a
  // stale snapshot.
  const editingGuest = editing
    ? guestList.find((g) => g.key === editing.personId)
    : undefined;
  const editingPkg = editing
    ? packages.find((p) => p.id === editing.portalId)
    : undefined;
  const editingCell =
    editingGuest && editingPkg ? roleForCell(editingGuest, editingPkg) : null;

  // Either sub-surface counts as "open" for the container's Escape guard:
  // AccessEditor only actually mounts below when editingCell also resolves
  // (Fix 6), so this mirrors that same condition rather than the looser
  // `editing !== null`, which could report open a beat after the row it
  // pointed at has disappeared and the editor has already declined to mount.
  const subSurfaceOpen =
    Boolean(editingGuest && editingPkg && editingCell) || addInvitePkg !== null;

  useEffect(() => {
    onSubSurfaceChange?.(subSurfaceOpen);
  }, [subSurfaceOpen, onSubSurfaceChange]);

  const onCellClick = (g: GuestRow, pkg: ProjectPackage) => {
    const cell = roleForCell(g, pkg);
    if (cell) {
      setEditing(
        editing?.personId === g.key && editing?.portalId === pkg.id
          ? null
          : { personId: g.key, portalId: pkg.id }
      );
      return;
    }
    // No row at all for this pair. Granting one is a manage-only action —
    // AddPeopleModal has no permission concept of its own (it just posts to
    // /api/participants, which 403s a non-manager server-side), so this is
    // the one place in the matrix that gates on `canManage` directly rather
    // than leaving it to a control that would fail silently-ish behind it.
    if (!canManage) return;
    setAddInvitePkg(pkg);
  };

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-extrabold text-stiko-ink">
            Team &amp; access
          </h2>
          <p className="mt-1 text-[12.5px] text-stiko-muted">
            {guestList.length + members.length} people across {packages.length}{' '}
            package{packages.length === 1 ? '' : 's'}. Guests only ever see the
            packages they&apos;re on.
          </p>
        </div>
        <Button onClick={onAddPeople}>Add people</Button>
      </div>

      {/* Project members — they see everything. */}
      <div className="rounded-panel bg-white p-5 shadow-stiko-panel">
        <div className="flex items-center gap-2">
          <SectionLabel>Project members</SectionLabel>
          <span
            className="rounded-chip px-[6px] py-[3px] text-[10px] font-extrabold uppercase"
            style={{ background: '#EBE4FD', color: '#6b4fc4' }}
          >
            See every package
          </span>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 rounded-[11px] bg-stiko-app px-3 py-[10px]"
            >
              <Avatar id={m.id} name={m.name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold text-stiko-ink">
                  {m.name}
                  {m.isYou && (
                    <span className="ml-1 text-[11px] font-semibold text-stiko-faint">
                      (you)
                    </span>
                  )}
                </div>
                <div className="truncate text-[11.5px] text-stiko-muted">
                  {m.email}
                </div>
              </div>
              <span
                className={`shrink-0 text-[12px] font-bold capitalize ${
                  m.role === 'owner' ? 'text-stiko-faint' : 'text-stiko-ink'
                }`}
              >
                {m.role}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Package guests — the matrix. */}
      <div className="overflow-hidden rounded-panel bg-white shadow-stiko-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <SectionLabel>Package guests · {guestList.length}</SectionLabel>
          <div className="flex items-center gap-3 text-[11px] text-stiko-muted">
            <LegendItem role="viewer" label="Viewer" />
            <LegendItem role="commenter" label="Commenter" />
            <LegendItem role="uploader" label="Uploader" />
          </div>
        </div>

        {guestList.length === 0 ? (
          <p className="px-5 py-8 text-center text-[12.5px] text-stiko-muted">
            No guests yet. Everyone here is a project member.
          </p>
        ) : (
          // Beyond ~8 packages this needs a horizontal scroll with the name
          // column pinned; the wrapper below is that scroll container.
          <div className="mt-3 overflow-x-auto px-5 pb-5">
            <div
              className="grid min-w-full"
              style={{
                gridTemplateColumns: `288px repeat(${packages.length}, minmax(96px, 1fr))`,
              }}
            >
              <div className="border-b-[1.5px] border-stiko-divider pb-3" />
              {packages.map((pkg) => (
                <div
                  key={pkg.id}
                  className="flex flex-col items-center gap-[6px] border-b-[1.5px] border-stiko-divider px-2 pb-3 text-center"
                >
                  <span className="text-[11.5px] font-extrabold leading-tight text-stiko-ink">
                    {pkg.name}
                  </span>
                  {pkg.tag && <TagChip tag={pkg.tag} />}
                </div>
              ))}

              {guestList.map((g) => (
                <React.Fragment key={g.key}>
                  <div className="flex items-center gap-3 border-b border-stiko-border py-[10px] pr-3">
                    <Avatar
                      id={g.key}
                      name={g.name}
                      size={30}
                      pending={g.pending}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-bold text-stiko-ink">
                        {g.name}
                      </div>
                      {g.pending ? (
                        // The note-yellow pair the rest of the app uses for
                        // "waiting on someone" (tailwind.config.ts:
                        // note.yellow / note.yellow-text) — same tokens
                        // VersionBrief.tsx's own pending chip uses.
                        <span className="mt-[3px] inline-flex items-center rounded-chip bg-note-yellow px-[6px] py-[2px] text-[9.5px] font-bold text-note-yellow-text">
                          Invited{' '}
                          {g.pendingSince ? relativeTime(g.pendingSince) : ''}
                        </span>
                      ) : (
                        <div className="truncate text-[11px] text-stiko-muted">
                          {g.company ?? g.email}
                        </div>
                      )}
                    </div>
                  </div>

                  {packages.map((pkg) => {
                    const cell = roleForCell(g, pkg);
                    const isEditing =
                      editing?.personId === g.key && editing?.portalId === pkg.id;
                    return (
                      <div
                        key={pkg.id}
                        className="relative flex items-center justify-center border-b border-stiko-border py-[10px]"
                      >
                        {/* Every cell is a control: a role opens AccessEditor,
                            an em-dash opens AddPeopleModal (see onCellClick). */}
                        <button
                          onClick={() => onCellClick(g, pkg)}
                          className={`rounded-chip transition hover:opacity-80 ${
                            isEditing ? 'ring-2 ring-stiko-primary' : ''
                          }`}
                          aria-label={`${g.name} on ${pkg.name}`}
                        >
                          <RolePill
                            role={cell?.role ?? null}
                            pending={cell?.invited ?? false}
                          />
                        </button>
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {/* The sentence that carries the screen. */}
        {guestList.length > 0 && (
          <div className="border-t border-stiko-border bg-stiko-app px-5 py-[13px] text-[12px] leading-[1.5] text-stiko-secondary">
            Click any cell to grant access, change a role or remove it. Nothing
            here is visible to guests
            {guestList[0] && packages[0] ? (
              <>
                {' '}— {guestList[0].name} only ever sees{' '}
                <b className="text-stiko-ink">
                  {packages.find((p) => roleForCell(guestList[0], p))?.name ??
                    packages[0].name}
                </b>
                .
              </>
            ) : (
              '.'
            )}
          </div>
        )}
      </div>

      {/* Mounted only while a cell with an existing row is being edited —
          matches VersionDetailDrawer.tsx's own inline-Drawer consumer, which
          likewise unmounts on close rather than animating out. Gated on
          `editingCell` too, not just `editingGuest`/`editingPkg`: if the row
          disappears out from under an open editor (a refetch mid-edit),
          there is no cell left to derive `userId`/`pending`/`email` from, and
          mounting anyway would risk breaching AccessEditor's documented
          contract that `pending` alone decides which identifier is sent.
          email/pending/userId all come from `editingCell` (Fix 2/3), not from
          `editingGuest`: for a pending row `editingGuest.email` is
          projectRoster's normalised key, not the address as stored, and
          `editingGuest.pending` is the roster's whole-person flag, which can
          disagree with this specific cell (someone accepted elsewhere with a
          separate open invite here).
          offsetLeft: this matrix cannot see what is to its left — only the
          container that mounts it knows the width of whatever this sits
          beside — so the value is threaded straight through from this
          component's own `offsetLeft` prop rather than reasoned about here. */}
      {editingGuest && editingPkg && editingCell && (
        <AccessEditor
          isOpen
          onClose={() => setEditing(null)}
          portalId={editingPkg.id}
          packageName={editingPkg.name}
          userId={editingCell.invited ? null : editingGuest.key}
          email={editingCell.email}
          displayName={editingGuest.pending ? editingCell.email : editingGuest.name}
          pending={editingCell.invited}
          canManage={canManage}
          offsetLeft={offsetLeft}
          onChanged={onChanged}
        />
      )}

      {/* An em-dash click grants fresh access, which is an invitation, not an
          edit — AddPeopleModal (already wired to POST /api/participants) does
          that, not AccessEditor. Pre-scoping: AddPeopleModal only auto-selects
          a package (skipping its own checklist) when it is handed exactly
          one, via its own `singlePackage` branch — so passing `[pkg]` here
          genuinely pre-scopes the PACKAGE half of "pre-scoped to that person
          and that package". The PERSON half cannot be done at all: the modal
          owns its `emails` field as its own local state with no prop to seed
          it, and this task's brief is Modify: TeamMatrix.tsx only, so
          threading a prefill prop through AddPeopleModal is out of scope
          here. `projectName` is genuinely required by AddPeopleModal but this
          matrix is never handed the project's name — the clicked package's
          own name fills that slot instead, which reads sensibly as the
          modal's subtitle given the invite is scoped to just that package.
          Mounted only when there is a package to scope it to, rather than
          unconditionally with `packages={addInvitePkg ? [addInvitePkg] : []}`:
          AddPeopleModal seeds `selection` (and therefore `singlePackage`) from
          `packages` in a `useState` initializer, which runs once at mount —
          nothing re-seeds it later. An always-mounted instance is born with
          `packages={[]}`, so `singlePackage` is false, `selection` stays `{}`
          forever, and clicking an em-dash would hide the package checklist
          (because `singlePackage` looks true by then) while `chosen` stays
          empty — Send invitation disabled with no control left to enable it.
          Mounting fresh each time also clears any stale email/note text an
          always-mounted instance would otherwise retain between opens. */}
      {addInvitePkg && (
        <AddPeopleModal
          isOpen
          onClose={() => setAddInvitePkg(null)}
          projectName={addInvitePkg.name}
          packages={[addInvitePkg]}
          onDone={onChanged}
        />
      )}
    </div>
  );
}

function LegendItem({ role, label }: { role: Role; label: string }) {
  return (
    <span className="flex items-center gap-[5px]">
      <RolePill role={role} />
      {label}
    </span>
  );
}
