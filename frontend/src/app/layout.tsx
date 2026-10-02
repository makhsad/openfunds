import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import "./projects.css";
import { ProjectProvider } from "@/hooks/use-projects";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "OpenFunds | Community Crowdfunding",
  description:
    "Create and support campaigns on Solana Devnet. Track campaign vaults, sponsor contributions and confirmed transactions across devices.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Suspense
          fallback={
            <main className="of-container of-page" role="status">
              Loading OpenFunds…
            </main>
          }
        >
          <ProjectProvider>
            <AppShell>{children}</AppShell>
          </ProjectProvider>
        </Suspense>
      </body>
    </html>
  );
}
