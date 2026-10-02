import { ProjectsExplore } from "@/components/projects-explore";
import { DevnetOverview } from "@/features/solana/devnet-overview";

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  return mode === "demo" ? (
    <ProjectsExplore />
  ) : (
    <DevnetOverview mode="catalog" />
  );
}
