import type { Campaign, Scenario, Transaction } from "@/types/crowdfunding";

const contributions: Transaction[] = [
  {
    id: "demo-contribution-3",
    type: "contribution",
    amount: "20000000",
    sender: "Demo backer (you)",
    recipient: "OpenFunds Vault",
    status: "confirmed",
    createdAt: "2026-09-28T14:30:00Z",
  },
  {
    id: "demo-contribution-4",
    type: "contribution",
    amount: "20000000",
    sender: "Demo backer C",
    recipient: "OpenFunds Vault",
    status: "confirmed",
    createdAt: "2026-09-28T09:00:00Z",
  },
  {
    id: "demo-contribution-2",
    type: "contribution",
    amount: "15000000",
    sender: "Demo backer B",
    recipient: "OpenFunds Vault",
    status: "confirmed",
    createdAt: "2026-09-27T10:15:00Z",
  },
  {
    id: "demo-contribution-1",
    type: "contribution",
    amount: "45000000",
    sender: "Demo backer A",
    recipient: "OpenFunds Vault",
    status: "confirmed",
    createdAt: "2026-09-26T09:00:00Z",
  },
];

export function createMockCampaign(scenario: Scenario): Campaign {
  const voting = scenario === "voting";
  return {
    id: "community-project",
    title: "Community Project",
    description:
      "Support projects you believe in. Funds are released milestone by milestone, with backers voting on each step.",
    category: "Community Crowdfunding",
    creator: "Build3rDAO",
    phase: scenario,
    goal: "100000000",
    raised: voting ? "100000000" : "40000000",
    locked: voting ? "80000000" : "40000000",
    released: voting ? "20000000" : "0",
    backers: voting ? 4 : 2,
    milestones: [
      {
        id: "prototype",
        title: "Prototype",
        description:
          "Validate the idea with a working prototype and early community feedback.",
        amount: "20000000",
        status: voting ? "released" : "locked",
      },
      {
        id: "mvp",
        title: "MVP",
        description:
          "Build the core experience, test it with early supporters, and share the results.",
        amount: "30000000",
        status: voting ? "voting" : "locked",
      },
      {
        id: "public-release",
        title: "Public Release",
        description:
          "Refine the experience, open access to everyone, and launch to the community.",
        amount: "50000000",
        status: "locked",
      },
    ],
    voting: voting
      ? {
          milestoneId: "mvp",
          totalWeight: "100000000",
          approveWeight: "45000000",
          rejectWeight: "15000000",
          userWeight: "20000000",
          userVote: null,
          thresholdPercent: 60,
        }
      : null,
    transactions: voting
      ? [
          {
            id: "demo-release-1",
            type: "release",
            amount: "20000000",
            sender: "OpenFunds Vault",
            recipient: "Build3rDAO",
            status: "confirmed",
            createdAt: "2026-09-29T12:00:00Z",
          },
          ...structuredClone(contributions),
        ]
      : [
          { ...contributions[2], amount: "20000000" },
          { ...contributions[3], amount: "20000000" },
        ],
  };
}
