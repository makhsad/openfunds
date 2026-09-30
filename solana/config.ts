import { address } from '@solana/kit';

export const DEVNET_RPC_URL = 'https://api.devnet.solana.com';

// Replace only this placeholder with the campaign PUBLIC address.
export const CAMPAIGN_PUBLIC_ADDRESS = 'EmscLo4seCRuU3nxe1oD26JsLatP16bRmfZXbgiLmsAF';

export function getCampaignAddress(value: string = CAMPAIGN_PUBLIC_ADDRESS) {
  const publicAddress = value.trim();
  if (!publicAddress || publicAddress === 'REPLACE_WITH_CAMPAIGN_PUBLIC_ADDRESS') {
    throw new Error('Set CAMPAIGN_PUBLIC_ADDRESS in solana/config.ts to your campaign public address.');
  }
  try {
    // Kit checks that this is a base58-encoded, 32-byte Solana address.
    return address(publicAddress);
  } catch {
    throw new Error('Invalid campaign public address: expected a base58-encoded, 32-byte Solana address.');
  }
}
