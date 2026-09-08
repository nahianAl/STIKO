// scripts/tests/viewerUrl.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

// lib/s3.ts throws at import time without these, so they must be set before the
// dynamic import below. The values are never used to talk to R2 — SigV4 signing is
// pure arithmetic over whatever credentials it is handed.
process.env.R2_ACCESS_KEY_ID = 'AKIAFAKEFAKEFAKE';
process.env.R2_SECRET_ACCESS_KEY = 'fakefakefakefakefakefakefake';
process.env.R2_ENDPOINT_URL = 'https://fake.r2.cloudflarestorage.com';
process.env.R2_BUCKET_NAME = 'stiko-uploads-test';

const { getViewerPresignedUrl } = await import('../../lib/s3.ts');
const { URL_WINDOW_MS } = await import('../../lib/urlWindow.ts');

const KEY = 'uploads/p/po/v/abc-123.glb';
const ALIGNED = Math.floor(1757318400000 / URL_WINDOW_MS) * URL_WINDOW_MS;

test('the same key yields a byte-identical URL across a whole window', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: ALIGNED });
  const atStart = await getViewerPresignedUrl(KEY);
  t.mock.timers.setTime(ALIGNED + URL_WINDOW_MS - 1000);
  const atEnd = await getViewerPresignedUrl(KEY);
  assert.equal(atStart, atEnd);
});

test('the URL changes in the next window', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: ALIGNED });
  const thisWindow = await getViewerPresignedUrl(KEY);
  t.mock.timers.setTime(ALIGNED + URL_WINDOW_MS + 1000);
  const nextWindow = await getViewerPresignedUrl(KEY);
  assert.notEqual(thisWindow, nextWindow);
});

test('different keys yield different URLs in the same window', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: ALIGNED });
  const a = await getViewerPresignedUrl(KEY);
  const b = await getViewerPresignedUrl('uploads/p/po/v/def-456.glb');
  assert.notEqual(a, b);
});

test('a URL minted at the very end of a window still outlives the window', async (t) => {
  // The failure this guards against: sign at the window start, hand the URL out 59
  // minutes later, and it 403s in the user's face while it is still being served.
  t.mock.timers.enable({ apis: ['Date'], now: ALIGNED + URL_WINDOW_MS - 1000 });
  const url = new URL(await getViewerPresignedUrl(KEY));
  const signedAt = url.searchParams.get('X-Amz-Date');
  const expiresIn = Number(url.searchParams.get('X-Amz-Expires'));

  // X-Amz-Date is ISO8601 basic: 20260908T070000Z
  const m = signedAt.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const signedMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const remaining = signedMs + expiresIn * 1000 - Date.now();
  assert.ok(
    remaining >= URL_WINDOW_MS,
    `only ${remaining}ms of life left, expected at least ${URL_WINDOW_MS}ms`
  );
});

test('the URL carries the cache-control override', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: ALIGNED });
  const url = new URL(await getViewerPresignedUrl(KEY));
  assert.equal(
    url.searchParams.get('response-cache-control'),
    'private, max-age=3600, immutable'
  );
});
