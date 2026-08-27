/**
 * Which model a measurement belongs to.
 *
 * The 3D viewer measures a model's bounding sphere from inside the <Canvas>, and every piece
 * of scene sizing downstream — the dolly range, the near/far planes, the ground disc, the
 * axis lengths, the cross-section box — is derived from that one measurement. So a
 * measurement left over from the model before it is not merely stale, it is wrong in a way
 * that shows: the wrong scale, on screen, with no error anywhere.
 *
 * The obvious way to handle that is to clear the stored bounds whenever the url changes.
 * The viewer did exactly that and it was a bug: the clear and the measurement are written by
 * two different React roots — the component tree in the DOM and React Three Fiber's own
 * reconciler inside the <Canvas> — and React guarantees no ordering between the passive
 * effects of two independently scheduled roots. Lose that race and the clear lands on top of
 * a fresh measurement, permanently, because the measuring component only re-runs when the url
 * changes and it already has.
 *
 * Pairing the measurement with its url removes the race instead of narrowing it: there is one
 * writer, the answer to "does this belong to the model on screen?" is a comparison rather than
 * an effect, and a measurement for any other model is ignored by definition.
 *
 * Generic over the bounds type so this stays free of THREE and testable under node; the viewer
 * instantiates it with its own ModelBounds.
 */
export interface MeasuredModel<TBounds> {
  /** The url the bounds were measured from, captured at measurement time. */
  url: string;
  bounds: TBounds;
}

/**
 * The measured bounds, but only when they belong to `url` — otherwise null.
 *
 * Matching is exact string equality, which is the strict reading on purpose. Two urls for the
 * same underlying file (a re-signed download link, say) count as different models and force a
 * re-measure: measuring again costs one bounding-box pass, whereas treating two urls as
 * interchangeable when they are not would size the whole scene from the wrong geometry.
 *
 * Returns the stored object itself rather than a copy. Callers put the result in React effect
 * dependency arrays, so the identity has to stay stable for as long as the measurement does.
 */
export function boundsForUrl<TBounds>(
  measured: MeasuredModel<TBounds> | null,
  url: string,
): TBounds | null {
  return measured !== null && measured.url === url ? measured.bounds : null;
}
