import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundsForUrl } from '../../lib/modelMeasurement.ts';

// Stands in for the viewer's ModelBounds. Nothing here reads inside it — the whole point of
// the helper is that it decides on the url alone and hands the value through untouched.
const BOUNDS = { radius: 7 };
const OTHER_BOUNDS = { radius: 1000 };

test('bounds measured from the current model are returned', () => {
  assert.equal(boundsForUrl({ url: 'a.glb', bounds: BOUNDS }, 'a.glb'), BOUNDS);
});

test('bounds measured from a DIFFERENT model are not returned', () => {
  // The failure this guards against is silent and permanent: the viewer sizes its dolly
  // range, clipping planes, ground disc and axes from whatever comes back here, so a
  // measurement that leaks across a model switch shows up as the previous model's scale
  // with nothing on screen to explain it.
  assert.equal(boundsForUrl({ url: 'a.glb', bounds: OTHER_BOUNDS }, 'b.glb'), null);
});

test('no measurement yet is null, not undefined', () => {
  // The viewer renders `bounds && <FitCameraToModel .../>` — a bare undefined would render as
  // nothing, but the prop types say null and a mismatch here would only surface in TS.
  assert.equal(boundsForUrl(null, 'a.glb'), null);
});

test('urls differing only in query string are different models', () => {
  // Presigned urls carry a signature and an expiry, so the same file can be handed to the
  // viewer under two different urls. Matching is exact: a re-signed url re-measures rather
  // than reusing bounds it cannot prove belong to the geometry now in the scene.
  const measured = { url: 'a.glb?sig=1', bounds: BOUNDS };
  assert.equal(boundsForUrl(measured, 'a.glb?sig=2'), null);
  assert.equal(boundsForUrl(measured, 'a.glb'), null);
});

test('repeated reads return the same object, so effect dependencies do not churn', () => {
  // FitCameraToModel re-frames the camera whenever its `bounds` dependency changes identity.
  // If this returned a fresh object per call it would refit on every render of the viewer and
  // throw away the user's zoom and pan each time.
  const measured = { url: 'a.glb', bounds: BOUNDS };
  assert.equal(boundsForUrl(measured, 'a.glb'), boundsForUrl(measured, 'a.glb'));
});
