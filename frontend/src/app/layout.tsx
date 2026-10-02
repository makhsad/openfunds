import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import "./projects.css";
import { PlatformProvider } from "@/features/platform/platform-provider";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "OpenFunds | Community Crowdfunding",
  description:
    "Create and support campaigns on Solana Devnet. Track campaign vaults, sponsor contributions and confirmed transactions across devices.",
  robots: { index: false, follow: false },
  other: { google: "notranslate" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" translate="no" className="notranslate">
      <body>
        <Suspense
          fallback={
            <main className="of-container of-page" role="status">
              Загружаем OpenFunds…
            </main>
          }
        >
          <PlatformProvider>
            <AppShell>{children}</AppShell>
          </PlatformProvider>
        </Suspense>
      </body>
    </html>
  );
}
