/**
 * Every SQL statement for KYC v2 profiles (spec §7). History rows are only ever
 * inserted; the workspace pointer and users.role move in the same transaction.
 */
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { ONBOARDING_VERSION } from '@/lib/kyc/gate';
import { decideOnboarding, deriveCompany, deriveRole, reviewersFor } from '@/lib/kyc/profile';
import type { CompanyAnswers, OnboardingKind, RoleAnswer } from '@/lib/kyc/profile';
import type { FormValues } from '@/lib/kyc/form';

export interface OnboardingState {
  kind: OnboardingKind;
  roleDone: boolean;
  companyDone: boolean;
  needsCompany: boolean;
  email: string;
  workosUserId: string | null;
  profileCompletedAt: string | null;
}

export async function onboardingState(userId: string): Promise<OnboardingState | null> {
  const rows = await sql`
    SELECT u.email, u.workos_user_id, u.onboarding_version, u.signup_type, u.profile_completed_at,
           cp.onboarding_version AS company_version,
           EXISTS (SELECT 1 FROM projects p WHERE p.owner_id = u.id) AS owns_project
    FROM users u
    LEFT JOIN workspaces w ON w.owner_user_id = u.id
    LEFT JOIN company_profiles cp ON cp.id = w.current_profile_id
    WHERE u.id = ${userId}
  `;
  const r = rows[0] as
    | {
        email: string; workos_user_id: string | null; onboarding_version: number | null;
        signup_type: string | null; profile_completed_at: string | null;
        company_version: number | null; owns_project: boolean;
      }
    | undefined;
  if (!r) return null;
  const roleDone = Number(r.onboarding_version ?? 0) >= ONBOARDING_VERSION;
  const companyDone = Number(r.company_version ?? 0) >= ONBOARDING_VERSION;
  // Users from before signup_type existed (NULL) are treated as direct signups.
  const needsCompany = r.signup_type !== 'invited_reviewer' || r.owns_project;
  return {
    kind: decideOnboarding({ roleDone, companyDone, needsCompany }),
    roleDone, companyDone, needsCompany,
    email: r.email, workosUserId: r.workos_user_id, profileCompletedAt: r.profile_completed_at,
  };
}

export async function companyProfileDone(userId: string): Promise<boolean> {
  const rows = await sql`
    SELECT cp.onboarding_version
    FROM workspaces w JOIN company_profiles cp ON cp.id = w.current_profile_id
    WHERE w.owner_user_id = ${userId}
  `;
  return Number(rows[0]?.onboarding_version ?? 0) >= ONBOARDING_VERSION;
}

/** The current v2 profile as form values, for Settings → Company. */
export async function currentCompanyForm(userId: string): Promise<Partial<FormValues> | null> {
  const rows = await sql`
    SELECT cp.*,
      ARRAY(SELECT market_code FROM company_profile_markets m WHERE m.profile_id = cp.id ORDER BY pick_order) AS markets,
      ARRAY(SELECT reviewer_code FROM company_profile_reviewers r WHERE r.profile_id = cp.id) AS reviewer_codes,
      ARRAY(SELECT file_type_code FROM company_profile_file_types f WHERE f.profile_id = cp.id ORDER BY file_type_code) AS file_types
    FROM workspaces w JOIN company_profiles cp ON cp.id = w.current_profile_id
    WHERE w.owner_user_id = ${userId} AND cp.onboarding_version >= ${ONBOARDING_VERSION}
  `;
  const p = rows[0] as Record<string, unknown> | undefined;
  if (!p) return null;
  const industry = p.industry as string;
  // Codes back to option ids: the first option in this industry's list with that code.
  const options = reviewersFor(industry);
  const reviewers = (p.reviewer_codes as string[])
    .map((code) => options.find((o) => o.code === code)?.id)
    .filter((id): id is string => Boolean(id));
  return {
    website: (p.company_domain as string | null) ?? '',
    noWebsite: p.website_source === 'none',
    industry,
    industryOtherText: (p.industry_other_text as string | null) ?? '',
    markets: p.markets as string[],
    marketOtherText: (p.market_other_text as string | null) ?? '',
    clientModel: p.client_model as string,
    companySize: p.company_size as string,
    reviewTeamSize: p.review_team_size as string,
    reviewers,
    fileTypes: p.file_types as string[],
    fileTypeOtherText: (p.file_type_other_text as string | null) ?? '',
  };
}

