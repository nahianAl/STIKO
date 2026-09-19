/**
 * The list's column header. Its cell widths must match ProjectListRow's
 * exactly — they are a single visual grid split across two components, and
 * nothing enforces the match but this comment.
 */
export function ProjectListHeader() {
  return (
    <div className="box-border flex min-w-[760px] items-center gap-3 border-b border-stiko-divider bg-stiko-wash px-[14px] py-[9px] text-[10px] font-bold uppercase tracking-label text-stiko-faint">
      <span className="w-[13px] shrink-0" />
      <span style={{ flex: '1 1 340px', minWidth: 300 }}>Project</span>
      <span className="w-[84px] shrink-0 text-right">Packages</span>
      <span className="w-[200px] shrink-0 text-right">Open</span>
      <span className="w-[96px] shrink-0 text-right">People</span>
      {/* Matches ProjectListRow's trailing ⤢ (manage) cell — empty here the
          same way the chevron spacer above is, so the flex-grow Project
          column doesn't absorb its width and drag every column after it out
          of alignment with the row below. */}
      <span className="w-6 shrink-0" />
    </div>
  );
}
