/**
 * Everything Stiko learns at account creation: signup source, the inviter's
 * workspace, first/last-touch UTMs, ad click IDs and consent. Saved on the
 * user (the permanent copy), then sent as signup_completed.
 *
 * Never throws: a signup must succeed even if this fails.
 */
import type { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { clickIds, FIRST_TOUCH_COOKIE, LAST_TOUCH_COOKIE, parseTouchCookie, signupSource } from '@/lib/attribution';
import { analyticsConsentAtSignup, CONSENT_COOKIE } from '@/lib/geo';
import { isBusinessEmail } from '@/lib/kyc/profile';
import { ensureWorkspace } from '@/lib/workspaces';
import { track } from '@/lib/analytics/server';

function prefixed(prefix: string, touch: Record<string, string> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(touch ?? {})) out[`${prefix}${k}`] = v;
  return out;
}

export async function recordSignup(
  request: NextRequest,
  userId: string,
  email: string,
  inviteToken: string | null | undefined
): Promise<void> {
  try {
    const c = request.cookies;
    const first = parseTouchCookie(c.get(FIRST_TOUCH_COOKIE)?.value);
    const last = parseTouchCookie(c.get(LAST_TOUCH_COOKIE)?.value);
    const ids = clickIds({
      first, last,
      fbc: c.get('_fbc')?.value, fbp: c.get('_fbp')?.value, ga: c.get('_ga')?.value,
    });
    const source = signupSource(inviteToken);
    const consent = analyticsConsentAtSignup(c.get(CONSENT_COOKIE)?.value, request.headers.get('x-vercel-ip-country'));
    const businessEmail = isBusinessEmail(email);

    let inviteId: string | null = null;
    let inviterWorkspaceId: string | null = null;
    if (inviteToken) {
      const rows = await sql`SELECT id, invited_by FROM invite_tokens WHERE token = ${inviteToken} LIMIT 1`;
      if (rows[0]) {
        inviteId = rows[0].id as string;
        if (rows[0].invited_by) inviterWorkspaceId = await ensureWorkspace(rows[0].invited_by as string);
      }
    }

    await ensureWorkspace(userId);
    await sql`
      UPDATE users SET
        signup_source = ${source}, invite_id = ${inviteId}, inviter_workspace_id = ${inviterWorkspaceId},
        is_business_email = ${businessEmail},
        utm_first = ${first ? JSON.stringify(first) : null}::jsonb,
        utm_last = ${last ? JSON.stringify(last) : null}::jsonb,
        click_ids = ${JSON.stringify(ids)}::jsonb,
        analytics_consent = ${consent}
      WHERE id = ${userId}
    `;

    const props = {
      signup_source: source, invite_id: inviteId, inviter_workspace_id: inviterWorkspaceId,
      is_business_email: businessEmail, ...prefixed('first_', first), ...prefixed('last_', last),
    };
    await track('signup_completed', {
      userId,
      properties: props,
      set: { signup_source: source, inviter_workspace_id: inviterWorkspaceId, is_business_email: businessEmail },
      setOnce: prefixed('first_', first),
    });
    if (source === 'reviewer_invite') {
      await track('reviewer_signup_completed', {
        userId, properties: { invite_id: inviteId, inviter_workspace_id: inviterWorkspaceId },
      });
    }
  } catch (err) {
    console.error('[analytics] recordSignup failed', err);
  }
}
