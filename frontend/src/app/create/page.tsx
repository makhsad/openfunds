import { ProjectEditor } from "@/components/project-editor";
import { SolanaTest } from "@/features/solana/solana-test";

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  return mode === "demo" ? <ProjectEditor /> : <SolanaTest createView />;
}
