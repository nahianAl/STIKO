import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { authProvider } from '@/lib/authProvider';
import { safeCallbackUrl } from '@/lib/callbackUrl';
import { kycGateEnabled } from '@/lib/kyc/gate';
import {
  allowedSubmission, deriveCompany, deriveRole, isBusinessEmail, emailDomain, validateCompany, validateRole,
  type CompanyAnswers, type RoleAnswer, type SubmitKind,
} from '@/lib/kyc/profile';
import { currentCompanyForm, onboardingState, saveOnboarding } from '@/lib/kyc/store';
import { profileCookieHeader, signProfileCookie } from '@/lib/kyc/profileCookie';
import { CONSENT_COOKIE, consentRequired, consentValue } from '@/lib/geo';
import { ensureWorkspace } from '@/lib/workspaces';
import { identifyWorkspace, track } from '@/lib/analytics/server';

const KINDS: readonly SubmitKind[] = ['full', 'role', 'company'];

/** GET — which variant to show, the website prefill, and the current answers (spec §5, §6). */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const state = await onboardingState(session.user.id);
  if (!state) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({
    kind: state.kind,
    companyDone: state.companyDone,
    companyRequired: kycGateEnabled() && !state.companyDone,
    prefillWebsite: emailDomain(state.email) ?? '',
    current: state.companyDone ? await currentCompanyForm(session.user.id) : null,
  });
}

/** POST — save one submission (spec §5, §7). */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  const kind = (body?.kind ?? '') as SubmitKind;
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'invalid', field: 'kind' }, { status: 400 });

  const state = await onboardingState(userId);
  if (!state) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!allowedSubmission(kind, state.kind)) {
    return NextResponse.json({ error: 'wrong_kind', kind: state.kind }, { status: 409 });
  }

  let company: CompanyAnswers | null = null;
  if (kind !== 'role') {
    const c = validateCompany(body, state.email);
    if (!c.ok) return NextResponse.json({ error: 'invalid', field: c.field }, { status: 400 });
    company = c.value;
  }
  let role: RoleAnswer | null = null;
  if (kind !== 'company') {
    const r = validateRole(body, kind === 'role' ? null : company!.industry);
    if (!r.ok) return NextResponse.json({ error: 'invalid', field: r.field }, { status: 400 });
    role = r.value;
  }

  const country = request.headers.get('x-vercel-ip-country');
  const region = request.headers.get('x-vercel-ip-country-region');
  const marketing = body?.marketingConsent === true;
  const source =
    kind !== 'company' ? 'onboarding' : body?.source === 'settings' ? 'settings' : 'project_gate';
  const businessEmail = isBusinessEmail(state.email);

  const workspaceId = await ensureWorkspace(userId);
  await saveOnboarding({
    userId, workspaceId, company, role, source,
    // A user imported before 019 has analytics_consent NULL ("never asked, allowed"). In a
    // consent country that is wrong: until they answer the banner they are 'pending'.
    consent: kind === 'company' ? null : {
      marketing,
      analytics: consentValue(cookies().get(CONSENT_COOKIE)?.value),
      pendingIfRequired: consentRequired(country) ? 'pending' : null,
    },
    country, region, businessEmail,
  });

  // Codes only: "Other" free text never leaves Postgres (plan Global Constraints).
  // The marketing checkbox is grant-only (store.ts), so an unticked box says nothing
  // about stored consent: report it as `marketing_checkbox`, and only $set
  // marketing_consent when it was ticked (it can only have become true).
  if (company) {
    // Pre-save state: a re-asked v1 owner and a reviewer's first company save are first answers.
    const resubmitted = state.companyDone;
    const d = deriveCompany(company);
    const r = role ? deriveRole(role.roleCode) : null;
    await track('company_profile_completed', {
      userId,
      properties: {
        kind, source, industry: company.industry, parent_segment: d.parentSegment,
        primary_market: d.primaryMarket, markets: company.markets, client_model: company.clientModel,
        company_size: company.companySize, review_team_size: company.reviewTeamSize,
        reviewers: company.reviewerCodes, file_types: company.fileTypes, icp_size_fit: d.icpSizeFit,
        website_source: company.websiteSource, track: d.track, country, region, resubmitted,
        ...(role && r ? { role: role.roleCode, seniority: r.seniority, role_family: r.roleFamily } : {}),
        ...(kind === 'full' ? { marketing_checkbox: marketing } : {}),
      },
      set: {
        is_business_email: businessEmail,
        ...(role && r ? { role: role.roleCode, seniority: r.seniority, role_family: r.roleFamily, decision_maker: r.decisionMaker, non_buyer: r.nonBuyer } : {}),
        ...(kind === 'full' && marketing ? { marketing_consent: true } : {}),
      },
    });
  } else if (role) {
    const r = deriveRole(role.roleCode);
    const resubmitted = state.roleDone;
    await track('reviewer_role_completed', {
      userId,
      properties: { role: role.roleCode, seniority: r.seniority, role_family: r.roleFamily, marketing_checkbox: marketing, resubmitted },
      set: {
        role: role.roleCode, seniority: r.seniority, role_family: r.roleFamily, decision_maker: r.decisionMaker, non_buyer: r.nonBuyer,
        ...(marketing ? { marketing_consent: true } : {}),
      },
    });
  }
  await identifyWorkspace(userId);

  const redirectPath = safeCallbackUrl(typeof body?.callbackUrl === 'string' ? body.callbackUrl : null);
  const res = NextResponse.json({ redirectPath });

  // The gate's cookie subject is the WorkOS user id under AUTH_PROVIDER=workos and the
  // local users.id under nextauth; sign the one the middleware will verify against.
  const secret = process.env.PROFILE_COOKIE_SECRET;
  const subject = authProvider() === 'workos' ? state.workosUserId : userId;
  if (role && secret && subject) {
    res.headers.append(
      'Set-Cookie',
      profileCookieHeader(await signProfileCookie(subject, secret), process.env.NODE_ENV === 'production')
    );
  }
  return res;
}
