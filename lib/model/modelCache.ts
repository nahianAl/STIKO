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

/** Minimal shape of what a loader hands back. Avoids importing three here. */
interface DisposableNode {
  geometry?: { dispose?: () => void };
  material?: unknown;
}

interface TraversableRoot {
  traverse?: (visit: (node: DisposableNode) => void) => void;
  dispose?: () => void;
}

/**
 * Release the GPU resources held by a loaded model.
 *
 * useLoader.clear() alone is not enough: it drops the suspend-react entry so the
 * JS objects can be collected, but geometries, materials and textures hold GPU
 * allocations that only dispose() frees.
 *
 * STL and PLY loaders return a bare BufferGeometry rather than an Object3D, which
 * has a dispose() but no traverse() — hence both branches.
 */
export function disposeTree(root: unknown): void {
  const node = root as TraversableRoot;
  if (typeof node?.traverse !== 'function') {
    node?.dispose?.();
    return;
  }
  node.traverse((child) => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      const m = material as Record<string, unknown> & { dispose?: () => void };
      // Textures are separate GPU allocations and are not freed by the material.
      for (const value of Object.values(m)) {
        const maybeTexture = value as { isTexture?: boolean; dispose?: () => void };
        if (maybeTexture?.isTexture) maybeTexture.dispose?.();
      }
      m.dispose?.();
    }
  });
}

export interface RegisterArgs {
  url: string;
  loader: unknown;
  root: unknown;
  bytes: number;
  /**
   * How to drop the entry from useLoader's cache. Injected rather than imported so
   * this module never pulls in @react-three/fiber, which keeps it importable — and
   * therefore testable — under plain `node --test`.
   */
  clearLoaderCache: (loader: unknown, url: string) => void;
}

interface Registered {
  loader: unknown;
  root: unknown;
  bytes: number;
  lastUsed: number;
}

const registry = new Map<string, Registered>();

/**
 * A monotonic counter, not a clock. Two models registered in the same millisecond
 * must still order deterministically, and Date.now() cannot promise that.
 */
let useCounter = 0;

/**
 * Record a freshly loaded model and evict whatever no longer fits.
 *
 * Safe to call on every render: re-registering a url refreshes its recency and
 * replaces nothing, so the model on screen is never disposed out from under itself.
 */
export function registerModel({ url, loader, root, bytes, clearLoaderCache }: RegisterArgs): void {
  registry.set(url, { loader, root, bytes, lastUsed: ++useCounter });

  const entries: CacheEntry[] = Array.from(registry.entries()).map(([entryUrl, entry]) => ({
    url: entryUrl,
    bytes: entry.bytes,
    lastUsed: entry.lastUsed,
  }));

  for (const victim of selectEvictions(entries, url)) {
    const entry = registry.get(victim);
    if (!entry) continue;
    // Order matters: dispose while we still hold the tree, then drop the cache entry.
    //
    // Disposing is only safe because the victim is never the active model, and
    // partTree's clones — which SHARE geometry with this root — die with the unmount
    // of the model that made them. A victim that was somehow still mounted would go
    // blank rather than error, which is why the active url is pinned in
    // selectEvictions rather than merely sorted to the front.
    disposeTree(entry.root);
    clearLoaderCache(entry.loader, victim);
    registry.delete(victim);
  }
}

/** Test seam. Module state would otherwise leak between test cases. */
export function resetModelCacheForTests(): void {
  registry.clear();
  useCounter = 0;
}
