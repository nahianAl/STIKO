'use client';

/**
 * The shared vocabulary from stiko_handoff/02. Everything else assembles from
 * these, so the exact values live here once rather than being re-typed per
 * screen.
 */

import React from 'react';
import { NOTES, avatarSwatch, initials, tagSwatch, fileChip } from '@/lib/design';
import { STATUS_CHIP, type VersionStatus } from '@/lib/status';

/* -------------------------------------------------------------------------- */
/* Panel — the universal container                                            */
/* -------------------------------------------------------------------------- */

export function Panel({
  className = '',
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-white rounded-panel shadow-stiko-panel ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section label                                                              */
/* -------------------------------------------------------------------------- */

export function SectionLabel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`text-[11px] font-bold uppercase tracking-label text-stiko-faint ${className}`}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Status chip (objective) — OUTLINED. A fact about the work.                 */
/* -------------------------------------------------------------------------- */

export function StatusChip({ status }: { status: VersionStatus }) {
  const spec = STATUS_CHIP[status];
  return (
    <span
      className="inline-flex items-center rounded-pill bg-white px-2 py-[3px] text-[10px] font-extrabold uppercase whitespace-nowrap"
      style={{ border: `1.5px solid ${spec.border}`, color: spec.fg }}
    >
      {spec.label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Attention pill (personal) — SOLID. A fact about you.                       */
/* 01: these two must never look alike.                                       */
/* -------------------------------------------------------------------------- */

export function AttentionPill({
  label,
  bg,
  fg,
}: {
  label: string;
  bg: string;
  fg: string;
}) {
  return (
    <span
      className="inline-flex items-center rounded-pill px-2 py-1 text-[10px] font-extrabold uppercase whitespace-nowrap"
      style={{ background: bg, color: fg }}
    >
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Tag chip — freeform text, colour hashed from the string                    */
/* -------------------------------------------------------------------------- */

export function TagChip({ tag }: { tag: string }) {
  const swatch = tagSwatch(tag);
  return (
    <span
      className="inline-flex items-center rounded-[5px] px-[7px] py-[3px] text-[9px] font-extrabold whitespace-nowrap"
      style={{ background: swatch.pastel, color: swatch.text }}
    >
      {tag}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* File-type chip                                                             */
/* -------------------------------------------------------------------------- */

export function FileChip({ filename }: { filename: string }) {
  const chip = fileChip(filename);
  return (
    <span
      className="inline-flex items-center rounded-chip px-[6px] py-[4px] text-[9px] font-extrabold uppercase leading-none"
      style={{ background: chip.bg, color: chip.fg }}
    >
      {chip.label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Avatar                                                                      */
/* -------------------------------------------------------------------------- */

export function Avatar({
  id,
  name,
  size = 26,
  pending = false,
  ring,
}: {
  /** Stable id, so the colour survives across sessions. */
  id: string;
  name: string;
  size?: number;
  /** A pending invitee reads as an outline, not a filled person. */
  pending?: boolean;
  /** Border colour when stacked — should match the surface behind. */
  ring?: string;
}) {
  const swatch = avatarSwatch(id);
  const fontSize = size <= 24 ? 9 : size <= 30 ? 10 : size <= 34 ? 11 : 14;

  return (
    <span
      title={name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-extrabold select-none"
      style={{
        width: size,
        height: size,
        fontSize,
        background: pending ? '#F1F3FF' : swatch.pastel,
        color: pending ? '#8094F5' : swatch.text,
        border: pending
          ? '1.5px dashed #C6CDE8'
          : ring
            ? `2px solid ${ring}`
            : undefined,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({
  people,
  size = 26,
  max = 4,
  ring = '#FFFFFF',
}: {
  people: { id: string; name: string; pending?: boolean }[];
  size?: number;
  max?: number;
  ring?: string;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;

  return (
    <span className="inline-flex items-center">
      {shown.map((p, i) => (
        <span key={p.id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
          <Avatar
            id={p.id}
            name={p.name}
            size={size}
            pending={p.pending}
            ring={ring}
          />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-stiko-idle text-[10px] font-extrabold text-stiko-secondary"
          style={{
            width: size,
            height: size,
            marginLeft: -8,
            border: `2px solid ${ring}`,
          }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Toggle                                                                      */
/* -------------------------------------------------------------------------- */

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative shrink-0 rounded-pill p-[2px] transition-colors duration-150 disabled:opacity-50"
      style={{
        width: 36,
        height: 21,
        background: checked ? '#5B60FF' : '#EFEFF4',
      }}
    >
      <span
        className="block rounded-full bg-white transition-transform duration-150"
        style={{
          width: 17,
          height: 17,
          boxShadow: checked ? undefined : '0 1px 2px rgba(0,0,0,0.15)',
          transform: `translateX(${checked ? 15 : 0}px)`,
        }}
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  hint,
  children,
  action,
}: {
  label: string;
  /** Optional-field hint, appended in a lighter weight. */
  hint?: string;
  children: React.ReactNode;
  /** e.g. the "Forgot?" link on the password label row. */
  action?: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-[6px] flex items-center justify-between">
        <span className="text-[12px] font-bold text-stiko-secondary">
          {label}
          {hint && (
            <span className="ml-1 font-medium text-stiko-faint">{hint}</span>
          )}
        </span>
        {action}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  'w-full rounded-[10px] border-[1.5px] border-stiko-divider bg-white px-[13px] py-[11px] text-[13.5px] text-stiko-ink outline-none transition placeholder:text-stiko-faint focus:border-stiko-primary focus:shadow-stiko-focus';

export const readOnlyInputClass = `${inputClass} bg-stiko-app`;

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return <input className={`${inputClass} ${className}`} {...rest} />;
}

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>
) {
  const { className = '', ...rest } = props;
  return (
    <textarea
      className={`${inputClass} resize-y leading-[1.5] ${className}`}
      {...rest}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Error banner — renders inside the card, above the fields                   */
/* -------------------------------------------------------------------------- */

export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-[10px] px-[13px] py-[11px] text-[13px]"
      style={{ background: NOTES.red.pastel, color: NOTES.red.text }}
    >
      {children}
    </div>
  );
}

/** The yellow explanatory note used throughout the flows. */
export function Note({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-inset px-[14px] py-[12px] text-[12.5px] leading-[1.5] ${className}`}
      style={{ background: NOTES.yellow.pastel, color: NOTES.yellow.text }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sticky-note motif — every empty state opens with this, never a bare button */
/* -------------------------------------------------------------------------- */

export function StickyNotes({
  notes = [
    { color: 'blue', size: 74, rotate: -9 },
    { color: 'red', size: 84, rotate: 3 },
    { color: 'yellow', size: 74, rotate: 11 },
  ],
  children,
}: {
  notes?: { color: keyof typeof NOTES; size: number; rotate: number }[];
  /** Optional glyph carried by the front note (e.g. the "?" on 3p). */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-center" aria-hidden>
      {notes.map((n, i) => (
        <div
          key={i}
          className="flex items-center justify-center rounded-[8px] shadow-stiko-note"
          style={{
            width: n.size,
            height: n.size,
            background: NOTES[n.color].pastel,
            transform: `rotate(${n.rotate}deg)`,
            marginLeft: i === 0 ? 0 : -16,
            zIndex: i === 1 ? 2 : 1,
            color: NOTES[n.color].text,
          }}
        >
          {i === notes.length - 1 ? children : null}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton — match the shape of the real content. No spinners.               */
/* -------------------------------------------------------------------------- */

export function SkeletonBar({
  width = '100%',
  height = 12,
  secondary = false,
}: {
  width?: number | string;
  height?: number;
  secondary?: boolean;
}) {
  return (
    <div
      className="rounded-[5px]"
      style={{
        width,
        height,
        background: secondary ? '#F1F3FF' : '#E8EBF6',
      }}
    />
  );
}

export function SkeletonAvatar({ size = 26 }: { size?: number }) {
  return (
    <div
      className="rounded-full"
      style={{ width: size, height: size, background: NOTES.blue.pastel }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Role pill — the matrix cell (4a)                                           */
/* -------------------------------------------------------------------------- */

const ROLE_PILL: Record<string, { letter: string; bg: string; fg: string }> = {
  viewer: { letter: 'V', bg: NOTES.blue.pastel, fg: NOTES.blue.text },
  commenter: { letter: 'C', bg: NOTES.green.pastel, fg: NOTES.green.text },
  uploader: { letter: 'U', bg: NOTES.purple.pastel, fg: NOTES.purple.text },
};

export function RolePill({
  role,
  pending = false,
}: {
  role: 'viewer' | 'commenter' | 'uploader' | null;
  pending?: boolean;
}) {
  if (!role) {
    // No access reads as an em-dash, not an empty cell.
    return (
      <span
        className="inline-flex items-center justify-center text-[13px]"
        style={{ width: 30, height: 24, color: '#D8DCE8' }}
        aria-label="No access"
      >
        —
      </span>
    );
  }
  const spec = ROLE_PILL[role];
  return (
    <span
      className="inline-flex items-center justify-center rounded-chip text-[10px] font-extrabold"
      style={{
        width: 30,
        height: 24,
        background: spec.bg,
        color: spec.fg,
        opacity: pending ? 0.55 : 1,
      }}
      title={role[0].toUpperCase() + role.slice(1)}
    >
      {spec.letter}
    </span>
  );
}

/** Role text colour used in the "who can see this" list (4d). */
export const ROLE_TEXT_COLOR: Record<string, string> = {
  uploader: '#6b4fc4',
  commenter: '#4B7A28',
  viewer: '#2f7fc4',
  owner: '#A2A7B8',
  coordinator: '#A2A7B8',
};
