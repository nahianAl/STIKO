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

/** A word the page explains with a "?" tooltip. */
export type Term = 'project' | 'package' | 'submission';

/**
 * What each Term means, in the words a first-time visitor needs. Kept true to
 * the product: a project groups packages, a package is what reviewers are
 * invited to, a submission is one numbered round of a package (S1, S2, ...).
 */
export const GLOSSARY: Record<Term, { title: string; body: string }> = {
  project: {
    title: 'Project',
    body: 'A job or client engagement. It holds the packages for that work and the team running it.',
  },
  package: {
    title: 'Package',
    body: 'A set of files you send out for review, like a drawing set, a model or a cut. Reviewers are invited to a package.',
  },
  submission: {
    title: 'Submission',
    body: 'One round of a package. Each time you publish updated files they become a new numbered submission (S1, S2, …) with its own comments and approval.',
  },
};

export interface PlanLimit {
  text: string;
  term?: Term;
}

export interface PlanCopy {
  tagline: string;
  /** The limits, which are what actually differ. */
  limits: PlanLimit[];
  /** What both plans share, said once per card. */
  shared: string[];
}

const SHARED = ['Unlimited reviewers and collaborators', 'Every review tool, nothing held back'];

export const FREE_COPY: PlanCopy = {
  tagline: 'For trying stiko on a real project.',
  limits: [
    { text: projectsLabel(free.maxProjects), term: 'project' },
    { text: packagesLabel(free.maxPackagesPerProject), term: 'package' },
    { text: `${formatBytes(free.storageBytes)} of storage` },
  ],
  shared: SHARED,
};

export const STANDARD_COPY: PlanCopy = {
  tagline: 'For teams with reviews on the go every week.',
  limits: [
    { text: projectsLabel(standard.maxProjects), term: 'project' },
    { text: packagesLabel(standard.maxPackagesPerProject), term: 'package' },
    { text: `${formatBytes(standard.storageBytes)} of storage — ${storageMultiple} Free` },
  ],
  shared: [...SHARED, 'Invoices, card changes and cancelling, self-serve'],
};

/** A comparison row: a label, and what each plan gets. `true` renders a check. */
export interface CompareRow {
  label: string;
  /** Adds a "?" tooltip explaining this word. */
  term?: Term;
  detail?: string;
  free: string | true;
  standard: string | true;
}

export const LIMIT_ROWS: CompareRow[] = [
  { label: 'Projects', term: 'project', free: String(free.maxProjects), standard: 'Unlimited' },
  {
    label: 'Packages per project',
    term: 'package',
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
  { label: 'Submissions and history', term: 'submission', detail: 'Every round kept, in order.', free: true, standard: true },
  { label: 'Approvals', free: true, standard: true },
  { label: 'Invite per submission, control downloads', free: true, standard: true },
  { label: 'AI briefs of each round of feedback', free: true, standard: true },
];

export interface FaqItem {
  q: string;
  a: string;
}

/** Plans and billing: only on this page. */
export const FAQ: FaqItem[] = [
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

/**
 * The marketing site's FAQ (www.stiko.design, home page), repeated here so the
 * two say the same thing. KEEP IN STEP with Webflow when either changes.
 *
 * One deliberate difference: the app says "submission" where the site says
 * "version" (S2, not V2), because that is the word used everywhere inside the
 * app, and scripts/tests/copyTerms.test.mjs enforces it. That includes the
 * site's "What does version control look like" question.
 */
export const SITE_FAQ: FaqItem[] = [
  {
    q: 'Can I upload all file types together in a single upload?',
    a: 'Yes. Drop 2D drawings, 3D models, PDFs and images into the same package in one go. Folders keep their structure, and the package is named from your files.',
  },
  {
    q: 'Is there a maximum file size limit?',
    a: "Large models and drawing sets upload straight to secure storage rather than through the app, so heavy CAD files don't need to be split, zipped or trimmed down first.",
  },
  {
    q: 'Can I share files with anyone?',
    a: 'Yes. Invite people by email, or send a share link. They land straight on the file in their browser, with no CAD software to install.',
  },
  {
    q: 'What capabilities does a recipient have when project files are shared with them?',
    a: 'It depends on the role you give them. A viewer can look at the files, a commenter can add markups and comments, and an uploader can submit files of their own. Downloading is granted per person.',
  },
  {
    q: 'What is the benefit of submitting project files in stiko instead of email?',
    a: 'Email scatters a review across attachments and threads. In stiko the files, the markups and the submission history live in one place, so nobody has to work out which attachment was current.',
  },
  {
    q: 'What does submission history look like in stiko?',
    a: 'Each publish becomes a numbered submission with its own changelog, files and comments. Submission numbers are never reused, so a reference to S2 always means the same set of drawings.',
  },
  {
    q: 'How does markup and commenting work in stiko?',
    a: "Click anywhere on a drawing or model and leave a comment pinned to that exact spot, with annotation tools for redlining. Replies thread under the pin, so the conversation stays attached to what it's about.",
  },
  {
    q: 'How secure is file sharing in stiko?',
    a: "Access is decided per person and per package: their role, whether they can download, and which submissions they're allowed to see. Anything outside that simply isn't there for them.",
  },
  {
    q: 'Does stiko keep track of who made changes or left feedback?',
    a: 'Yes. Every submission, file and comment carries who added it and when, so the record is already there when you need it for an audit or a handoff.',
  },
  {
    q: 'Do recipients need an account to access shared files?',
    a: "Viewers don't. A share link opens the package straight away. People who need to comment or upload sign in once from their invite, so their contributions are attributable.",
  },
];
