import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseTouchCookie } from '../../lib/attribution.ts';

const SRC = readFileSync(new URL('../../public/stiko-tracking.js', import.meta.url), 'utf8');

// geo: an object is the /api/geo reply; null makes fetch reject; 'html' makes json() reject.
function run({
  href,
  cookies = {},
  geo = { consentRequired: false },
  referrer = '',
  readyState = 'complete',
  hasBody = true,
  blockCookies = false,
}) {
  const jar = { ...cookies };
  const events = [];
  const appended = [];
  const cookieWrites = [];
  const fetches = [];
  const listeners = {};
  let bodyPresent = hasBody;
  const document = {
    referrer,
    currentScript: { src: 'https://app.stiko.design/stiko-tracking.js' },
    get cookie() { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); },
    set cookie(str) {
      if (blockCookies) throw new Error('cookies blocked');
      cookieWrites.push(str);
      const [pair] = str.split(';');
      const i = pair.indexOf('=');
      jar[pair.slice(0, i)] = pair.slice(i + 1);
    },
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {} }),
    get body() { return bodyPresent ? { appendChild: (el) => appended.push(el) } : null; },
    readyState,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  };
  const window = {
    location: new URL(href),
    dispatchEvent: (e) => events.push(e.detail.state),
  };
  const ctx = {
    window, document, URL, URLSearchParams, JSON, Date, encodeURIComponent, decodeURIComponent,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    fetch: async (url, init) => {
      fetches.push({ url, init });
      if (geo === null) throw new Error('down');
      if (geo === 'html') return { ok: true, json: async () => { throw new SyntaxError('not json'); } };
      return { ok: true, json: async () => geo };
    },
  };
  vm.runInNewContext(SRC, ctx);
  return {
    jar,
    events,
    appended,
    cookieWrites,
    fetches,
    window,
    flush: () => new Promise((r) => setTimeout(r, 0)),
    // The browser finishing the parse: the body now exists and DOMContentLoaded fires.
    domReady: () => {
      bodyPresent = true;
      for (const fn of listeners.DOMContentLoaded || []) fn();
    },
  };
}

const decode = (v) => JSON.parse(decodeURIComponent(v));

test('outside consent countries, UTMs are written as first and last touch', async () => {
  const r = run({ href: 'https://www.stiko.design/?utm_source=Meta&utm_campaign=2026-11_meta_pd_trial&gclid=AbC' });
  await r.flush();
  assert.deepEqual(r.events, ['not_required']);
  const ft = decode(r.jar.stiko_ft);
  assert.equal(ft.utm_source, 'meta');
  assert.equal(ft.gclid, 'AbC');
  assert.equal(ft.landing_page, '/');
  assert.equal(decode(r.jar.stiko_lt).utm_campaign, '2026-11_meta_pd_trial');
});

test('first touch is never overwritten; last touch is', async () => {
  const first = encodeURIComponent(JSON.stringify({ utm_source: 'google' }));
  const r = run({ href: 'https://www.stiko.design/?utm_source=linkedin', cookies: { stiko_ft: first } });
  await r.flush();
  assert.equal(decode(r.jar.stiko_ft).utm_source, 'google');
  assert.equal(decode(r.jar.stiko_lt).utm_source, 'linkedin');
});

test('a visit without UTMs writes nothing', async () => {
  const r = run({ href: 'https://www.stiko.design/pricing' });
  await r.flush();
  assert.equal(r.jar.stiko_ft, undefined);
  assert.equal(r.jar.stiko_lt, undefined);
});

test('in a consent country nothing is written and the banner shows until Accept', async () => {
  const r = run({ href: 'https://www.stiko.design/?utm_source=meta', geo: { consentRequired: true } });
  await r.flush();
  assert.deepEqual(r.events, ['pending']);
  assert.equal(r.jar.stiko_ft, undefined);
  assert.equal(r.appended.length, 1);
  r.window.stikoTracking.accept();
  assert.equal(r.jar.stiko_consent, 'granted');
  assert.equal(decode(r.jar.stiko_ft).utm_source, 'meta');
  assert.deepEqual(r.events, ['pending', 'granted']);
});

test('decline is remembered and writes no attribution', async () => {
  const r = run({ href: 'https://www.stiko.design/?utm_source=meta', geo: { consentRequired: true } });
  await r.flush();
  r.window.stikoTracking.decline();
  assert.equal(r.jar.stiko_consent, 'denied');
  assert.equal(r.jar.stiko_ft, undefined);
  assert.deepEqual(r.events, ['pending', 'denied']);
});

