import { ProjectDashboard } from "@/components/project-dashboard";
import { DevnetOverview } from "@/features/solana/devnet-overview";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  return mode === "demo" ? (
    <ProjectDashboard />
  ) : (
    <DevnetOverview mode="dashboard" />
  );
}
