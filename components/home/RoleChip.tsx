import { roleLabel } from '@/lib/roles';

/** Solid for owner, outlined for invited — solid pills are facts about YOU. */
export function RoleChip({
  ownedByMe,
  myRole,
}: {
  ownedByMe: boolean;
  myRole: string | null;
}) {
  if (ownedByMe) {
    return (
      <span
        className="shrink-0 whitespace-nowrap rounded-pill border-[1.5px] border-transparent bg-note-purple px-2 py-[3px] text-[9.5px] font-extrabold uppercase text-note-purple-text"
        style={{ letterSpacing: '0.04em' }}
      >
        Owner
      </span>
    );
  }

  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-pill border-[1.5px] border-stiko-chip-grey bg-white px-2 py-[3px] text-[9.5px] font-extrabold uppercase text-stiko-muted"
      style={{ letterSpacing: '0.04em' }}
    >
      {myRole ? `Invited · ${roleLabel(myRole)}` : 'Invited'}
    </span>
  );
}
