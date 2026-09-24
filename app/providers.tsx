'use client';

import { AuthClientProvider } from '@/lib/authClient';
import type { AuthProviderName } from '@/lib/authProvider';

export default function Providers({
  provider,
  children,
}: {
  provider: AuthProviderName;
  children: React.ReactNode;
}) {
  return <AuthClientProvider provider={provider}>{children}</AuthClientProvider>;
}
