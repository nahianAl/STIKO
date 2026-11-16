import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { authProvider } from '@/lib/authProvider';
import { safeCallbackUrl } from '@/lib/callbackUrl';
import { isBusinessEmail, trackForSize, validateProfile } from '@/lib/kyc/profile';
import { profileCookieHeader, signProfileCookie } from '@/lib/kyc/profileCookie';
import { CONSENT_COOKIE, consentValue } from '@/lib/geo';
import { ensureWorkspace } from '@/lib/workspaces';
import { identifyWorkspace, track } from '@/lib/analytics/server';

/** POST — save the business profile (spec §3.5). Idempotent. */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  const result = validateProfile(body);
  if (!result.ok) return NextResponse.json({ error: 'invalid', field: result.field }, { status: 400 });
  const a = result.answers;

  const country = request.headers.get('x-vercel-ip-country');
  const region = request.headers.get('x-vercel-ip-country-region');
  const consent = consentValue(cookies().get(CONSENT_COOKIE)?.value);

  const workspaceId = await ensureWorkspace(userId);
  const users = await sql`
    SELECT email, utm_first, workos_user_id, profile_completed_at FROM users WHERE id = ${userId}
  `;
  const user = users[0] as
    | { email: string; utm_first: unknown; workos_user_id: string | null; profile_completed_at: string | null }
    | undefined;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const resubmitted = user.profile_completed_at !== null;
  const trackValue = trackForSize(a.companySizeBand);
  const businessEmail = isBusinessEmail(user.email);
  const utmFirst = user.utm_first ? JSON.stringify(user.utm_first) : null;

  // One transaction: the workspace answers and users.profile_completed_at must
  // land together, or the gate and the data disagree about whether this user
  // has a profile.
  await sql.transaction([
    sql`
      UPDATE workspaces SET
        pillar = ${a.pillar}, segment_id = ${a.segmentId},
        business_type_other = ${a.businessTypeOther}, client_model = ${a.clientModel},
        company_size_band = ${a.companySizeBand}, track = ${trackValue},
        country = COALESCE(${country}, country), region = COALESCE(${region}, region),
        is_business_email = ${businessEmail},
        utm_first = COALESCE(utm_first, ${utmFirst}::jsonb)
      WHERE id = ${workspaceId}
    `,
    sql`
      UPDATE users SET
        role = ${a.role},
        profile_completed_at = COALESCE(profile_completed_at, now()),
        is_business_email = ${businessEmail},
        marketing_consent = ${a.marketingConsent},
        marketing_consent_at = CASE WHEN ${a.marketingConsent} THEN now() ELSE NULL END,
        marketing_consent_method = CASE WHEN ${a.marketingConsent} THEN 'welcome_checkbox' ELSE NULL END,
        analytics_consent = COALESCE(${consent}, analytics_consent)
      WHERE id = ${userId}
    `,
  ]);

  // track() reads the workspace context after the transaction, so the event
  // already carries the new segment_id and track. The explicit `track` property
  // here is overwritten by the standard property with the same value.
  await track('company_profile_completed', {
    userId,
    properties: {
      pillar: a.pillar, segment_id: a.segmentId, client_model: a.clientModel,
      company_size_band: a.companySizeBand, role: a.role, country, region,
      track: trackValue, marketing_consent: a.marketingConsent, resubmitted,
    },
    set: { role: a.role, marketing_consent: a.marketingConsent, is_business_email: businessEmail },
  });
  await identifyWorkspace(userId);

  const redirectPath = safeCallbackUrl(typeof body?.callbackUrl === 'string' ? body.callbackUrl : null);
  const res = NextResponse.json({ redirectPath });

  // The gate's cookie subject is the WorkOS user id under AUTH_PROVIDER=workos
  // and the local users.id under nextauth; sign the same one the middleware
  // will verify against. profileCookieHeader keeps one cookie format with the
  // middleware's own cache write.
  const secret = process.env.PROFILE_COOKIE_SECRET;
  const subject = authProvider() === 'workos' ? user.workos_user_id : userId;
  if (secret && subject) {
    res.headers.append(
      'Set-Cookie',
      profileCookieHeader(await signProfileCookie(subject, secret), process.env.NODE_ENV === 'production')
    );
  }
  return res;
}
