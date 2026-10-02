import type { Metadata } from "next";
import { SolanaTest } from "@/features/solana/solana-test";

export const metadata: Metadata = {
  title: "OpenFunds | Devnet campaign",
  description:
    "Read this OpenFunds campaign, contribution history and vault balance on Solana Devnet.",
};

export default async function DevnetCampaignPage({
  params,
}: {
  params: Promise<{ creator: string }>;
}) {
  const { creator } = await params;
  return <SolanaTest initialCreator={creator} projectView />;
}
