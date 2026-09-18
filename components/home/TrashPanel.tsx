'use client';

import { useCallback, useEffect, useState } from 'react';
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
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/trash')
      .then((res) => (res.ok ? res.json() : []))
      .then((body: TrashItem[]) => setItems(Array.isArray(body) ? body : []))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    // Null first, so a stale list from a previous open never shows as current.
    setItems(null);
    load();
  }, [isOpen, load]);

  const restore = async (item: TrashItem) => {
    // Composite, matching the list key below: id alone is a project id or a
    // portal id depending on `kind`, and nothing guarantees those two id
    // spaces never collide.
    const key = `${item.kind}-${item.id}`;
    setBusy(key);
    const res = await fetch('/api/trash/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: item.kind, id: item.id }),
    });
    setBusy(null);

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
      subtitle={`Removed for good ${TRASH_RETENTION_DAYS} days after deletion — until then it still counts toward your storage.`}
    >
      {items === null && (
        <div className="flex flex-col gap-[10px]">
          <SkeletonBar height={60} />
          <SkeletonBar height={60} secondary />
        </div>
      )}

      {items !== null && items.length === 0 && (
        <p className="px-1 py-6 text-center text-[12.5px] text-stiko-muted">
          Nothing deleted. Deleted projects and packages appear here for{' '}
          {TRASH_RETENTION_DAYS} days.
        </p>
      )}

      {items !== null && items.length > 0 && (
        <div className="flex flex-col gap-[10px]">
          {items.map((item) => {
            const key = `${item.kind}-${item.id}`;
            const urgent = item.daysLeft <= 3;
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
                  className="shrink-0 whitespace-nowrap text-right text-[11px] font-bold"
                  style={{ color: urgent ? '#B23A52' : '#8A90A6' }}
                >
                  {item.daysLeft === 0
                    ? 'Gone today'
                    : `${item.daysLeft} ${item.daysLeft === 1 ? 'day' : 'days'} left`}
                </span>

                <Button
                  variant="secondary"
                  onClick={() => restore(item)}
                  disabled={busy === key}
                >
                  {busy === key ? 'Restoring…' : 'Restore'}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}
