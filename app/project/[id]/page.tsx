'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { Column, Shell, TopBar } from '@/components/ui/Shell';
import {
  AvatarStack,
  SkeletonBar,
  StatusChip,
  TagChip,
} from '@/components/ui/Primitives';
import EmptyState from '@/components/ui/EmptyState';
import AvatarMenu from '@/components/shell/AvatarMenu';
import { AddPeopleModal } from '@/components/people/AddPeopleModal';
import { TeamMatrix } from '@/components/people/TeamMatrix';
import { WaitingOn } from '@/components/project/WaitingOn';
import ProjectBrief from '@/components/project/ProjectBrief';
import { STATUS_ACCENT } from '@/lib/status';
import { relativeTime } from '@/lib/design';
import { DISCLOSURE, EMPTY_DISCLOSURE } from '@/lib/disclosure';

export interface ProjectPerson {
  id: string;
  name: string;
  email: string;
  company: string | null;
  role: string;
  verdict: string | null;
  viewedAt: string | null;
  commentCount: number;
  lastCommentAt: string | null;
}

export interface ProjectPackage {
  id: string;
  name: string;
  tag: string | null;
  versionNumber: number | null;
  changelog: string | null;
  publishedAt: string | null;
  updatedByName: string | null;
  fileCount: number;
  openComments: number;
  status: keyof typeof STATUS_ACCENT;
  people: ProjectPerson[];
  pending: {
    email: string;
    role: string;
    createdAt: string;
    expiresAt: string;
  }[];
}

interface Overview {
  project: { id: string; name: string; createdAt: string };
  members: {
    id: string;
    name: string;
    email: string;
    company: string | null;
    role: string;
    isYou: boolean;
  }[];
  packages: ProjectPackage[];
  disclosure: {
    packagesInProject: number;
    peopleCount: number;
    hasPublishedVersion: boolean;
  };
}

