'use client';

import { BAR, SLOT_BASE, LABEL_ABOVE } from './toolbarStyles';

const CrossIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

const TickIcon = (
  <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

/**
 * The two action chips. Same 34x34 geometry and hover lift as a toolbar slot, but each with its
 * own pastel rather than the toolbar's shared lilac — these commit and discard work, so they
 * should not read as another pair of tools.
 *
 * Tints are Tailwind arbitrary values rather than inline styles so hover stays in CSS. The
 * pastels are note-red and note-green from tailwind.config.ts, and the borders are the matching
 * status-chip tokens.
 */
const ACTION_TINTS = {
  discard: 'bg-[#FFE2E2]/60 hover:bg-[#FFE2E2] border-stiko-chip-red text-[#B23A52]',
  apply: 'bg-[#EDFFDA]/60 hover:bg-[#EDFFDA] border-stiko-chip-green text-[#4B7A28]',
} as const;

function ActionButton({
  label,
  tint,
  onClick,
  children,
}: {
  label: string;
  tint: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative flex">
      <button
        aria-label={label}
        onClick={onClick}
        // SLOT_BASE carries the geometry and the hover lift; the tint supplies the colours that
        // slot() would otherwise apply as lilac.
        className={`${SLOT_BASE} ${tint}`}
      >
        {children}
      </button>
      <span className={LABEL_ABOVE}>{label}</span>
    </div>
  );
}

/**
 * The "you are marking up" indicator, as a pill floating over the bottom of the viewport.
 *
 * It floats rather than occupying a row for a reason that is not cosmetic: a row above the
 * viewer shrinks it the moment a session starts, but the snapshot behind the session was
 * captured a tick earlier at the taller size. The mismatched aspect ratio then letterboxes,
 * and those transparent bands encode black in the JPEG. Floating keeps the viewer one size.
 *
 * It cannot appear in a capture: `captureViewerSnapshot` reads the <canvas> element and
 * `stage.toDataURL()` reads the Konva stage. Neither sees sibling DOM.
 */
export default function AnnotationBanner({
  annotatingFileName,
  onDiscard,
  onApply,
}: {
  annotatingFileName: string | null;
  onDiscard: () => void;
  onApply: () => void;
}) {
  return (
    <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 select-none">
      <div className={BAR}>
        <span className="flex items-center gap-2 pl-[6px] pr-[10px] text-[14px] leading-none tracking-heading text-stiko-secondary">
          <span className="inline-block h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-stiko-primary" />
          {annotatingFileName !== null ? (
            <span>
              Marking up <span className="font-semibold text-stiko-ink">{annotatingFileName}</span> — applying replaces the attachment
            </span>
          ) : (
            <span>Marking up — apply to attach it to your comment</span>
          )}
        </span>

        <div className="mr-[6px] h-[24px] w-px bg-stiko-divider" />

        <ActionButton label="Discard" tint={ACTION_TINTS.discard} onClick={onDiscard}>
          {CrossIcon}
        </ActionButton>
        <ActionButton label="Apply" tint={ACTION_TINTS.apply} onClick={onApply}>
          {TickIcon}
        </ActionButton>
      </div>
    </div>
  );
}
