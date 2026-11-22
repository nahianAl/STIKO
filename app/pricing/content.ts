/**
 * The words on /pricing. Kept apart from the page so the copy can be read and
 * changed without wading through JSX.
 *
 * Accuracy rule: the ONLY things that differ between plans are the three limits
 * in lib/plans.ts (projects, packages per project, and storage). Every review feature is on every
 * plan — nothing in the product checks the plan for anything else. If a
 * feature is ever gated, the comparison table below must say so.
 */
import { PLANS } from '@/lib/plans';
import { formatBytes } from '@/lib/design';
import { TRASH_RETENTION_DAYS } from '@/lib/trash';

const free = PLANS.free;
const standard = PLANS.standard;

export const projectsLabel = (max: number | null) =>
  max === null ? 'Unlimited projects' : `${max} projects`;

export const packagesLabel = (max: number | null) =>
  max === null ? 'Unlimited packages in each' : `${max} packages per project`;

export const STANDARD_STORAGE = formatBytes(standard.storageBytes);

/** "50×" — how much more room Standard gives, derived so it can't drift. */
export const storageMultiple = `${Math.round(standard.storageBytes / free.storageBytes)}×`;

export interface PlanCopy {
  tagline: string;
  /** The limits, which are what actually differ. */
  limits: string[];
  /** What both plans share, said once per card. */
  shared: string[];
}

const SHARED = ['Unlimited reviewers and collaborators', 'Every review tool, nothing held back'];

export const FREE_COPY: PlanCopy = {
  tagline: 'For trying stiko on a real project.',
  limits: [
    projectsLabel(free.maxProjects),
    packagesLabel(free.maxPackagesPerProject),
    `${formatBytes(free.storageBytes)} of storage`,
  ],
  shared: SHARED,
};

export const STANDARD_COPY: PlanCopy = {
  tagline: 'For teams with reviews on the go every week.',
  limits: [
    projectsLabel(standard.maxProjects),
    packagesLabel(standard.maxPackagesPerProject),
    `${formatBytes(standard.storageBytes)} of storage — ${storageMultiple} Free`,
  ],
  shared: [...SHARED, 'Invoices, card changes and cancelling, self-serve'],
};

/** A comparison row: a label, and what each plan gets. `true` renders a check. */
export interface CompareRow {
  label: string;
  detail?: string;
  free: string | true;
  standard: string | true;
}

export const LIMIT_ROWS: CompareRow[] = [
  { label: 'Projects', free: String(free.maxProjects), standard: 'Unlimited' },
  {
    label: 'Packages per project',
    detail: "Packages in the trash don't count.",
    free: String(free.maxPackagesPerProject),
    standard: 'Unlimited',
  },
  {
    label: 'Storage',
    detail: `Files and comment attachments. Deleted packages and projects keep counting for ${TRASH_RETENTION_DAYS} days, while they can still be restored.`,
    free: formatBytes(free.storageBytes),
    standard: formatBytes(standard.storageBytes),
  },
  { label: 'Reviewers and collaborators', free: 'Unlimited', standard: 'Unlimited' },
];

export const FEATURE_ROWS: CompareRow[] = [
  {
    label: '3D models in the browser',
    detail: 'STEP, STL, FBX, OBJ, Rhino, IGES, GLB and more — with section planes and part colours.',
    free: true,
    standard: true,
  },
  { label: 'Drawings', detail: 'PDF, DWG and DXF.', free: true, standard: true },
  { label: 'Images and video', detail: 'Comments pinned to a frame and a time.', free: true, standard: true },
  { label: 'Pinned comments and @mentions', free: true, standard: true },
  { label: 'Markup', detail: 'Pens, shapes, arrows and text boxes.', free: true, standard: true },
  { label: 'Measure and calibrate', free: true, standard: true },
  { label: 'Submissions and history', detail: 'Every round kept, in order.', free: true, standard: true },
  { label: 'Approvals', free: true, standard: true },
  { label: 'Invite per submission, control downloads', free: true, standard: true },
  { label: 'AI briefs of each round of feedback', free: true, standard: true },
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'Do reviewers and collaborators need to pay?',
    a: 'No. Invite as many people as you like on either plan. Only the project owner needs a plan, and storage and projects count against the owner.',
  },
  {
    q: 'What counts toward storage?',
    a: `The files you upload and the attachments people add to comments. Deleting a file frees its space straight away. Deleted packages and projects go to the trash, where you can restore them for ${TRASH_RETENTION_DAYS} days — they keep counting until they're removed for good.`,
  },
  {
    q: 'What happens if I go over a Free limit?',
    a: "Nothing is deleted. Everyone can still view, comment and download. You just can't add projects or packages, or upload, until you're back under the limit or upgrade.",
  },
  {
    q: 'Can I switch between monthly and yearly, or cancel?',
    a: 'Yes, any time, from Plan & billing. Switching is prorated. If you cancel, you keep Standard until the end of the period you paid for.',
  },
  {
    q: 'How do payments work?',
    a: 'Payments are handled securely by Stripe. You can update your card and download every invoice from Plan & billing.',
  },
];
