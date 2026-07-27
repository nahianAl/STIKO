/**
 * Version status — stiko_handoff/01.
 *
 * Status is DERIVED from reviewer verdicts, never set. Nobody flips a global
 * switch. That is what makes "Needs you" trustworthy, gives "3 of 4 approved"
 * for free, and keeps status a record of what people actually said rather than
 * an opinion someone typed.
 */

export type VersionStatus =
  | 'draft'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'no_files';

export type Verdict = 'approved' | 'changes_requested';

export interface StatusChipSpec {
  label: string;
  /** Border colour — status chips are outlined, never solid. */
  border: string;
  fg: string;
}

/** 02: objective status is an OUTLINED chip. Personal attention is a SOLID
 *  pastel pill. The two must never look alike (01). */
export const STATUS_CHIP: Record<VersionStatus, StatusChipSpec> = {
  draft: { label: 'DRAFT', border: '#DDDFE8', fg: '#8A90A6' },
  in_review: { label: 'IN REVIEW', border: '#EAD68A', fg: '#7A5E00' },
  changes_requested: {
    label: 'CHANGES REQUESTED',
    border: '#F6B8C2',
    fg: '#B23A52',
  },
  approved: { label: 'APPROVED', border: '#B9DC96', fg: '#4B7A28' },
  no_files: { label: 'NO FILES YET', border: '#DDDFE8', fg: '#8A90A6' },
};

/** The 3px left border keyed to status, used on package rows (2g) . */
export const STATUS_ACCENT: Record<VersionStatus, string> = {
  draft: '#E4E5EC',
  in_review: '#FFCF2E',
  changes_requested: '#FF6B6B',
  approved: '#7BC24A',
  no_files: '#E4E5EC',
};

export interface DeriveStatusInput {
  /** Null when the package has never had a version published. */
  hasVersion: boolean;
  /** False while the version is still being assembled. */
  isPublished: boolean;
  /** One entry per reviewer who has recorded a verdict. */
  verdicts: Verdict[];
  /** How many reviewers are expected to weigh in. */
  requiredReviewers: number;
}

/**
 * Compute a version's status.
 *
 * Order matters: a single "changes requested" outranks any number of approvals,
 * because the work demonstrably needs another pass. Approval requires ALL
 * required reviewers, not a majority — a drawing set is not a vote.
 */
export function deriveStatus(input: DeriveStatusInput): VersionStatus {
  if (!input.hasVersion) return 'no_files';
  if (!input.isPublished) return 'draft';

  if (input.verdicts.some((v) => v === 'changes_requested')) {
    return 'changes_requested';
  }

  const approvals = input.verdicts.filter((v) => v === 'approved').length;
  if (input.requiredReviewers > 0 && approvals >= input.requiredReviewers) {
    return 'approved';
  }

  return 'in_review';
}

/** "3 of 4 approved" — free once status is derived. */
export function approvalSummary(
  verdicts: Verdict[],
  requiredReviewers: number
): string {
  const approvals = verdicts.filter((v) => v === 'approved').length;
  return `${approvals} of ${requiredReviewers} approved`;
}

/**
 * Personal attention pill (02) — a fact about *you*, so it is computed per
 * viewer and rendered as a SOLID pastel pill.
 *
 * The zero-state word is "Up to date" everywhere. No synonyms: not "all clear",
 * not "clear", not "done", not "nothing new" (01).
 */
export interface AttentionInput {
  mentions: number;
  needsYou: number;
  hasUnseenVersion: boolean;
}

export interface AttentionPill {
  label: string;
  bg: string;
  fg: string;
}

export function deriveAttention(input: AttentionInput): AttentionPill {
  if (input.mentions > 0) {
    return {
      label: input.mentions === 1 ? '1 MENTION' : `${input.mentions} MENTIONS`,
      bg: '#FFE2E2',
      fg: '#B23A52',
    };
  }
  if (input.needsYou > 0) {
    return { label: `${input.needsYou} NEED YOU`, bg: '#FFE2E2', fg: '#B23A52' };
  }
  if (input.hasUnseenVersion) {
    return { label: 'NEW VERSION', bg: '#FFFCCE', fg: '#7A5E00' };
  }
  return { label: 'UP TO DATE', bg: '#EFEFF4', fg: '#8A90A6' };
}
