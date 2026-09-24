/**
 * The WorkOS API client, for the routes that call it directly.
 *
 * Taken from authkit-nextjs's getWorkOS() so the session layer and Stiko's own
 * calls share one configured client. Imported lazily: a deploy running
 * NextAuth never loads WorkOS or needs its environment variables.
 */
import type { WorkOS } from '@workos-inc/node';

export type WorkosAuthResponse = Awaited<
  ReturnType<WorkOS['userManagement']['authenticateWithPassword']>
>;
export type WorkosUser = WorkosAuthResponse['user'];

export async function workos(): Promise<WorkOS> {
  const { getWorkOS } = await import('@workos-inc/authkit-nextjs');
  return getWorkOS();
}

export function workosClientId(): string {
  const id = process.env.WORKOS_CLIENT_ID;
  if (!id) {
    throw new Error('WORKOS_CLIENT_ID must be set when AUTH_PROVIDER=workos.');
  }
  return id;
}
