import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// middleware.ts imports next/server and the auth stack, so it cannot be imported under
// node --test. The matcher is a plain string literal; read it out of the source and apply it
// the way Next does: the pattern must match the WHOLE pathname for middleware to run.
const source = readFileSync('middleware.ts', 'utf8');
const pattern = source.match(/matcher:\s*\['([^']+)'\]/)[1];
const runsMiddleware = (pathname) => new RegExp(`^${pattern}$`).test(pathname);

test('the WASM assets the viewer workers fetch skip auth', () => {
  for (const p of ['/occt-import-js.wasm', '/rhino3dm/rhino3dm.js', '/rhino3dm/rhino3dm.wasm']) {
    assert.equal(runsMiddleware(p), false, p);
  }
});

test('ordinary pages and API routes still run middleware', () => {
  for (const p of ['/', '/portal/abc', '/api/files/url', '/api/uploads/rejected']) {
    assert.equal(runsMiddleware(p), true, p);
  }
});
