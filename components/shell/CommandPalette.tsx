'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SectionLabel } from '@/components/ui/Primitives';
import type { PackageCard } from '@/lib/queries';

/**
 * ⌘K command palette (3h). Groups results by kind, highlights the matched
 * substring, and traps focus while open.
 *
 * Only ever searches what the caller passed in, which is already scoped to what
 * this user may see — the palette must not become a way to discover the
 * existence of a package you aren't on.
 */

interface Result {
  kind: 'Packages' | 'Actions';
  id: string;
  label: string;
  sub?: string;
  href?: string;
  action?: () => void;
  shortcut?: string;
}

export default function CommandPalette({
  packages,
  onNewPackage,
}: {
  packages: PackageCard[];
  onNewPackage: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery('');
        setSelected(0);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();

    const pkgs: Result[] = packages
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 6)
      .map((p) => ({
        kind: 'Packages' as const,
        id: p.id,
        label: p.name,
        sub: `${p.projectName} · ${p.openComments} open`,
        href: `/portal/${p.id}`,
      }));

    const actions: Result[] = [
      {
        kind: 'Actions' as const,
        id: 'new-package',
        label: 'New package',
        shortcut: '⌘N',
        action: onNewPackage,
      },
    ].filter((a) => !q || a.label.toLowerCase().includes(q));

    return [...pkgs, ...actions];
  }, [query, packages, onNewPackage]);

  // Keep the highlight inside the list as it shrinks with the query.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, results.length - 1)));
  }, [results.length]);

  if (!open) return null;

  const run = (r: Result) => {
    setOpen(false);
    if (r.action) r.action();
    else if (r.href) router.push(r.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    }
    if (e.key === 'Enter' && results[selected]) {
      e.preventDefault();
      run(results[selected]);
    }
  };

  let cursor = -1;

  return (
    <div className="fixed inset-0 z-[70] flex justify-center px-4 pt-[92px]">
      <div
        className="stiko-scrim-palette fixed inset-0"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative z-10 h-fit w-full max-w-[640px] overflow-hidden rounded-sheet bg-white shadow-stiko-palette"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-stiko-border px-4 py-[14px]">
          <svg
            className="h-[17px] w-[17px] shrink-0 text-stiko-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
          >
            <path d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search packages, files, comments"
            className="flex-1 bg-transparent text-[15px] text-stiko-ink outline-none placeholder:text-stiko-faint"
          />
          <kbd className="rounded-[5px] bg-stiko-app px-[6px] py-[3px] text-[10px] font-bold text-stiko-muted">
            ESC
          </kbd>
        </div>

        <div className="max-h-[380px] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12.5px] text-stiko-muted">
              Nothing matches “{query}”.
            </p>
          ) : (
            (['Packages', 'Actions'] as const).map((group) => {
              const rows = results.filter((r) => r.kind === group);
              if (rows.length === 0) return null;
              return (
                <div key={group} className="mb-2">
                  <SectionLabel className="px-3 pb-1 pt-2">{group}</SectionLabel>
                  {rows.map((r) => {
                    cursor++;
                    const isSelected = cursor === selected;
                    return (
                      <button
                        key={r.id}
                        onClick={() => run(r)}
                        onMouseEnter={() => setSelected(results.indexOf(r))}
                        className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-[10px] text-left transition ${
                          isSelected ? 'bg-stiko-tint' : 'hover:bg-stiko-app'
                        }`}
                      >
                        {r.kind === 'Packages' ? (
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-stiko-tint text-[10px] font-extrabold text-stiko-primary">
                            PK
                          </span>
                        ) : (
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-stiko-app text-stiko-primary">
                            +
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold text-stiko-ink">
                            <Highlight text={r.label} query={query} />
                          </span>
                          {r.sub && (
                            <span className="block truncate text-[11.5px] text-stiko-muted">
                              {r.sub}
                            </span>
                          )}
                        </span>
                        {r.shortcut && (
                          <kbd className="rounded-[5px] bg-stiko-app px-[6px] py-[3px] text-[10px] font-bold text-stiko-muted">
                            {r.shortcut}
                          </kbd>
                        )}
                        {isSelected && !r.shortcut && (
                          <span className="text-[11px] text-stiko-muted">↵</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-stiko-border bg-stiko-app px-4 py-[10px] text-[11px] text-stiko-muted">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
        </div>
      </div>
    </div>
  );
}

/** Matched substrings get a yellow highlight (3h). */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[3px] bg-[#FFFCCE] px-[2px] text-stiko-ink">
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
}
