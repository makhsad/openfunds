import type {
  Campaign,
  Lamports,
  Milestone,
  VoteChoice,
  Transaction,
} from "./crowdfunding";
import type {
  DiscussionMessageData,
  DiscussionMessageType,
} from "./discussion";

export type DemoIdentityId = "creator" | "backer-a" | "backer-b" | "visitor";
export interface DemoIdentity {
  id: DemoIdentityId;
  name: string;
  description: string;
}
export const DEMO_IDENTITIES: readonly DemoIdentity[] = [
  {
    id: "creator",
    name: "Creator",
    description: "Build and manage your projects",
  },
  {
    id: "backer-a",
    name: "Backer A",
    description: "Support projects and review progress",
  },
  {
    id: "backer-b",
    name: "Backer B",
    description: "An independent demo supporter",
  },
  {
    id: "visitor",
    name: "Visitor",
    description: "Explore without posting or contributing",
  },
];
export const CATEGORIES = [
  "Technology",
  "Education",
  "Open Source",
  "Environment",
  "Community",
  "Gaming",
  "Social Impact",
  "Other",
] as const;
export type ProjectStatus = "draft" | "funding" | "active" | "completed";
export type ProjectMilestoneStatus =
  | "locked"
  | "in_progress"
  | "submitted"
  | "voting"
  | "approved"
  | "rejected"
  | "released";
export interface MilestoneSubmission {
  summary: string;
  evidenceUrl?: string;
  demoUrl?: string;
  githubUrl?: string;
}
export interface ProjectVoting {
  weights: Record<string, Lamports>;
  votes: Record<string, VoteChoice>;
  totalWeight: Lamports;
  approveWeight: Lamports;
  rejectWeight: Lamports;
  thresholdPercent: number;
}
export interface ProjectMilestone extends Omit<Milestone, "status"> {
  status: ProjectMilestoneStatus;
  submission?: MilestoneSubmission;
  voting?: ProjectVoting;
}
export interface ProjectPlan {
  what: string;
  why: string;
  audience: string;
  roadmap: string;
}
export interface ProjectLinks {
  website?: string;
  github?: string;
  demo?: string;
}
export interface ProjectTransaction extends Omit<Transaction, "status"> {
  status: "pending" | "confirmed" | "failed";
  /** Only a future verified Solana adapter may populate this. */
  signature?: string;
}
export interface Project extends Omit<
  Campaign,
  "milestones" | "voting" | "transactions"
> {
  campaignId: number;
  creatorId: string;
  creatorName: string;
  creatorWallet?: string;
  shortDescription: string;
  logoUrl?: string;
  coverUrl?: string;
  gallery?: string[];
  plan: ProjectPlan;
  links: ProjectLinks;
  status: ProjectStatus;
  createdAt: string;
  milestones: ProjectMilestone[];
  transactions: ProjectTransaction[];
}
export interface ProjectInput {
  title: string;
  shortDescription: string;
  description: string;
  category: string;
  logoUrl?: string;
  coverUrl?: string;
  gallery?: string[];
  goal: Lamports;
  plan: ProjectPlan;
  links: ProjectLinks;
  milestones: { title: string; description: string; amount: Lamports }[];
}
export interface ProjectState {
  version: 1;
  identityId: DemoIdentityId;
  projects: Project[];
  contributions: Record<string, Record<string, Lamports>>;
  messages: DiscussionMessageData[];
  balances: Record<DemoIdentityId, Lamports>;
}
export interface CampaignRepository {
  readonly mode: "demo";
  getSnapshot(): ProjectState;
  subscribe(listener: () => void): () => void;
  setIdentity(id: DemoIdentityId): void;
  reset(): void;
  createProject(input: ProjectInput, publish: boolean): Project;
  updateProject(id: string, input: ProjectInput, publish?: boolean): Project;
  publishProject(id: string): Project;
  contribute(id: string, amount: Lamports): void;
  startMilestone(id: string, milestoneId: string): void;
  submitMilestone(
    id: string,
    milestoneId: string,
    submission: MilestoneSubmission,
  ): void;
  vote(id: string, milestoneId: string, choice: VoteChoice): void;
  releaseMilestone(id: string, milestoneId: string): void;
  postMessage(id: string, text: string, type: DiscussionMessageType): void;
}
