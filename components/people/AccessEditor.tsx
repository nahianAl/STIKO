'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Drawer from '@/components/ui/Drawer';
import Button from '@/components/ui/Button';
import { Avatar, SectionLabel, SkeletonBar, Toggle } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { roleLabel } from '@/lib/roles';

type Role = 'viewer' | 'commenter' | 'uploader';

// Verbatim from app/portal/[id]/settings/people/page.tsx's ROLE_HELP — that
// copy is already right, so it is quoted here rather than rewritten.
const ROLE_HELP: Record<Role, string> = {
  viewer: 'Viewers can open every file and read every comment.',
  commenter: 'Commenters can do everything a viewer can, and leave comments.',
  uploader: 'Uploaders can do everything a commenter can, and publish versions.',
};

interface AccessFields {
  role: Role;
  canDownload?: boolean;
  /** Withheld by GET /api/participants (an allowlist) from anyone without
   *  manage rights — never assume this is present. */
  allVersions?: boolean;
  /** Same withholding as allVersions. */
  versionIds?: string[];
}

interface ParticipantRow extends AccessFields {
  userId: string;
}

interface PendingRow extends AccessFields {
  email: string | null;
}

interface VersionOption {
  id: string;
  versionNumber: number;
}

async function postJSON(
  url: string,
  body: unknown
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: {} };
  }
}

/**
 * The single editor for a (person x package) pair — exactly one
 * `participants` row (or, before acceptance, one `invite_tokens` row keyed on
 * the same email). Everything the drawer and the settings page each grew
 * separately — role, pending vs accepted, resend/revoke, version scope,
 * download — lives here once, so both surfaces can open the same thing
 * instead of re-growing their own half.
 *
 * Every control here is lifted from app/portal/[id]/settings/people/page.tsx,
 * which already got the fetch shapes and the scope guard right.
 */
