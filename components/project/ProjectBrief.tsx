'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The project roll-up above the package list. Each section names the
 * package it draws on; when that package is one the page has listed, the
 * name is a button that navigates to it — one click through to the
 * package's own briefs and comments. `versionIds` is carried on each
 * section (server-validated, citing the version briefs that made the
 * claim) but not yet rendered as a link: this app has no per-version URL
 * to point it at (the portal page doesn't read a version from the URL),
 * so the package is as deep as click-through can go today. A future
 * version-level deep link should read `versionIds` from here.
 */

interface Section {
  portalId: string;
  body: string;
  versionIds: string[];
}

interface ProjectSummary {
  enabled: boolean;
  configured: boolean;
  brief: { headline: string; sections: Section[] } | null;
  stale?: boolean;
}

export default function ProjectBrief({
  projectId,
  packageNames,
}: {
  projectId: string;
  packageNames: Record<string, string>;
}) {
  const router = useRouter();
  const [data, setData] = useState<ProjectSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/summary`);
    if (res.ok) setData(await res.json());
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/summary`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? 'Could not refresh the summary');
      else setData(body);
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  if (!data?.enabled) return null;

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Where this project stands
        </h2>
        <button
          type="button"
          onClick={generate}
          disabled={busy || !data.configured}
          className="text-xs font-medium text-gray-900 underline disabled:opacity-40"
        >
          {busy ? 'Updating…' : data.brief ? 'Refresh' : 'Summarise'}
        </button>
      </div>

      {data.brief ? (
        <>
          <p className="mt-2 text-sm font-medium text-gray-900">{data.brief.headline}</p>
          <ul className="mt-3 space-y-2">
            {data.brief.sections.map((section) => {
              const name = packageNames[section.portalId];
              return (
                <li key={section.portalId} className="text-sm text-gray-700">
                  {name ? (
                    <button
                      type="button"
                      onClick={() => router.push(`/portal/${section.portalId}`)}
                      className="font-medium text-gray-900 underline"
                    >
                      {name}
                    </button>
                  ) : (
                    <span className="font-medium text-gray-900">
                      A package not shown here
                    </span>
                  )}{' '}
                  — {section.body}
                </li>
              );
            })}
          </ul>
          {data.stale && (
            <p className="mt-2 text-xs text-gray-500">
              Package summaries have changed since this was written.
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-gray-500">
          {data.configured
            ? 'No summary yet — package summaries are rolled up here once versions have been reviewed.'
            : 'Summarising is not configured for this deployment.'}
        </p>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}
