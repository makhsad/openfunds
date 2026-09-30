import { asLamports } from "@/lib/amounts";
import { createMockCampaign } from "@/services/mock-data";
import type {
  CrowdfundingClient,
  CrowdfundingSnapshot,
  DemoOutcome,
  Lamports,
  Scenario,
  VoteChoice,
} from "@/types/crowdfunding";

export class OperationCancelledError extends Error {
  constructor() {
    super("Operation cancelled. No demo funds or votes were changed.");
    this.name = "OperationCancelledError";
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OperationCancelledError());
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new OperationCancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** In-memory only. No wallet extension, RPC, persistence, signatures or network calls. */
export function createMockClient(
  scenario: Scenario,
  delayMs = 1000,
): CrowdfundingClient & { setOutcome(outcome: DemoOutcome): void } {
  const state: CrowdfundingSnapshot = {
    campaign: createMockCampaign(scenario),
    wallet: null,
  };
  let outcome: DemoOutcome = "success";
  let busy = false;
  let hasContributed = false;
  // A disconnected demo wallet retains its balance in this client session.
  let balance: Lamports = "120000000";
  const snapshot = () => structuredClone(state);

  async function transact(change: () => void, signal?: AbortSignal) {
    if (busy) throw new Error("Another demo operation is already pending.");
    busy = true;
    const chosenOutcome = outcome;
    try {
      await wait(delayMs, signal);
      if (signal?.aborted || chosenOutcome === "cancel")
        throw new OperationCancelledError();
      if (chosenOutcome === "error")
        throw new Error(
          "The demo operation failed. Nothing changed. Choose Success in Demo controls and try again.",
        );
      change();
      return snapshot();
    } finally {
      busy = false;
    }
  }

  return {
    setOutcome(next) {
      outcome = next;
    },
    async getSnapshot(signal) {
      await wait(Math.min(delayMs, 450), signal);
      return snapshot();
    },
    connectWallet(signal) {
      return transact(() => {
        state.wallet = {
          address: "Demo backer (you)",
          balance: state.wallet?.balance ?? balance,
        };
      }, signal);
    },
    disconnectWallet() {
      if (busy)
        throw new Error("Wait for the pending operation before disconnecting.");
      if (state.wallet) balance = state.wallet.balance;
      state.wallet = null;
      return snapshot();
    },
    support(amount: Lamports, signal) {
      return transact(() => {
        const wallet = state.wallet;
        const campaign = state.campaign;
        if (!wallet)
          throw new Error("Connect your demo wallet to support this project.");
        if (campaign.phase !== "funding")
          throw new Error("Contributions are closed during milestone voting.");
        const value = asLamports(amount);
        if (value <= 0n) throw new Error("Enter an amount greater than 0 SOL.");
        if (value > asLamports(wallet.balance))
          throw new Error("This amount exceeds your demo wallet balance.");
        const remaining =
          asLamports(campaign.goal) - asLamports(campaign.raised);
        if (value > remaining)
          throw new Error("This amount exceeds the remaining funding goal.");
        wallet.balance = (asLamports(wallet.balance) - value).toString();
        balance = wallet.balance;
        campaign.raised = (asLamports(campaign.raised) + value).toString();
        campaign.locked = (asLamports(campaign.locked) + value).toString();
        if (!hasContributed) {
          campaign.backers += 1;
          hasContributed = true;
        }
        campaign.transactions.unshift({
          id: `demo-${crypto.randomUUID()}`,
          type: "contribution",
          amount,
          sender: wallet.address,
          recipient: "OpenFunds Vault",
          status: "confirmed",
          createdAt: new Date().toISOString(),
        });
      }, signal);
    },
    vote(choice: VoteChoice, signal) {
      return transact(() => {
        const { campaign, wallet } = state;
        if (!wallet) throw new Error("Connect your demo wallet to vote.");
        const vote = campaign.voting;
        if (campaign.phase !== "voting" || !vote)
          throw new Error("There is no active milestone vote.");
        if (choice !== "approve" && choice !== "reject")
          throw new Error("Choose Approve or Reject.");
        if (vote.userVote)
          throw new Error(
            "Your vote has already been recorded for this milestone.",
          );
        if (asLamports(vote.userWeight) === 0n)
          throw new Error("This wallet has no weight in the voting snapshot.");
        const cast =
          asLamports(vote.approveWeight) + asLamports(vote.rejectWeight);
        if (cast + asLamports(vote.userWeight) > asLamports(vote.totalWeight))
          throw new Error("Invalid voting snapshot.");
        const key = choice === "approve" ? "approveWeight" : "rejectWeight";
        vote[key] = (
          asLamports(vote[key]) + asLamports(vote.userWeight)
        ).toString();
        vote.userVote = choice;
        campaign.transactions.unshift({
          id: `demo-${crypto.randomUUID()}`,
          type: "vote",
          amount: null,
          voteChoice: choice,
          sender: wallet.address,
          recipient: "MVP milestone vote",
          status: "confirmed",
          createdAt: new Date().toISOString(),
        });
      }, signal);
    },
  };
}
