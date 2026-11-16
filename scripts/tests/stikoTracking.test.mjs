import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseTouchCookie } from '../../lib/attribution.ts';
import { ALLOWED_QUERY_KEYS, scrubUrl } from '../../lib/analytics/scrub.ts';

const SRC = readFileSync(new URL('../../public/stiko-tracking.js', import.meta.url), 'utf8');

// geo: an object is the /api/geo reply; null makes fetch reject; 'html' makes json() reject.
// currentScript: undefined = served from app.stiko.design; null = the browser hides it.
// sessionStorage: a store from makeStore() (pass the same one to simulate a second
// pageview in one session), or 'throws' for a browser that denies access to it.
// noFetch removes fetch from the context; throwCookies makes the cookie getter AND setter throw.
function makeStore() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
  };
}

function run({
  href,
  cookies = {},
  geo = { consentRequired: false },
  referrer = '',
  readyState = 'complete',
  hasBody = true,
  blockCookies = false,
  throwCookies = false,
  currentScript = { src: 'https://app.stiko.design/stiko-tracking.js' },
  sessionStorage = makeStore(),
  noFetch = false,
}) {
  const jar = { ...cookies };
  const events = [];
  const appended = [];
  const created = [];
  const cookieWrites = [];
  const fetches = [];
  const listeners = {};
  let bodyPresent = hasBody;
  const document = {
    referrer,
    currentScript,
    get cookie() {
      if (throwCookies) throw new Error('cookies unavailable');
      return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(str) {
      if (blockCookies || throwCookies) throw new Error('cookies blocked');
      cookieWrites.push(str);
      const [pair] = str.split(';');
      const i = pair.indexOf('=');
      jar[pair.slice(0, i)] = pair.slice(i + 1);
    },
    createElement: (tag) => {
      const el = {
        tag,
        style: {},
        attrs: {},
        children: [],
        textContent: '',
        removed: false,
        handlers: {},
        setAttribute(k, v) { el.attrs[k] = v; },
        appendChild(c) { el.children.push(c); },
        addEventListener(type, fn) { el.handlers[type] = fn; },
        remove() { el.removed = true; },
      };
      created.push(el);
      return el;
    },
    get body() { return bodyPresent ? { appendChild: (el) => appended.push(el) } : null; },
    readyState,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  };
  const window = {
    location: new URL(href),
    dispatchEvent: (e) => events.push(e.detail.state),
  };
  if (sessionStorage === 'throws') {
    Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('storage denied'); } });
  } else {
    window.sessionStorage = sessionStorage;
  }
  const ctx = {
    window, document, URL, URLSearchParams, JSON, Date, encodeURIComponent, decodeURIComponent,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
  };
  if (!noFetch) {
    ctx.fetch = async (url, init) => {
      fetches.push({ url, init });
      if (geo === null) throw new Error('down');
      if (geo === 'html') return { ok: true, json: async () => { throw new SyntaxError('not json'); } };
      return { ok: true, json: async () => geo };
    };
  }
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return {
    jar,
    events,
    appended,
    created,
    cookieWrites,
    fetches,
    window,
    sessionStorage,
    // A second <script> tag for the same file (a double embed): same window, same document.
    loadAgain: () => vm.runInContext(SRC, ctx),
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

test('the percent-encoded /login?callbackUrl= form is redacted: only allowlisted query keys survive', async () => {
  const r = run({
    href: 'https://www.stiko.design/?utm_source=meta',
    referrer: `https://app.stiko.design/login?callbackUrl=%2Finvite%2F${TOKEN}&x=1`,
  });
  await r.flush();
  assert.equal(decode(r.jar.stiko_ft).referrer, 'https://app.stiko.design/login');
  assert.ok(!r.jar.stiko_ft.includes(TOKEN));
});

test('a /verify-email referrer loses the email address; a /reset-password landing page loses its token', async () => {
  const a = run({
    href: 'https://www.stiko.design/?utm_source=meta',
    referrer: 'https://app.stiko.design/verify-email?email=a%40b.co&callbackUrl=%2Fdashboard',
  });
  await a.flush();
  assert.equal(decode(a.jar.stiko_ft).referrer, 'https://app.stiko.design/verify-email');
  assert.ok(!decodeURIComponent(a.jar.stiko_ft).includes('b.co'));
  const b = run({ href: 'https://app.stiko.design/reset-password/abc123?utm_source=meta' });
  await b.flush();
  assert.equal(decode(b.jar.stiko_ft).landing_page, '/reset-password/[token]');
  assert.ok(!b.jar.stiko_ft.includes('abc123'));
});

test('fragments, user:password@ and non-allowlisted query keys are dropped from the referrer', async () => {
  const r = run({
    href: 'https://www.stiko.design/?utm_source=meta',
    referrer: 'https://user:pw@www.google.com/search?q=secret+plan&gclid=G1#frag',
  });
  await r.flush();
  assert.equal(decode(r.jar.stiko_ft).referrer, 'https://www.google.com/search?gclid=G1');
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

test('the script scrubs referrers exactly like the server-side parser (and both match scrubUrl)', async () => {
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
    'https://app.stiko.design/verify-email?email=a%40b.co&callbackUrl=%2Fdashboard',
    'https://app.stiko.design/reset-password/abc123',
    'https://app.stiko.design/reset-password/abc123?utm_source=x#frag',
    `https://app.stiko.design/login?callbackUrl=%2Freset-password%2Fabc123&utm_medium=email`,
    `https://app.stiko.design/pricing?utm_content=%252Finvite%252F${TOKEN}`,
    'https://user:pw@www.google.com/search?q=a&gclid=G1#top',
    '//app.stiko.design/reset-password/abc123?email=a@b.co',
    'android-app://com.google.android.gm/',
    `https://app.stiko.design/${'a'.repeat(300)}/reset-password/abc123`,
  ];
  for (const referrer of referrers) {
    const r = run({ href: 'https://www.stiko.design/?utm_source=meta', referrer });
    await r.flush();
    const mine = decode(r.jar.stiko_ft).referrer;
    const server = parseTouchCookie(JSON.stringify({ referrer })).referrer;
    assert.equal(mine, server, referrer);
    assert.equal(mine, scrubUrl(referrer).slice(0, 200), referrer);
    assert.ok(!mine.includes(TOKEN), referrer);
  }
});

test('the script keeps exactly the query keys the server-side allowlist keeps', async () => {
  const keys = [...ALLOWED_QUERY_KEYS, 'q', 'email', 'callbackUrl', 'token', 'constructor', 'hasOwnProperty', 'UTM_SOURCE'];
  for (const key of keys) {
    const referrer = `https://www.google.com/search?${key}=v1`;
    const r = run({ href: 'https://www.stiko.design/?utm_source=meta', referrer });
    await r.flush();
    const mine = decode(r.jar.stiko_ft).referrer;
    assert.equal(mine, scrubUrl(referrer), key);
    assert.equal(mine.includes('v1'), ALLOWED_QUERY_KEYS.has(key), key);
  }
});

test('the script scrubs the landing page exactly like the server-side parser', async () => {
  const pages = [
    '/',
    '/pricing',
    `/invite/${TOKEN}`,
    '/reset-password/abc123',
    '/verify-email',
    `/go%2Finvite%2F${TOKEN}`,
    `/go%252Freset-password%252Fabc123`,
    '/Invite/abc123',
    '/invite-friends/abc123',
    `/${'a'.repeat(300)}/reset-password/abc123`,
  ];
  for (const page of pages) {
    const r = run({ href: `https://app.stiko.design${page}?utm_source=meta` });
    await r.flush();
    const mine = decode(r.jar.stiko_ft).landing_page;
    const server = parseTouchCookie(JSON.stringify({ landing_page: new URL(`https://app.stiko.design${page}`).pathname })).landing_page;
    assert.equal(mine, server, page);
    assert.ok(!mine.includes(TOKEN), page);
    // /invite-friends/<x> is an ordinary route, not a token route: it keeps its segment.
    if (!page.includes('invite-friends')) assert.ok(!mine.includes('abc123'), page);
  }
});

// ---- Fix 1: double embeds, blocked cookies, geo fallbacks, equal-weight buttons ----

test('a double embed is ignored: one banner, one geo call, one announcement', async () => {
  const r = run({ href: 'https://www.stiko.design/', geo: { consentRequired: true } });
  const first = r.window.stikoTracking;
  r.loadAgain(); // Webflow embeds the same <script> twice before the first geo call returns
  await r.flush();
  r.loadAgain(); // ...and once more after it settled
  await r.flush();
  assert.equal(r.window.stikoTracking, first, 'the second load must not replace the API');
  assert.equal(r.fetches.length, 1);
  assert.equal(r.appended.length, 1, 'exactly one banner');
  assert.deepEqual(r.events, ['pending']);
  r.window.stikoTracking.accept();
  assert.deepEqual(r.events, ['pending', 'granted'], 'no contradictory second instance');
});

test('cookies that throw on read and write never stop accept() from settling', async () => {
  const r = run({ href: 'https://www.stiko.design/?utm_source=meta', geo: { consentRequired: true }, throwCookies: true });
  await r.flush();
  assert.deepEqual(r.events, ['pending']);
  assert.equal(r.appended.length, 1);
  assert.equal(r.appended[0].removed, false);
  r.window.stikoTracking.accept();
  assert.deepEqual(r.events, ['pending', 'granted']);
  assert.equal(r.appended[0].removed, true, 'the banner goes away even though the answer cannot be stored');
  assert.equal(r.window.stikoTracking.state, 'granted');
});

test('cookies that throw never stop decline() from settling either', async () => {
  const r = run({ href: 'https://www.stiko.design/', geo: { consentRequired: true }, throwCookies: true });
  await r.flush();
  r.window.stikoTracking.decline();
  assert.deepEqual(r.events, ['pending', 'denied']);
  assert.equal(r.appended[0].removed, true);
});

test('cookies that throw, with no stored answer and geo "not required", still announce not_required', async () => {
  const r = run({ href: 'https://www.stiko.design/?utm_source=meta', geo: { consentRequired: false }, throwCookies: true });
  await r.flush();
  assert.deepEqual(r.events, ['not_required']);
  assert.equal(r.appended.length, 0);
});

test('without document.currentScript the geo call still goes to the app origin, not a relative URL', async () => {
  const r = run({ href: 'https://www.stiko.design/', currentScript: null });
  await r.flush();
  assert.equal(r.fetches.length, 1);
  assert.equal(r.fetches[0].url, 'https://app.stiko.design/api/geo');
  assert.deepEqual(r.events, ['not_required']);
});

test('a "not required" geo answer is remembered for the session: the next pageview does not ask again', async () => {
  const store = makeStore();
  const a = run({ href: 'https://www.stiko.design/', sessionStorage: store, geo: { consentRequired: false } });
  await a.flush();
  assert.equal(a.fetches.length, 1);
  assert.equal(store.getItem('stiko_geo'), '0');
  const b = run({ href: 'https://www.stiko.design/pricing', sessionStorage: store, geo: { consentRequired: true } });
  await b.flush();
  assert.equal(b.fetches.length, 0, 'no second /api/geo call');
  assert.deepEqual(b.events, ['not_required']);
});

test('a "consent required" geo answer is remembered too, and still shows the banner', async () => {
  const store = makeStore();
  const a = run({ href: 'https://www.stiko.design/', sessionStorage: store, geo: { consentRequired: true } });
  await a.flush();
  assert.equal(store.getItem('stiko_geo'), '1');
  const b = run({ href: 'https://www.stiko.design/pricing', sessionStorage: store, geo: { consentRequired: false } });
  await b.flush();
  assert.equal(b.fetches.length, 0);
  assert.deepEqual(b.events, ['pending']);
  assert.equal(b.appended.length, 1);
});

test('a failed geo call is never remembered: the next pageview asks again', async () => {
  const store = makeStore();
  for (const geo of [null, 'html']) {
    const a = run({ href: 'https://www.stiko.design/', sessionStorage: store, geo });
    await a.flush();
    assert.deepEqual(a.events, ['pending']);
    assert.equal(store.getItem('stiko_geo'), null);
  }
  const b = run({ href: 'https://www.stiko.design/', sessionStorage: store, geo: { consentRequired: false } });
  await b.flush();
  assert.equal(b.fetches.length, 1);
  assert.deepEqual(b.events, ['not_required']);
});

test('a reply that says neither true nor false is not remembered', async () => {
  const store = makeStore();
  const a = run({ href: 'https://www.stiko.design/', sessionStorage: store, geo: {} });
  await a.flush();
  assert.deepEqual(a.events, ['pending']);
  assert.equal(store.getItem('stiko_geo'), null);
});

test('a sessionStorage that throws neither breaks the decision nor the banner', async () => {
  const off = run({ href: 'https://www.stiko.design/', sessionStorage: 'throws', geo: { consentRequired: false } });
  await off.flush();
  assert.deepEqual(off.events, ['not_required']);
  const on = run({ href: 'https://www.stiko.design/', sessionStorage: 'throws', geo: { consentRequired: true } });
  await on.flush();
  assert.deepEqual(on.events, ['pending']);
  assert.equal(on.appended.length, 1);
});

test('a stored answer in sessionStorage that is not 0 or 1 is ignored', async () => {
  const store = makeStore();
  store.setItem('stiko_geo', 'maybe');
  const r = run({ href: 'https://www.stiko.design/', sessionStorage: store, geo: { consentRequired: false } });
  await r.flush();
  assert.equal(r.fetches.length, 1);
  assert.deepEqual(r.events, ['not_required']);
});

test('Accept and Decline carry the same weight: identical styling, 40px minimum height', async () => {
  const r = run({ href: 'https://www.stiko.design/', geo: { consentRequired: true } });
  await r.flush();
  const buttons = r.created.filter((el) => el.tag === 'button');
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].style.cssText, buttons[1].style.cssText, 'one button must not be styled as the quiet option');
  assert.match(buttons[0].style.cssText, /min-height:40px/);
});

