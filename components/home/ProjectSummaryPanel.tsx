'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { STATUS_ACCENT } from '@/lib/status';
import { relativeTime } from '@/lib/design';
import type { ProjectGroup } from '@/lib/home';

interface Section {
  portalId: string;
  body: string;
  versionIds: string[];
}

interface SummaryResponse {
  enabled: boolean;
  configured: boolean;
  brief: { headline: string; sections: Section[] } | null;
  generatedAt: string | null;
  stale?: boolean;
}

/**
 * Panel A — the project's AI summary.
 *
 * `group` is the LAST selected project, not the current one: it must keep
 * rendering the outgoing project's content for the whole close animation, or
 * the panel visibly empties on the way down. `open` alone drives the geometry.
 *
 * Summaries are generated on demand (a ~30s model call), so a project that has
 * never been summarised shows a button rather than a spinner. Firing the
 * generation automatically on select would mean a half-minute wait and a paid
 * call for every row the user clicks through.
 */
export default function ProjectSummaryPanel({
  group,
  open,
  onClose,
}: {
  group: ProjectGroup | null;
  open: boolean;
  /** Deselects the project. The ✕ does NOT merely hide this panel — leaving
   *  the row expanded under a dismissed summary is two states for one fact. */
  onClose: () => void;
}) {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-selecting a project the user already looked at must not re-fetch, and a
  // fast run down the list must not leave a slow response overwriting a fast
  // one — hence the cache and the abort.
  const cache = useRef(new Map<string, SummaryResponse>());
  const inflight = useRef<AbortController | null>(null);

  const projectId = group?.project.id ?? null;

  useEffect(() => {
    if (!projectId || !open) return;

    const cached = cache.current.get(projectId);
    if (cached) {
      setData(cached);
      setError(null);
      return;
    }

    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;

    setData(null);
    setError(null);

    fetch(`/api/projects/${projectId}/summary`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: SummaryResponse | null) => {
        if (controller.signal.aborted || !body) return;
        cache.current.set(projectId, body);
        setData(body);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Couldn’t load the summary.');
      });

    return () => controller.abort();
  }, [projectId, open]);

  const generate = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/summary`, {
        method: 'POST',
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Couldn’t write a summary.');
      } else {
        cache.current.set(projectId, body);
        setData(body);
      }
    } catch {
      setError('Couldn’t reach the server.');
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  // Switched off for this project: the panel is absent, not empty. The feed
  // below simply takes the whole rail.
  const visible = open && Boolean(group) && data?.enabled !== false;

  return (
    <div
      className="stiko-motion shrink-0 overflow-hidden transition-[max-height,opacity,margin-bottom,transform] duration-[380ms] ease-[cubic-bezier(.32,.72,0,1)]"
      style={{
        maxHeight: visible ? 328 : 0,
        opacity: visible ? 1 : 0,
        marginBottom: visible ? 12 : 0,
        transform: visible ? 'none' : 'translateY(-10px)',
      }}
      aria-hidden={!visible}
    >
      <section className="flex h-[328px] flex-col overflow-hidden rounded-panel border-[1.5px] border-stiko-divider bg-white shadow-stiko-panel">
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-stiko-border px-4 py-[13px]">
          <div className="min-w-0">
            <div className="flex items-center gap-[7px]">
              <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-chip bg-gradient-to-br from-[#8094F5] to-[#5B60FF] text-[9px] font-extrabold text-white">
                AI
              </span>
              <h2 className="text-[14px] font-extrabold text-stiko-ink">
                Project summary
              </h2>
            </div>
            <p className="mt-[3px] truncate text-[11.5px] font-bold text-stiko-primary">
              {group?.project.name ?? ''}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close the summary and deselect the project"
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] bg-stiko-app text-stiko-muted transition duration-150 hover:bg-stiko-idle hover:text-stiko-ink"
          >
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[14px] pt-3">
          {error ? (
            <p className="text-[12px] text-note-red-text">{error}</p>
          ) : data?.brief ? (
            <Brief brief={data.brief} group={group} generatedAt={data.generatedAt} />
          ) : data ? (
            <div>
              <p className="text-[12.5px] leading-[1.55] text-stiko-secondary">
                {data.configured
                  ? 'No summary yet. Stiko can read this project’s comments and versions and write one.'
                  : 'Summaries aren’t configured for this deployment.'}
              </p>
              {data.configured && (
                <button
                  type="button"
                  onClick={generate}
                  disabled={busy}
                  className="mt-3 rounded-[10px] bg-gradient-to-br from-[#8094F5] to-[#5B60FF] px-[14px] py-2 text-[12.5px] font-bold text-white shadow-stiko-primary transition duration-150 hover:brightness-[1.04] disabled:opacity-50"
                >
                  {busy ? 'Writing…' : 'Summarise this project'}
                </button>
              )}
              {busy && (
                <p className="mt-2 text-[10.5px] text-stiko-faint">
                  This takes about half a minute.
                </p>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-stiko-faint">Loading…</p>
          )}
        </div>
      </section>
    </div>
  );
}

function Brief({
  brief,
  group,
  generatedAt,
}: {
  brief: { headline: string; sections: Section[] };
  group: ProjectGroup | null;
  generatedAt: string | null;
}) {
  // The accent is the package's REAL derived status, never something the model
  // chose — the palette has to keep meaning what it means everywhere else.
  const statusOf = (portalId: string) =>
    group?.packages.find((p) => p.id === portalId)?.status ?? 'draft';

  const nameOf = (portalId: string) =>
    group?.packages.find((p) => p.id === portalId)?.name ?? 'A package';

  const versions = new Set(brief.sections.flatMap((s) => s.versionIds)).size;

  return (
    <>
      <p
        className="text-[12.5px] leading-[1.55] text-stiko-ink"
        style={{ textWrap: 'pretty' }}
      >
        {brief.headline}
      </p>

      <div className="flex flex-col gap-[10px] pt-3">
        {brief.sections.map((section) => (
          <div key={section.portalId} className="flex gap-[9px]">
            <span
              className="w-[3px] shrink-0 rounded-full"
              style={{ background: STATUS_ACCENT[statusOf(section.portalId)] }}
            />
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-label text-stiko-faint">
                {nameOf(section.portalId)}
              </div>
              <p
                className="text-[12px] leading-[1.5] text-stiko-secondary"
                style={{ textWrap: 'pretty' }}
              >
                {section.body}
              </p>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-[14px] text-[10.5px] text-stiko-faint">
        Drafted from {brief.sections.length}{' '}
        {brief.sections.length === 1 ? 'package' : 'packages'} and {versions}{' '}
        {versions === 1 ? 'version' : 'versions'}
        {generatedAt ? ` · updated ${relativeTime(generatedAt)}` : ''}
      </p>
    </>
  );
}
