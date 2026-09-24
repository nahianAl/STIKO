/**
 * auth() — who is making this request, as a local users row.
 *
 * Called from 60 places across the API. It keeps its name and a fixed return
 * shape so that swapping the sign-in provider underneath changes none of them;
 * that is the whole blast-radius strategy of the WorkOS migration.
 */
import { auth as nextAuth } from '@/lib/nextauth';
import { toAppSession, type AppSession } from '@/lib/appSession';

export type { AppSession };

export async function auth(): Promise<AppSession | null> {
  const session = await nextAuth();
  return toAppSession(session?.user);
}