test('no fetch in the browser fails closed to the banner', async () => {
  const r = run({ href: 'https://www.stiko.design/', noFetch: true });
  await r.flush();
  assert.deepEqual(r.events, ['pending']);
  assert.equal(r.appended.length, 1);
});

test('the banner is an accessible dialog with labelled Accept and Decline buttons', async () => {
  const r = run({ href: 'https://www.stiko.design/', geo: { consentRequired: true } });
  await r.flush();
  const banner = r.appended[0];
  assert.equal(banner.tag, 'div');
  assert.equal(banner.attrs.role, 'dialog');
  assert.equal(banner.attrs['aria-label'], 'Cookie consent');
  const labels = banner.children.filter((el) => el.tag === 'button').map((el) => el.textContent).sort();
  assert.deepEqual(labels, ['Accept', 'Decline']);
  for (const el of banner.children.filter((c) => c.tag === 'button')) assert.equal(el.attrs.type, 'button');
});

test('the banner buttons answer the visitor: Accept grants, Decline denies, both close the banner', async () => {
  for (const [label, state] of [['Accept', 'granted'], ['Decline', 'denied']]) {
    const r = run({ href: 'https://www.stiko.design/', geo: { consentRequired: true } });
    await r.flush();
    const btn = r.appended[0].children.find((el) => el.tag === 'button' && el.textContent === label);
    btn.handlers.click();
    assert.deepEqual(r.events, ['pending', state]);
    assert.equal(r.appended[0].removed, true);
  }
});

// ---- /api/geo: the response varies by Origin whether or not CORS is granted ----

test('/api/geo sets Vary: Origin on every response, not only on allow-listed origins', () => {
  const src = readFileSync(new URL('../../app/api/geo/route.ts', import.meta.url), 'utf8');
  // Drop the allow-list branch; the Vary header must survive outside it.
  const outsideBranch = src.replace(/if \(origin && ALLOWED_ORIGINS\.has\(origin\)\) \{[^}]*\}/, '');
  assert.notEqual(outsideBranch, src, 'the allow-list branch moved; update this test');
  assert.match(outsideBranch, /headers\.set\('Vary', 'Origin'\)/);
});
