'use client';

import React, { useState } from 'react';
import Button from '@/components/ui/Button';
import {
  Avatar,
  RolePill,
  SectionLabel,
  TagChip,
} from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { relativeTime } from '@/lib/design';
import type { ProjectPackage } from '@/app/project/[id]/page';

type Role = 'viewer' | 'commenter' | 'uploader';

/**
 * 4a — the team & access matrix.
 *
 * This is not administrative housekeeping. A package is a permission boundary,
 * so this screen is how a coordinator avoids showing the client the
 * consultant's markup. The footer sentence is the point of the whole thing.
 */
export function TeamMatrix({
  members,
  packages,
  onChanged,
  onAddPeople,
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
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<{
    personId: string;
    portalId: string;
  } | null>(null);

  // One row per guest, one column per package. A person commonly holds a
  // different role in each, so roles live at (person, package) — never on the
  // person.
  const guests = new Map<
    string,
    {
      id: string;
      name: string;
      email: string;
      company: string | null;
      pending?: boolean;
      pendingSince?: string;
    }
  >();

  for (const pkg of packages) {
    for (const p of pkg.people) {
      if (!guests.has(p.id)) {
        guests.set(p.id, {
          id: p.id,
          name: p.name,
          email: p.email,
          company: p.company,
        });
      }
    }
    for (const inv of pkg.pending) {
      if (!guests.has(inv.email)) {
        guests.set(inv.email, {
          id: inv.email,
          name: inv.email,
          email: inv.email,
          company: null,
          pending: true,
          pendingSince: inv.createdAt,
        });
      }
    }
  }

  const guestList = Array.from(guests.values());

  const roleFor = (personId: string, pkg: ProjectPackage): Role | null => {
    const found = pkg.people.find((p) => p.id === personId);
    if (found) return found.role as Role;
    const pending = pkg.pending.find((i) => i.email === personId);
    return pending ? (pending.role as Role) : null;
  };

  const changeRole = async (
    personId: string,
    portalId: string,
    role: Role | null
  ) => {
    setEditing(null);
    await fetch('/api/participants/role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: personId, portalId, role }),
    });
    toast(role ? 'Role updated' : 'Access removed');
    onChanged();
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
                <React.Fragment key={g.id}>
                  <div className="flex items-center gap-3 border-b border-stiko-border py-[10px] pr-3">
                    <Avatar
                      id={g.id}
                      name={g.name}
                      size={30}
                      pending={g.pending}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-bold text-stiko-ink">
                        {g.name}
                      </div>
                      <div className="truncate text-[11px] text-stiko-muted">
                        {g.pending
                          ? `Invite pending${g.pendingSince ? ` · ${relativeTime(g.pendingSince)}` : ''}`
                          : (g.company ?? g.email)}
                      </div>
                    </div>
                  </div>

                  {packages.map((pkg) => {
                    const role = roleFor(g.id, pkg);
                    const isEditing =
                      editing?.personId === g.id && editing?.portalId === pkg.id;
                    return (
                      <div
                        key={pkg.id}
                        className="relative flex items-center justify-center border-b border-stiko-border py-[10px]"
                      >
                        {/* Every cell is a control. */}
                        <button
                          onClick={() =>
                            setEditing(
                              isEditing
                                ? null
                                : { personId: g.id, portalId: pkg.id }
                            )
                          }
                          disabled={g.pending}
                          className="rounded-chip transition hover:opacity-80 disabled:cursor-default"
                          aria-label={`${g.name} on ${pkg.name}`}
                        >
                          <RolePill role={role} pending={g.pending} />
                        </button>

                        {isEditing && (
                          <div className="absolute top-full z-20 mt-1 w-[150px] overflow-hidden rounded-inset bg-white p-1 shadow-stiko-popover">
                            {(['viewer', 'commenter', 'uploader'] as const).map(
                              (r) => (
                                <button
                                  key={r}
                                  onClick={() => changeRole(g.id, pkg.id, r)}
                                  className={`block w-full rounded-[8px] px-3 py-2 text-left text-[12.5px] capitalize transition hover:bg-stiko-app ${
                                    role === r
                                      ? 'font-bold text-stiko-primary'
                                      : 'text-stiko-secondary'
                                  }`}
                                >
                                  {r}
                                </button>
                              )
                            )}
                            {role && (
                              <button
                                onClick={() => changeRole(g.id, pkg.id, null)}
                                className="mt-1 block w-full rounded-[8px] border-t border-stiko-border px-3 py-2 text-left text-[12.5px] font-bold text-[#B23A52] transition hover:bg-[#FFF5F5]"
                              >
                                Remove access
                              </button>
                            )}
                          </div>
                        )}
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
            Click any cell to change a role or remove access. Nothing here is
            visible to guests
            {guestList[0] && packages[0] ? (
              <>
                {' '}— {guestList[0].name} only ever sees{' '}
                <b className="text-stiko-ink">
                  {packages.find((p) => roleFor(guestList[0].id, p))?.name ??
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
