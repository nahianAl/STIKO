'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { paletteForKey } from '@/lib/commentColors';
import { getInitials } from '@/lib/initials';
import {
  shouldShowBrief,
  briefDigest,
  statChips,
  stalenessLine,
} from '@/lib/brief';

/**
 * The AI brief above the comment list.
 *
 * Four states, deliberately distinct: not configured (an honest line instead
 * of a brief), configured with no brief yet (offer to summarise), brief
 * current, and brief present-but-stale (show it, say how far behind it is).
 *
 * Expanded by default — this lives in a drawer someone opened deliberately.
 * It can still be collapsed to a single digest line via the toggle.
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
   * citation whose id is missing here (e.g. the comment was deleted after the
   * brief was generated) has nothing to resolve to and must not render. */
  commentFiles: Record<string, string>;
  /** Comment id → author name, for the citation avatars. A comment can be
   * present in commentFiles and absent here (a legacy row with no author); that
   * citation still renders, with a neutral avatar. Dropping it would hide a
   * real citation over a cosmetic gap. */
  commentAuthors: Record<string, string>;
  generatedAt: string | null;
  newSinceBrief: number;
}

const GRADIENT = 'linear-gradient(135deg, #8094F5, #5B60FF)';

/** Focus treatment for every button in here; the prototype specified none. */
const FOCUS = 'focus:outline-none focus-visible:shadow-stiko-focus';

