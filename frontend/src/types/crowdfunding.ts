/** Decimal integer strings only. Never pass SOL floats across the client boundary. */
export type Lamports = string;
export type Scenario = "voting" | "funding";
export type VoteChoice = "approve" | "reject";
export type DemoOutcome = "success" | "error" | "cancel";
export type MilestoneStatus = "released" | "voting" | "locked";

export interface Milestone {
  id: string;
  title: string;
  description: string;
  amount: Lamports;
  status: MilestoneStatus;
}

export interface VoteSnapshot {
  milestoneId: string;
  totalWeight: Lamports;
  approveWeight: Lamports;
  rejectWeight: Lamports;
  userWeight: Lamports;
  userVote: VoteChoice | null;
  thresholdPercent: number;
}

export interface Transaction {
  id: string;
  type: "contribution" | "release" | "vote";
  amount: Lamports | null;
  voteChoice?: VoteChoice;
  sender: string;
  recipient: string;
  status: "confirmed";
  createdAt: string;
}

export interface Campaign {
  id: string;
  title: string;
  description: string;
  category: string;
  creator: string;
  phase: Scenario;
  goal: Lamports;
  raised: Lamports;
  locked: Lamports;
  released: Lamports;
  backers: number;
  milestones: Milestone[];
  voting: VoteSnapshot | null;
  transactions: Transaction[];
}

export interface DemoWallet {
  address: string;
  balance: Lamports;
}

export interface CrowdfundingSnapshot {
  campaign: Campaign;
  wallet: DemoWallet | null;
}

export type OperationKind = "connect" | "support" | "vote";
export type OperationState =
  | { status: "idle" }
  | { status: "pending"; kind: OperationKind; message: string }
  | { status: "success" | "error" | "cancelled"; message: string };

/** Replace the mock implementation with an adapter without changing UI components. */
export interface CrowdfundingClient {
  getSnapshot(signal?: AbortSignal): Promise<CrowdfundingSnapshot>;
  connectWallet(signal?: AbortSignal): Promise<CrowdfundingSnapshot>;
  disconnectWallet(): CrowdfundingSnapshot;
  support(
    amount: Lamports,
    signal?: AbortSignal,
  ): Promise<CrowdfundingSnapshot>;
  vote(choice: VoteChoice, signal?: AbortSignal): Promise<CrowdfundingSnapshot>;
}