type Tab = 'packages' | 'team' | 'activity';

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('packages');
  const [view, setView] = useState<'status' | 'waiting'>('status');
  const [addPeopleOpen, setAddPeopleOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/projects/${id}/overview`);
      if (!res.ok) {
        // Same rule as home: a failure is never rendered as "still loading".
        const body = await res.json().catch(() => ({}));
        setError(
          res.status === 403 || res.status === 404
            ? 'This project doesn’t exist, or you don’t have access to it.'
            : (body.error ?? `Couldn’t load this project (${res.status}).`)
        );
        return;
      }
      setData(await res.json());
    } catch (err) {
      console.error('Failed to load project', err);
      setError('Couldn’t reach the server.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const disclosure = useMemo(
    () => ({
      ...EMPTY_DISCLOSURE,
      packagesInProject: data?.disclosure.packagesInProject ?? 0,
      peopleCount: data?.disclosure.peopleCount ?? 0,
      hasPublishedVersion: data?.disclosure.hasPublishedVersion ?? false,
      reviewerCount: Math.max(
        0,
        ...(data?.packages.map((p) => p.people.length) ?? [0])
      ),
    }),
    [data]
  );

  if (loading) return <ProjectSkeleton />;

  if (error || !data) {
    return (
      <Shell>
        <TopBar crumbs={[{ label: 'Projects', href: '/' }]} right={<AvatarMenu />} />
        <Column width={720}>
          <div className="mt-10 rounded-panel bg-white p-8 text-center shadow-stiko-panel">
            <h1 className="text-[19px] font-extrabold text-stiko-ink">
              Couldn&apos;t load this project
            </h1>
            <p className="mt-2 text-[13px] leading-[1.6] text-stiko-muted">
              {error ?? 'Something went wrong on our side.'}
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <Button variant="secondary" onClick={() => router.push('/')}>
                Back to your packages
              </Button>
              <Button onClick={load}>Try again</Button>
            </div>
          </div>
        </Column>
      </Shell>
    );
  }

  const showTabs = DISCLOSURE.showProjectTabs(disclosure);
  const showTags = DISCLOSURE.showTags(disclosure);
  const showStatus = DISCLOSURE.showStatusChips(disclosure);
  const showWaitingOn = DISCLOSURE.showWaitingOn(disclosure);

  const allPeople = Array.from(
    new Map(
      data.packages.flatMap((p) => p.people).map((p) => [p.id, p])
    ).values()
  );

  return (
    <Shell>
      <TopBar
        crumbs={[
          { label: 'Projects', href: '/' },
          { label: data.project.name },
        ]}
        right={
          <>
            <Button onClick={() => router.push(`/new?project=${id}`)}>
              New package
            </Button>
            <AvatarMenu />
          </>
        }
      />

      <Column width={1120}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-extrabold tracking-title text-stiko-ink">
              {data.project.name}
            </h1>
            <p className="mt-1 text-[12.5px] text-stiko-muted">
              {data.packages.length} package
              {data.packages.length === 1 ? '' : 's'} ·{' '}
              {disclosure.peopleCount} {disclosure.peopleCount === 1 ? 'person' : 'people'} ·
              Started{' '}
              {new Date(data.project.createdAt).toLocaleDateString(undefined, {
                month: 'long',
                year: 'numeric',
              })}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {allPeople.length > 0 && (
              <AvatarStack people={allPeople} size={30} />
            )}
            <Button variant="secondary" onClick={() => setAddPeopleOpen(true)}>
              Manage people
            </Button>
          </div>
        </div>

        {/* 03: tabs are earned by 2+ packages AND 3+ people. Below that,
            "People" is just a button, which the header already carries. */}
        {showTabs && (
          <nav className="mt-6 flex items-center gap-5 border-b border-stiko-border">
            {(
              [
                ['packages', 'Packages'],
                ['team', 'Team & access'],
                ['activity', 'Activity'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 pb-[10px] text-[14px] transition ${
                  tab === key
                    ? 'border-stiko-primary font-extrabold text-stiko-ink'
                    : 'border-transparent font-semibold text-stiko-muted hover:text-stiko-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        )}

        {tab === 'packages' && (
          <>
            <div className="mt-6">
              <ProjectBrief
                projectId={id}
                packageNames={Object.fromEntries(
                  data.packages.map((p) => [p.id, p.name])
                )}
              />
            </div>

            {showWaitingOn && (
              <div className="mt-5 flex justify-end">
                <div className="flex rounded-[10px] bg-white p-1 shadow-stiko-panel">
                  {(['status', 'waiting'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={`rounded-[7px] px-3 py-[6px] text-[12px] font-bold transition ${
                        view === v
                          ? 'bg-stiko-tint text-stiko-primary'
                          : 'text-stiko-muted hover:text-stiko-ink'
                      }`}
                    >
                      {v === 'status' ? 'Status' : 'Waiting on'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {data.packages.length === 0 ? (
              // 3f — a project with no packages. The whole panel is a drop target.
              <div className="mt-6 rounded-shell border-2 border-dashed border-stiko-dashed bg-white p-6">
                <EmptyState
                  notes={[
                    { color: 'blue', size: 74, rotate: -9 },
                    { color: 'yellow', size: 78, rotate: 8 },
                  ]}
                  heading="A package is one set of drawings, reviewed over time"
                  description="Level 3 — Structural. Podium & Canopy. Each keeps its own versions, people and comments."
                  actionLabel="New package"
                  onAction={() => router.push(`/new?project=${id}`)}
                  secondary={
                    <span className="text-[12.5px] text-stiko-faint">
                      or drop files anywhere here
                    </span>
                  }
                />
              </div>
            ) : view === 'waiting' ? (
              <WaitingOn packages={data.packages} />
            ) : (
              <div className="mt-5 flex flex-col gap-3">
                {data.packages.map((p) => (
                  <ProjectPackageRow
                    key={p.id}
                    pkg={p}
                    showTag={showTags}
                    showStatus={showStatus}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'team' && (
          <TeamMatrix
            members={data.members}
            packages={data.packages}
            onChanged={load}
            onAddPeople={() => setAddPeopleOpen(true)}
          />
        )}

        {tab === 'activity' && (
          <p className="mt-8 text-center text-[13px] text-stiko-muted">
            Nothing has happened here yet.
          </p>
        )}
      </Column>

      <AddPeopleModal
        isOpen={addPeopleOpen}
        onClose={() => setAddPeopleOpen(false)}
        projectName={data.project.name}
        packages={data.packages}
        onDone={load}
      />
    </Shell>
  );
}

/** 2g — a package row inside the project. */
function ProjectPackageRow({
  pkg,
  showTag,
  showStatus,
}: {
  pkg: ProjectPackage;
  showTag: boolean;
  showStatus: boolean;
}) {
  const router = useRouter();
  const open = () => router.push(`/portal/${pkg.id}`);
  const needsAttention =
    pkg.status === 'changes_requested' || pkg.openComments > 0;

  return (
    <div
      className="flex items-center justify-between gap-4 rounded-panel bg-white px-5 py-[18px] shadow-stiko-panel"
      style={{ borderLeft: `3px solid ${STATUS_ACCENT[pkg.status]}` }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-[15.5px] font-extrabold text-stiko-ink">
            {pkg.name}
          </h3>
          {showTag && pkg.tag && <TagChip tag={pkg.tag} />}
          {showStatus && <StatusChip status={pkg.status} />}
        </div>
        <p className="mt-[5px] truncate text-[12.5px] text-stiko-muted">
          {pkg.versionNumber != null ? (
            <>
              V{pkg.versionNumber}
              {pkg.changelog ? ` · “${pkg.changelog}”` : ''}
              {pkg.publishedAt
                ? ` · updated ${relativeTime(pkg.publishedAt)}`
                : ''}
              {pkg.updatedByName ? ` by ${pkg.updatedByName}` : ''}
            </>
          ) : (
            'No files yet'
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-5">
        {pkg.versionNumber != null ? (
          <>
            <div className="text-center">
              <div
                className={`text-[17px] font-extrabold ${
                  pkg.openComments > 0 ? 'text-[#B23A52]' : 'text-stiko-ink'
                }`}
              >
                {pkg.openComments}
              </div>
              <div className="text-[10.5px] text-stiko-faint">open</div>
            </div>
            <div className="text-center">
              <div className="text-[17px] font-extrabold text-stiko-ink">
                {pkg.fileCount}
              </div>
              <div className="text-[10.5px] text-stiko-faint">files</div>
            </div>
            {pkg.people.length > 0 && (
              <AvatarStack people={pkg.people} size={26} />
            )}
            <Button
              variant={needsAttention ? 'primary' : 'secondary'}
              onClick={open}
            >
              Open
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={open}>
              Invite people
            </Button>
            <Button onClick={open}>Add files</Button>
          </>
        )}
      </div>
    </div>
  );
}

function ProjectSkeleton() {
  return (
    <Shell>
      <div className="flex h-[52px] shrink-0 items-center rounded-panel bg-white px-[18px] shadow-stiko-panel">
        <SkeletonBar width={200} height={14} />
      </div>
      <Column width={1120}>
        <SkeletonBar width={280} height={22} />
        <div className="mt-6 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-panel bg-white px-5 py-[18px] shadow-stiko-panel"
            >
              <div className="flex flex-col gap-2">
                <SkeletonBar width={200} height={14} />
                <SkeletonBar width={320} height={11} secondary />
              </div>
              <SkeletonBar width={70} height={30} secondary />
            </div>
          ))}
        </div>
      </Column>
    </Shell>
  );
}