test('a stored answer skips the geo call and the banner', async () => {
  const r = run({ href: 'https://app.stiko.design/?utm_source=x', cookies: { stiko_consent: 'denied' }, geo: { consentRequired: true } });
  await r.flush();
  assert.deepEqual(r.events, ['denied']);
  assert.equal(r.appended.length, 0);
  assert.equal(r.fetches.length, 0);
});

test('a failed geo call fails closed (banner)', async () => {
  const r = run({ href: 'https://www.stiko.design/', geo: null });
  await r.flush();
  assert.deepEqual(r.events, ['pending']);
});

// ---- beyond the brief ----

test('a geo reply that is not JSON fails closed too', async () => {
  const r = run({ href: 'https://www.stiko.design/?utm_source=meta', geo: 'html' });
  await r.flush();
  assert.deepEqual(r.events, ['pending']);
  assert.equal(r.jar.stiko_ft, undefined);
  assert.equal(r.appended.length, 1);
});

test('the geo call goes to the origin the script was served from, without credentials', async () => {
  const r = run({ href: 'https://www.stiko.design/' });
  await r.flush();
  assert.equal(r.fetches.length, 1);
  assert.equal(r.fetches[0].url, 'https://app.stiko.design/api/geo');
  assert.equal(r.fetches[0].init.credentials, 'omit');
});

