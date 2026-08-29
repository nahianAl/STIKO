/**
 * Pure presentation logic for the version Brief.
 *
 * Deliberately free of database and React imports so scripts/tests can load it
 * directly — the same split that keeps lib/ai/staleness.ts out of lib/ai/facts.ts,
 * which throws on import when DATABASE_URL is unset.
 */

import type { VersionFacts } from './ai/types';

/**
 * How many comments a version needs before it gets a Brief at all.
 *
 * Below this the section does not render — no card, no dashed placeholder, no
 * header. A handful of comments summarises to less than it costs to read.
 *
 * This is also the auto-generate threshold. The two are one number on purpose:
 * generating below the show threshold would spend a model call on a brief no
 * one can ever open.
 */
export const BRIEF_MIN_COMMENTS = 5;

export function shouldShowBrief(commentCount: number): boolean {
  return commentCount >= BRIEF_MIN_COMMENTS;
}

/**
 * The one-line digest beside the label when the card is collapsed.
 *
 * The card defaults to collapsed, so this is the entire case for opening it.
 * "Brief / Show" on its own gives a reader no reason to.
 */
export function briefDigest(themes: { firstSeenVersionId: string | null }[]): string {
  const base = `${themes.length} theme${themes.length === 1 ? '' : 's'}`;
  const open = themes.filter((t) => t.firstSeenVersionId).length;
  return open > 0 ? `${base} · ${open} still open` : base;
}

export type ChipTone = 'neutral' | 'red' | 'green';

export interface StatChip {
  key: string;
  label: string;
  tone: ChipTone;
}

/**
 * The footer band. Counts only — the model is never asked for these.
 *
 * facts.mostAnnotatedFile is intentionally absent: it did not fit the chip row
 * and its placement is an open question with the design owner. Leaving it out
 * is the decision; do not invent a spot for it.
 */
export function statChips(facts: Omit<VersionFacts, 'mostAnnotatedFile'>): StatChip[] {
  const chips: StatChip[] = [
    {
      key: 'unanswered',
      label: `${facts.openThreadCount} unanswered`,
      tone: 'neutral',
    },
    {
      key: 'comments',
      label: `${facts.commentCount} comment${facts.commentCount === 1 ? '' : 's'}`,
      tone: 'neutral',
    },
    {
      key: 'people',
      // One author can hold every comment on a version, so this reaches 1.
      label: `${facts.participantCount} ${facts.participantCount === 1 ? 'person' : 'people'}`,
      tone: 'neutral',
    },
  ];

  if (facts.changesRequestedCount > 0) {
    chips.push({
      key: 'changes',
      label: `${facts.changesRequestedCount} change${
        facts.changesRequestedCount === 1 ? '' : 's'
      } requested`,
      tone: 'red',
    });
  }

  if (facts.approvedCount > 0) {
    chips.push({
      key: 'approved',
      label: `${facts.approvedCount} approved`,
      tone: 'green',
    });
  }

  return chips;
}

export function stalenessLine(newSinceBrief: number): string {
  return `${newSinceBrief} new comment${newSinceBrief === 1 ? '' : 's'} since this brief`;
}
