import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, proxyRequestHeaders, proxyResponseHeaders, upstreamSearch, upstreamUrl } from '../../lib/analytics/ingestProxy.ts';

// ---- where a request goes ----

test('events, flags and replay go to the ingest host, trailing slash and query kept', () => {
  assert.equal(upstreamUrl('/ingest/e/', '?ip=0&_=1&ver=1.450.0&compression=gzip-js'), 'https://us.i.posthog.com/e/?ip=0&_=1&ver=1.450.0&compression=gzip-js');
  assert.equal(upstreamUrl('/ingest/flags/', '?v=2'), 'https://us.i.posthog.com/flags/?v=2');
  assert.equal(upstreamUrl('/ingest/s/', ''), 'https://us.i.posthog.com/s/');
  assert.equal(upstreamUrl('/ingest/i/v0/e/', ''), 'https://us.i.posthog.com/i/v0/e/');
});

test('static and array go to the assets host', () => {
  assert.equal(upstreamUrl('/ingest/static/1.450.0/recorder.js', '?v=1'), 'https://us-assets.i.posthog.com/static/1.450.0/recorder.js?v=1');
  assert.equal(upstreamUrl('/ingest/array/phc_x/config', ''), 'https://us-assets.i.posthog.com/array/phc_x/config');
  assert.equal(upstreamUrl('/ingest/array/phc_x/config.js', ''), 'https://us-assets.i.posthog.com/array/phc_x/config.js');
  assert.equal(upstreamUrl('/ingest/static', ''), 'https://us-assets.i.posthog.com/static');
  // Not a prefix match on the word.
  assert.equal(upstreamUrl('/ingest/statics/x', ''), 'https://us.i.posthog.com/statics/x');
});

test('a crafted path cannot change the upstream host', () => {
  for (const p of ['/ingest//evil.example/x', '/ingest/@evil.example/x', '/ingest/static//evil.example/x']) {
    const url = new URL(upstreamUrl(p, ''));
    assert.ok(url.host === 'us.i.posthog.com' || url.host === 'us-assets.i.posthog.com', `${p} -> ${url.host}`);
  }
});

test('anything outside /ingest is not proxied', () => {
  assert.equal(upstreamUrl('/ingestx/e/', ''), null);
  assert.equal(upstreamUrl('/api/me', ''), null);
  assert.equal(upstreamUrl('/ingest', ''), 'https://us.i.posthog.com/');
});

test("Next's injected catch-all param is removed from the query; the rest is kept verbatim", () => {
  assert.equal(upstreamSearch('?ip=0&_=1&ver=1.450.0&path=e'), '?ip=0&_=1&ver=1.450.0');
  assert.equal(upstreamSearch('?v=1&path=static&path=1.450.0&path=recorder.js'), '?v=1');
  assert.equal(upstreamSearch('?path=e'), '');
  assert.equal(upstreamSearch(''), '');
  assert.equal(upstreamSearch('?a=%2F%20b&compression=gzip-js'), '?a=%2F%20b&compression=gzip-js');
  assert.equal(upstreamSearch('?pathx=1&xpath=2'), '?pathx=1&xpath=2');
});

// ---- what goes with it ----

test('cookies, authorization and the referer are never forwarded', () => {
  const incoming = new Headers({
    cookie: 'wos-session=SECRET; authjs.session-token=SECRET2; ph_phc_x_posthog=%7B%7D',
    authorization: 'Bearer SECRET3',
    referer: 'https://app.stiko.design/reset-password/abc123',
    'x-forwarded-host': 'app.stiko.design',
    'x-middleware-subrequest': 'middleware',
    'x-vercel-id': 'iad1::abc',
    'accept-encoding': 'gzip, br',
    'content-type': 'text/plain',
    'content-encoding': 'gzip',
    'user-agent': 'Mozilla/5.0',
    accept: '*/*',
    origin: 'https://www.stiko.design',
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type',
  });
  const out = proxyRequestHeaders(incoming, '203.0.113.7');
  assert.deepEqual(Object.fromEntries(out.entries()), {
    accept: '*/*',
    'access-control-request-headers': 'content-type',
    'access-control-request-method': 'POST',
    'content-encoding': 'gzip',
    'content-type': 'text/plain',
    origin: 'https://www.stiko.design',
    'user-agent': 'Mozilla/5.0',
    'x-forwarded-for': '203.0.113.7',
  });
});

test('no client IP, no x-forwarded-for', () => {
  const out = proxyRequestHeaders(new Headers({ 'x-forwarded-for': '1.2.3.4' }), null);
  assert.equal(out.get('x-forwarded-for'), null);
});

test('the client IP comes from the platform first, then x-real-ip, then the first x-forwarded-for hop', () => {
  assert.equal(clientIp(new Headers({ 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '1.1.1.1' }), '203.0.113.7'), '203.0.113.7');
  assert.equal(clientIp(new Headers({ 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '1.1.1.1' }), undefined), '198.51.100.2');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': ' 192.0.2.9 , 10.0.0.1' }), undefined), '192.0.2.9');
  assert.equal(clientIp(new Headers(), undefined), null);
});

test('the response keeps its type, caching and CORS headers; loses cookies and transfer encoding', () => {
  const upstream = new Headers({
    'content-type': 'application/json',
    'content-encoding': 'gzip',
    'content-length': '123',
    'set-cookie': 'tracker=1; Domain=.posthog.com',
    'cache-control': 'public, max-age=300',
    etag: '"abc"',
    vary: 'Origin',
    'access-control-allow-origin': 'https://www.stiko.design',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'x-envoy-upstream-service-time': '3',
    server: 'envoy',
  });
  assert.deepEqual(Object.fromEntries(proxyResponseHeaders(upstream).entries()), {
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-origin': 'https://www.stiko.design',
    'access-control-max-age': '86400',
    'cache-control': 'public, max-age=300',
    'content-type': 'application/json',
    etag: '"abc"',
    vary: 'Origin',
  });
});