test('cookies are shared across stiko.design and flagged Secure on https', async () => {
  const r = run({ href: 'https://www.stiko.design/?utm_source=meta' });
  await r.flush();
  assert.ok(r.cookieWrites.length >= 2);
  for (const w of r.cookieWrites) {
    assert.match(w, /; Path=\//);
    assert.match(w, /; SameSite=Lax/);
    assert.match(w, /; Domain=\.stiko\.design/);
    assert.match(w, /; Secure/);
  }
});

test('on localhost cookies carry no Domain and no Secure flag', async () => {
  const r = run({ href: 'http://localhost:3000/?utm_source=meta' });
  await r.flush();
  assert.ok(r.cookieWrites.length >= 2);
  for (const w of r.cookieWrites) {
    assert.doesNotMatch(w, /Domain=/);
    assert.doesNotMatch(w, /Secure/);
  }
});

test('the consent answer lives a year and the touches ninety days', async () => {
  const r = run({ href: 'https://www.stiko.design/?utm_source=meta', geo: { consentRequired: true } });
  await r.flush();
  r.window.stikoTracking.accept();
  const maxAge = (name) => Number(/Max-Age=(\d+)/.exec(r.cookieWrites.find((w) => w.startsWith(`${name}=`)))[1]);
  assert.equal(maxAge('stiko_consent'), 365 * 86400);
  assert.equal(maxAge('stiko_ft'), 90 * 86400);
  assert.equal(maxAge('stiko_lt'), 90 * 86400);
});

test('click IDs keep their case; utm values are capped at 200 characters', async () => {
  const r = run({ href: `https://www.stiko.design/?fbclid=IwAR0AbC&utm_term=${'X'.repeat(300)}` });
  await r.flush();
  const ft = decode(r.jar.stiko_ft);
  assert.equal(ft.fbclid, 'IwAR0AbC');
  assert.equal(ft.utm_term, 'x'.repeat(200));
});

test('blocked cookies never stop the decision from being announced', async () => {
  const r = run({ href: 'https://www.stiko.design/?utm_source=meta', blockCookies: true });
  await r.flush();
  assert.deepEqual(r.events, ['not_required']);
  assert.equal(r.appended.length, 0, 'a cookie failure must not turn into a banner');
});

test('window.stikoTracking.state follows the decision', async () => {
  const r = run({ href: 'https://www.stiko.design/', geo: { consentRequired: true } });
  assert.equal(r.window.stikoTracking.state, 'loading');
  await r.flush();
  assert.equal(r.window.stikoTracking.state, 'pending');
  r.window.stikoTracking.decline();
  assert.equal(r.window.stikoTracking.state, 'denied');
});

// ---- the banner before <body> exists ----

test('the banner waits for the document when the script runs in <head>', async () => {
  const r = run({ href: 'https://www.stiko.design/', geo: { consentRequired: true }, readyState: 'loading', hasBody: false });
  await r.flush();
  assert.deepEqual(r.events, ['pending']);
  assert.equal(r.appended.length, 0);
  r.domReady();
  assert.equal(r.appended.length, 1);
});

test('no body yet, even when the document claims to be interactive, never throws', async () => {
  const r = run({ href: 'https://www.stiko.design/', geo: { consentRequired: true }, readyState: 'interactive', hasBody: false });
  await r.flush();
  assert.deepEqual(r.events, ['pending']);
  assert.equal(r.appended.length, 0);
  r.domReady();
  assert.equal(r.appended.length, 1);
});

test('a banner that was waiting for the document is not shown after the visitor already answered', async () => {
  const r = run({ href: 'https://www.stiko.design/', geo: { consentRequired: true }, readyState: 'loading', hasBody: false });
  await r.flush();
  r.window.stikoTracking.accept();
  r.domReady();
  assert.equal(r.appended.length, 0);
  assert.deepEqual(r.events, ['pending', 'granted']);
});

// ---- invite tokens never reach the touch cookie ----

const TOKEN = 'SECRETTOKEN123';

test('an invite link a social app appended ?fbclid to stores the path without the token', async () => {
  const r = run({ href: `https://app.stiko.design/invite/${TOKEN}?fbclid=x` });
  await r.flush();
  assert.equal(decode(r.jar.stiko_ft).landing_page, '/invite/[token]');
  assert.equal(decode(r.jar.stiko_lt).landing_page, '/invite/[token]');
  assert.equal(decode(r.jar.stiko_ft).fbclid, 'x');
  for (const name of ['stiko_ft', 'stiko_lt']) {
    assert.ok(!decodeURIComponent(r.jar[name]).includes(TOKEN), `${name} leaked the token`);
    assert.ok(!r.jar[name].includes(TOKEN), `${name} leaked the token (encoded)`);
  }
});

test('a referrer that is an app invite URL is redacted', async () => {
  const r = run({
    href: 'https://www.stiko.design/?utm_source=meta',
    referrer: `https://app.stiko.design/invite/${TOKEN}`,
  });
  await r.flush();
  assert.equal(decode(r.jar.stiko_ft).referrer, 'https://app.stiko.design/invite/[token]');
  assert.ok(!r.jar.stiko_ft.includes(TOKEN));
});

test('the percent-encoded /login?callbackUrl= form is redacted, keeping the rest of the URL', async () => {
  const r = run({
    href: 'https://www.stiko.design/?utm_source=meta',
    referrer: `https://app.stiko.design/login?callbackUrl=%2Finvite%2F${TOKEN}&x=1`,
  });
  await r.flush();
  assert.equal(
    decode(r.jar.stiko_ft).referrer,
    'https://app.stiko.design/login?callbackUrl=%2Finvite%2F[token]&x=1',
  );
});

test('an encoded invite path in the landing page is redacted too', async () => {
  const r = run({ href: `https://app.stiko.design/go%2Finvite%2F${TOKEN}?utm_source=meta` });
  await r.flush();
  const lp = decode(r.jar.stiko_ft).landing_page;
  assert.ok(!lp.includes(TOKEN), lp);
  assert.ok(lp.includes('[token]'), lp);
});

test('a long referrer is redacted and still capped at 200 characters', async () => {
  const r = run({
    href: 'https://www.stiko.design/?utm_source=meta',
    referrer: `https://app.stiko.design/${'a'.repeat(160)}/invite/${TOKEN}`,
  });
  await r.flush();
  const ref = decode(r.jar.stiko_ft).referrer;
  assert.ok(ref.endsWith('/invite/[token]'), ref);
  assert.ok(!ref.includes('SECRET'), ref);
  assert.ok(ref.length <= 200, String(ref.length));
});

test('a referrer with no invite in it is stored as is', async () => {
  const r = run({ href: 'https://www.stiko.design/?utm_source=meta', referrer: 'https://www.google.com/' });
  await r.flush();
  assert.equal(decode(r.jar.stiko_ft).referrer, 'https://www.google.com/');
});

test('the script redacts exactly what the server-side parser redacts', async () => {
  const referrers = [
    `https://app.stiko.design/invite/${TOKEN}`,
    `https://app.stiko.design/invite/${TOKEN}?fbclid=IwAR0abc#top`,
    `https://app.stiko.design/invite/${TOKEN}/extra`,
    `https://app.stiko.design/login?callbackUrl=%2Finvite%2F${TOKEN}&x=1`,
    `https://app.stiko.design/login?callbackUrl=%2FINVITE%2F${TOKEN}`,
    `https://app.stiko.design/login?callbackUrl=%2Finvite%2F${TOKEN}%2Fextra&x=1`,
    `https://app.stiko.design/portal/abc?next=/invite/${TOKEN}`,
    'https://www.google.com/search?q=invite',
    'https://app.stiko.design/invites/list',
  ];
  for (const referrer of referrers) {
    const r = run({ href: 'https://www.stiko.design/?utm_source=meta', referrer });
    await r.flush();
    const mine = decode(r.jar.stiko_ft).referrer;
    const server = parseTouchCookie(JSON.stringify({ referrer })).referrer;
    assert.equal(mine, server, referrer);
    assert.ok(!mine.includes(TOKEN), referrer);
  }
});
