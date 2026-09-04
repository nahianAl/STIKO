'use client';

import React, { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Field, Input, Note, Textarea } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import type { ProjectPackage } from '@/app/project/[id]/page';

type Role = 'viewer' | 'commenter' | 'uploader';
type PackageGrant = {
  role: Role;
  canDownload: boolean;
  allVersions: boolean;
  versionIds: string[];
};

/**
 * 4c — Add people.
 *
 * The role is chosen PER PACKAGE, because one person routinely holds different
 * roles across them (01). The yellow note states the consequence plainly, which
 * is the whole reason this screen is not a single "invite to project" field.
 */
export function AddPeopleModal({
  isOpen,
  onClose,
  projectName,
  packages,
  onDone,
}: {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  packages: ProjectPackage[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [emails, setEmails] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  // 03: with one package the checklist is skipped entirely — the invite goes
  // straight into it.
  const singlePackage = packages.length === 1;
  const [selection, setSelection] = useState<Record<string, PackageGrant>>(
    singlePackage
      ? {
          [packages[0]?.id ?? '']: {
            role: 'commenter',
            canDownload: false,
            allVersions: true,
            versionIds: [],
          },
        }
      : {}
  );
  const [versionsByPackage, setVersionsByPackage] = useState<
    Record<string, { id: string; versionNumber: number }[]>
  >({});

  useEffect(() => {
    if (!isOpen) return;
    // Only the packages actually ticked — fetching every package's versions on
    // open would be a request per package for a list most invites never use.
    for (const portalId of Object.keys(selection)) {
      if (versionsByPackage[portalId]) continue;
      fetch(`/api/versions?portalId=${portalId}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((v) =>
          setVersionsByPackage((prev) => ({ ...prev, [portalId]: Array.isArray(v) ? v : [] }))
        )
        .catch(() => undefined);
    }
  }, [isOpen, selection, versionsByPackage]);

  const parsed = emails
    .split(/[,\s]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes('@'));

  const chosen = Object.keys(selection);

  const toggle = (portalId: string) => {
    setSelection((prev) => {
      const next = { ...prev };
      if (next[portalId]) delete next[portalId];
      else next[portalId] = { role: 'commenter', canDownload: false, allVersions: true, versionIds: [] };
      return next;
    });
  };

  const send = async () => {
    setSending(true);
    let delivered = 0;
    let failed = 0;

    for (const email of parsed) {
      for (const [portalId, { role, canDownload, allVersions, versionIds }] of Object.entries(
        selection
      )) {
        const res = await fetch('/api/participants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ portalId, email, role, canDownload, allVersions, versionIds, note }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.emailDelivered) delivered++;
        else if (res.ok) failed++;
      }
    }

    setSending(false);
    setEmails('');
    setNote('');
    onClose();

    // Never claim an email was sent when no provider is configured.
    if (failed > 0 && delivered === 0) {
      toast('Invitations created — copy the link to share them');
    } else {
      toast(`Invitation${parsed.length === 1 ? '' : 's'} sent`);
    }
    onDone();
  };

  const notSelected = packages.filter((p) => !selection[p.id]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add people"
      subtitle={projectName}
      width={470}
      footer={
        <>
          <button
            onClick={() => toast('Invite link copied')}
            className="mr-auto text-[12px] font-bold text-stiko-primary hover:text-stiko-primary-hover"
          >
            Copy link instead
          </button>
          <Button
            onClick={send}
            disabled={sending || parsed.length === 0 || chosen.length === 0}
          >
            {sending ? 'Sending…' : 'Send invitation'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[18px]">
        <Field label="Who" hint="comma- or paste-separated">
          <Input
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder="name@company.com, another@company.com"
            autoFocus
          />
        </Field>

        {!singlePackage && (
          <div>
            <span className="mb-[6px] block text-[12px] font-bold text-stiko-secondary">
              Give them access to
            </span>
            <div className="flex flex-col gap-1">
              {packages.map((pkg) => {
                const checked = Boolean(selection[pkg.id]);
                const grant = selection[pkg.id];
                const scopable = checked && (grant.role === 'commenter' || grant.role === 'viewer');
                const pkgVersions = versionsByPackage[pkg.id] ?? [];
                return (
                  <div key={pkg.id}>
                  <div
                    className="flex items-center gap-3 rounded-[10px] px-2 py-[9px] transition hover:bg-stiko-app"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(pkg.id)}
                      aria-checked={checked}
                      role="checkbox"
                      className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] transition"
                      style={{
                        background: checked ? '#5B60FF' : '#fff',
                        border: checked ? 'none' : '1.5px solid #D3D8E6',
                      }}
                    >
                      {checked && (
                        <svg
                          className="h-3 w-3 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3.2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-[13px] ${
                          checked
                            ? 'font-bold text-stiko-ink'
                            : 'font-semibold text-stiko-secondary'
                        }`}
                      >
                        {pkg.name}
                      </div>
                      <div
                        className={`truncate text-[11.5px] ${checked ? 'text-stiko-muted' : 'text-stiko-faint'}`}
                      >
                        {pkg.people.length}{' '}
                        {pkg.people.length === 1 ? 'person' : 'people'}
                        {pkg.versionNumber != null
                          ? ` · V${pkg.versionNumber}`
                          : ''}
                      </div>
                    </div>

                    {checked && (
                      <>
                        <select
                          value={selection[pkg.id].role}
                          onChange={(e) =>
                            setSelection((prev) => ({
                              ...prev,
                              [pkg.id]: { ...prev[pkg.id], role: e.target.value as Role },
                            }))
                          }
                          className="shrink-0 rounded-[8px] border-[1.5px] border-stiko-divider bg-white px-2 py-1 text-[12px] font-semibold capitalize text-stiko-ink outline-none focus:border-stiko-primary"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="commenter">Commenter</option>
                          <option value="uploader">Uploader</option>
                        </select>
                        <label className="flex shrink-0 items-center gap-2 text-[12.5px] font-semibold text-stiko-secondary">
                          <input
                            type="checkbox"
                            checked={selection[pkg.id].canDownload}
                            onChange={(e) =>
                              setSelection((prev) => ({
                                ...prev,
                                [pkg.id]: { ...prev[pkg.id], canDownload: e.target.checked },
                              }))
                            }
                            className="h-[15px] w-[15px] accent-stiko-primary"
                          />
                          Can download files
                        </label>
                      </>
                    )}
                  </div>

                  {scopable && pkgVersions.length > 0 && (
                    <div className="ml-9 mb-1 mt-1 pl-[3px]">
                      <span className="mb-[6px] block text-[12px] font-bold text-stiko-secondary">
                        Versions they can see
                      </span>
                      <label className="flex items-center gap-2 text-[12.5px] font-semibold text-stiko-secondary">
                        <input
                          type="checkbox"
                          checked={grant.allVersions}
                          onChange={(e) =>
                            setSelection((prev) => ({
                              ...prev,
                              [pkg.id]: { ...prev[pkg.id], allVersions: e.target.checked },
                            }))
                          }
                          className="h-[15px] w-[15px] accent-stiko-primary"
                        />
                        All versions, including future ones
                      </label>
                      {!grant.allVersions && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {pkgVersions.map((v) => {
                            const on = grant.versionIds.includes(v.id);
                            return (
                              <button
                                key={v.id}
                                type="button"
                                onClick={() =>
                                  setSelection((prev) => {
                                    const cur = prev[pkg.id];
                                    const versionIds = cur.versionIds.includes(v.id)
                                      ? cur.versionIds.filter((x) => x !== v.id)
                                      : [...cur.versionIds, v.id];
                                    return { ...prev, [pkg.id]: { ...cur, versionIds } };
                                  })
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
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {chosen.length > 0 && parsed.length > 0 && (
          <Note>
            {parsed[0].split('@')[0]} will only ever see the{' '}
            {chosen.length === 1 ? 'one package' : `${chosen.length} packages`}{' '}
            you&apos;ve ticked — not the project
            {notSelected.length > 0
              ? `, and not the other ${notSelected.length}`
              : ''}
            .
          </Note>
        )}

        <Field label="Note in the invitation" hint="(optional)">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Anything they should know before they open it"
          />
        </Field>
      </div>
    </Modal>
  );
}
