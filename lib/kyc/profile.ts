/**
 * KYC v2 rules (spec 2026-11-19-kyc-v2-design.md): filters, validation, derived
 * values, and which onboarding variant a person gets. Pure. POST /api/welcome is
 * the authority; the page and Settings → Company reuse the same functions.
 */
import {
  CLIENT_MODELS, FILE_GROUP_LABELS, FILE_GROUP_ORDER, FILE_TYPES, INDUSTRIES, MARKETS, MAX_MARKETS,
  OTHER_FILE_TYPE, OTHER_INDUSTRY, OTHER_MARKET, OTHER_ROLE, OTHER_TEXT_MAX, REVIEWERS,
  REVIEWER_LISTS, REVIEW_TEAM_BANDS, ROLES, ROLE_LISTS, SIZE_BANDS,
} from './catalog.ts';
import type {
  ClientModel, FileGroup, FileType, Industry, IndustryCode, ParentSegment, Reviewer, Role,
  RoleFamily, Seniority, Track,
} from './catalog.ts';
import { SUPPORTED_EXTENSIONS } from '../fileFormats.ts';

export type OnboardingKind = 'full' | 'role' | 'company' | 'done';
export type SubmitKind = Exclude<OnboardingKind, 'done'>;
export type WebsiteSource = 'prefilled' | 'typed' | 'none';

export interface CompanyAnswers {
  companyDomain: string | null;
  websiteSource: WebsiteSource;
  industry: IndustryCode;
  industryOtherText: string | null;
  /** In pick order; the first is the primary market. */
  markets: string[];
  marketOtherText: string | null;
  clientModel: string;
  companySize: string;
  reviewTeamSize: string;
  /** ER codes, de-duplicated, in pick order. */
  reviewerCodes: string[];
  fileTypes: string[];
  fileTypeOtherText: string | null;
}
export interface RoleAnswer { roleCode: string; roleOtherText: string | null }

export type CompanyField =
  | 'website' | 'industry' | 'industryOtherText' | 'markets' | 'marketOtherText' | 'clientModel'
  | 'companySize' | 'reviewTeamSize' | 'reviewers' | 'fileTypes' | 'fileTypeOtherText';
export type RoleField = 'role' | 'roleOtherText';
export type Validation<T, F> = { ok: true; value: T } | { ok: false; field: F };

export interface DerivedCompany {
  parentSegment: ParentSegment | null;
  primaryMarket: string;
  sizeMin: number;
  sizeMax: number | null;
  rtMin: number;
  rtMax: number | null;
  icpSizeFit: boolean;
  track: Track;
  fileTypeSupport: { code: string; supported: boolean }[];
}
export interface DerivedRole {
  roleFamily: RoleFamily;
  seniority: Seniority | null;
  decisionMaker: boolean;
  nonBuyer: boolean;
}
export interface FileTypeGroup { group: FileGroup | null; label: string; types: FileType[] }

const ROLE_BY_CODE = new Map(ROLES.map((r) => [r.code, r]));
const REVIEWER_BY_ID = new Map(REVIEWERS.map((r) => [r.id, r]));

export function industryFor(code: string): Industry | undefined {
  return INDUSTRIES.find((i) => i.code === code);
}

function parentOf(industry: string | null): ParentSegment | null {
  return industry ? industryFor(industry)?.parent ?? null : null;
}

/** The industry's list, or for Other / no industry every role once, Other last. */
export function rolesFor(industry: string | null): Role[] {
  const own = industry && Object.prototype.hasOwnProperty.call(ROLE_LISTS, industry)
    ? ROLE_LISTS[industry as keyof typeof ROLE_LISTS]
    : null;
  const lists = own ? [own] : Object.values(ROLE_LISTS);
  const codes: string[] = [];
  for (const list of lists) for (const c of list) if (c !== OTHER_ROLE && !codes.includes(c)) codes.push(c);
  codes.push(OTHER_ROLE);
  return codes.map((c) => ROLE_BY_CODE.get(c) as Role);
}

