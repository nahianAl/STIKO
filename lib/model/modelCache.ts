/**
 * A bounded LRU over the models useLoader has parsed.
 *
 * Why this exists at all: useLoader caches parsed models through suspend-react with
 * NO lifespan, and this repo never called useLoader.clear() — see the note in
 * lib/model/partTree.ts. Combined with a presigned URL that changed on every call,
 * that produced the worst of both worlds: a cache that never hit, and never freed.
 * Every model opened stayed fully resident — geometries, materials, textures, GPU
 * buffers — for the life of the tab.
 *
 * Task 3 made the cache hit. This makes it bounded. Doing only the first would turn
 * a leak bounded by "files opened" into an unbounded one.
 */

/** Retained source bytes above which the coldest models are dropped. */
export const BUDGET_BYTES = 300 * 1024 * 1024;

/**
 * Never retain fewer than this, whatever the budget says. Two is the floor because
 * A -> B -> A is the exact journey this whole change exists to make instant.
 */
export const MIN_RETAINED = 2;

export interface CacheEntry {
  url: string;
  bytes: number;
  lastUsed: number;
}

/**
 * Decide which entries to evict, most-recently-used first.
 *
 * Eviction is strictly ordered: once the running total exceeds the budget, every
 * colder entry goes too. The alternative — keep any entry that still happens to fit —
 * makes survival depend on file size rather than recency, so a small model opened
 * once long ago outlives a large one opened moments before.
 */
export function selectEvictions(
  entries: CacheEntry[],
  activeUrl: string,
  budgetBytes: number = BUDGET_BYTES,
  minRetained: number = MIN_RETAINED
): string[] {
  const ordered = [...entries].sort((a, b) => {
    // The active model sorts first unconditionally. It is normally the most recently
    // used anyway; pinning it here means a caller that registers out of order, or a
    // clock that has not advanced, still cannot destroy what is on screen.
    if (a.url === activeUrl) return -1;
    if (b.url === activeUrl) return 1;
    return b.lastUsed - a.lastUsed;
  });

  const evict: string[] = [];
  let retained = 0;
  let overBudget = false;

  ordered.forEach((entry, index) => {
    if (index < minRetained) {
      retained += entry.bytes;
      return;
    }
    if (overBudget || retained + entry.bytes > budgetBytes) {
      overBudget = true;
      evict.push(entry.url);
      return;
    }
    retained += entry.bytes;
  });

  return evict;
}
