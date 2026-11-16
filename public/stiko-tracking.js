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
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'ttclid'];
  var MAX = 200;
  var DAY = 86400;
  var PRIVACY_URL = 'https://www.stiko.design/privacy';
  var scriptSrc = (document.currentScript && document.currentScript.src) || '';
  var GEO_URL = (scriptSrc ? new URL(scriptSrc).origin : '') + '/api/geo';
  var host = window.location.hostname;
  var domain = /(^|\.)stiko\.design$/.test(host) ? '; Domain=.stiko.design' : '';
  var secure = window.location.protocol === 'https:' ? '; Secure' : '';

  function readCookie(name) {
    var parts = document.cookie ? document.cookie.split('; ') : [];
    for (var i = 0; i < parts.length; i++) {
      var j = parts[i].indexOf('=');
      if (parts[i].slice(0, j) === name) return parts[i].slice(j + 1);
    }
    return undefined;
  }
  function writeCookie(name, value, days) {
    document.cookie = name + '=' + value + '; Path=/; Max-Age=' + days * DAY + '; SameSite=Lax' + domain + secure;
  }

  /*
   * An invite token is a credential. A shared invite link opened from a social
   * app arrives with ?fbclid=… appended, so the landing page is /invite/<token>;
   * an app URL can be the referrer; and the /login redirect carries the path
   * percent-encoded (callbackUrl=%2Finvite%2F<token>). Neither may reach the
   * cookie, which is later forwarded to analytics. Mirrors lib/attribution.ts.
   */
  var INVITE_PATH = /(\/invite\/)[^\/?#]+/g;
  var INVITE_PATH_ENCODED = /(%2Finvite%2F)(?:(?!%2F)[^\/?#&])+/gi;
  function redactInviteTokens(value) {
    return value.replace(INVITE_PATH, '$1[token]').replace(INVITE_PATH_ENCODED, '$1[token]');
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
    // Redact first, then cap the length.
    touch.landing_page = redactInviteTokens(window.location.pathname).slice(0, MAX);
    touch.referrer = redactInviteTokens(document.referrer || '').slice(0, MAX);
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

  function button(label, primary, onClick) {
    var b = document.createElement('button');
    b.setAttribute('type', 'button');
    b.textContent = label;
    b.style.cssText = 'font:inherit;font-weight:700;border-radius:9px;padding:8px 14px;cursor:pointer;' +
      (primary ? 'background:#111;color:#fff;border:0;' : 'background:#fff;color:#111;border:1.5px solid #ddd;');
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
    banner.appendChild(button('Decline', false, decline));
    banner.appendChild(button('Accept', true, accept));
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

  // true only when /api/geo positively says "not required"; anything else fails closed.
  function geoSaysNotRequired() {
    try {
      return fetch(GEO_URL, { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return !!d && d.consentRequired === false; }, function () { return false; });
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