/** The parent segment's list, or for Other / no industry every reviewer once. */
export function reviewersFor(industry: string | null): Reviewer[] {
  const parent = parentOf(industry);
  const lists = parent ? [REVIEWER_LISTS[parent]] : Object.values(REVIEWER_LISTS);
  const ids: string[] = [];
  for (const list of lists) for (const id of list) if (!ids.includes(id)) ids.push(id);
  return ids.map((id) => REVIEWER_BY_ID.get(id) as Reviewer);
}

export function clientModelsFor(industry: string | null): ClientModel[] {
  return CLIENT_MODELS.filter(
    (c) => !c.industries || (industry !== null && (c.industries as readonly string[]).includes(industry))
  );
}

export function fileTypeGroupsFor(industry: string | null): FileTypeGroup[] {
  const order = FILE_GROUP_ORDER[parentOf(industry) ?? 'default'];
  const groups: FileTypeGroup[] = order.map((g) => ({
    group: g, label: FILE_GROUP_LABELS[g], types: FILE_TYPES.filter((t) => t.group === g),
  }));
  groups.push({ group: null, label: '', types: FILE_TYPES.filter((t) => t.group === null) });
  return groups;
}

export function matchesSearch(o: { label: string; synonyms?: readonly string[] }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [o.label, ...(o.synonyms ?? [])].some((s) => s.toLowerCase().includes(q));
}

/** "https://www.Acme.com/about" → "acme.com". Null when it is not a hostname. */
export function normaliseDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0];
  s = s.replace(/^[^@]*@/, '');
  s = s.replace(/:\d+$/, '');
  s = s.replace(/\.$/, '');
  s = s.replace(/^www\./, '');
  if (!s || s.length > 253) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) return null;
  // A numeric last label is an IP address, not a website.
  if (!/[a-z]/.test(s.slice(s.lastIndexOf('.') + 1))) return null;
  return s;
}

/**
 * Personal mailbox providers. High-value logic and domain enrichment only run on
 * business email. Includes the big Canadian ISPs because the ICP is North America.
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

/** The website prefill: the email's domain, for a work email only. */
export function emailDomain(email: string): string | null {
  if (!isBusinessEmail(email)) return null;
  return normaliseDomain(email.slice(email.lastIndexOf('@') + 1));
}

export function trackForSize(code: string): Track | null {
  return SIZE_BANDS.find((b) => b.code === code)?.track ?? null;
}