export default function AccessEditor({
  isOpen,
  onClose,
  portalId,
  packageName,
  userId,
  email,
  displayName,
  pending,
  canManage,
  offsetLeft,
  onChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** The package this access is on. */
  portalId: string;
  packageName: string;
  /** users.id for an accepted person, null for a pending invite. */
  userId: string | null;
  /** Always present — the pending case has only an address. */
  email: string;
  displayName: string;
  pending: boolean;
  /** Whether the person viewing this drawer can manage people on this
   *  package. GET /api/participants withholds allVersions/versionIds from
   *  anyone without manage rights (an allowlist), GET /api/invites 403s them
   *  outright, and every mutation route here 403s too — so when this is
   *  false the scope and download sections and the danger strip are omitted
   *  entirely and the role renders read-only, rather than the editor
   *  guessing at values it was never given. The surfaces that mount this
   *  already know the caller's own access, so it comes in as a prop rather
   *  than being re-derived here. */
  canManage: boolean;
  /** Distance from the positioned ancestor's left edge, passed straight
   *  through to Drawer's own `offsetLeft` — this always anchors "inline"
   *  beside another panel, and per Drawer's doc the caller owns that
   *  arithmetic. Required, not optional: the only other inline consumer
   *  (VersionDetailDrawer.tsx) declares it required too, and an omitted
   *  value would render this drawer at `left: 0` — on top of the panel it
   *  is meant to sit beside — with `tsc` never catching the missing prop at
   *  a mount site, since `undefined` would otherwise be silently valid. */
  offsetLeft: number;
  /** Refetch the panel; access changed. */
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<Role>('commenter');
  const [canDownload, setCanDownload] = useState(false);
  const [allVersions, setAllVersions] = useState(true);
  const [versionIds, setVersionIds] = useState<string[]>([]);
  const [versions, setVersions] = useState<VersionOption[]>([]);
  // Distinguishes "this package genuinely has none" from "the request to
  // list them failed" — GET /api/versions returning a non-OK status used to
  // be indistinguishable from an empty package, so the empty-state copy
  // below could flatly lie about why the box is empty.
  const [versionsLoadFailed, setVersionsLoadFailed] = useState(false);

  // Bumped at the start of every load(), and whenever the drawer closes, so
  // a response — from load() or from any mutation below — can tell whether
  // it is still the latest one in flight. Without this, opening on Bob,
  // toggling something, closing (Escape and a scrim click both bypass
  // `busy`), and opening on Alice before Bob's slower request lands would
  // let Bob's response win the race and paint his settings under Alice's
  // name once it finally resolves. Same shape as components/home/TrashPanel.tsx.
  const gen = useRef(0);

  // Every mutation route (/api/participants/role, /download, /versions)
  // accepts either a real user id (accepted) or an email (pending) under the
  // same `userId` field — this is the one identifier all of them send.
  //
  // `pending` is what decides which collection load() reads from
  // (/api/invites vs /api/participants), so it must also be the one thing
  // that decides which identifier gets sent — otherwise the two can disagree.
  // `userId ?? email` used to decide this instead: a caller passing a real
  // users.id alongside pending: true (entirely possible — the cross-package
  // grid holds users.id for anyone with an account, whether or not they've
  // accepted on *this* package) made identityKey a uuid. /api/participants/
  // role branches on whether the value contains '@', so it took the accepted
  // branch, matched zero rows, and returned {ok:true} anyway — revoke
  // "succeeded" while the invite token stayed live and redeemable. Do not
  // simplify this back to `userId ?? email`.
  //
  // In the other direction: inside the non-pending branch, `userId ?? email`
  // only falls through to `email` if `userId` were null, which cannot happen
  // here. GET /api/participants always INNER JOINs users
  // (`JOIN users u ON u.id = p.user_id`), so every accepted row it returns —
  // and therefore every `userId` this component is ever mounted with for a
  // non-pending person — already carries a real `users.id`. The fallback is
  // dead code, kept only because `userId` is typed `string | null`; it is
  // not a second path this relies on silently.
  const identityKey = pending ? email : (userId ?? email);

  const load = useCallback(() => {
    const myGen = ++gen.current;
    setLoading(true);
    setLoadError(null);
    // Reset before the fetch, not after: if the fetch fails or the row is
    // missing, the previous person's role/download/scope must not still be
    // sitting in state under the new person's header.
    setRole('commenter');
    setCanDownload(false);
    setAllVersions(true);
    setVersionIds([]);
    // Reset alongside the rest: a mutation left in flight when the drawer
    // moved on to a new identity (or a new open) never gets to clear its own
    // `busy` — its generation check now sits above that clear (see every
    // mutation below), by design, so a stale response cannot yank `busy` out
    // from under whoever is on screen now. load() running is what guarantees
    // busy is false whenever a drawer is actually presented.
    setBusy(false);
    // Reset with the others — this is the one field that fetch below can
    // otherwise leave holding the previous person's (or previous package's)
    // versions for the whole loading spinner, and briefly longer still if the
    // /api/versions leg resolves after everything else.
    setVersions([]);
    setVersionsLoadFailed(false);

    (async () => {
      try {
        const [versionsRes, dataRes] = await Promise.all([
          fetch(`/api/versions?portalId=${portalId}`),
          fetch(
            pending
              ? `/api/invites?portalId=${portalId}`
              : `/api/participants?portalId=${portalId}`
          ),
        ]);
        if (myGen !== gen.current) return;

        const versionsList = versionsRes.ok ? await versionsRes.json() : [];
        if (myGen !== gen.current) return;
        const versionsArr = Array.isArray(versionsList) ? versionsList : [];
        setVersions(versionsArr);
        // Only a non-OK response (or a malformed body) counts as a failure —
        // an empty array from a healthy 200 really does mean no published
        // versions, and the two must read differently below.
        setVersionsLoadFailed(!versionsRes.ok);

        if (!dataRes.ok) {
          setLoadError("Could not load this person's access.");
          setLoading(false);
          return;
        }

        const rows = await dataRes.json();
        if (myGen !== gen.current) return;

        const row = pending
          ? (rows as PendingRow[]).find((r) => r.email === email)
          : (rows as ParticipantRow[]).find((r) => r.userId === userId);

        if (!row) {
          setLoadError("Could not load this person's access.");
          setLoading(false);
          return;
        }

        setRole(row.role);
        setCanDownload(Boolean(row.canDownload));
        // GET /api/participants withholds allVersions/versionIds from anyone
        // without manage rights. Missing reads as "all versions" — the same
        // `!== false` convention the settings page uses, and the same
        // default participants.all_versions itself has. `canManage` still
        // governs whether the scope section ever renders at all — see below.
        setAllVersions(row.allVersions !== false);
        setVersionIds(row.versionIds ?? []);
        setLoading(false);
      } catch {
        if (myGen !== gen.current) return;
        setLoadError('Could not reach the server.');
        setLoading(false);
      }
    })();
  }, [portalId, pending, email, userId]);

  useEffect(() => {
    if (isOpen) {
      load();
      return;
    }
    // A mutation kicked off before Escape or a scrim click — neither of
    // which `busy` blocks — can still resolve after the drawer is gone.
    // Bumping here means its captured generation can never match again, so
    // its success path (below) cannot setState or toast under whoever the
    // drawer shows next. A reopen on a *different* identity while staying
    // open is already covered without this: load() bumps on every call it
    // makes, and it gets called again whenever its own deps
    // (portalId/pending/email/userId) change.
    gen.current++;
  }, [isOpen, load]);

  const changeRole = async (next: Role) => {
    // Captured before the await, checked after — same trick as load()'s own
    // guard. If the drawer closes or moves on to someone else while this is
    // in flight, gen.current will have moved past myGen by the time the
    // response lands, and the success path below must not paint under the
    // wrong name.
    const myGen = gen.current;
    setBusy(true);
    const { ok } = await postJSON('/api/participants/role', {
      userId: identityKey,
      portalId,
      role: next,
    });
    // Checked before clearing busy (or toasting, or touching any other
    // state): a stale response — this request outliving a close or a move to
    // someone else's drawer — must not clear `busy` out from under whoever
    // the drawer has moved on to, mid-mutation of their own, and must not
    // toast a failure over their drawer either. load() is what guarantees
    // `busy` starts false for whoever is on screen; this guard is what stops
    // a late arrival from being the one to flip it after that.
    if (myGen !== gen.current) return;
    setBusy(false);
    if (!ok) {
      toast('Could not change role');
      return;
    }
    setRole(next);
    // An uploader is never scoped — the server clears any narrowing the
    // moment someone is promoted (lib/access.ts), so the editor's own display
    // follows rather than showing a scope that no longer exists.
    if (next === 'uploader') {
      setAllVersions(true);
      setVersionIds([]);
    }
    toast('Role updated');
    onChanged();
  };

  const changeDownload = async (next: boolean) => {
    // See changeRole's comment on this pattern.
    const myGen = gen.current;
    setBusy(true);
    const { ok } = await postJSON('/api/participants/download', {
      userId: identityKey,
      portalId,
      canDownload: next,
    });
    // See changeRole's comment: generation checked before busy is cleared.
    if (myGen !== gen.current) return;
    setBusy(false);
    if (!ok) {
      toast('Could not change download access');
      return;
    }
    setCanDownload(next);
    toast(next ? 'Download allowed' : 'Download turned off');
    onChanged();
  };

  // Sent whole rather than as a diff — same reasoning as the settings page's
  // changeScope: this editor always holds the complete selection, and a diff
  // would need a merge rule for a scope changed in another tab.
  const changeScope = async (nextAllVersions: boolean, nextVersionIds: string[]) => {
    // See changeRole's comment on this pattern.
    const myGen = gen.current;
    setBusy(true);
    const { ok } = await postJSON('/api/participants/versions', {
      userId: identityKey,
      portalId,
      allVersions: nextAllVersions,
      versionIds: nextVersionIds,
    });
    // See changeRole's comment: generation checked before busy is cleared.
    if (myGen !== gen.current) return;
    setBusy(false);
    if (!ok) {
      toast('Could not change which versions they can see');
      return;
    }
    setAllVersions(nextAllVersions);
    setVersionIds(nextVersionIds);
    toast('Versions updated');
    onChanged();
  };

  // Guard, verbatim from the settings page: allVersions: false with an empty
  // list is a scope that admits nothing, silently. Short-circuited here
  // rather than sent to a route that now rejects it anyway. Unchecking "All
  // versions" no longer reaches this at all (see the checkbox handler below)
  // — what this still guards is deselecting the last remaining chip while
  // mid-edit.
  const changeScopeGuarded = (nextAllVersions: boolean, nextVersionIds: string[]) => {
    if (!nextAllVersions && nextVersionIds.length === 0) {
      // The one case this still guards: deselecting the last remaining chip
      // (unchecking "All versions" itself never reaches here — see the
      // checkbox handler below). Refusing without a word would leave that
      // chip lit, no state changed, and the "pick at least one" hint unable
      // to render (it only shows once versionIds is already empty) — the one
      // interaction the guard protects would look like nothing happened.
      toast('Keep at least one version selected, or turn "All versions" back on.');
      return;
    }
    changeScope(nextAllVersions, nextVersionIds);
  };

  // Remove (accepted) and revoke (pending) turn out to be the same call: a
  // pending row here is always an addressed invite (there is no share-link
  // concept in this component's props — no token, no "anyone with the
  // link"), so the branch of the settings page's `revoke` that actually
  // applies is the email one, POST /api/participants/role with role: null —
  // identical to how an accepted person is removed. DELETE /api/invites only
  // accepts a token, and GET /api/invites deliberately never returns one for
  // an addressed invite (see that route's own comment), so it has no way to
  // reach this row at all.
  const endAccess = async (successMessage: string, failureMessage: string) => {
    // Generation-guarded like every other mutation, and for a sharper reason
    // than a stray toast: this one calls onClose(). A stale revoke — Bob's,
    // landing after the drawer has moved on to Alice — would otherwise shut
    // Alice's drawer under her, reporting Bob's success while she was part
    // way through editing someone else's access.
    const myGen = gen.current;
    setBusy(true);
    const { ok } = await postJSON('/api/participants/role', {
      userId: identityKey,
      portalId,
      role: null,
    });
    if (myGen !== gen.current) return;
    setBusy(false);
    if (!ok) {
      toast(failureMessage);
      return;
    }
    toast(successMessage);
    onChanged();
    onClose();
  };

  const resend = async () => {
    // Refuse before posting, same wording as changeScopeGuarded uses.
    // Unchecking "All versions" is local-only (see the checkbox handler
    // below), so the drawer can legitimately be sitting on
    // allVersions:false, versionIds:[] when this button is clicked, before
    // any version has been picked. POST /api/participants has no guard of
    // its own — unlike /api/participants/versions, which 400s this exact
    // body — so without this check it would mint a token with
    // all_versions = false and zero scope rows: an invitation that admits
    // the invitee to nothing. Do not "fix" this by coercing allVersions to
    // true instead — that would silently widen a grant from a button whose
    // label promises neither.
    if (!allVersions && versionIds.length === 0) {
      toast('Keep at least one version selected, or turn "All versions" back on.');
      return;
    }
    // Same pattern as changeRole — but here it also guards the load() call
    // below: without it, a stale resend (Bob's) landing after the drawer has
    // moved on to Alice would call Bob's own load(), which would win the
    // race outright (load() bumps gen.current itself, becoming the new
    // "latest") and overwrite Alice's on-screen access with Bob's fetched
    // row.
    const myGen = gen.current;
    setBusy(true);
    // Revoke every prior token at this address BEFORE minting the
    // replacement, so acceptance cannot leave a redeemable orphan behind.
    // Order matters: the revoke is address-wide and hits every un-used
    // token, so it must precede the insert or it would kill the new one too.
    //
    // Without this, POST /api/participants only ever INSERTs — it never
    // revokes the token the original invite or a previous resend created,
    // and there is no unique constraint on (portal_id, email) — so the prior
    // token survives with used_at still NULL. Acceptance stamps used_at on
    // only the clicked token, so removing this person later deletes their
    // participants row but touches no token: the survivor still looks
    // unused, the single-use gate is skipped, the binding check passes, and
    // the row is re-created. A removed person can re-admit themselves by
    // clicking the older link in their inbox, for up to 14 days. The
    // survivor also keeps them listed as pending on a package they have
    // already accepted, and shows two rows for one address after a resend.
    // Sending the same grants to both tokens (below) only ever made the two
    // tokens' *contents* agree — it never removed the surviving token as a
    // redemption path, which is the actual risk.
    const revoke = await postJSON('/api/participants/role', {
      userId: email,
      portalId,
      role: null,
    });
    // Non-atomic by necessity — lib/db.ts's neon() client has no ambient
    // transaction across two routes. If the insert below fails after this
    // revoke succeeded, the invitee is left with no live invite at all
    // rather than a permanently redeemable orphan: visible (the toast below
    // says so) and recoverable (clicking Resend again mints a fresh token),
    // unlike the silent duplicate this replaces.
    const { ok, data } = revoke.ok
      ? await postJSON('/api/participants', {
          portalId,
          email,
          role,
          canDownload,
          allVersions,
          versionIds,
        })
      : revoke;
    // See changeRole's comment: generation checked before busy is cleared.
    if (myGen !== gen.current) return;
    setBusy(false);
    if (!ok) {
      toast('Could not resend invitation');
      return;
    }
    toast(
      data.emailDelivered === false
        ? 'Invitation created — copy the link to share it'
        : 'Invitation resent'
    );
    onChanged();
    // Reloading afterwards shows the drawer what the server actually did
    // rather than assuming it matches what was sent.
    load();
  };

  const label = displayName || email;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Access"
      anchor="inline"
      offsetLeft={offsetLeft}
    >
      <div className="flex flex-col gap-5">
        {/* 1. Header */}
        <div className="flex items-center gap-3">
          <Avatar id={identityKey} name={label} size={40} pending={pending} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-bold text-stiko-ink">{label}</div>
            <div className="truncate text-[12px] text-stiko-muted">{email}</div>
          </div>
        </div>

        {/* 2. Which package this is */}
        <p className="text-[12.5px] text-stiko-muted">
          Access on <span className="font-bold text-stiko-ink">{packageName}</span>
        </p>

        {loading ? (
          <div className="flex flex-col gap-3">
            <SkeletonBar height={34} />
            <SkeletonBar height={14} width="70%" />
            <SkeletonBar height={34} />
          </div>
        ) : loadError ? (
          <p className="px-1 py-6 text-center text-[12.5px] text-note-red-text">
            {loadError}
          </p>
        ) : (
          <>
            {/* 3. Role */}
            <div>
              <SectionLabel>Role</SectionLabel>
              {canManage ? (
                <>
                  <div className="mt-2 flex rounded-[10px] bg-stiko-app p-1">
                    {(['viewer', 'commenter', 'uploader'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => changeRole(r)}
                        disabled={busy}
                        className={`flex-1 rounded-[7px] px-3 py-[7px] text-[12px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          role === r
                            ? 'bg-white text-stiko-ink shadow-stiko-tab'
                            : 'text-stiko-muted hover:text-stiko-ink'
                        }`}
                      >
                        {roleLabel(r)}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[12px] text-stiko-muted">{ROLE_HELP[role]}</p>
                </>
              ) : (
                // Someone without manage rights cannot change this, so it
                // renders as fact rather than as a control that would 403 on
                // the first click.
                <>
                  <p className="mt-2 text-[13px] font-bold text-stiko-ink">
                    {roleLabel(role)}
                  </p>
                  <p className="mt-1 text-[12px] text-stiko-muted">{ROLE_HELP[role]}</p>
                </>
              )}
            </div>

            {/* 4. Versions they can see — uploaders are never scoped. An
                uploader's work builds on what came before, so scoping one
                would break the thing they are there to do (lib/access.ts).
                Hidden entirely, not disabled, when they are one. Also hidden
                for anyone without manage rights: GET /api/participants
                withholds the real allVersions/versionIds from them, so
                rendering this would mean showing a fabricated "all versions"
                default that could be flatly wrong for a caller who is
                actually narrowed to one version. */}
            {canManage && role !== 'uploader' && (
              <div>
                <SectionLabel>Versions they can see</SectionLabel>
                <label className="mt-2 flex items-center gap-2 text-[12.5px] font-semibold text-stiko-secondary">
                  <input
                    type="checkbox"
                    checked={allVersions}
                    disabled={busy}
                    onChange={(e) => {
                      if (e.target.checked) {
                        // Re-checking is a complete, self-contained grant —
                        // send it immediately, same as every other control
                        // here.
                        changeScopeGuarded(true, versionIds);
                        return;
                      }
                      if (versions.length === 0) {
                        // Nothing to narrow to — this package either has no
                        // published versions yet, or the list failed to load
                        // (versionsLoadFailed tells the two apart). Unchecking
                        // here would leave the box sitting unchecked with no
                        // chips to pick from, the server still on
                        // all_versions = true, and — before this fix — nothing
                        // explaining why: the same silent dead end as the
                        // last-chip guard above, reached a different way. Keep
                        // it checked and say why instead.
                        toast(
                          versionsLoadFailed
                            ? 'Could not load versions — close and reopen this drawer to retry.'
                            : 'This package has no published versions to narrow to yet.'
                        );
                        return;
                      }
                      // Unchecking is only an intent, not a commitment.
                      // versionIds is empty for anyone currently on all
                      // versions (the server writes no scope rows for an
                      // unscoped grant), so posting straight away would hit
                      // the empty-scope guard and do nothing — silently, with
                      // no chip list ever appearing. Reveal the list and wait
                      // for a pick instead; the first version chosen below is
                      // what actually commits the narrowing.
                      setAllVersions(false);
                      setVersionIds([]);
                    }}
                    className="h-[15px] w-[15px] accent-stiko-primary"
                  />
                  All versions, including future ones
                </label>
                {!allVersions && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {versions.map((v) => {
                      const on = versionIds.includes(v.id);
                      return (
                        <button
                          key={v.id}
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            changeScopeGuarded(
                              false,
                              on
                                ? versionIds.filter((x) => x !== v.id)
                                : [...versionIds, v.id]
                            )
                          }
                          className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            on
                              ? 'bg-stiko-primary text-white'
                              : 'bg-stiko-app text-stiko-secondary hover:text-stiko-ink'
                          }`}
                        >
                          V{v.versionNumber}
                        </button>
                      );
                    })}
                    {versions.length === 0 && (
                      <p className="text-[11.5px] text-stiko-faint">
                        {versionsLoadFailed
                          ? 'Could not load versions — close and reopen this drawer to retry.'
                          : 'No versions published yet.'}
                      </p>
                    )}
                  </div>
                )}
                {!allVersions && versionIds.length === 0 && versions.length > 0 && (
                  <p className="mt-1.5 text-[11.5px] text-stiko-muted">
                    Pick at least one version — nothing is sent until you do.
                  </p>
                )}
              </div>
            )}

            {/* 5. Downloads — omitted for anyone without manage rights: every
                mutation route here 403s for them, and for a pending person
                GET /api/invites 403s before this could even be populated. */}
            {canManage && (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <SectionLabel>Downloads</SectionLabel>
                  <p className="mt-1 text-[12px] text-stiko-muted">
                    Allow {label} to download files from this package.
                  </p>
                </div>
                <Toggle
                  checked={canDownload}
                  onChange={changeDownload}
                  label="Allow downloads"
                  disabled={busy}
                />
              </div>
            )}

            {/* 6. Danger strip — omitted for anyone without manage rights;
                see above. */}
            {canManage && (
              <div className="border-t border-stiko-border pt-4">
                {pending ? (
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={resend} disabled={busy} fullWidth>
                      Resend invitation
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() =>
                        endAccess('Invitation revoked', 'Could not revoke invitation')
                      }
                      disabled={busy}
                      fullWidth
                    >
                      Revoke invitation
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="danger"
                    onClick={() =>
                      endAccess(`Removed from ${packageName}`, 'Could not remove access')
                    }
                    disabled={busy}
                    fullWidth
                  >
                    Remove from {packageName}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
