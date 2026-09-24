'use client';

/**
 * Sign-in as the browser sees it, for whichever provider this deploy runs.
 *
 * Pages call useAuthSession() and useAuthActions() and never import
 * next-auth/react themselves. Under NextAuth these delegate to it, so
 * behaviour is exactly what it was; under WorkOS they talk to
 * /api/auth/workos/*. The provider arrives as a prop from the root layout,
 * the same env var the server reads, so the two cannot disagree.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  SessionProvider,
  signIn as nextAuthSignIn,
  signOut as nextAuthSignOut,
  useSession as useNextAuthSession,
} from 'next-auth/react';
import type { AuthProviderName } from '@/lib/authProvider';
import { toAppSession, type AppSession } from '@/lib/appSession';
import type { AuthResult } from '@/lib/authMessages';

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthSessionState {
  data: AppSession | null;
  status: SessionStatus;
  /** Re-read the session, e.g. after the profile name changed. */
  update: () => Promise<void>;
}

const ProviderContext = createContext<AuthProviderName>('nextauth');
const WorkosSessionContext = createContext<AuthSessionState | null>(null);

async function postAuth(url: string, body?: unknown): Promise<AuthResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => null)) as AuthResult | null;
    return data && data.ok === false ? data : { ok: false, error: 'unknown' };
  } catch {
    return { ok: false, error: 'unknown' };
  }
}

function WorkosSessionProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppSession | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');

  const update = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/workos/session', { cache: 'no-store' });
      const body = res.ok ? ((await res.json()) as { user: AppSession['user'] | null }) : null;
      const session = toAppSession(body?.user);
      setData(session);
      setStatus(session ? 'authenticated' : 'unauthenticated');
    } catch {
      setData(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    void update();
  }, [update]);

  const value = useMemo(() => ({ data, status, update }), [data, status, update]);
  return <WorkosSessionContext.Provider value={value}>{children}</WorkosSessionContext.Provider>;
}

export function AuthClientProvider({
  provider,
  children,
}: {
  provider: AuthProviderName;
  children: React.ReactNode;
}) {
  // NextAuth's SessionProvider stays mounted under WorkOS too: useAuthSession
  // calls useNextAuthSession unconditionally (hooks cannot be conditional),
  // and that hook throws without its provider. Under WorkOS it simply reports
  // no session.
  return (
    <ProviderContext.Provider value={provider}>
      <SessionProvider>
        {provider === 'workos' ? <WorkosSessionProvider>{children}</WorkosSessionProvider> : children}
      </SessionProvider>
    </ProviderContext.Provider>
  );
}

export function useAuthSession(): AuthSessionState {
  const provider = useContext(ProviderContext);
  const workos = useContext(WorkosSessionContext);
  const nextAuth = useNextAuthSession();
  const nextAuthUpdate = nextAuth.update;

  const nextAuthState = useMemo<AuthSessionState>(
    () => ({
      data: toAppSession(nextAuth.data?.user as { id?: string; name?: string | null; email?: string | null } | undefined),
      status: nextAuth.status,
      update: async () => {
        await nextAuthUpdate();
      },
    }),
    [nextAuth.data, nextAuth.status, nextAuthUpdate]
  );

  return provider === 'workos' && workos ? workos : nextAuthState;
}

export function useAuthActions() {
  const provider = useContext(ProviderContext);
  const refresh = useContext(WorkosSessionContext)?.update;

  const signInWithPassword = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (provider !== 'workos') {
        const result = await nextAuthSignIn('credentials', { email, password, redirect: false });
        return result?.error ? { ok: false, error: 'invalid_credentials' } : { ok: true };
      }
      const result = await postAuth('/api/auth/workos/sign-in', { email, password });
      if (result.ok) await refresh?.();
      return result;
    },
    [provider, refresh]
  );

  const signUp = useCallback(
    async (input: { name: string; email: string; password: string; inviteToken?: string }): Promise<AuthResult> => {
      if (provider !== 'workos') {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: input.name, email: input.email, password: input.password }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return {
            ok: false,
            error: res.status === 409 ? 'email_taken' : 'invalid_request',
            message: data.error,
          };
        }
        const result = await nextAuthSignIn('credentials', {
          email: input.email,
          password: input.password,
          redirect: false,
        });
        return result?.error
          ? { ok: false, error: 'unknown', message: 'Account created, but sign-in failed. Try signing in.' }
          : { ok: true };
      }
      const result = await postAuth('/api/auth/workos/sign-up', input);
      if (result.ok) await refresh?.();
      return result;
    },
    [provider, refresh]
  );

  const verifyEmail = useCallback(
    async (code: string): Promise<AuthResult> => {
      const result = await postAuth('/api/auth/workos/verify-email', { code });
      if (result.ok) await refresh?.();
      return result;
    },
    [refresh]
  );

  const resendCode = useCallback(() => postAuth('/api/auth/workos/resend-code'), []);

  const signOutTo = useCallback(
    async (callbackUrl: string) => {
      if (provider !== 'workos') {
        await nextAuthSignOut({ callbackUrl });
        return;
      }
      await postAuth('/api/auth/workos/sign-out');
      // A full navigation, not router.push: every component still holding the
      // old session is torn down rather than left showing it.
      window.location.assign(callbackUrl);
    },
    [provider]
  );

  return { signInWithPassword, signUp, verifyEmail, resendCode, signOutTo };
}
