/*
 * stiko-tracking.js — consent, the EU/UK banner, and UTM capture.
 * Served by app.stiko.design and loaded by BOTH the app and the Webflow
 * marketing site (www.stiko.design), so one copy governs both.
 * Spec: docs/superpowers/specs/2026-11-15-kyc-and-posthog-design.md §6–7.
 *
 * It never loads PostHog itself. It announces the decision on window as a
 * 'stiko:tracking' CustomEvent (and window.stikoTracking.state); PostHog is
 * started by whoever listens, only for 'granted' or 'not_required'. A stored
 * answer settles synchronously while this script runs, so a listener added
 * afterwards reads window.stikoTracking.state first and then subscribes.
 */
(function () {
  // A page can embed this twice (Webflow site + custom-code, a re-run). A second
  // instance would stack a second banner and announce contradictory decisions.
  if (window.stikoTracking) return;

  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'ttclid'];
  var MAX = 200;
  var DAY = 86400;
  var PRIVACY_URL = 'https://www.stiko.design/privacy';
  var APP_ORIGIN = 'https://app.stiko.design';
  var GEO_MEMO_KEY = 'stiko_geo';
  var scriptSrc = (document.currentScript && document.currentScript.src) || '';
  // Hidden currentScript (dynamic injection): never a relative URL, it would hit the host page.
  var GEO_URL = (scriptSrc ? new URL(scriptSrc).origin : APP_ORIGIN) + '/api/geo';
  var host = window.location.hostname;
  var domain = /(^|\.)stiko\.design$/.test(host) ? '; Domain=.stiko.design' : '';
  var secure = window.location.protocol === 'https:' ? '; Secure' : '';

  // Cookie access can throw (sandboxed iframe, blocked storage). That must never
  // stop the decision being made or the banner being closed.
  function readCookie(name) {
    try {
      var parts = document.cookie ? document.cookie.split('; ') : [];
      for (var i = 0; i < parts.length; i++) {
        var j = parts[i].indexOf('=');
        if (parts[i].slice(0, j) === name) return parts[i].slice(j + 1);
      }
    } catch (e) { /* treated as no cookie */ }
    return undefined;
  }
  function writeCookie(name, value, days) {
    try {
      document.cookie = name + '=' + value + '; Path=/; Max-Age=' + days * DAY + '; SameSite=Lax' + domain + secure;
    } catch (e) { /* the answer just is not remembered */ }
  }

  /*
   * landing_page and referrer are URLs, and a URL can carry a credential or
   * personal data: /invite/<token>, /reset-password/<token>,
   * /verify-email?email=<address>, /login?callbackUrl=%2Finvite%2F<token>. A
   * shared invite link opened from a social app arrives with ?fbclid=… appended,
   * and an app URL can be the referrer. None of it may reach the cookie, which
   * is later forwarded to analytics. So the cookie gets the same allowlist
   * scrub PostHog events get: token segments become "[token]", only UTM,
   * click-id, billing and tab query keys survive, and the fragment and any
   * user:password@ are dropped.
   *
   * KEEP IN SYNC with scrubUrl() in lib/analytics/scrub.ts (and the allowlist
   * there). scripts/tests/stikoTracking.test.mjs runs both on the same inputs
   * and fails if they diverge.
   */
  var ALLOWED_QUERY_KEYS = {
    utm_source: 1, utm_medium: 1, utm_campaign: 1, utm_content: 1, utm_term: 1,
    gclid: 1, fbclid: 1, ttclid: 1, billing: 1, tab: 1
  };
  var TOKEN_SEGMENTS = { 'invite': 1, 'reset-password': 1 };
  var TOKEN_ROUTE = /((?:^|\/|%(?:25)*2F)(?:invite|reset-password)(?:\/|%(?:25)*2F))(?:(?!%(?:25)*2F)[^\/?#&\s])+/gi;
  var ABSOLUTE_URL = /^https?:\/\/\S*$/i;
  var PROTOCOL_RELATIVE_URL = /^\/\/\S*$/;
  var PATH_URL = /^\/\S*$/;
  function redactTokenRoutes(value) {
    return value.replace(TOKEN_ROUTE, '$1[token]');
  }
  function decodeSegment(segment) {
    try { return decodeURIComponent(segment); } catch (e) { return segment; }
  }
  function scrubPath(pathname) {
    var segments = pathname.split('/');
    for (var i = 1; i < segments.length; i++) {
      if (segments[i] && TOKEN_SEGMENTS.hasOwnProperty(decodeSegment(segments[i - 1]).toLowerCase())) segments[i] = '[token]';
    }
    return redactTokenRoutes(segments.join('/'));
  }
  function scrubQuery(params) {
    var kept = new URLSearchParams();
    params.forEach(function (value, key) {
      if (ALLOWED_QUERY_KEYS.hasOwnProperty(key)) kept.append(key, redactTokenRoutes(value));
    });
    var query = kept.toString();
    return query ? '?' + query : '';
  }
  function scrubUrl(value) {
    var absolute = ABSOLUTE_URL.test(value);
    var protocolRelative = !absolute && PROTOCOL_RELATIVE_URL.test(value);
    if (!absolute && !protocolRelative && !PATH_URL.test(value)) return redactTokenRoutes(value);
    try {
      var url = protocolRelative
        ? new URL('https:' + value)
        : absolute
          ? new URL(value)
          : new URL(value, 'https://placeholder.invalid');
      var origin = absolute ? url.protocol + '//' + url.host : protocolRelative ? '//' + url.host : '';
      return origin + scrubPath(url.pathname) + scrubQuery(url.searchParams);
    } catch (e) {
      // Unparseable: keep only what precedes the query and the fragment.
      return redactTokenRoutes(value.split(/[?#]/)[0]);
    }
  }

  function captureTouch() {
    var params = new URLSearchParams(window.location.search);
    var touch = {};
    var found = false;
    for (var i = 0; i < KEYS.length; i++) {
      var v = params.get(KEYS[i]);
      if (v) {
        v = v.slice(0, MAX);
        // utm_* lowercased (naming rule); click IDs are case-sensitive.
        touch[KEYS[i]] = KEYS[i].indexOf('utm_') === 0 ? v.toLowerCase() : v;
        found = true;
      }
    }
    if (!found) return;
    // Scrub first, then cap the length.
    touch.landing_page = scrubUrl(window.location.pathname).slice(0, MAX);
    touch.referrer = scrubUrl(document.referrer || '').slice(0, MAX);
    touch.ts = new Date().toISOString();
    var value = encodeURIComponent(JSON.stringify(touch));
    if (value.length > 2000) return;
    if (!readCookie('stiko_ft')) writeCookie('stiko_ft', value, 90);
    writeCookie('stiko_lt', value, 90);
  }

  var api = { state: 'loading', accept: accept, decline: decline };
  window.stikoTracking = api;
  var banner = null;

  function settle(state) {
    api.state = state;
    if (state === 'granted' || state === 'not_required') {
      // Blocked cookies must not swallow the decision (nor turn into a banner).
      try { captureTouch(); } catch (e) { /* attribution is best-effort */ }
    }
    try {
      window.dispatchEvent(new CustomEvent('stiko:tracking', { detail: { state: state } }));
    } catch (e) { /* listeners can read window.stikoTracking.state */ }
  }
  function closeBanner() {
    if (banner) banner.remove();
    banner = null;
  }
  function accept() {
    writeCookie('stiko_consent', 'granted', 365);
    closeBanner();
    settle('granted');
  }
  function decline() {
    writeCookie('stiko_consent', 'denied', 365);
    closeBanner();
    settle('denied');
  }

  // Decline must be as easy to choose as Accept (UK/EU guidance): one shared style.
  var BUTTON_STYLE = 'font:inherit;font-weight:700;border-radius:9px;padding:8px 14px;min-height:40px;cursor:pointer;' +
    'background:#111;color:#fff;border:1.5px solid #111;';
  function button(label, onClick) {
    var b = document.createElement('button');
    b.setAttribute('type', 'button');
    b.textContent = label;
    b.style.cssText = BUTTON_STYLE;
    b.addEventListener('click', onClick);
    return b;
  }
  function showBanner() {
    // Answered while the page was still parsing: nothing left to ask.
    if (api.state !== 'pending' || banner) return;
    // Run from <head>, <body> does not exist yet.
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', showBanner);
      return;
    }
    banner = document.createElement('div');
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;max-width:560px;margin:0 auto;' +
      'background:#fff;color:#111;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:14px 16px;' +
      'font:13px/1.45 system-ui,-apple-system,sans-serif;display:flex;flex-wrap:wrap;gap:10px;align-items:center;';
    var text = document.createElement('span');
    text.style.cssText = 'flex:1 1 260px;';
    text.textContent = 'We use analytics cookies to improve stiko. ';
    var link = document.createElement('a');
    link.setAttribute('href', PRIVACY_URL);
    link.textContent = 'Privacy policy';
    link.style.cssText = 'color:inherit;text-decoration:underline;';
    text.appendChild(link);
    banner.appendChild(text);
    banner.appendChild(button('Decline', decline));
    banner.appendChild(button('Accept', accept));
    document.body.appendChild(banner);
  }

  function pending() {
    settle('pending');
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showBanner);
    } else {
      showBanner();
    }
  }

  // The geo answer is remembered for the tab's session ('1' = consent required,
  // '0' = not), so a visitor outside the consent countries (who never gets a
  // cookie) does not re-ask on every pageview. Only an explicit answer is kept.
  function readGeoMemo() {
    try {
      var v = window.sessionStorage.getItem(GEO_MEMO_KEY);
      return v === '1' || v === '0' ? v : null;
    } catch (e) {
      return null;
    }
  }
  function writeGeoMemo(value) {
    try { window.sessionStorage.setItem(GEO_MEMO_KEY, value); } catch (e) { /* asked again next time */ }
  }

  // true only when /api/geo positively says "not required"; anything else fails closed.
  function geoSaysNotRequired() {
    var memo = readGeoMemo();
    if (memo !== null) return Promise.resolve(memo === '0');
    try {
      return fetch(GEO_URL, { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && d.consentRequired === false) { writeGeoMemo('0'); return true; }
          if (d && d.consentRequired === true) writeGeoMemo('1');
          return false;
        }, function () { return false; });
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  var stored = readCookie('stiko_consent');
  if (stored === 'granted' || stored === 'denied') {
    settle(stored);
    return;
  }
  geoSaysNotRequired().then(function (notRequired) {
    if (notRequired) settle('not_required'); else pending();
  });
})();
