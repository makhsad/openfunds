import { createSolanaRpc } from '@solana/kit';
import { CAMPAIGN_PUBLIC_ADDRESS, DEVNET_RPC_URL, getCampaignAddress } from './config.ts';

const LAMPORTS_PER_SOL = 1_000_000_000n;

export function formatSol(lamports: bigint): string {
  if (lamports < 0n) throw new Error('A wallet balance cannot be negative.');
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = (lamports % LAMPORTS_PER_SOL)
    .toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

// The optional public address also allows read-only verification without editing config.
export async function getCampaignBalance(publicAddress: string = CAMPAIGN_PUBLIC_ADDRESS) {
  const campaignAddress = getCampaignAddress(publicAddress);
  const rpc = createSolanaRpc(DEVNET_RPC_URL);
  const { value } = await rpc.getBalance(campaignAddress, {
    commitment: 'confirmed',
  }).send({ abortSignal: AbortSignal.timeout(15_000) });

  // Decimal strings preserve precision and can safely cross a JSON boundary.
  return {
    address: campaignAddress,
    network: 'devnet' as const,
    lamports: value.toString(),
    sol: formatSol(value),
  };
}