export default function VersionBrief({
  versionId,
  autoBusy = false,
  onSelectComment,
}: {
  versionId: string;
  /** True while the PAGE is auto-generating this version's brief. The Brief's
   *  own `busy` cannot see that, so without this the buttons below would offer
   *  to start a second concurrent generation of the same version. */
  autoBusy?: boolean;
  /** Fired with the comment's id and the id of the file it lives on — the
   * caller owns switching files and activating the comment, this component
   * only knows where each citation resolves to. */
  onSelectComment: (commentId: string, fileId: string) => void;
}) {
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Expanded by default. It defaulted to collapsed when it lived in the comment
  // panel, where it competed for space above every file's comments. It now has
  // a drawer of its own that people open deliberately, so collapsed-by-default
  // would mean two clicks to reach the thing they opened the drawer for. The
  // toggle stays, so a long brief can still be folded to reach what is below it.
  const [collapsed, setCollapsed] = useState(false);
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
        setError(body.error ?? 'Could not refresh the brief');
      } else {
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
    load();
  }, [load]);

  // The page generates in the background and does not hand the result down.
  // When its generation finishes, re-read — otherwise this keeps offering to
  // summarise a version that now has a brief.
  const wasAutoBusy = useRef(false);
  useEffect(() => {
    if (wasAutoBusy.current && !autoBusy) load();
    wasAutoBusy.current = autoBusy;
  }, [autoBusy, load]);

  if (!data || !data.enabled) return null;
  // A version with few comments has no Brief section at all — no card, no
  // dashed placeholder, no header. Applied regardless of whether a brief
  // exists: one whose comments have since been deleted goes away with them.
  if (!shouldShowBrief(data.facts.commentCount)) return null;

  const f = data.facts;
  const brief = data.brief;

  // No brief yet, or summarising is switched off for the deployment. Dashed and
  // muted because the section is inert — there is nothing here to collapse.
  if (!brief) {
    return (
      <section className="shrink-0 rounded-[12px] border border-dashed border-stiko-dashed bg-white p-[13px]">
        <h3 className="text-[10px] font-extrabold uppercase tracking-label text-stiko-muted">
          Brief
        </h3>
        <p className="mt-2 text-[12px] leading-[1.5] text-stiko-muted">
          {data.configured
            ? `No brief yet. Summarise the ${f.commentCount} comments on this version into themes.`
            : 'Summarising is not configured for this deployment.'}
        </p>
        {data.configured && (
          <button
            type="button"
            onClick={generate}
            disabled={busy || autoBusy}
            className={`mt-2.5 px-3.5 py-[7px] rounded-[10px] text-[11px] font-bold text-white disabled:opacity-40 transition-[filter] hover:brightness-[0.97] ${FOCUS}`}
            style={{ background: GRADIENT }}
          >
            {busy || autoBusy ? 'Summarising…' : 'Summarise'}
          </button>
        )}
        {error && (
          <p className="mt-2 text-[10.5px] text-note-red-text">{error}</p>
        )}
      </section>
    );
  }

  const toggle = (
    <button
      type="button"
      onClick={() => setCollapsed((c) => !c)}
      className={`shrink-0 text-[11px] font-bold text-stiko-primary hover:text-stiko-primary-hover transition-colors ${FOCUS}`}
    >
      {collapsed ? 'Show' : 'Hide'}
    </button>
  );

  return (
    <section className="shrink-0 rounded-[12px] border border-stiko-divider bg-white overflow-hidden">
      {/* Header strip — the whole card when collapsed, so it sits slightly
          taller in that state. */}
      <div
        className={`bg-stiko-tint px-3 flex items-center justify-between gap-2 ${
          collapsed ? 'py-2.5' : 'py-[9px]'
        }`}
      >
        <div className="flex items-center gap-[7px] min-w-0">
          <span className="w-[5px] h-[5px] shrink-0 rounded-full bg-stiko-primary" />
          <h3 className="shrink-0 text-[10px] font-extrabold uppercase tracking-label text-stiko-primary">
            Brief
          </h3>
          {collapsed && (
            <span className="text-[11.5px] text-stiko-muted truncate">
              {briefDigest(brief.themes)}
            </span>
          )}
        </div>
        {toggle}
      </div>

      {!collapsed && (
        <>
          <div className="p-3">
            <p className="text-[12.5px] font-bold leading-[1.45] text-stiko-ink">
              {brief.headline}
            </p>

            {/* Fixed-length scroll region. The cap is on the theme list alone —
                headline, stat chips and the staleness row stay fully visible. */}
            <div className="mt-3 max-h-[190px] overflow-y-auto flex flex-col gap-3">
              {brief.themes.map((theme, i) => (
                <div key={i} className="flex gap-[9px]">
                  <span className="mt-px w-[17px] h-[17px] shrink-0 rounded-[5px] bg-stiko-tint text-stiko-primary text-[9px] font-extrabold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center flex-wrap gap-1.5">
                      <span className="text-[12px] font-bold text-stiko-ink">
                        {theme.title}
                      </span>
                      {theme.firstSeenVersionId && (
                        <span className="text-[9px] font-bold bg-note-yellow text-note-yellow-text px-1.5 py-0.5 rounded-chip">
                          Still open
                        </span>
                      )}
                    </div>
                    <p className="mt-[3px] text-[12px] leading-[1.5] text-[#4A4F63]">
                      {theme.body}
                    </p>
                    <div className="mt-[7px] flex items-center gap-[5px]">
                      {theme.commentIds
                        // A citation that cannot resolve to a file must not be
                        // shown at all — rendering it dead (no scroll, no
                        // message) is worse than not rendering it.
                        .filter((id) => data.commentFiles[id])
                        .map((id) => {
                          const author = data.commentAuthors[id];
                          const pal = author ? paletteForKey(author) : null;
                          return (
                            <button
                              key={id}
                              type="button"
                              title={author ?? 'Unknown author'}
                              onClick={() => onSelectComment(id, data.commentFiles[id])}
                              className={`w-[19px] h-[19px] shrink-0 rounded-full flex items-center justify-center text-[8px] font-extrabold transition-shadow hover:shadow-[0_0_0_2px_rgba(91,96,255,0.25)] ${FOCUS} ${
                                pal ? '' : 'bg-stiko-idle text-stiko-muted'
                              }`}
                              style={
                                pal ? { background: pal.swatch, color: pal.dark } : undefined
                              }
                            >
                              {author ? getInitials(author) : '?'}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-stiko-border px-3 py-2.5 flex flex-wrap gap-[5px]">
            {statChips(f).map((chip) => (
              <span
                key={chip.key}
                className={`text-[10px] font-bold px-2 py-[3px] rounded-chip ${
                  chip.tone === 'red'
                    ? 'bg-note-red text-note-red-text'
                    : chip.tone === 'green'
                    ? 'bg-note-green text-note-green-text'
                    : 'bg-stiko-subtle text-stiko-secondary'
                }`}
              >
                {chip.label}
              </span>
            ))}
          </div>

          {error ? (
            <div className="border-t border-stiko-border px-3 py-[9px] bg-[#FDFDFF]">
              <p className="text-[10.5px] text-note-red-text">{error}</p>
            </div>
          ) : (
            data.newSinceBrief > 0 && (
              <div className="border-t border-stiko-border px-3 py-[9px] flex items-center justify-between gap-2 bg-[#FDFDFF]">
                <span className="text-[10.5px] text-stiko-muted">
                  {stalenessLine(data.newSinceBrief)}
                </span>
                <button
                  type="button"
                  onClick={generate}
                  disabled={busy || autoBusy}
                  className={`shrink-0 text-[10.5px] font-bold text-stiko-primary hover:text-stiko-primary-hover disabled:opacity-40 transition-colors ${FOCUS}`}
                >
                  {busy || autoBusy ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            )
          )}
        </>
      )}
    </section>
  );
}
