import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stiko",
  description: "Creative review and approval platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
