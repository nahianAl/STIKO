'use client';

import { useRouter } from 'next/navigation';
import {
  AttentionPill,
  AvatarStack,
  StatusChip,
} from '@/components/ui/Primitives';
import { STATUS_ACCENT } from '@/lib/status';
import {
  openCommentsLabel,
  packageAttention,
  packageCountLabel,
  packageMeta,
  projectAttention,
  type ProjectGroup,
} from '@/lib/home';
// Type-only: lib/queries.ts imports lib/db, which throws at module load
// without DATABASE_URL. A type-only import is erased.
import type { PackageCard } from '@/lib/queries';

/**
 * The selected project's packages.
 *
 * From lg up it is the dashboard's right-hand column: the wrapper animates
 * `width` 0 ↔ --stiko-packages-w while the section inside holds the full open
 * width, so the list never reflows mid-slide. Below lg there is no room for a
 * third column and a block stacked under a long grid would open where nobody
 * can see it, so the same element is a fixed overlay that slides in from the
 * right instead. One transition list serves both: at lg the transform is pinned
 * to none, and below lg the width is pinned, so each breakpoint only ever
 * animates the property that means something there.
 *
 * `group` is the LAST selected project, not the current one. The panel must
 * keep rendering the outgoing project for the whole close, or it visibly
 * empties on the way out — the same reason ProjectSummaryPanel takes lastId.
 */
export default function PackagesPanel({
  group,
  open,
  onClose,
  onOpenPeople,
}: {
  group: ProjectGroup | null;
  open: boolean;
  /** Deselects the project, which is what closes this panel. */
  onClose: () => void;
  onOpenPeople: (id: string) => void;
}) {
  return (
    <div
      // Clicks inside must not reach the page root's deselect handler.
      onClick={(e) => e.stopPropagation()}
      // No aria-hidden: the delayed `visibility: hidden` below already takes
      // the closed panel out of the accessibility tree and the tab order.
      // aria-hidden would flip at the START of the close, while the panel is
      // still visible and its own Close button still holds focus.
      className={`stiko-motion fixed inset-y-3 right-3 z-40 w-[min(372px,calc(100vw_-_24px))] lg:static lg:z-auto lg:h-full lg:shrink-0 lg:translate-x-0 lg:overflow-hidden ${
        open
          ? 'translate-x-0 opacity-100 lg:w-[var(--stiko-packages-w)]'
          : 'translate-x-[calc(100%_+_12px)] opacity-0 lg:w-0'
      }`}
      style={{
        transitionProperty: 'width, opacity, transform, visibility',
        // visibility is a 0s step, delayed to the end of the close — see the
        // note in ActivityRail. A shared 520ms would keep it focusable twice
        // as long as it is visible.
        transitionDuration: '520ms, 380ms, 520ms, 0s',
        transitionTimingFunction: 'cubic-bezier(.32,.72,0,1)',
        visibility: open ? 'visible' : 'hidden',
        transitionDelay: open ? '0s' : '0s, 0s, 0s, 520ms',
      }}
    >
      <section
        aria-label={group ? `Packages in ${group.project.name}` : 'Packages'}
        className="flex h-full w-full flex-col overflow-hidden rounded-panel bg-white shadow-stiko-drawer lg:w-[var(--stiko-packages-w)] lg:shadow-stiko-panel"
      >
        {group && (
          <PanelContents
            group={group}
            onClose={onClose}
            onOpenPeople={onOpenPeople}
          />
        )}
      </section>
    </div>
  );
}

function PanelContents({
  group,
  onClose,
  onOpenPeople,
}: {
  group: ProjectGroup;
  onClose: () => void;
  onOpenPeople: (id: string) => void;
}) {
  const router = useRouter();
  const { project, packages, openComments, people } = group;
  const attention = projectAttention(packages);

  // `myRole === 'coordinator'` is safe as a permission signal because
  // participants.role is CHECK-constrained to viewer|commenter|uploader, so
  // coordinator can only have come from a project_members row.
  const canManage = project.ownedByMe || project.myRole === 'coordinator';

  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-[10px] border-b border-stiko-border px-4 py-[14px]">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-extrabold tracking-heading text-stiko-ink">
            {project.name}
          </h2>
          <div className="mt-1 flex items-center gap-2">
            <span
              className="whitespace-nowrap text-[11.5px] font-bold"
              style={{ color: openComments > 0 ? '#B23A52' : '#8A90A6' }}
            >
              {openCommentsLabel(openComments)}
            </span>
            {attention && (
              <AttentionPill
                label={attention.label}
                bg={attention.bg}
                fg={attention.fg}
              />
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close packages"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-stiko-app text-stiko-muted transition duration-150 hover:bg-stiko-idle hover:text-stiko-ink"
        >
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-[10px] px-4 pb-1 pt-3">
        <span className="text-[10px] font-bold uppercase tracking-label text-stiko-faint">
          Packages
        </span>
        {people.length > 0 && (
          <button
            type="button"
            title="People on this project"
            onClick={() => onOpenPeople(project.id)}
            className="flex rounded-pill focus:outline-none focus-visible:shadow-stiko-focus"
          >
            <AvatarStack people={people} size={26} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
        <div className="flex flex-col gap-2">
          {packages.map((pkg) => (
            <PackageItem key={pkg.id} pkg={pkg} />
          ))}

          {packages.length === 0 && (
            <p className="px-1 py-2 text-[11.5px] text-stiko-muted">
              No packages in this project yet.
            </p>
          )}

          {canManage && (
            <button
              type="button"
              onClick={() => router.push(`/new?project=${project.id}`)}
              className="flex w-full items-center justify-center gap-[6px] rounded-[10px] border-[1.5px] border-dashed border-stiko-border-strong bg-transparent p-[11px] text-[11.5px] font-bold text-stiko-muted transition-[border-color,color] duration-150 hover:border-stiko-primary hover:text-stiko-primary"
            >
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.8}
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add a package
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** One package: name and status, then meta, attention and count. */
function PackageItem({ pkg }: { pkg: PackageCard }) {
  const router = useRouter();
  const attention = packageAttention(pkg);

  return (
    <button
      type="button"
      onClick={() => router.push(`/portal/${pkg.id}`)}
      className="flex flex-col rounded-inset border border-stiko-border bg-white px-3 py-[11px] text-left shadow-stiko-panel transition-shadow duration-150 hover:shadow-stiko-lift"
      // The left edge is the package's status accent — declared after the
      // uniform border so it wins on that one side.
      style={{ borderLeft: `3px solid ${STATUS_ACCENT[pkg.status]}` }}
    >
      <span className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-stiko-ink">
          {pkg.name}
        </span>
        {/* No version means no status to state yet. */}
        {pkg.versionNumber != null && (
          <span className="shrink-0">
            <StatusChip status={pkg.status} />
          </span>
        )}
      </span>

      <span className="flex w-full items-center gap-2 pt-[6px]">
        <span className="min-w-0 flex-1 truncate text-[11px] text-stiko-muted">
          {packageMeta(pkg)}
        </span>
        {attention && (
          <span className="shrink-0">
            <AttentionPill
              label={attention.label}
              bg={attention.bg}
              fg={attention.fg}
            />
          </span>
        )}
        <span
          className="shrink-0 text-[11px] font-extrabold"
          style={{ color: pkg.openComments > 0 ? '#B23A52' : '#8A90A6' }}
        >
          {packageCountLabel(pkg)}
        </span>
      </span>
    </button>
  );
}
