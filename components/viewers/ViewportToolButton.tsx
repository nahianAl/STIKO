'use client';

/**
 * One free-standing tool button in the 3D viewport, with a hover label.
 *
 * Shared by every viewport tool so the three buttons are identical by construction rather
 * than by three copies of a className that drift apart. Deliberately mirrors the markup
 * toolbar's chip in components/markup/DrawingTools.tsx — same size, radius, tint and hover
 * lift — so the two sets of controls read as the same family.
 *
 * Two things differ from the toolbar's version, both because of where these sit:
 *  - each button carries its own white surface and shadow, since these float over the model
 *    rather than sitting in a shared bar;
 *  - the label hangs ABOVE, which is the only side with room at the bottom edge of the
 *    viewport.
 *
 * The scale is on the button and the label on the wrapper, so growing the chip on hover does
 * not drag the label with it.
 */
export default function ViewportToolButton({
  label,
  active,
  onClick,
  disabled = false,
  title,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** Hover text when the button is unavailable, explaining why. */
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative flex">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        aria-disabled={disabled}
        disabled={disabled}
        onClick={onClick}
        className={`relative flex h-[34px] w-[34px] items-center justify-center rounded-[11px] border shadow-stiko-panel transition-all duration-150 ${
          disabled
            ? 'cursor-not-allowed border-stiko-border bg-white text-stiko-ghost'
            : active
              ? 'border-stiko-primary-light bg-stiko-tint text-stiko-primary hover:scale-[1.12] hover:z-10 hover:shadow-[0_5px_12px_-3px_rgba(28,32,48,0.22)]'
              : 'border-stiko-border bg-white text-stiko-secondary hover:scale-[1.12] hover:z-10 hover:shadow-[0_5px_12px_-3px_rgba(28,32,48,0.22)] hover:bg-[#F8EDFC] hover:border-stiko-border-strong'
        }`}
      >
        {children}
      </button>

      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-[9px] -translate-x-1/2 whitespace-nowrap rounded-[7px] bg-stiko-ink px-2 py-[3px] text-[11px] font-medium leading-none tracking-heading text-white opacity-0 shadow-stiko-sheet transition-opacity duration-100 group-hover:opacity-100">
        {disabled && title ? title : label}
      </span>
    </div>
  );
}
