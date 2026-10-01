/** The UI repository is deliberately independent from any wallet or RPC SDK. */
export interface SolanaCampaignGateway {
  /** Must return a verified signature from an actual signed transaction. */
  initializeCampaign(): Promise<{ campaignAddress: string; signature: string }>;
  contribute(
    campaignAddress: string,
    amountLamports: string,
  ): Promise<{ signature: string }>;
  readCampaign(campaignAddress: string): Promise<{
    creatorAddress: string;
    totalContributedLamports: string;
    vaultBalanceLamports: string;
    contributionLamports: string;
  }>;
}

export const SOLANA_CAPABILITIES = Object.freeze({
  frontendConnected: false,
  source: "solana/anchor/programs/openfunds/src/lib.rs",
  availableProgramInstructions: ["initialize_campaign", "contribute"] as const,
  campaignSeed: ["campaign", "creator public key"] as const,
  multipleCampaignsPerCreator: false,
  milestoneVoting: false,
  fundRelease: false,
});

/** Fail explicitly if a caller requests blockchain access without a real adapter. */
export function requireSolanaGateway(
  gateway?: SolanaCampaignGateway,
): SolanaCampaignGateway {
  if (!gateway)
    throw new Error(
      "Solana wallet and RPC integration are not connected. Use the clearly labelled local demo.",
    );
  return gateway;
}
