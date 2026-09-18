'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Drawer from '@/components/ui/Drawer';
import Button from '@/components/ui/Button';
import { SectionLabel, SkeletonBar } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { formatBytes, relativeTime } from '@/lib/design';
import { TRASH_RETENTION_DAYS } from '@/lib/trash';
import type { TrashItem } from '@/lib/trashQueries';

/**
 * Everything this user can still get back.
 *
 * There is no empty-the-trash control and no permanent delete, by design:
 * expiry is the only way out. That makes this panel purely a safety net rather
 * than something the user has to manage, which is why it can be shown to
 * everyone — a guest can delete no container, so theirs is simply empty.
 */
export default function TrashPanel({
  isOpen,
  onClose,
  onRestored,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Refetch the dashboard — a restored project belongs back in the list. */
  onRestored: () => void;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  // Bumped at the start of every load() so a response can tell whether it is
  // still the latest one in flight. Without this, restoring an item (which
  // triggers its own reload) and then closing and reopening the panel (which
  // triggers another) can let the FIRST call land after the second: the
  // pre-restore list would overwrite the correct post-restore one, bringing a
  // restored card back with a Restore button that now 404s.
  const gen = useRef(0);

  const load = useCallback(() => {
    const myGen = ++gen.current;

    type LoadResult =
      | { ok: true; items: TrashItem[] }
      | { ok: false; error: string };

    fetch('/api/trash')
      .then(async (res): Promise<LoadResult> => {
        if (res.ok) {
          const body = await res.json();
          return { ok: true, items: Array.isArray(body) ? (body as TrashItem[]) : [] };
        }
        const body = await res.json().catch(() => ({}));
        return {
          ok: false,
          error:
            (body as { error?: string }).error ?? 'Could not load your trash.',
        };
      })
      .catch(
        (): LoadResult => ({ ok: false, error: 'Could not reach the server.' })
      )
      .then((result) => {
        // Stale calls lose, whichever order they land in: only the response
        // to the most recently started request is allowed to update state.
        if (myGen !== gen.current) return;
        if (result.ok) {
          setItems(result.items);
          setError(null);
        } else {
          setItems([]);
          setError(result.error);
        }
      });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    // Null first, so a stale list from a previous open never shows as current.
    setItems(null);
    setError(null);
    load();
  }, [isOpen, load]);

  const restore = async (item: TrashItem) => {
    // Composite, matching the list key below. `id` alone would be ambiguous —
    // a project id or a package id depending on `kind` — so the key mirrors
    // the same pairing the list already keys on, not a hedge against the two
    // id spaces colliding (both come from uuidv4()).
    const key = `${item.kind}-${item.id}`;
    setBusy((prev) => new Set(prev).add(key));
    const res = await fetch('/api/trash/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: item.kind, id: item.id }),
    });
    // Only this call's own key comes off the set. A second restore started
    // while this one was in flight owns its own key and must stay disabled
    // until its own request completes.
    setBusy((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

    if (!res.ok) {
      // The likeliest cause is expiry while the panel sat open, so reload
      // rather than leaving a card that cannot be restored.
      toast('That item is no longer in your trash');
      load();
      return;
    }

    toast(`${item.name} restored`);
    load();
    onRestored();
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Trash"
      subtitle={`Deleted items go for good after ${TRASH_RETENTION_DAYS} days — until then they still count toward your storage.`}
    >
      {error && (
        <p className="px-1 py-6 text-center text-[12.5px] text-note-red-text">
          {error}
        </p>
      )}

      {!error && items === null && (
        <div className="flex flex-col gap-[10px]">
          <SkeletonBar height={60} />
          <SkeletonBar height={60} secondary />
        </div>
      )}

      {!error && items !== null && items.length === 0 && (
        <p className="px-1 py-6 text-center text-[12.5px] text-stiko-muted">
          Nothing deleted.
        </p>
      )}

      {!error && items !== null && items.length > 0 && (
        <div className="flex flex-col gap-[10px]">
          {items.map((item) => {
            const key = `${item.kind}-${item.id}`;
            const urgent = item.daysLeft <= 3;
            const isBusy = busy.has(key);
            return (
              <div
                key={key}
                className={`flex items-center gap-3 rounded-inset border px-[15px] py-[13px] ${
                  urgent
                    ? 'border-stiko-chip-red bg-note-red/40'
                    : 'border-stiko-sheet bg-white'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-extrabold tracking-heading text-stiko-ink">
                      {item.name}
                    </span>
                    <SectionLabel>{item.kind}</SectionLabel>
                  </div>
                  <p className="mt-1 text-[11.5px] text-stiko-muted">
                    {item.kind === 'package' && item.projectName
                      ? `in ${item.projectName} · `
                      : ''}
                    {item.sweptPackageCount > 0
                      ? `${item.sweptPackageCount} ${
                          item.sweptPackageCount === 1
                            ? 'package goes'
                            : 'packages go'
                        } back with it · `
                      : ''}
                    {formatBytes(item.bytes)} · deleted{' '}
                    {relativeTime(item.deletedAt)}
                    {item.deletedByName ? ` by ${item.deletedByName}` : ''}
                  </p>
                </div>

                <span
                  className={`shrink-0 whitespace-nowrap text-right text-[11px] font-bold ${
                    urgent ? 'text-note-red-text' : 'text-stiko-muted'
                  }`}
                >
                  {item.daysLeft === 0
                    ? 'Gone today'
                    : `${item.daysLeft} ${item.daysLeft === 1 ? 'day' : 'days'} left`}
                </span>

                <Button
                  variant="secondary"
                  onClick={() => restore(item)}
                  disabled={isBusy}
                  title={`Restore ${item.name}`}
                >
                  {isBusy ? 'Restoring…' : 'Restore'}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}
