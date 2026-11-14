import type { Metadata } from 'next';

// The root layout's title is the lowercase wordmark ("stiko"); match it.
export const metadata: Metadata = { title: 'Pricing · stiko' };

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
