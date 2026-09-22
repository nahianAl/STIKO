/**
 * The maths behind the card grid's glide (components/home/useGridGlide.ts).
 *
 * The grid is `repeat(auto-fill, minmax(min(220px, 100%), 1fr))`, so while a
 * side panel animates its width the cards do two different things:
 *
 * - Between column-count changes they DRIFT: every track narrows or widens a
 *   little each frame and the cards follow. That is the layout animating, it
 *   is already smooth, and it must be left alone.
 * - When the column count changes, or the grid itself moves — e.g. the header
 *   above it re-wraps as the column narrows and pushes the whole grid down a
 *   row — cards JUMP: a card changes row, column, or just vertical position
 *   between one frame and the next. That movement has no frames of its own,
 *   so it is the only one that gets a glide.
 *
 * The trigger is discrete (a column-count change or a grid move), not a
 * distance threshold. A card that stays in column 1 across a 4→3 change still
 * moves by the change in track width (≈80px at 1440px), and one fast frame of
 * drift can move a far-right card nearly as far. No single distance separates
 * the two; the discrete trigger does.
 */

export interface GlidePoint {
  x: number;
  y: number;
}

export interface Glide {
  key: string;
  /** Where the card starts, relative to its new layout position. */
  dx: number;
  dy: number;
}

/**
 * Tracks in a resolved `grid-template-columns` value, as getComputedStyle
 * reports it: "300px 300px 300px" → 3. With auto-fill, empty tracks are still
 * listed, so this is the grid's column count however few cards it holds.
 */
export function columnCount(template: string): number {
  const value = template.trim();
  if (value === '' || value === 'none') return 0;
  return value.split(/\s+/).length;
}

/**
 * Which cards glide, and from how far.
 *
 * `prev` and `next` are LAYOUT positions in the grid's offsetParent's
 * coordinates — the grid's own offset plus the card's offset within the grid
 * (offsetLeft/offsetTop), which ignore transforms, so an unfinished glide
 * never pollutes them. `inFlight` is the translate a card is showing right
 * now from a glide that has not finished; adding it means a card caught by a
 * second jump starts from where it visibly IS rather than snapping to where
 * its layout was.
 *
 * Only cards whose LAYOUT moved glide. A mid-glide card whose cell did not
 * change keeps its current animation rather than restarting it.
 */
export function planGlides(
  prev: ReadonlyMap<string, GlidePoint>,
  next: ReadonlyMap<string, GlidePoint>,
  jumped: boolean,
  inFlight: ReadonlyMap<string, GlidePoint> = new Map()
): Glide[] {
  if (!jumped) return [];

  const glides: Glide[] = [];
  next.forEach((to, key) => {
    const from = prev.get(key);
    if (!from) return;

    const layoutDx = from.x - to.x;
    const layoutDy = from.y - to.y;
    if (Math.abs(layoutDx) < 1 && Math.abs(layoutDy) < 1) return;

    const offset = inFlight.get(key) ?? { x: 0, y: 0 };
    glides.push({ key, dx: layoutDx + offset.x, dy: layoutDy + offset.y });
  });
  return glides;
}
