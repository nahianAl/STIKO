'use client';

import { AuthClientProvider } from '@/lib/authClient';
import type { AuthProviderName } from '@/lib/authProvider';
import AnalyticsProvider from '@/components/analytics/AnalyticsProvider';

export default function Providers({
  provider,
  children,
}: {
  provider: AuthProviderName;
  children: React.ReactNode;
}) {
  return (
    <AuthClientProvider provider={provider}>
      <AnalyticsProvider>{children}</AnalyticsProvider>
    </AuthClientProvider>
  );
}