export interface SaveInput {
  userId: string;
  workspaceId: string;
  company: CompanyAnswers | null;
  role: RoleAnswer | null;
  source: 'onboarding' | 'project_gate' | 'settings';
  /** Null for a company-only save: consent is not on that form. */
  consent: { marketing: boolean; analytics: string | null; pendingIfRequired: string | null } | null;
  country: string | null;
  region: string | null;
  businessEmail: boolean;
}

/** One transaction per submission (spec §7). */
export async function saveOnboarding(input: SaveInput): Promise<{ profileId: string | null }> {
  const { userId, workspaceId, company, role, source, consent, country, region, businessEmail } = input;
  const V = ONBOARDING_VERSION;
  const profileId = company ? uuidv4() : null;
  const queries = [];

  if (company && profileId) {
    const d = deriveCompany(company);
    queries.push(
      sql`
        INSERT INTO company_profiles (
          id, workspace_id, submitted_by_user_id, onboarding_version, source,
          company_domain, website_source, industry, industry_other_text, parent_segment, client_model,
          company_size, size_min, size_max, review_team_size, rt_min, rt_max,
          primary_market, market_other_text, file_type_other_text, icp_size_fit
        ) VALUES (
          ${profileId}, ${workspaceId}, ${userId}, ${V}, ${source},
          ${company.companyDomain}, ${company.websiteSource}, ${company.industry}, ${company.industryOtherText},
          ${d.parentSegment}, ${company.clientModel},
          ${company.companySize}, ${d.sizeMin}, ${d.sizeMax}, ${company.reviewTeamSize}, ${d.rtMin}, ${d.rtMax},
          ${d.primaryMarket}, ${company.marketOtherText}, ${company.fileTypeOtherText}, ${d.icpSizeFit}
        )
      `,
      sql`
        INSERT INTO company_profile_markets (profile_id, market_code, pick_order)
        SELECT ${profileId}, m, o FROM unnest(${company.markets}::text[]) WITH ORDINALITY AS t(m, o)
      `,
      sql`
        INSERT INTO company_profile_reviewers (profile_id, reviewer_code)
        SELECT ${profileId}, c FROM unnest(${company.reviewerCodes}::text[]) AS t(c)
      `,
      sql`
        INSERT INTO company_profile_file_types (profile_id, file_type_code, supported_at_signup)
        SELECT ${profileId}, c, s
        FROM unnest(${d.fileTypeSupport.map((f) => f.code)}::text[], ${d.fileTypeSupport.map((f) => f.supported)}::boolean[]) AS t(c, s)
      `,
      sql`
        UPDATE workspaces SET
          current_profile_id = ${profileId}, company_domain = ${company.companyDomain},
          country = COALESCE(${country}, country), region = COALESCE(${region}, region),
          is_business_email = ${businessEmail}
        WHERE id = ${workspaceId}
      `
    );
  }

  if (role) {
    const r = deriveRole(role.roleCode);
    queries.push(
      sql`
        INSERT INTO user_roles (
          id, user_id, onboarding_version, source, role_code, role_other_text, role_family, seniority,
          decision_maker, non_buyer
        ) VALUES (
          ${uuidv4()}, ${userId}, ${V}, ${source}, ${role.roleCode}, ${role.roleOtherText}, ${r.roleFamily},
          ${r.seniority}, ${r.decisionMaker}, ${r.nonBuyer}
        )
      `,
      sql`
        UPDATE users SET
          role = ${role.roleCode},
          onboarding_version = GREATEST(COALESCE(onboarding_version, 0), ${V}),
          profile_completed_at = COALESCE(profile_completed_at, now()),
          is_business_email = ${businessEmail}
        WHERE id = ${userId}
      `
    );
  }

  if (consent) {
    queries.push(sql`
      UPDATE users SET
        marketing_consent = ${consent.marketing},
        marketing_consent_at = CASE WHEN ${consent.marketing} THEN now() ELSE NULL END,
        marketing_consent_method = CASE WHEN ${consent.marketing} THEN 'welcome_checkbox' ELSE NULL END,
        analytics_consent = COALESCE(${consent.analytics}, analytics_consent, ${consent.pendingIfRequired})
      WHERE id = ${userId}
    `);
  }

  await sql.transaction(queries);
  return { profileId };
}
