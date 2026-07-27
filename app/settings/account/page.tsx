'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  SettingsShell,
  SettingsCard,
  DangerCard,
} from '@/components/settings/SettingsShell';
import { DestructiveConfirm } from '@/components/settings/DestructiveConfirm';
import Button from '@/components/ui/Button';
import {
  Avatar,
  Field,
  Input,
  readOnlyInputClass,
} from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';

const RAIL = [
  { key: 'profile', label: 'Profile', href: '/settings/account' },
  { key: 'password', label: 'Password', href: '/settings/password' },
  {
    key: 'notifications',
    label: 'Notifications',
    href: '/settings/notifications',
  },
];

/** 3j — Account · Profile. */
export default function AccountSettings() {
  const { data: session, update } = useSession();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (!me) return;
        setName(me.name ?? '');
        setJobTitle(me.jobTitle ?? '');
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, jobTitle }),
    });
    setSaving(false);
    if (res.ok) {
      toast('Profile saved');
      await update();
    } else {
      toast('Could not save your profile');
    }
  };

  return (
    <SettingsShell
      crumbs={[{ label: 'Settings' }, { label: 'Account' }]}
      railLabel="Account"
      items={RAIL}
      active="profile"
    >
      <SettingsCard
        heading="Profile"
        description="How you appear on comments and in people lists."
        actions={
          <>
            <Button variant="ghost">Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-4">
          <Avatar
            id={session?.user?.id ?? 'me'}
            name={name || (session?.user?.email ?? '?')}
            size={62}
          />
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <Button variant="secondary">Upload photo</Button>
              <Button variant="ghost">Remove</Button>
            </div>
            <span className="text-[12px] text-stiko-faint">
              Your initials tile is used until you add one.
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Job title" hint="(optional)">
            <Input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="Structural engineer"
            />
          </Field>
        </div>

        <Field label="Email">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={session?.user?.email ?? ''}
              className={readOnlyInputClass}
            />
            <Button variant="secondary" className="shrink-0">
              Change
            </Button>
          </div>
        </Field>
        <p className="-mt-3 text-[11.5px] text-stiko-faint">
          Invitations sent to this address are matched to your account
          automatically.
        </p>
      </SettingsCard>

      <DangerCard
        rows={[
          {
            title: 'Delete account',
            description:
              'Removes you from every package. Comments you’ve written stay, attributed to a deleted user.',
            actionLabel: 'Delete account',
            onAction: () => setConfirmDelete(true),
          },
        ]}
      />

      <DestructiveConfirm
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => toast('Account deletion is not wired up yet')}
        title="Delete your account?"
        name={session?.user?.email ?? ''}
        consequence="This cannot be undone. You lose access to every package immediately."
        inventory={[]}
        confirmLabel="Delete account"
      />
    </SettingsShell>
  );
}
