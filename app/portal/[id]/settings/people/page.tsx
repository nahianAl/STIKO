'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  SettingsShell,
  SettingsCard,
} from '@/components/settings/SettingsShell';
import Button from '@/components/ui/Button';
import {
  Avatar,
  Input,
  SectionLabel,
} from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { relativeTime } from '@/lib/design';

type Role = 'viewer' | 'commenter' | 'uploader';

const ROLE_HELP: Record<Role, string> = {
  viewer: 'Viewers can open every file and read every comment.',
  commenter: 'Commenters can do everything a viewer can, and leave comments.',
  uploader: 'Uploaders can do everything a commenter can, and publish versions.',
};

interface Person {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  canDownload?: boolean;
  allVersions?: boolean;
  versionIds?: string[];
}

interface Pending {
  /** Only sent for a share link — an addressed invite is keyed on its email. */
  token: string | null;
  /** Null for a share link, which was addressed to nobody. */
  email: string | null;
  multiUse: boolean;
  role: Role;
  createdAt: string;
  expiresAt: string;
  canDownload?: boolean;
  allVersions?: boolean;
  versionIds?: string[];
}

/** 2h — Package people. The package-scoped counterpart to 4a. */
export default function PackagePeople() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const [pkg, setPkg] = useState<{
    name: string;
    projectId: string;
    projectName: string;
  } | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [versions, setVersions] = useState<{ id: string; versionNumber: number }[]>([]);
  const [emails, setEmails] = useState('');
  const [role, setRole] = useState<Role>('commenter');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const [settingsRes, peopleRes, pendingRes, versionsRes] = await Promise.all([
      fetch(`/api/portals/${id}/settings`),
      fetch(`/api/participants?portalId=${id}`),
      fetch(`/api/invites?portalId=${id}`),
      fetch(`/api/versions?portalId=${id}`),
    ]);
    if (settingsRes.ok) {
      const d = await settingsRes.json();
      setPkg({
        name: d.package.name,
        projectId: d.package.projectId,
        projectName: d.package.projectName,
      });
    }
    if (peopleRes.ok) setPeople(await peopleRes.json());
    if (pendingRes.ok) setPending(await pendingRes.json());
    setVersions(versionsRes.ok ? await versionsRes.json() : []);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const parsed = emails
    .split(/[,\s]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes('@'));

  const invite = async () => {
    setSending(true);
    let undelivered = 0;
    for (const email of parsed) {
      const res = await fetch('/api/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portalId: id, email, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.emailDelivered) undelivered++;
    }
    setSending(false);
    setEmails('');
    toast(
      undelivered === parsed.length && parsed.length > 0
        ? 'Invitations created — copy the links to share them'
        : `Invitation${parsed.length === 1 ? '' : 's'} sent`
    );
    load();
  };

  const changeRole = async (userId: string, next: Role) => {
    await fetch('/api/participants/role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, portalId: id, role: next }),
    });
    toast('Role updated');
    load();
  };

  const changeDownload = async (userId: string, next: boolean) => {
    const res = await fetch('/api/participants/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, portalId: id, canDownload: next }),
    });
    if (!res.ok) {
      toast('Could not change download access');
      return;
    }
    toast(next ? 'Download allowed' : 'Download turned off');
    load();
  };

  // Sent whole rather than as a diff: the panel always holds the complete
  // selection, and a diff would need a merge rule for a scope changed in
  // another tab.
  const changeScope = async (
    userId: string,
    allVersions: boolean,
    versionIds: string[]
  ) => {
    const res = await fetch('/api/participants/versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, portalId: id, allVersions, versionIds }),
    });
    if (!res.ok) {
      toast('Could not change which versions they can see');
      return;
    }
    toast('Versions updated');
    load();
  };

  // Two handles, because an invitation has two shapes. An email invite is keyed
  // on its recipient, like every other row in the people matrix. A share link
  // has no recipient, so the token is the only thing that identifies it.
  const revoke = async (p: Pending) => {
    if (p.email || !p.token) {
      await fetch('/api/participants/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: p.email, portalId: id, role: null }),
      });
    } else {
      await fetch('/api/invites', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portalId: id, token: p.token }),
      });
    }
    toast(p.multiUse ? 'Share link revoked' : 'Invitation revoked');
    load();
  };

  const resend = async (email: string, r: Role) => {
    await fetch('/api/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portalId: id, email, role: r }),
    });
    toast('Invitation resent');
    load();
  };

  const rail = [
    { key: 'general', label: 'General', href: `/portal/${id}/settings` },
    { key: 'people', label: 'People', href: `/portal/${id}/settings/people` },
  ];

  return (
    <SettingsShell
      crumbs={
        pkg
          ? [
              { label: pkg.projectName, href: `/project/${pkg.projectId}` },
              { label: pkg.name, href: `/portal/${id}` },
              { label: 'People' },
            ]
          : undefined
      }
      railLabel="Package"
      items={rail}
      active="people"
    >
      <SettingsCard
        heading="People"
        description={pkg?.name ?? ''}
      >
        {/* Invite block */}
        <div className="border-b border-stiko-border pb-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <span className="mb-[6px] block text-[12px] font-bold text-stiko-secondary">
                Invite by email
              </span>
              <Input
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                placeholder="name@company.com, another@company.com"
              />
            </div>

            <div className="flex rounded-[10px] bg-stiko-app p-1">
              {(['viewer', 'commenter', 'uploader'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`rounded-[7px] px-3 py-[7px] text-[12px] font-bold capitalize transition ${
                    role === r
                      ? 'bg-white text-stiko-ink shadow-stiko-tab'
                      : 'text-stiko-muted hover:text-stiko-ink'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            <Button onClick={invite} disabled={sending || parsed.length === 0}>
              {sending ? 'Sending…' : 'Send invites'}
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] text-stiko-muted">
              {ROLE_HELP[role]}
            </span>
            <button
              onClick={() => toast('Invite link copied')}
              className="text-[12px] font-bold text-stiko-primary hover:text-stiko-primary-hover"
            >
              Copy invite link instead
            </button>
          </div>
        </div>

        <div>
          <SectionLabel>On this package · {people.length}</SectionLabel>
          <div className="mt-2 flex flex-col">
            {people.map((p) => (
              <div
                key={p.id}
                className="border-b border-stiko-border py-[10px] last:border-0"
              >
                <div className="flex items-center gap-3">
                  <Avatar
                    id={p.userId}
                    name={p.name ?? p.email}
                    size={32}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold text-stiko-ink">
                      {p.name ?? p.email}
                    </div>
                    <div className="truncate text-[11.5px] text-stiko-muted">
                      {p.email}
                    </div>
                  </div>
                  <label
                    className="flex shrink-0 items-center gap-1.5 text-[11.5px] font-semibold text-stiko-secondary"
                    title="Allow this person to download files from this package"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(p.canDownload)}
                      onChange={(e) => changeDownload(p.userId, e.target.checked)}
                      className="h-[14px] w-[14px] accent-stiko-primary"
                    />
                    Download
                  </label>
                  <select
                    value={p.role}
                    onChange={(e) => changeRole(p.userId, e.target.value as Role)}
                    className="shrink-0 rounded-[8px] border-[1.5px] border-stiko-divider bg-white px-2 py-1 text-[12px] font-semibold capitalize text-stiko-ink outline-none focus:border-stiko-primary"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="commenter">Commenter</option>
                    <option value="uploader">Uploader</option>
                  </select>
                </div>
                {(p.role === 'commenter' || p.role === 'viewer') && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-stiko-secondary">
                      <input
                        type="checkbox"
                        checked={p.allVersions !== false}
                        onChange={(e) => changeScope(p.userId, e.target.checked, p.versionIds ?? [])}
                        className="h-[14px] w-[14px] accent-stiko-primary"
                      />
                      All versions
                    </label>
                    {p.allVersions === false &&
                      versions.map((v) => {
                        const on = (p.versionIds ?? []).includes(v.id);
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() =>
                              changeScope(
                                p.userId,
                                false,
                                on
                                  ? (p.versionIds ?? []).filter((x) => x !== v.id)
                                  : [...(p.versionIds ?? []), v.id]
                              )
                            }
                            className={`rounded-full px-2 py-0.5 text-[11px] font-bold transition ${
                              on ? 'bg-stiko-primary text-white' : 'bg-stiko-app text-stiko-secondary'
                            }`}
                          >
                            V{v.versionNumber}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            ))}
            {people.length === 0 && (
              <p className="py-4 text-[12.5px] text-stiko-muted">
                Nobody has accepted an invitation yet.
              </p>
            )}
          </div>
        </div>

        {pending.length > 0 && (
          <div>
            <SectionLabel>Pending · {pending.length}</SectionLabel>
            <div className="mt-2 flex flex-col">
              {pending.map((p) => {
                const hoursLeft =
                  (new Date(p.expiresAt).getTime() - Date.now()) / 3_600_000;
                return (
                  <div
                    key={p.token ?? p.email ?? p.createdAt}
                    className="border-b border-stiko-border py-[10px] last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar
                        id={p.email ?? p.token ?? p.createdAt}
                        name={p.email ?? 'Link'}
                        size={32}
                        pending
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-bold text-stiko-ink">
                          {p.email ?? 'Anyone with the link'}
                        </div>
                        <div className="truncate text-[11.5px] text-stiko-muted">
                          <span className="capitalize">{p.role}</span> ·{' '}
                          {p.multiUse ? 'link created' : 'invited'}{' '}
                          {relativeTime(p.createdAt)}
                          {hoursLeft > 0 && hoursLeft < 24 && (
                            <span className="ml-1 font-bold text-[#B23A52]">
                              · expires in {Math.max(1, Math.round(hoursLeft))}h
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-[12px] font-bold">
                        {/* A share link has no email, and a link can never carry the grant. */}
                        {p.email && (
                          <label
                            className="flex shrink-0 items-center gap-1.5 text-[11.5px] font-semibold text-stiko-secondary"
                            title="Allow this person to download files once they accept"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(p.canDownload)}
                              onChange={(e) => changeDownload(p.email!, e.target.checked)}
                              className="h-[14px] w-[14px] accent-stiko-primary"
                            />
                            Download
                          </label>
                        )}
                        {/* Nothing to resend a share link to. */}
                        {p.email && (
                          <button
                            onClick={() => resend(p.email!, p.role)}
                            className="text-stiko-primary hover:text-stiko-primary-hover"
                          >
                            Resend
                          </button>
                        )}
                        <button
                          onClick={() => revoke(p)}
                          className="text-[#B23A52] hover:opacity-80"
                        >
                          Revoke
                        </button>
                      </div>
                    </div>
                    {/* Keyed on email, not a user id — a pending row has no
                        participant yet. A share link has no email, so it gets
                        no control at all: there is nobody to narrow. */}
                    {p.email && (p.role === 'commenter' || p.role === 'viewer') && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-stiko-secondary">
                          <input
                            type="checkbox"
                            checked={p.allVersions !== false}
                            onChange={(e) => changeScope(p.email!, e.target.checked, p.versionIds ?? [])}
                            className="h-[14px] w-[14px] accent-stiko-primary"
                          />
                          All versions
                        </label>
                        {p.allVersions === false &&
                          versions.map((v) => {
                            const on = (p.versionIds ?? []).includes(v.id);
                            return (
                              <button
                                key={v.id}
                                type="button"
                                onClick={() =>
                                  changeScope(
                                    p.email!,
                                    false,
                                    on
                                      ? (p.versionIds ?? []).filter((x) => x !== v.id)
                                      : [...(p.versionIds ?? []), v.id]
                                  )
                                }
                                className={`rounded-full px-2 py-0.5 text-[11px] font-bold transition ${
                                  on ? 'bg-stiko-primary text-white' : 'bg-stiko-app text-stiko-secondary'
                                }`}
                              >
                                V{v.versionNumber}
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </SettingsCard>
    </SettingsShell>
  );
}
