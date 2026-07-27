'use client';

import { useEffect, useState } from 'react';
import {
  SettingsShell,
  SettingsCard,
} from '@/components/settings/SettingsShell';
import { SectionLabel, Toggle } from '@/components/ui/Primitives';
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

interface Pref {
  key: string;
  label: string;
  note: string | null;
  inApp: boolean;
  email: boolean;
  inAppApplies: boolean;
  emailApplies: boolean;
}

/** 3k — per-event control across two channels. */
export default function NotificationSettings() {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Pref[]>([]);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    fetch('/api/notification-prefs')
      .then((r) => (r.ok ? r.json() : []))
      .then(setPrefs)
      .catch(() => setPrefs([]));

    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (me?.emailPausedUntil) {
          setPaused(new Date(me.emailPausedUntil).getTime() > Date.now());
        }
      })
      .catch(() => {});
  }, []);

  const update = async (key: string, channel: 'inApp' | 'email', next: boolean) => {
    const target = prefs.find((p) => p.key === key);
    if (!target) return;

    const updated = { ...target, [channel]: next };
    setPrefs((prev) => prev.map((p) => (p.key === key ? updated : p)));

    await fetch('/api/notification-prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: key,
        inApp: updated.inApp,
        email: updated.email,
      }),
    });
  };

  const togglePause = async (next: boolean) => {
    setPaused(next);
    await fetch('/api/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emailPausedUntil: next
          ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          : null,
      }),
    });
    toast(next ? 'Email paused for 24 hours' : 'Email resumed');
  };

  return (
    <SettingsShell
      crumbs={[{ label: 'Settings' }, { label: 'Notifications' }]}
      railLabel="Account"
      items={RAIL}
      active="notifications"
    >
      <SettingsCard
        heading="Notifications"
        description="These are global defaults; a single package can be muted from its own settings."
      >
        <div>
          <div className="grid grid-cols-[1fr_74px_74px] items-center gap-2 border-b border-stiko-border pb-2">
            <SectionLabel>Event</SectionLabel>
            <SectionLabel className="text-center">In app</SectionLabel>
            <SectionLabel className="text-center">Email</SectionLabel>
          </div>

          {prefs.map((p) => (
            <div
              key={p.key}
              className="grid grid-cols-[1fr_74px_74px] items-center gap-2 border-b border-stiko-border py-[14px]"
            >
              <div className="min-w-0">
                <div className="text-[13.5px] font-bold text-stiko-ink">
                  {p.label}
                </div>
                {p.note && (
                  <div className="mt-[2px] text-[12px] text-stiko-muted">
                    {p.note}
                  </div>
                )}
              </div>

              <div className="flex justify-center">
                {p.inAppApplies ? (
                  <Toggle
                    checked={p.inApp}
                    onChange={(v) => update(p.key, 'inApp', v)}
                    label={`${p.label} in app`}
                  />
                ) : (
                  <span className="text-stiko-crumb">—</span>
                )}
              </div>

              <div className="flex justify-center">
                {p.emailApplies ? (
                  <Toggle
                    checked={p.email}
                    onChange={(v) => update(p.key, 'email', v)}
                    label={`${p.label} by email`}
                  />
                ) : (
                  <span className="text-stiko-crumb">—</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between rounded-panel bg-stiko-app px-4 py-[14px]">
          <div>
            <div className="text-[13.5px] font-bold text-stiko-ink">
              Pause all email for 24 hours
            </div>
            <div className="mt-[2px] text-[12px] text-stiko-muted">
              In-app notifications keep arriving.
            </div>
          </div>
          <Toggle
            checked={paused}
            onChange={togglePause}
            label="Pause all email"
          />
        </div>
      </SettingsCard>
    </SettingsShell>
  );
}