/** Whether Stiko accepts this format today, read from the uploader's own list. */
export function fileTypeSupported(ft: FileType): boolean {
  return ft.extensions.some((e) => SUPPORTED_EXTENSIONS.has(e));
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const record = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function otherText(v: unknown): string | null {
  const t = str(v).trim();
  return t && t.length <= OTHER_TEXT_MAX ? t : null;
}

/** Absent → []; anything but an array of distinct strings → null. */
function stringList(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return null;
  if (new Set(v).size !== v.length) return null;
  return v as string[];
}

/** Checks every company answer against the catalog, in page order. */
export function validateCompany(body: unknown, email: string): Validation<CompanyAnswers, CompanyField> {
  const b = record(body);
  const fail = (field: CompanyField) => ({ ok: false as const, field });

  let companyDomain: string | null = null;
  let websiteSource: WebsiteSource = 'none';
  if (b.noWebsite !== true) {
    companyDomain = normaliseDomain(str(b.website));
    if (!companyDomain) return fail('website');
    // Typing the same domain as the prefill also reads as 'prefilled'; the two are indistinguishable.
    websiteSource = companyDomain === emailDomain(email) ? 'prefilled' : 'typed';
  }

  const industry = str(b.industry);
  if (!industryFor(industry)) return fail('industry');
  let industryOtherText: string | null = null;
  if (industry === OTHER_INDUSTRY) {
    industryOtherText = otherText(b.industryOtherText);
    if (!industryOtherText) return fail('industryOtherText');
  }

  const markets = stringList(b.markets);
  if (
    !markets || markets.length < 1 || markets.length > MAX_MARKETS ||
    !markets.every((m) => MARKETS.some((x) => x.code === m))
  ) return fail('markets');
  let marketOtherText: string | null = null;
  if (markets.includes(OTHER_MARKET)) {
    marketOtherText = otherText(b.marketOtherText);
    if (!marketOtherText) return fail('marketOtherText');
  }

  const clientModel = str(b.clientModel);
  if (!clientModelsFor(industry).some((c) => c.code === clientModel)) return fail('clientModel');

  const companySize = str(b.companySize);
  if (!SIZE_BANDS.some((s) => s.code === companySize)) return fail('companySize');

  const reviewTeamSize = str(b.reviewTeamSize);
  // Every band, whatever the company size: reviewers include clients and anyone
  // else who comments or approves, so a 3-person studio can have 10 (user, 2026-11-23).
  if (!REVIEW_TEAM_BANDS.some((r) => r.code === reviewTeamSize)) return fail('reviewTeamSize');

  const reviewerIds = stringList(b.reviewers);
  const allowed = reviewersFor(industry);
  if (!reviewerIds || !reviewerIds.every((id) => allowed.some((r) => r.id === id))) return fail('reviewers');
  const reviewerCodes = Array.from(new Set(reviewerIds.map((id) => (REVIEWER_BY_ID.get(id) as Reviewer).code)));

  const fileTypes = stringList(b.fileTypes);
  if (!fileTypes || !fileTypes.every((c) => FILE_TYPES.some((f) => f.code === c))) return fail('fileTypes');
  let fileTypeOtherText: string | null = null;
  if (fileTypes.includes(OTHER_FILE_TYPE)) {
    fileTypeOtherText = otherText(b.fileTypeOtherText);
    if (!fileTypeOtherText) return fail('fileTypeOtherText');
  }

  return {
    ok: true,
    value: {
      companyDomain, websiteSource, industry: industry as IndustryCode, industryOtherText,
      markets, marketOtherText, clientModel, companySize, reviewTeamSize, reviewerCodes,
      fileTypes, fileTypeOtherText,
    },
  };
}

/** Role from the industry's list; null industry (Role-only page) or Other = the combined list. */
export function validateRole(body: unknown, industry: string | null): Validation<RoleAnswer, RoleField> {
  const b = record(body);
  const role = str(b.role);
  if (!rolesFor(industry).some((r) => r.code === role)) return { ok: false, field: 'role' };
  let roleOtherText: string | null = null;
  if (role === OTHER_ROLE) {
    roleOtherText = otherText(b.roleOtherText);
    if (!roleOtherText) return { ok: false, field: 'roleOtherText' };
  }
  return { ok: true, value: { roleCode: role, roleOtherText } };
}

/** Derived on the server and stored on the row; never trusted from the client. */
export function deriveCompany(a: CompanyAnswers): DerivedCompany {
  const size = SIZE_BANDS.find((s) => s.code === a.companySize)!;
  const rt = REVIEW_TEAM_BANDS.find((r) => r.code === a.reviewTeamSize)!;
  return {
    parentSegment: industryFor(a.industry)?.parent ?? null,
    primaryMarket: a.markets[0],
    sizeMin: size.min,
    sizeMax: size.max,
    rtMin: rt.min,
    rtMax: rt.max,
    icpSizeFit: size.min >= 5,
    track: size.track,
    fileTypeSupport: a.fileTypes.map((code) => ({
      code, supported: fileTypeSupported(FILE_TYPES.find((f) => f.code === code)!),
    })),
  };
}

export function deriveRole(code: string): DerivedRole {
  const role = ROLE_BY_CODE.get(code);
  const seniority = role?.seniority ?? null;
  return {
    roleFamily: role?.family ?? 'other',
    seniority,
    decisionMaker: seniority === 'owner_exec' || seniority === 'director',
    nonBuyer: seniority === 'student',
  };
}

/**
 * Which /welcome variant (spec §5). needsCompany = signed up directly or owns a
 * project. A reviewer reaches 'company' only when sent there by project creation.
 */
export function decideOnboarding(s: { roleDone: boolean; companyDone: boolean; needsCompany: boolean }): OnboardingKind {
  if (!s.roleDone) return s.needsCompany && !s.companyDone ? 'full' : 'role';
  if (!s.companyDone) return 'company';
  return 'done';
}

/** The kind the server expects, or a company edit (Settings) once onboarding is done. */
export function allowedSubmission(posted: SubmitKind, expected: OnboardingKind): boolean {
  return posted === expected || (posted === 'company' && expected === 'done');
}
