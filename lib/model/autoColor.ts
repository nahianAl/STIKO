import type { PartNode } from './partTree.ts';

/**
 * Restraint, not decoration.
 *
 * A real CAD assembly is mostly one neutral material with a few accents — grey steel, brass
 * flanges, a copper stem. Dealing a distinct colour to every part turns a 3,000-part model
 * into noise and makes the viewer LESS legible, not more. So: the largest top-level assembly
 * keeps the base grey, at most four others take a muted accent, and everything else stays
 * grey.
 *
 * Deterministic, so every viewer computes the same result and nothing needs storing. A user's
 * explicit override simply displaces the result for that part.
 *
 * Relative import, not the '@/' alias: unit-tested by `node --test`, which does not resolve it.
 */

/** Matches DEFAULT_MATERIAL in components/viewers/ModelViewerInner.tsx. */
export const BASE_GREY = '#8899AA';

/**
 * Muted on purpose — these sit against BASE_GREY under a headlight, and saturated hues read
 * as a rendering fault rather than as a material. Brass, steel blue, copper, olive.
 */
export const ACCENTS = ['#C8A05A', '#5B7FA6', '#A8563F', '#6E8A6B'] as const;

export const MAX_AUTO_COLORED = ACCENTS.length;

/**
 * Ranked by triangle count rather than bounding volume deliberately: volume ranks a large
 * hollow shell above the dense mechanism inside it, which is the opposite of what a viewer
 * reads as "the main body".
 */
export function autoColors(parts: PartNode[], authored: boolean): Map<string, string> {
  const colors = new Map<string, string>();
  if (authored) return colors;
  // One assembly means nothing to differentiate FROM, so colour would only mislead.
  if (parts.length < 2) return colors;

  const ranked = [...parts].sort(
    (a, b) => b.triangles - a.triangles || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );

  ranked.slice(1, 1 + MAX_AUTO_COLORED).forEach((partNode, i) => {
    colors.set(partNode.key, ACCENTS[i]);
  });

  return colors;
}
