'use client';

import { useCallback, useEffect, useState } from 'react';
import Drawer from '@/components/ui/Drawer';
import Button from '@/components/ui/Button';
import { Avatar, SectionLabel, SkeletonBar, Toggle } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';

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
  body: unknown,
  method: 'POST' | 'DELETE' = 'POST'
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method,
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
  /** Refetch the panel; access changed. */
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<Role>('commenter');
  const [canDownload, setCanDownload] = useState(false);
  const [allVersions, setAllVersions] = useState(true);
  const [versionIds, setVersionIds] = useState<string[]>([]);
  const [versions, setVersions] = useState<VersionOption[]>([]);

  // Every mutation route (/api/participants/role, /download, /versions)
  // accepts either a real user id (accepted) or an email (pending) under the
  // same `userId` field — this is the one identifier all of them send.
  // Pending's `userId` prop is always null, so this resolves to `email`
  // exactly when it needs to.
  const identityKey = userId ?? email;

  const load = useCallback(async () => {
    setLoading(true);
    const [versionsRes, dataRes] = await Promise.all([
      fetch(`/api/versions?portalId=${portalId}`),
      fetch(
        pending
          ? `/api/invites?portalId=${portalId}`
          : `/api/participants?portalId=${portalId}`
      ),
    ]);
    setVersions(versionsRes.ok ? await versionsRes.json() : []);

    if (dataRes.ok) {
      const row = pending
        ? ((await dataRes.json()) as PendingRow[]).find((r) => r.email === email)
        : ((await dataRes.json()) as ParticipantRow[]).find((r) => r.userId === userId);
      if (row) {
        setRole(row.role);
        setCanDownload(Boolean(row.canDownload));
        // GET /api/participants withholds allVersions/versionIds from anyone
        // without manage rights. Missing reads as "all versions" — the same
        // `!== false` convention the settings page uses, and the same
        // default participants.all_versions itself has.
        setAllVersions(row.allVersions !== false);
        setVersionIds(row.versionIds ?? []);
      }
    }
    setLoading(false);
  }, [portalId, pending, email, userId]);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  const changeRole = async (next: Role) => {
    const { ok } = await postJSON('/api/participants/role', {
      userId: identityKey,
      portalId,
      role: next,
    });
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
    const { ok } = await postJSON('/api/participants/download', {
      userId: identityKey,
      portalId,
      canDownload: next,
    });
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
    const { ok } = await postJSON('/api/participants/versions', {
      userId: identityKey,
      portalId,
      allVersions: nextAllVersions,
      versionIds: nextVersionIds,
    });
    if (!ok) {
      toast('Could not change which versions they can see');
      return;
    }
    setAllVersions(nextAllVersions);
    setVersionIds(nextVersionIds);
    toast('Versions updated');
    onChanged();
  };

  // Guard, verbatim from the settings page: unchecking "All versions" with
  // nothing yet picked, or deselecting the last remaining chip, both produce
  // allVersions: false with an empty list — a scope that admits nothing,
  // silently. Short-circuited here rather than sent to a route that now
  // rejects it anyway.
  const changeScopeGuarded = (nextAllVersions: boolean, nextVersionIds: string[]) => {
    if (!nextAllVersions && nextVersionIds.length === 0) return;
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
    setBusy(true);
    const { ok } = await postJSON('/api/participants/role', {
      userId: identityKey,
      portalId,
      role: null,
    });
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
    setBusy(true);
    const { ok, data } = await postJSON('/api/participants', { portalId, email, role });
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
  };

  const label = displayName || email;

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Access" anchor="inline">
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
        ) : (
          <>
            {/* 3. Role */}
            <div>
              <SectionLabel>Role</SectionLabel>
              <div className="mt-2 flex rounded-[10px] bg-stiko-app p-1">
                {(['viewer', 'commenter', 'uploader'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => changeRole(r)}
                    className={`flex-1 rounded-[7px] px-3 py-[7px] text-[12px] font-bold capitalize transition ${
                      role === r
                        ? 'bg-white text-stiko-ink shadow-stiko-tab'
                        : 'text-stiko-muted hover:text-stiko-ink'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-stiko-muted">{ROLE_HELP[role]}</p>
            </div>

            {/* 4. Versions they can see — uploaders are never scoped. An
                uploader's work builds on what came before, so scoping one
                would break the thing they are there to do (lib/access.ts).
                Hidden entirely, not disabled, when they are one. */}
            {role !== 'uploader' && (
              <div>
                <SectionLabel>Versions they can see</SectionLabel>
                <label className="mt-2 flex items-center gap-2 text-[12.5px] font-semibold text-stiko-secondary">
                  <input
                    type="checkbox"
                    checked={allVersions}
                    onChange={(e) => changeScopeGuarded(e.target.checked, versionIds)}
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
                          onClick={() =>
                            changeScopeGuarded(
                              false,
                              on
                                ? versionIds.filter((x) => x !== v.id)
                                : [...versionIds, v.id]
                            )
                          }
                          className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold transition ${
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
                        No versions published yet.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 5. Downloads */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <SectionLabel>Downloads</SectionLabel>
                <p className="mt-1 text-[12px] text-stiko-muted">
                  Allow {label} to download files from this package.
                </p>
              </div>
              <Toggle checked={canDownload} onChange={changeDownload} label="Allow downloads" />
            </div>

            {/* 6. Danger strip */}
            <div className="border-t border-stiko-border pt-4">
              {pending ? (
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={resend} disabled={busy} fullWidth>
                    Resend invitation
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => endAccess('Invitation revoked', 'Could not revoke invitation')}
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
          </>
        )}
      </div>
    </Drawer>
  );
}
