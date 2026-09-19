import { redirect } from 'next/navigation';

/**
 * Retired. Everything this page did — roles, version scoping, download
 * permission, pending invites, resend and revoke — now lives in the project
 * panel on the dashboard, reachable without leaving it.
 *
 * A redirect rather than a deletion because this URL has been linked from the
 * package settings nav for months and may sit in a bookmark or an email.
 */
export default function RetiredPackagePeoplePage() {
  redirect('/');
}
