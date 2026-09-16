'use client';

/**
 * The header bell. It no longer opens a tray — it shows and hides the activity
 * rail, which is the same information without a second surface to maintain.
 *
 * The unread dot appears ONLY while the rail is hidden: with the rail open the
 * feed itself is the indicator, and a dot over a visible list of unread items
 * is noise.
 */
export default function RailToggle({
  open,
  hasUnread,
  onToggle,
}: {
  open: boolean;
  hasUnread: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={open ? 'Hide activity' : 'Show activity'}
      aria-pressed={open}
      className={`relative flex h-9 w-9 items-center justify-center rounded-[10px] transition duration-150 ${
        open
          ? 'bg-stiko-tint text-stiko-primary'
          : 'text-stiko-muted hover:bg-stiko-app hover:text-stiko-ink'
      }`}
    >
      <svg
        className="h-[17px] w-[17px]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
      </svg>
      {!open && hasUnread && (
        <span className="absolute right-[7px] top-[7px] h-[7px] w-[7px] rounded-full bg-note-red-accent ring-2 ring-white" />
      )}
    </button>
  );
}
