import { address, getAddressEncoder } from "@solana/kit";

export interface RememberedWallet {
  address: string;
  label: string;
}

export const WALLET_STORAGE_KEY = "openfunds-public-wallets-v1";

/** Public addresses are conveniences, never proof of ownership or signers. */
export function readRememberedWallets(raw: string | null): RememberedWallet[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const result: RememberedWallet[] = [];
    for (const item of parsed.slice(0, 12)) {
      if (!item || typeof item !== "object" || typeof item.address !== "string")
        continue;
      try {
        if (
          getAddressEncoder().encode(address(item.address)).length !== 32 ||
          seen.has(item.address)
        )
          continue;
      } catch {
        continue;
      }
      seen.add(item.address);
      result.push({
        address: item.address,
        label:
          typeof item.label === "string" ? item.label.trim().slice(0, 60) : "",
      });
    }
    return result;
  } catch {
    return [];
  }
}

export function rememberWallet(
  wallets: RememberedWallet[],
  publicAddress: string,
): RememberedWallet[] {
  address(publicAddress);
  if (wallets.some((wallet) => wallet.address === publicAddress))
    return wallets;
  return [...wallets.slice(-11), { address: publicAddress, label: "" }];
}
