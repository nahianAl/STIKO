/**
 * The KYC rules: validation, size → track, business-email detection.
 * Pure. Shared by POST /api/welcome (authoritative) and the /welcome page.
 */
import {
  BUSINESS_TYPES, CLIENT_MODELS, OTHER_SUFFIX, OTHER_TEXT_MAX, PILLARS, ROLES, SIZE_BANDS,
  type BusinessType, type PillarId, type Track,
} from './catalog.ts';

export interface ProfileAnswers {
  pillar: PillarId;
  segmentId: string;
  businessTypeOther: string | null;
  clientModel: string;
  companySizeBand: string;
  role: string;
  marketingConsent: boolean;
}

export type ProfileValidation =
  | { ok: true; answers: ProfileAnswers }
  | { ok: false; field: keyof ProfileAnswers };

export function trackForSize(band: string): Track | null {
  return SIZE_BANDS.find((b) => b.id === band)?.track ?? null;
}

export function businessTypesFor(pillar: string): BusinessType[] {
  return BUSINESS_TYPES.filter((b) => b.pillar === pillar);
}

export function isOtherSegment(id: string): boolean {
  return id.endsWith(OTHER_SUFFIX);
}

/** Checks every value against the catalog. The first bad field is reported. */
export function validateProfile(body: unknown): ProfileValidation {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');

  const pillar = str(b.pillar);
  if (!PILLARS.some((p) => p.id === pillar)) return { ok: false, field: 'pillar' };

  const segmentId = str(b.segmentId);
  const type = BUSINESS_TYPES.find((t) => t.id === segmentId);
  if (!type || type.pillar !== pillar) return { ok: false, field: 'segmentId' };

  let businessTypeOther: string | null = null;
  if (isOtherSegment(segmentId)) {
    const text = str(b.businessTypeOther).trim();
    if (!text || text.length > OTHER_TEXT_MAX) return { ok: false, field: 'businessTypeOther' };
    businessTypeOther = text;
  }

  const clientModel = str(b.clientModel);
  if (!CLIENT_MODELS.some((c) => c.id === clientModel)) return { ok: false, field: 'clientModel' };

  const companySizeBand = str(b.companySizeBand);
  if (!SIZE_BANDS.some((s) => s.id === companySizeBand)) return { ok: false, field: 'companySizeBand' };

  const role = str(b.role);
  if (!ROLES.some((r) => r.id === role)) return { ok: false, field: 'role' };

  return {
    ok: true,
    answers: {
      pillar: pillar as PillarId,
      segmentId,
      businessTypeOther,
      clientModel,
      companySizeBand,
      role,
      marketingConsent: b.marketingConsent === true,
    },
  };
}

/**
 * Personal mailbox providers. High-value logic and domain enrichment (later
 * phases) only run on business email. Includes the big Canadian ISPs because
 * the ICP is North America.
 */
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.ca', 'hotmail.co.uk',
  'live.com', 'live.ca', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'yahoo.com', 'yahoo.ca', 'yahoo.co.uk', 'ymail.com', 'aol.com',
  'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'zoho.com', 'yandex.com',
  'mail.com', 'hey.com', 'fastmail.com',
  'shaw.ca', 'rogers.com', 'sympatico.ca', 'bell.net', 'telus.net', 'videotron.ca',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net',
]);

export function isBusinessEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain.includes('.')) return false;
  return !FREE_EMAIL_DOMAINS.has(domain);
}
