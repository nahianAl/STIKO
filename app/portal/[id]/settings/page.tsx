'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  SettingsShell,
  SettingsCard,
  DangerCard,
} from '@/components/settings/SettingsShell';
import { DestructiveConfirm } from '@/components/settings/DestructiveConfirm';
import Button from '@/components/ui/Button';
import {
  Field,
  Input,
  StatusChip,
  TagChip,
  Toggle,
} from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import type { VersionStatus } from '@/lib/status';

interface Settings {
  package: {
    id: string;
    name: string;
    tag: string | null;
    linkAccess: boolean;
    projectId: string;
    projectName: string;
  };
  access: { canManagePeople: boolean };
  counts: {
    versions: number;
    files: number;
    comments: number;
    people: number;
    openComments: number;
  };
  status: VersionStatus;
  latestVersionNumber: number | null;
  muted: boolean;
}

/** 3l — Package settings · General. */
export default function PackageSettings() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [data, setData] = useState<Settings | null>(null);
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [muted, setMuted] = useState(false);
  const [linkAccess, setLinkAccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/portals/${id}/settings`);
    if (!res.ok) return;
    const d: Settings = await res.json();
    setData(d);
    setName(d.package.name);
    setTag(d.package.tag ?? '');
    setMuted(d.muted);
    setLinkAccess(d.package.linkAccess);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    const res = await fetch(`/api/portals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, tag, linkAccess }),
    });
    setSaving(false);
    toast(res.ok ? 'Package updated' : 'Could not save your changes');
    if (res.ok) load();
  };

  const toggleMute = async (next: boolean) => {
    setMuted(next);
    await fetch(`/api/portals/${id}/mute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ muted: next }),
    });
    toast(next ? 'Package muted' : 'Package unmuted');
  };

  const archive = async () => {
    const res = await fetch(`/api/portals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    if (!res.ok) {
      toast('Could not archive this package');
      return;
    }
    // Reversible, so it gets an Undo on the toast rather than a confirm.
    toast('Package archived', {
      label: 'Undo',
      onClick: async () => {
        await fetch(`/api/portals/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived: false }),
        });
        load();
      },
    });
    load();
  };

  const remove = async () => {
    const res = await fetch(`/api/portals/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast('Could not delete this package');
      return;
    }
    toast('Package deleted');
    router.push(data ? `/project/${data.package.projectId}` : '/');
  };

  if (!data) {
    return (
      <SettingsShell
        railLabel="Package"
        items={[{ key: 'general', label: 'General', href: `/portal/${id}/settings` }]}
        active="general"
      >
        <div className="h-40 rounded-panel bg-white shadow-stiko-panel" />
      </SettingsShell>
    );
  }

  const rail = [
    { key: 'general', label: 'General', href: `/portal/${id}/settings` },
    { key: 'people', label: 'People', href: `/portal/${id}/settings/people` },
  ];

  return (
    <SettingsShell
      crumbs={[
        { label: data.package.projectName, href: `/project/${data.package.projectId}` },
        { label: data.package.name, href: `/portal/${id}` },
        { label: 'Settings' },
      ]}
      railLabel="Package"
      items={rail}
      active="general"
    >
      <SettingsCard
        heading="General"
        description={`${data.package.name} · ${data.counts.versions} version${data.counts.versions === 1 ? '' : 's'} · ${data.counts.openComments} open comment${data.counts.openComments === 1 ? '' : 's'}`}
        actions={
          <>
            <Button variant="ghost" onClick={load}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        <Field label="Package name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Project">
            <Input value={data.package.projectName} readOnly className="bg-stiko-app" />
          </Field>
          <Field label="Tag" hint="(optional, your own wording)">
            <div className="flex items-center gap-2">
              <Input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="Type to change"
              />
              {tag.trim() && <TagChip tag={tag.trim()} />}
            </div>
          </Field>
        </div>

        {/* Status is derived from reviewer verdicts and is never edited here. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel bg-stiko-app px-4 py-[14px]">
          <div className="min-w-0">
            <div className="text-[13.5px] font-bold text-stiko-ink">
              Review status
            </div>
            <div className="mt-[2px] text-[12px] text-stiko-muted">
              Set on the version, not here
              {data.latestVersionNumber != null
                ? ` — V${data.latestVersionNumber} currently ${statusPhrase(data.status)}.`
                : '.'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <StatusChip status={data.status} />
            {data.latestVersionNumber != null && (
              <Link href={`/portal/${id}`} className="text-[12.5px] font-bold">
                Open V{data.latestVersionNumber}
              </Link>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-panel bg-stiko-app px-4 py-[14px]">
          <div>
            <div className="text-[13.5px] font-bold text-stiko-ink">
              Mute this package
            </div>
            <div className="mt-[2px] text-[12px] text-stiko-muted">
              No emails or badges, even for @mentions.
            </div>
          </div>
          <Toggle checked={muted} onChange={toggleMute} label="Mute package" />
        </div>

        <div className="flex items-center justify-between rounded-panel bg-stiko-app px-4 py-[14px]">
          <div>
            <div className="text-[13.5px] font-bold text-stiko-ink">
              Anyone with the link can view
            </div>
            <div className="mt-[2px] text-[12px] text-stiko-muted">
              {linkAccess
                ? 'On — anyone with the link can view this package.'
                : 'Off — people must be invited by email.'}
            </div>
          </div>
          <Toggle
            checked={linkAccess}
            onChange={setLinkAccess}
            label="Anyone with the link can view"
          />
        </div>
      </SettingsCard>

      {data.access.canManagePeople && (
        <DangerCard
          rows={[
            {
              title: 'Archive package',
              description:
                'Read-only for everyone, hidden from the project. Reversible.',
              actionLabel: 'Archive',
              variant: 'secondary',
              onAction: archive,
            },
            {
              title: 'Delete package',
              description: `All ${data.counts.versions} version${data.counts.versions === 1 ? '' : 's'}, ${data.counts.files} file${data.counts.files === 1 ? '' : 's'} and ${data.counts.comments} comment${data.counts.comments === 1 ? '' : 's'} are permanently removed.`,
              actionLabel: 'Delete',
              onAction: () => setConfirmDelete(true),
            },
          ]}
        />
      )}

      <DestructiveConfirm
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title={`Delete ${data.package.name}?`}
        name={data.package.name}
        consequence="This cannot be undone. Everyone loses access immediately, including people mid-review."
        inventory={[
          { label: 'Versions', value: data.counts.versions },
          { label: 'Files', value: data.counts.files },
          { label: 'Comments', value: data.counts.comments },
          {
            label: 'People who lose access',
            value: data.counts.people,
            urgent: true,
          },
        ]}
        reversibleHint="Archiving keeps everything read-only instead — and you can undo it."
        confirmLabel="Delete package"
      />
    </SettingsShell>
  );
}

function statusPhrase(status: VersionStatus): string {
  switch (status) {
    case 'approved':
      return 'is approved';
    case 'changes_requested':
      return 'has changes requested';
    case 'in_review':
      return 'is in review';
    case 'draft':
      return 'is a draft';
    default:
      return 'has no files yet';
  }
}
