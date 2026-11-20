// lib/undo/checkpoint.ts
// Whether a quiet moment is an undo step. Pure, for node --test.
//
// The checkpointed stores (markup objects, measurements, plane flags) are never mutated in
// place — every update goes through map/filter/spread — so element identity is exact. But a
// filter that removed nothing, or a delete of a text box created empty a moment earlier, still
// returns a NEW container. Comparing containers by identity would record those as steps that
// change nothing, so containers compare one level deep.

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra);
  if (ka.length !== Object.keys(rb).length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(rb, k) || !Object.is(ra[k], rb[k])) return false;
  }
  return true;
}

/** The step a quiet moment records, or null when nothing really changed since the baseline. */
export function checkpointStep<T>(baseline: T, current: T): { before: T; after: T } | null {
  return shallowEqual(baseline, current) ? null : { before: baseline, after: current };
}
