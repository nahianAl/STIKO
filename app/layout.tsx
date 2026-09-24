import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import { manrope } from "@/lib/fonts";
import { ToastProvider } from "@/components/ui/Toast";
import { authProvider } from "@/lib/authProvider";

export const metadata: Metadata = {
  title: "Stiko",
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
          <ToastProvider>{children}</ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
