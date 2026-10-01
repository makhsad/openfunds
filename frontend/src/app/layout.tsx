import type { Metadata } from "next";
import "./globals.css";
import "./projects.css";
import { ProjectProvider } from "@/hooks/use-projects";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "OpenFunds | Community Crowdfunding",
  description:
    "Support projects you believe in. Funds are released milestone by milestone, with backers voting on each step.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ProjectProvider>
          <AppShell>{children}</AppShell>
        </ProjectProvider>
      </body>
    </html>
  );
}
