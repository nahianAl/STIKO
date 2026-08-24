'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The AI brief above the comment list.
 *
 * Four states, deliberately distinct: not configured (an honest line instead
 * of a brief), configured with no brief yet (offer to summarise), brief
 * current, and brief present-but-stale (show it, say how far behind it is).
 * The fact strip renders in all four.
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
  /** Comment id → file id, for every comment cited anywhere in the brief. A
   * chip whose id is missing here (e.g. the comment was deleted after the
   * brief was generated) has nothing to resolve to and must not render. */
  commentFiles: Record<string, string>;
  generatedAt: string | null;
  newSinceBrief: number;
}

const AUTO_GENERATE_THRESHOLD = 3;

export default function VersionBrief({
  versionId,
  onSelectComment,
}: {
  versionId: string;
  /** Fired with the comment's id and the id of the file it lives on — the
   * caller owns switching files and activating the comment, this component
   * only knows where each citation resolves to. */
  onSelectComment: (commentId: string, fileId: string) => void;
}) {
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // generate() leaves data.brief null on failure, so without this the effect
  // re-fires on every busy transition and loops against a paid API. Records
  // the versionId an auto-attempt has already been made for, capping it to
  // one automatic attempt per version per mount.
  const autoAttempted = useRef<string | null>(null);
  // Which version the `data` in state was loaded for. setData is queued, so on a
  // versionId change the auto-generate effect would otherwise still see the
  // PREVIOUS version's data while already bound to the new versionId — and fire
  // a POST for the new version on the strength of the old one's facts.
  const loadedFor = useRef<string | null>(null);
  // Always the version currently on screen. Both load() and generate() capture
  // the version they were started for and compare against this after awaiting —
  // a response that arrives after the user has moved on must be discarded, not
  // applied. Without it a slow generate() for one version lands its brief, and
  // its citation ids, into a different version's panel.
  const currentVersion = useRef(versionId);
  currentVersion.current = versionId;

  const load = useCallback(async () => {
    const target = versionId;
    const res = await fetch(`/api/versions/${target}/summary`);
    if (target !== currentVersion.current) return;
    if (!res.ok) return;
    const body = await res.json();
    if (target !== currentVersion.current) return;
    loadedFor.current = target;
    setData(body);
  }, [versionId]);

  const generate = useCallback(async () => {
    const target = versionId;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/versions/${target}/summary`, { method: 'POST' });
      if (target !== currentVersion.current) return;
      const body = await res.json();
      if (target !== currentVersion.current) return;
      // On failure the existing brief stays on screen; only the notice changes.
      if (!res.ok) {
        setError(body.error ?? 'Could not refresh the summary');
      } else {
        loadedFor.current = target;
        setData(body);
      }
    } catch {
      if (target !== currentVersion.current) return;
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }, [versionId]);

  useEffect(() => {
    setData(null);
    setError(null);
    setBusy(false);
    autoAttempted.current = null;
    loadedFor.current = null;
    load();
  }, [load]);

  useEffect(() => {
    if (loadedFor.current !== versionId) return;
    if (
      data?.enabled &&
      data.configured &&
      !data.brief &&
      data.facts.commentCount >= AUTO_GENERATE_THRESHOLD &&
      !busy
    ) {
      if (autoAttempted.current === versionId) return;
      autoAttempted.current = versionId;
      generate();
    }
  }, [data, busy, generate, versionId]);

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
                      {theme.commentIds
                        // A chip that cannot resolve to a file must not be shown at
                        // all — rendering it dead (no scroll, no message) is worse
                        // than not rendering it.
                        .filter((id) => data.commentFiles[id])
                        .map((id) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => onSelectComment(id, data.commentFiles[id])}
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
              {data.configured && !data.brief && f.commentCount > 0 && (
                <button
                  type="button"
                  onClick={generate}
                  disabled={busy}
                  className="ml-2 font-medium text-gray-900 underline disabled:opacity-50"
                >
                  {busy ? 'Summarising…' : 'Summarise'}
                </button>
              )}
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
