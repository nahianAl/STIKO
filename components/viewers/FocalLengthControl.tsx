'use client';

import { useEffect, useRef, useState } from 'react';
import { FOCAL_LENGTH_PRESETS, parseFocalLength } from '@/lib/focalLength';

/**
 * Camera focal length, as a single pill: eye icon, the value, and an arrow that opens the
 * presets upward.
 *
 * Lives in the viewer's DOM rather than the 3D scene, which is also why it never appears in
 * an annotation snapshot — the snapshot is a read of the canvas, and this is not in it.
 */
export default function FocalLengthControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (millimetres: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close the menu on an outside click or Escape, the way the toolbar's own popovers do.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startEditing = () => {
    setDraft(String(value));
    setEditing(true);
    setOpen(false);
  };

  const commit = () => {
    onChange(parseFocalLength(draft, value));
    setEditing(false);
  };

  return (
    <div ref={rootRef} className="absolute bottom-3 left-3 z-20 select-none">
      {open && (
        <div className="mb-1.5 overflow-hidden rounded-panel bg-white shadow-stiko-sheet border border-stiko-border">
          {FOCAL_LENGTH_PRESETS.map((mm) => (
            <button
              key={mm}
              onClick={() => {
                onChange(mm);
                setOpen(false);
              }}
              className={`block w-full px-3 py-1.5 text-left text-xs transition-colors ${
                mm === value
                  ? 'bg-stiko-tint text-stiko-primary'
                  : 'text-stiko-secondary hover:bg-stiko-tint'
              }`}
            >
              {mm}mm
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 rounded-panel bg-white shadow-stiko-panel border border-stiko-border h-8 pl-2 pr-1">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-stiko-muted"
          aria-hidden
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
        </svg>

        {editing ? (
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            aria-label="Focal length in millimetres"
            className="w-12 bg-transparent text-xs text-stiko-ink outline-none"
          />
        ) : (
          <button
            onClick={startEditing}
            title="Set focal length"
            className="w-12 text-left text-xs text-stiko-ink"
          >
            {value}mm
          </button>
        )}

        <button
          onClick={() => {
            setEditing(false);
            setOpen((o) => !o);
          }}
          title="Focal length presets"
          aria-expanded={open}
          className="flex h-6 w-6 items-center justify-center rounded-[8px] text-stiko-muted transition-colors hover:bg-stiko-tint"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
      </div>
    </div>
  );
}
