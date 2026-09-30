import type { Lamports, VoteSnapshot } from "@/types/crowdfunding";

export const LAMPORTS_PER_SOL = 1_000_000_000n;

export function asLamports(value: Lamports): bigint {
  if (!/^\d+$/.test(value))
    throw new Error(
      "Invalid lamports: expected a non-negative integer string.",
    );
  return BigInt(value);
}

export function parseSol(value: string): Lamports {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(trimmed)) {
    throw new Error(
      "Enter a SOL amount using up to 9 decimal places, for example 0.01.",
    );
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const amount =
    BigInt(whole) * LAMPORTS_PER_SOL + BigInt(fraction.padEnd(9, "0"));
  if (amount <= 0n) throw new Error("Enter an amount greater than 0 SOL.");
  return amount.toString();
}

export function formatSol(value: Lamports): string {
  const amount = asLamports(value);
  const whole = amount / LAMPORTS_PER_SOL;
  const fraction = (amount % LAMPORTS_PER_SOL)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Integer basis points; conversion to Number happens only after the ratio is bounded. */
export function percentOf(part: Lamports, total: Lamports): number {
  const denominator = asLamports(total);
  if (denominator === 0n) return 0;
  const numerator = asLamports(part);
  return (
    Number(
      ((numerator > denominator ? denominator : numerator) * 10_000n) /
        denominator,
    ) / 100
  );
}

export function voteResults(vote: VoteSnapshot) {
  const total = asLamports(vote.totalWeight);
  const approve = asLamports(vote.approveWeight);
  const reject = asLamports(vote.rejectWeight);
  if (approve + reject > total)
    throw new Error("Vote weights exceed the snapshot total.");
  return {
    approve: percentOf(vote.approveWeight, vote.totalWeight),
    reject: percentOf(vote.rejectWeight, vote.totalWeight),
    notVoted: percentOf(
      (total - approve - reject).toString(),
      vote.totalWeight,
    ),
    // Compare integers directly; rounding for display must never determine approval.
    thresholdReached:
      total > 0n && approve * 100n >= total * BigInt(vote.thresholdPercent),
  };
}
