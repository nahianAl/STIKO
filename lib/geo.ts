/**
 * Who sees the cookie banner, and what consent means for server events.
 * Pure. Used by /api/geo, signup, /api/welcome and lib/analytics/server.ts.
 * public/stiko-tracking.js does not import this; it asks /api/geo.
 */

export const CONSENT_COOKIE = 'stiko_consent';

/** EU-27 + EEA (IS, LI, NO) + UK + Switzerland. ISO 3166-1 alpha-2. */
const CONSENT_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO', 'GB', 'CH',
]);

/** Unknown country fails closed: better a banner too many than tracking without consent. */
export function consentRequired(country: string | null | undefined): boolean {
  if (!country) return true;
  return CONSENT_COUNTRIES.has(country.toUpperCase());
}

export function consentValue(raw: string | undefined): 'granted' | 'denied' | null {
  return raw === 'granted' || raw === 'denied' ? raw : null;
}

/**
 * users.analytics_consent at account creation. 'pending' = a consent-country
 * visitor who has not answered the banner: no server events until they accept.
 */
export function analyticsConsentAtSignup(
  cookie: string | undefined,
  country: string | null
): 'granted' | 'denied' | 'pending' | null {
  const v = consentValue(cookie);
  if (v) return v;
  return consentRequired(country) ? 'pending' : null;
}

/** null = never asked (outside consent countries), which the privacy policy covers. */
export function analyticsAllowed(consent: string | null): boolean {
  return consent === null || consent === 'granted';
}
