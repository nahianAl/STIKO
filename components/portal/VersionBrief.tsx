'use client';

import React, { useCallback, useEffect, useState } from 'react';

/**
 * The AI brief above the comment list.
 *
 * Three states, deliberately distinct: absent (offer to summarise), present,
 * and present-but-stale (show it, say how far behind it is). The fact strip
 * renders in all three — and when summarisation is unconfigured, it is all
 * that renders, with an honest line instead of a brief.
 */

interface Theme {
  title: string;
  body: string;
  commentIds: string[];
  firstSeenVersionId: string | null;
}

interface Summary {
  enabled: boolean;
  configured: boolean;
  facts: {
    commentCount: number;
    openThreadCount: number;
    approvedCount: number;
    changesRequestedCount: number;
    participantCount: number;
    mostAnnotatedFile: string | null;
  };
  brief: { headline: string; themes: Theme[] } | null;
  generatedAt: string | null;
  newSinceBrief: number;
}

const AUTO_GENERATE_THRESHOLD = 3;

export default function VersionBrief({
  versionId,
  onSelectComment,
}: {
  versionId: string;
  onSelectComment: (commentId: string) => void;
}) {
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/versions/${versionId}/summary`);
    if (!res.ok) return;
    setData(await res.json());
  }, [versionId]);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/versions/${versionId}/summary`, { method: 'POST' });
      const body = await res.json();
      // On failure the existing brief stays on screen; only the notice changes.
      if (!res.ok) setError(body.error ?? 'Could not refresh the summary');
      else setData(body);
    } finally {
      setBusy(false);
    }
  }, [versionId]);

  useEffect(() => {
    setData(null);
    setError(null);
    load();
  }, [load]);

  useEffect(() => {
    if (
      data?.enabled &&
      data.configured &&
      !data.brief &&
      data.facts.commentCount >= AUTO_GENERATE_THRESHOLD &&
      !busy
    ) {
      generate();
    }
  }, [data, busy, generate]);

  if (!data || !data.enabled) return null;

  const f = data.facts;

  return (
    <section className="border-b border-gray-200 bg-gray-50/60 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Summary
        </h3>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="text-xs text-gray-500 hover:text-gray-900"
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>

      {!collapsed && (
        <>
          {data.brief ? (
            <>
              <p className="mt-2 text-sm font-medium text-gray-900">
                {data.brief.headline}
              </p>
              <ul className="mt-2 space-y-2">
                {data.brief.themes.map((theme, i) => (
                  <li key={i} className="text-sm text-gray-700">
                    <span className="font-medium text-gray-900">{theme.title}</span>
                    {theme.firstSeenVersionId && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        Raised earlier, still open
                      </span>
                    )}
                    <span className="block">{theme.body}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {theme.commentIds.map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => onSelectComment(id)}
                          className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-600 hover:border-gray-500"
                        >
                          pin
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-500">
              {data.configured
                ? 'No summary yet.'
                : 'Summarising is not configured for this deployment.'}
            </p>
          )}

          {data.newSinceBrief > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              {data.newSinceBrief} new comment{data.newSinceBrief === 1 ? '' : 's'} since
              this summary.{' '}
              <button
                type="button"
                onClick={generate}
                disabled={busy}
                className="font-medium text-gray-900 underline disabled:opacity-50"
              >
                {busy ? 'Refreshing…' : 'Refresh'}
              </button>
            </p>
          )}

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

          <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>{f.openThreadCount} unanswered</span>
            <span>{f.commentCount} comments</span>
            <span>{f.participantCount} people</span>
            {f.changesRequestedCount > 0 && (
              <span>{f.changesRequestedCount} requested changes</span>
            )}
            {f.approvedCount > 0 && <span>{f.approvedCount} approved</span>}
            {f.mostAnnotatedFile && <span>most pins on {f.mostAnnotatedFile}</span>}
          </dl>
        </>
      )}
    </section>
  );
}
