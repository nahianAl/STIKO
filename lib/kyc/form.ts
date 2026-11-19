/**
 * The onboarding form's state rules (spec §6). Pure. The form validates with the
 * server's own validators, so the button can never disagree with the API.
 */
import { OTHER_FILE_TYPE, OTHER_INDUSTRY, OTHER_MARKET, OTHER_ROLE } from './catalog.ts';
import { clientModelsFor, reviewTeamBandsFor, validateCompany, validateRole } from './profile.ts';
import type { CompanyField, RoleField, SubmitKind } from './profile.ts';

export interface FormValues {
  website: string;
  noWebsite: boolean;
  industry: string;
  industryOtherText: string;
  markets: string[];
  marketOtherText: string;
  clientModel: string;
  companySize: string;
  reviewTeamSize: string;
  role: string;
  roleOtherText: string;
  /** Reviewer option ids (rv-…), not ER codes. */
  reviewers: string[];
  fileTypes: string[];
  fileTypeOtherText: string;
  marketingConsent: boolean;
}

export const EMPTY_FORM: FormValues = {
  website: '', noWebsite: false, industry: '', industryOtherText: '', markets: [], marketOtherText: '',
  clientModel: '', companySize: '', reviewTeamSize: '', role: '', roleOtherText: '', reviewers: [],
  fileTypes: [], fileTypeOtherText: '', marketingConsent: false,
};

/** Industry is the one parent field: Role and External reviewers belong to it. */
export function withIndustry(v: FormValues, code: string): FormValues {
  if (code === v.industry) return v;
  const keepClient = clientModelsFor(code).some((c) => c.code === v.clientModel);
  return {
    ...v,
    industry: code,
    industryOtherText: code === OTHER_INDUSTRY ? v.industryOtherText : '',
    role: '',
    roleOtherText: '',
    reviewers: [],
    clientModel: keepClient ? v.clientModel : '',
  };
}

export function withCompanySize(v: FormValues, code: string): FormValues {
  const fits = reviewTeamBandsFor(code).some((b) => b.code === v.reviewTeamSize);
  return { ...v, companySize: code, reviewTeamSize: fits ? v.reviewTeamSize : '' };
}

export function toRequestBody(v: FormValues, kind: SubmitKind): Record<string, unknown> {
  const company =
    kind === 'role'
      ? {}
      : {
          website: v.noWebsite ? '' : v.website,
          noWebsite: v.noWebsite,
          industry: v.industry,
          industryOtherText: v.industry === OTHER_INDUSTRY ? v.industryOtherText : undefined,
          markets: v.markets,
          marketOtherText: v.markets.includes(OTHER_MARKET) ? v.marketOtherText : undefined,
          clientModel: v.clientModel,
          companySize: v.companySize,
          reviewTeamSize: v.reviewTeamSize,
          reviewers: v.reviewers,
          fileTypes: v.fileTypes,
          fileTypeOtherText: v.fileTypes.includes(OTHER_FILE_TYPE) ? v.fileTypeOtherText : undefined,
        };
  const role =
    kind === 'company'
      ? {}
      : { role: v.role, roleOtherText: v.role === OTHER_ROLE ? v.roleOtherText : undefined, marketingConsent: v.marketingConsent };
  return { kind, ...company, ...role };
}

export function firstInvalidField(v: FormValues, kind: SubmitKind): CompanyField | RoleField | null {
  const body = toRequestBody(v, kind);
  if (kind !== 'role') {
    const c = validateCompany(body, '');
    if (!c.ok) return c.field;
  }
  if (kind !== 'company') {
    const r = validateRole(body, kind === 'role' ? null : v.industry);
    if (!r.ok) return r.field;
  }
  return null;
}

export const FIELD_ERRORS: Readonly<Record<CompanyField | RoleField, string>> = {
  website: 'Enter your company website, or tick "We don\'t have a website yet".',
  industry: 'Pick your industry.',
  industryOtherText: 'Tell us your industry (up to 120 characters).',
  markets: 'Pick up to 3 markets.',
  marketOtherText: 'Tell us your other market (up to 120 characters).',
  clientModel: 'Pick who you mainly work for.',
  companySize: 'Pick your company size.',
  reviewTeamSize: 'Pick how many people review designs.',
  reviewers: 'Pick from the list for your industry.',
  fileTypes: 'Pick from the list of file types.',
  fileTypeOtherText: 'Tell us the other file type (up to 120 characters).',
  role: 'Pick your role.',
  roleOtherText: 'Tell us your role (up to 120 characters).',
};

export function fieldDomId(field: CompanyField | RoleField): string {
  return `kyc-${field}`;
}
