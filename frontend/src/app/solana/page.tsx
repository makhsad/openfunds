import type { Metadata } from "next";
import { SolanaTest } from "@/features/solana/solana-test";

export const metadata: Metadata = {
  title: "OpenFunds | Solana Devnet Test",
  description:
    "Connect Phantom and test campaign creation and contributions on Solana Devnet.",
};

export default function SolanaTestPage() {
  return <SolanaTest />;
}
