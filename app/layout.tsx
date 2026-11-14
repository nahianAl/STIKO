import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import { manrope } from "@/lib/fonts";
import { ToastProvider } from "@/components/ui/Toast";
import { authProvider } from "@/lib/authProvider";
import UpgradeDialogHost from "@/components/billing/UpgradeDialog";

export const metadata: Metadata = {
  title: "stiko",
  description: "Review and approval for construction and design teams",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Manrope is the product typeface everywhere now, not just the review view.
    <html lang="en" className={manrope.variable}>
      <body className="antialiased min-h-screen font-manrope">
        <Providers provider={authProvider()}>
          <ToastProvider>
            {children}
            <UpgradeDialogHost />
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
