/** The 409 from POST /api/projects when the company questions are still unanswered (spec §5). */
export const COMPANY_PROFILE_REQUIRED = 'company_profile_required';

export async function isCompanyProfileRequired(res: Response): Promise<boolean> {
  if (res.status !== 409) return false;
  const data = await res.clone().json().catch(() => null);
  return data?.code === COMPANY_PROFILE_REQUIRED;
}

export function companyProfilePath(returnTo: string): string {
  return `/welcome?${new URLSearchParams({ callbackUrl: returnTo }).toString()}`;
}
