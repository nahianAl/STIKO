import type { Comment } from './types';

type Positioned = Pick<Comment, 'xPosition' | 'yPosition' | 'worldX' | 'worldY' | 'worldZ'>;

/** A comment "has a tag" if it carries a viewport position (2D percent, or 3D world coords). */
export function hasTag(c: Positioned): boolean {
  return (
    (c.xPosition !== null && c.yPosition !== null) ||
    (c.worldX !== null && c.worldY !== null && c.worldZ !== null)
  );
}

/**
 * Assign file-wide tag numbers (1, 2, 3, …) to tagged comments in the order given.
 * The comments API returns rows sorted by created_at ASC, so numbering is stable and
 * matches across the viewport pins and the comment list. Returns a map of comment id → number.
 */
export function buildTagNumbers(comments: Comment[]): Map<string, number> {
  const map = new Map<string, number>();
  let n = 0;
  for (const c of comments) {
    if (hasTag(c)) map.set(c.id, ++n);
  }
  return map;
}
