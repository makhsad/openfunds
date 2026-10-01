import type { Project, ProjectState } from "../types/project";

const seeds = [
  {
    id: "sol-edu",
    title: "SolEdu",
    category: "Education",
    creatorId: "creator",
    creatorName: "Creator",
    image: "education",
    goal: 20,
    a: "7400000000",
    b: "5000000000",
    short: "Make learning open to everyone.",
    description:
      "A community-owned learning space with practical courses, accessible lessons, and scholarships for curious people everywhere.",
    what: "An open learning platform with bite-sized courses and verifiable learning achievements.",
    why: "Quality education should be accessible regardless of location or income.",
    audience:
      "Students, independent learners, and educators sharing practical skills.",
  },
  {
    id: "green-chain",
    title: "GreenChain",
    category: "Environment",
    creatorId: "green-collective",
    creatorName: "Green Collective",
    image: "environment",
    goal: 15,
    a: "4000000000",
    b: "4700000000",
    short: "Small actions. A greener tomorrow.",
    description:
      "Help neighborhoods restore local ecosystems with transparent budgets, shared progress reports, and community-led planting days.",
    what: "A neighborhood toolkit for funding and tracking local restoration projects.",
    why: "Local climate action needs clear budgets and community accountability.",
    audience:
      "Neighborhood groups, volunteers, and people who care about their environment.",
  },
  {
    id: "gamefi-hub",
    title: "GameFi Hub",
    category: "Gaming",
    creatorId: "play-studio",
    creatorName: "Play Studio",
    image: "gaming",
    goal: 50,
    a: "15000000000",
    b: "10100000000",
    short: "Better games, built together.",
    description:
      "An indie game collective building an accessible cooperative adventure. Backers help shape development through milestone reviews and playtest feedback.",
    what: "A cooperative adventure game with an open development roadmap.",
    why: "Independent creators need an accountable path from prototype to launch.",
    audience:
      "Players, indie developers, and communities that enjoy building together.",
  },
  {
    id: "open-source-tools",
    title: "OpenSource Tools",
    category: "Open Source",
    creatorId: "creator",
    creatorName: "Creator",
    image: "opensource",
    goal: 30,
    a: "10000000000",
    b: "8600000000",
    short: "Useful tools. Open to everyone.",
    description:
      "A friendly collection of open source developer tools, better documentation, and starter projects that lower the barrier to building on Solana.",
    what: "Accessible developer tooling with examples and clear documentation.",
    why: "Developers should spend more time building and less time wrestling with setup.",
    audience:
      "Open source contributors, students, and independent product builders.",
  },
  {
    id: "community-hub",
    title: "Community Hub",
    category: "Community",
    creatorId: "neighbors",
    creatorName: "Neighborhood Collective",
    image: "community",
    goal: 10,
    a: "2000000000",
    b: "1400000000",
    short: "A place for good ideas to meet.",
    description:
      "Turn an underused neighborhood space into a welcoming hub for workshops, shared resources, and community-led events.",
    what: "A shared space and event program for neighborhood collaboration.",
    why: "Strong communities grow when people have places to meet and make things.",
    audience:
      "Local residents, community organizers, and small creative groups.",
  },
  {
    id: "health-dao",
    title: "HealthDAO",
    category: "Social Impact",
    creatorId: "care-network",
    creatorName: "Care Network",
    image: "health",
    goal: 10,
    a: "3000000000",
    b: "2200000000",
    short: "Bring better care a little closer.",
    description:
      "Community-led health education and resource directories that make reliable information easier to find. This project provides educational resources, not medical advice.",
    what: "A clear, accessible directory of community health resources and workshops.",
    why: "People need a simpler way to discover trusted local support.",
    audience:
      "Community organizations, health educators, and underserved neighborhoods.",
  },
] as const;

/** Reproducible local demo fixtures. These are not on-chain balances or wallets. */
export function createProjectSeed(): ProjectState {
  const contributions: ProjectState["contributions"] = {};
  const projects: Project[] = seeds.map((seed, index) => {
    const goal = BigInt(seed.goal) * 1_000_000_000n;
    const raised = BigInt(seed.a) + BigInt(seed.b);
    contributions[seed.id] = { "backer-a": seed.a, "backer-b": seed.b };
    return {
      id: seed.id,
      campaignId: index + 1,
      title: seed.title,
      category: seed.category,
      creatorId: seed.creatorId,
      creatorName: seed.creatorName,
      creator: seed.creatorName,
      shortDescription: seed.short,
      description: seed.description,
      logoUrl: `/images/project-${seed.image}.svg`,
      coverUrl: `/images/project-${seed.image}.svg`,
      gallery: [],
      goal: goal.toString(),
      raised: raised.toString(),
      locked: raised.toString(),
      released: "0",
      backers: 2,
      status: "funding",
      phase: "funding",
      createdAt: `2026-09-${24 + index}T10:00:00.000Z`,
      plan: {
        what: seed.what,
        why: seed.why,
        audience: seed.audience,
        roadmap:
          "Prototype and community feedback → a usable MVP → a public release with documentation.",
      },
      links: {},
      milestones: [
        {
          id: `${seed.id}-prototype`,
          title: "Prototype",
          description:
            "Build a working prototype and share early community feedback.",
          amount: (goal / 5n).toString(),
          status: "locked",
        },
        {
          id: `${seed.id}-mvp`,
          title: "MVP",
          description:
            "Deliver the core experience, test it with supporters, and document the results.",
          amount: ((goal * 3n) / 10n).toString(),
          status: "locked",
        },
        {
          id: `${seed.id}-release`,
          title: "Public release",
          description:
            "Open access, publish documentation, and launch with the community.",
          amount: (goal / 2n).toString(),
          status: "locked",
        },
      ],
      transactions: (
        [
          ["backer-a", "Backer A", seed.a],
          ["backer-b", "Backer B", seed.b],
        ] as const
      ).map(([id, sender, amount]) => ({
        id: `demo-seed-${seed.id}-${id}`,
        type: "contribution",
        amount,
        sender,
        recipient: "Demo project vault",
        status: "confirmed",
        createdAt: `2026-09-${24 + index}T12:00:00.000Z`,
      })),
    };
  });
  return {
    version: 1,
    identityId: "visitor",
    projects,
    contributions,
    balances: {
      creator: "100000000000",
      "backer-a": "100000000000",
      "backer-b": "100000000000",
      visitor: "0",
    },
    messages: projects.flatMap((project) => [
      {
        id: `seed-${project.id}-welcome`,
        projectId: project.id,
        campaignId: String(project.campaignId),
        authorName: project.creatorName,
        role: "creator" as const,
        type: "update" as const,
        text: "Welcome to our project! We will share progress and evidence here as each milestone takes shape. Thank you for being part of the journey.",
        createdAt: project.createdAt,
      },
    ]),
  };
}
