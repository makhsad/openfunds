import type {
  DiscussionMessageData,
  DiscussionScope,
} from "@/types/discussion";

export interface DemoDiscussionContext extends DiscussionScope {
  label: string;
  creator: string;
}

// Two mock projects, with a second campaign on the first project to exercise both IDs.
export const demoDiscussionContexts: readonly DemoDiscussionContext[] = [
  {
    projectId: "community-project",
    campaignId: "demo-campaign-1",
    label: "Community Project · Campaign 1",
    creator: "Build3rDAO",
  },
  {
    projectId: "neighborhood-garden",
    campaignId: "demo-campaign-1",
    label: "Neighborhood Garden · Campaign 1",
    creator: "Garden Collective",
  },
  {
    projectId: "community-project",
    campaignId: "demo-campaign-2",
    label: "Community Project · Campaign 2",
    creator: "Build3rDAO",
  },
];

export function createMockDiscussionMessages(
  context: DemoDiscussionContext,
): DiscussionMessageData[] {
  const garden = context.projectId === "neighborhood-garden";
  const secondCampaign = context.campaignId === "demo-campaign-2";
  const texts = garden
    ? [
        "Welcome to the garden project. Our first milestone is a shared plan for the space.",
        "Could the plan include a few accessible raised beds?",
        "I would love to see a clear materials budget before the next vote.",
        "Project update: the draft layout and materials list are ready for community review.",
        "The shared layout looks promising. Thanks for keeping everyone involved!",
      ]
    : secondCampaign
      ? [
          "Welcome to the second campaign. This discussion is reserved for the next phase of Community Project.",
          "Which improvements will this campaign focus on first?",
          "A short progress checklist would help us review each step.",
          "Project update: we have outlined the next set of deliverables for this campaign.",
          "Thanks for giving this phase its own clear plan.",
        ]
      : [
          "Welcome, backers! Use this space to discuss Community Project and the work behind each milestone.",
          "What will be included in the MVP milestone?",
          "I would like to see the prototype feedback summarized before the next release.",
          "Project update: the prototype is complete. We are preparing the MVP deliverables for backer review.",
          "Thanks for sharing the progress. A clear checklist will make the next vote easier.",
        ];
  return texts.map((text, index) => ({
    projectId: context.projectId,
    campaignId: context.campaignId,
    id: `seed-${index + 1}`,
    ...(index === 2
      ? { walletAddress: "demo-wallet-cedar-7c42" }
      : {
          authorName:
            index === 0 || index === 3
              ? context.creator
              : index === 1
                ? "Alex"
                : "Jordan",
        }),
    role: index === 0 || index === 3 ? "creator" : "backer",
    text,
    createdAt: `2026-09-29T${10 + index}:00:00Z`,
    type: index === 3 ? "update" : "message",
  }));
}
