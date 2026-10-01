import assert from "node:assert/strict";
import { test } from "node:test";
import { voteResults } from "../src/lib/amounts";
import {
  createDemoProjectRepository,
  getProjectRole,
  getUserContribution,
  MAX_LAMPORTS,
  PROJECT_STORAGE_KEY,
  type ProjectStorage,
} from "../src/services/project-repository";
import { createProjectSeed } from "../src/services/project-seed";
import type {
  CampaignRepository,
  ProjectInput,
  ProjectState,
} from "../src/types/project";

class MemoryStorage implements ProjectStorage {
  data = new Map<string, string>();
  failWrites = false;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("Quota exceeded");
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const timestamp = "2026-10-01T10:00:00.000Z";
function input(overrides: Partial<ProjectInput> = {}): ProjectInput {
  return {
    title: "Community learning",
    shortDescription: "A shared place to learn.",
    description: "Practical courses created with our local community.",
    category: "Education",
    goal: "3000000000",
    plan: {
      what: "An open course library",
      why: "Accessible learning",
      audience: "Students",
      roadmap: "Prototype, then launch",
    },
    links: { website: "https://example.com" },
    milestones: [
      {
        title: "Prototype",
        description: "Build and test the prototype",
        amount: "1000000000",
      },
      {
        title: "Launch",
        description: "Open the learning library",
        amount: "2000000000",
      },
    ],
    ...overrides,
  };
}
function setup(storage = new MemoryStorage()) {
  const repository = createDemoProjectRepository(storage, {
    now: () => timestamp,
  });
  repository.setIdentity("creator");
  const project = repository.createProject(input(), true);
  return { repository, storage, project };
}
function project(repository: CampaignRepository, id: string) {
  const found = repository
    .getSnapshot()
    .projects.find((entry) => entry.id === id);
  assert.ok(found);
  return found;
}
function atomicFailure(
  repository: CampaignRepository,
  act: () => unknown,
  pattern?: RegExp,
) {
  const snapshot = repository.getSnapshot();
  if (pattern) assert.throws(act, pattern);
  else assert.throws(act);
  assert.strictEqual(
    repository.getSnapshot(),
    snapshot,
    "a failed operation must not publish a partial snapshot",
  );
}
function fundedVote() {
  const result = setup();
  const { repository, project } = result;
  repository.setIdentity("backer-a");
  repository.contribute(project.id, "400000000");
  repository.setIdentity("backer-b");
  repository.contribute(project.id, "600000000");
  repository.setIdentity("creator");
  repository.startMilestone(project.id, project.milestones[0].id);
  repository.submitMilestone(project.id, project.milestones[0].id, {
    summary: "Prototype is ready.",
    evidenceUrl: "https://example.com/evidence",
  });
  return result;
}

test("deterministic seeds reconcile vault totals, contributions and unsigned local history", () => {
  const first = createProjectSeed();
  assert.deepEqual(first, createProjectSeed());
  assert.equal(first.identityId, "visitor");
  for (const item of first.projects) {
    assert.equal(
      BigInt(item.locked) + BigInt(item.released),
      BigInt(item.raised),
    );
    assert.equal(
      Object.values(first.contributions[item.id]).reduce(
        (sum, value) => sum + BigInt(value),
        0n,
      ),
      BigInt(item.raised),
    );
    assert.equal(
      item.transactions.reduce(
        (sum, entry) => sum + BigInt(entry.amount ?? "0"),
        0n,
      ),
      BigInt(item.raised),
    );
    assert.ok(item.transactions.every((entry) => !entry.signature));
    assert.equal(item.backers, 2);
  }
});

test("one creator can publish multiple independent projects with distinct campaign identifiers", () => {
  const { repository, project: first } = setup();
  const second = repository.createProject(input(), true);
  const third = repository.createProject(
    input({ title: "Another initiative" }),
    true,
  );
  assert.equal(new Set([first.id, second.id, third.id]).size, 3);
  assert.equal(
    new Set([first.campaignId, second.campaignId, third.campaignId]).size,
    3,
  );
  for (const item of [first, second, third]) {
    assert.equal(item.creatorId, "creator");
    assert.equal(item.status, "funding");
    assert.equal(item.raised, "0");
    assert.equal(item.locked, "0");
    assert.equal(item.backers, 0);
    assert.equal(item.transactions.length, 0);
  }
  for (const identity of ["backer-a", "backer-b", "visitor"] as const) {
    repository.setIdentity(identity);
    atomicFailure(
      repository,
      () => repository.createProject(input(), true),
      /Creator/,
    );
  }
});

test("drafts permit unfinished descriptive fields and publication requires a complete valid plan", () => {
  const { repository } = setup();
  const fields = input({
    title: "  Draft idea  ",
    shortDescription: "",
    description: "",
    plan: { what: "", why: "", audience: "", roadmap: "" },
    milestones: [{ title: "Sketch", description: "", amount: "1" }],
  });
  const draft = repository.createProject(fields, false);
  assert.equal(draft.title, "Draft idea");
  assert.equal(draft.status, "draft");
  atomicFailure(
    repository,
    () => repository.publishProject(draft.id),
    /required/,
  );
  const completed = input({
    title: draft.title,
    milestones: [
      { title: "Sketch", description: "Draw the initial sketch", amount: "1" },
    ],
  });
  repository.updateProject(draft.id, completed);
  assert.equal(repository.publishProject(draft.id).status, "funding");
  atomicFailure(
    repository,
    () => repository.publishProject(draft.id),
    /already published/,
  );
});

test("service validation rejects invalid goals, budgets, links, media and incomplete public metadata", () => {
  const { repository } = setup();
  const invalid: ProjectInput[] = [
    input({ title: " " }),
    input({ goal: "0" }),
    input({ goal: "-1" }),
    input({ goal: "1.5" }),
    input({ goal: (MAX_LAMPORTS + 1n).toString() }),
    input({ category: "Unrecognized" }),
    input({ shortDescription: "" }),
    input({ milestones: [] }),
    input({
      milestones: Array.from({ length: 6 }, () => ({
        title: "Step",
        description: "Work",
        amount: "1",
      })),
    }),
    input({
      milestones: [{ title: "Step", description: "Work", amount: "0" }],
    }),
    input({
      milestones: [
        { title: "Step", description: "Work", amount: "3000000001" },
      ],
    }),
    input({ links: { demo: "javascript:alert(1)" } }),
    input({ links: { website: "https://name:secret@example.com" } }),
    input({ logoUrl: "data:image/svg+xml;base64,PHN2Zz4=" }),
    input({ coverUrl: "https://external.example.com/image.png" }),
    input({ gallery: ["/a.png", "/b.png", "/c.png", "/d.png"] }),
  ];
  for (const fields of invalid)
    atomicFailure(repository, () => repository.createProject(fields, true));
  const valid = repository.createProject(
    input({
      logoUrl: "data:image/png;base64,aGVsbG8=",
      coverUrl: "/images/project-education.svg",
      goal: "03000000000",
    }),
    true,
  );
  assert.equal(valid.goal, "3000000000");
});

test("editing is creator-only and accounting fields freeze after the first contribution", () => {
  const { repository, project: item } = setup();
  repository.setIdentity("backer-a");
  atomicFailure(
    repository,
    () => repository.updateProject(item.id, input({ title: "Stolen title" })),
    /creator/,
  );
  repository.contribute(item.id, "10000000");
  repository.setIdentity("creator");
  const before = project(repository, item.id);
  for (const fields of [
    input({ goal: "4000000000" }),
    input({
      milestones: [
        { title: "Only step", description: "Work", amount: "3000000000" },
      ],
    }),
    input({
      milestones: [
        { title: "Prototype", description: "Work", amount: "900000000" },
        { title: "Launch", description: "Launch", amount: "2100000000" },
      ],
    }),
  ])
    atomicFailure(
      repository,
      () => repository.updateProject(item.id, fields),
      /locked/,
    );
  const after = repository.updateProject(
    item.id,
    input({
      title: "Updated learning",
      description: "Updated detail",
      logoUrl: "/images/project-health.svg",
      links: { github: "https://github.com/example/project" },
    }),
  );
  assert.equal(after.title, "Updated learning");
  assert.equal(after.raised, before.raised);
  assert.deepEqual(after.transactions, before.transactions);
  assert.deepEqual(
    after.milestones.map((step) => [step.id, step.amount, step.status]),
    before.milestones.map((step) => [step.id, step.amount, step.status]),
  );
});

test("saving edits and publishing a draft is one atomic persisted operation", () => {
  const { repository, storage } = setup();
  const draft = repository.createProject(
    input({ title: "Draft title", description: "" }),
    false,
  );
  const saved = storage.getItem(PROJECT_STORAGE_KEY);
  storage.failWrites = true;
  atomicFailure(
    repository,
    () =>
      repository.updateProject(
        draft.id,
        input({ title: "Ready for launch" }),
        true,
      ),
    /Could not save/,
  );
  assert.equal(storage.getItem(PROJECT_STORAGE_KEY), saved);
  assert.equal(project(repository, draft.id).title, "Draft title");
  assert.equal(project(repository, draft.id).status, "draft");
  storage.failWrites = false;
  const published = repository.updateProject(
    draft.id,
    input({ title: "Ready for launch" }),
    true,
  );
  assert.equal(published.status, "funding");
  assert.equal(published.title, "Ready for launch");
  assert.deepEqual(
    createDemoProjectRepository(storage).getSnapshot(),
    repository.getSnapshot(),
  );
});

test("repeated contributions debit demo balance, accumulate exactly and count each backer once", () => {
  const { repository, project: item } = setup();
  repository.setIdentity("backer-a");
  const balance = BigInt(repository.getSnapshot().balances["backer-a"]);
  repository.contribute(item.id, "10000000");
  repository.contribute(item.id, "10000000");
  const after = project(repository, item.id);
  assert.equal(after.raised, "20000000");
  assert.equal(after.locked, "20000000");
  assert.equal(after.backers, 1);
  assert.equal(
    getUserContribution(repository.getSnapshot(), item.id),
    "20000000",
  );
  assert.equal(
    repository.getSnapshot().balances["backer-a"],
    (balance - 20_000_000n).toString(),
  );
  assert.equal(getProjectRole(repository.getSnapshot(), after), "backer");
  assert.ok(
    after.transactions.every(
      (transaction) =>
        transaction.status === "confirmed" && !transaction.signature,
    ),
  );
});

test("zero, malformed, over-goal, over-balance, visitor and creator contributions fail atomically", () => {
  const { repository, project: item } = setup();
  atomicFailure(
    repository,
    () => repository.contribute(item.id, "1"),
    /Creators/,
  );
  repository.setIdentity("visitor");
  atomicFailure(
    repository,
    () => repository.contribute(item.id, "1"),
    /identity/,
  );
  repository.setIdentity("backer-a");
  for (const value of [
    "0",
    "-1",
    "1.1",
    "NaN",
    (MAX_LAMPORTS + 1n).toString(),
    "100000000001",
    "3000000001",
  ])
    atomicFailure(repository, () => repository.contribute(item.id, value));
  repository.contribute(item.id, "3000000000");
  atomicFailure(
    repository,
    () => repository.contribute(item.id, "1"),
    /exceed/,
  );
});

test("project contributions and discussion permissions never leak into a second project", () => {
  const { repository, project: first } = setup();
  const second = repository.createProject(
    input({ title: "Second project" }),
    true,
  );
  repository.setIdentity("backer-a");
  assert.equal(
    getProjectRole(repository.getSnapshot(), first),
    "connected_non_backer",
  );
  atomicFailure(
    repository,
    () => repository.postMessage(first.id, "Hello", "message"),
    /permission/,
  );
  repository.contribute(first.id, "10000000");
  repository.postMessage(
    first.id,
    "  <script>alert('plain text')</script>  ",
    "message",
  );
  assert.equal(getUserContribution(repository.getSnapshot(), second.id), "0");
  assert.equal(project(repository, second.id).raised, "0");
  assert.equal(
    getProjectRole(repository.getSnapshot(), second),
    "connected_non_backer",
  );
  atomicFailure(
    repository,
    () => repository.postMessage(second.id, "Hello", "message"),
    /permission/,
  );
  assert.equal(
    repository
      .getSnapshot()
      .messages.filter((message) => message.projectId === first.id)
      .at(-1)?.text,
    "<script>alert('plain text')</script>",
  );
  assert.equal(
    repository
      .getSnapshot()
      .messages.filter((message) => message.projectId === second.id).length,
    0,
  );
});

test("discussion is trimmed, creator updates are exclusive, empty and duplicate messages are atomic failures", () => {
  const { repository, project: item } = setup();
  repository.postMessage(item.id, "  Creator update  ", "update");
  const update = repository.getSnapshot().messages.at(-1)!;
  assert.equal(update.text, "Creator update");
  assert.equal(update.role, "creator");
  assert.equal(update.type, "update");
  atomicFailure(
    repository,
    () => repository.postMessage(item.id, "Creator update", "update"),
    /just sent/,
  );
  for (const message of ["", " ", "x".repeat(4001)])
    atomicFailure(repository, () =>
      repository.postMessage(item.id, message, "message"),
    );
  repository.setIdentity("backer-b");
  repository.contribute(item.id, "1");
  atomicFailure(
    repository,
    () => repository.postMessage(item.id, "Pretend update", "update"),
    /permission/,
  );
  repository.postMessage(item.id, "A backer message", "message");
  assert.equal(repository.getSnapshot().messages.at(-1)?.role, "backer");
  repository.setIdentity("visitor");
  atomicFailure(
    repository,
    () => repository.postMessage(item.id, "Visitor message", "message"),
    /permission/,
  );
});

test("milestones require creator ownership, sufficient funding and release of earlier work", () => {
  const { repository, project: item } = setup();
  atomicFailure(
    repository,
    () => repository.startMilestone(item.id, item.milestones[0].id),
    /funding/,
  );
  atomicFailure(
    repository,
    () => repository.startMilestone(item.id, item.milestones[1].id),
    /earlier/,
  );
  repository.setIdentity("backer-a");
  repository.contribute(item.id, "1000000000");
  atomicFailure(
    repository,
    () => repository.startMilestone(item.id, item.milestones[0].id),
    /creator/,
  );
  repository.setIdentity("creator");
  repository.startMilestone(item.id, item.milestones[0].id);
  assert.equal(project(repository, item.id).status, "active");
  assert.equal(
    project(repository, item.id).milestones[0].status,
    "in_progress",
  );
  atomicFailure(
    repository,
    () => repository.startMilestone(item.id, item.milestones[0].id),
    /already/,
  );
  atomicFailure(
    repository,
    () =>
      repository.submitMilestone(item.id, item.milestones[0].id, {
        summary: "",
      }),
    /required/,
  );
  atomicFailure(
    repository,
    () =>
      repository.submitMilestone(item.id, item.milestones[0].id, {
        summary: "Complete",
      }),
    /link/,
  );
  atomicFailure(
    repository,
    () =>
      repository.submitMilestone(item.id, item.milestones[0].id, {
        summary: "Complete",
        evidenceUrl: "javascript:alert(1)",
      }),
    /valid/,
  );
  atomicFailure(
    repository,
    () => repository.releaseMilestone(item.id, item.milestones[0].id),
    /approve/,
  );
});

test("weighted votes use a fixed denominator and exact 60 percent threshold with uncast weight", () => {
  const { repository, project: item } = fundedVote();
  const milestoneId = item.milestones[0].id;
  repository.setIdentity("backer-a");
  repository.contribute(item.id, "200000000");
  repository.vote(item.id, milestoneId, "reject");
  let milestone = project(repository, item.id).milestones[0];
  assert.equal(milestone.voting?.totalWeight, "1000000000");
  assert.equal(milestone.voting?.weights["backer-a"], "400000000");
  assert.equal(milestone.voting?.rejectWeight, "400000000");
  assert.equal(milestone.status, "voting");
  assert.deepEqual(
    voteResults({
      ...milestone.voting!,
      milestoneId,
      userWeight: "400000000",
      userVote: "reject",
    }),
    { approve: 0, reject: 40, notVoted: 60, thresholdReached: false },
  );
  atomicFailure(
    repository,
    () => repository.vote(item.id, milestoneId, "approve"),
    /already/,
  );
  repository.setIdentity("backer-b");
  repository.vote(item.id, milestoneId, "approve");
  milestone = project(repository, item.id).milestones[0];
  assert.equal(milestone.status, "approved");
  assert.equal(milestone.voting?.approveWeight, "600000000");
  assert.equal(
    project(repository, item.id).locked,
    "1200000000",
    "approval must not release funds automatically",
  );
  atomicFailure(
    repository,
    () => repository.vote(item.id, milestoneId, "reject"),
    /closed/,
  );
});

test("creator, visitor, non-backers and late first-time backers cannot vote", () => {
  const { repository, project: item } = setup();
  repository.setIdentity("backer-a");
  repository.contribute(item.id, "1000000000");
  repository.setIdentity("creator");
  repository.startMilestone(item.id, item.milestones[0].id);
  repository.submitMilestone(item.id, item.milestones[0].id, {
    summary: "Work completed",
    demoUrl: "https://example.com/demo",
  });
  atomicFailure(
    repository,
    () => repository.vote(item.id, item.milestones[0].id, "approve"),
    /eligible/,
  );
  repository.setIdentity("visitor");
  atomicFailure(
    repository,
    () => repository.vote(item.id, item.milestones[0].id, "approve"),
    /eligible/,
  );
  repository.setIdentity("backer-b");
  atomicFailure(
    repository,
    () => repository.vote(item.id, item.milestones[0].id, "approve"),
    /snapshot/,
  );
  repository.contribute(item.id, "100000000");
  atomicFailure(
    repository,
    () => repository.vote(item.id, item.milestones[0].id, "approve"),
    /snapshot/,
  );
  assert.equal(
    project(repository, item.id).milestones[0].voting?.totalWeight,
    "1000000000",
  );
});

test("a rejected milestone may be reworked and its next review captures a fresh snapshot", () => {
  const { repository, project: item } = fundedVote();
  repository.setIdentity("backer-a");
  repository.vote(item.id, item.milestones[0].id, "approve");
  repository.setIdentity("backer-b");
  repository.vote(item.id, item.milestones[0].id, "reject");
  assert.equal(project(repository, item.id).milestones[0].status, "rejected");
  repository.contribute(item.id, "100000000");
  repository.setIdentity("creator");
  repository.startMilestone(item.id, item.milestones[0].id);
  assert.equal(project(repository, item.id).milestones[0].voting, undefined);
  repository.submitMilestone(item.id, item.milestones[0].id, {
    summary: "Improved prototype",
    githubUrl: "https://github.com/example/project",
  });
  const snapshot = project(repository, item.id).milestones[0].voting!;
  assert.equal(snapshot.totalWeight, "1100000000");
  assert.deepEqual(snapshot.votes, {});
});

test("approved demo releases credit Creator, reconcile the vault and prevent duplicate release", () => {
  const { repository, project: item } = fundedVote();
  repository.setIdentity("backer-a");
  repository.vote(item.id, item.milestones[0].id, "approve");
  repository.setIdentity("backer-b");
  repository.vote(item.id, item.milestones[0].id, "approve");
  atomicFailure(
    repository,
    () => repository.releaseMilestone(item.id, item.milestones[0].id),
    /creator/,
  );
  repository.setIdentity("creator");
  const balance = BigInt(repository.getSnapshot().balances.creator);
  repository.releaseMilestone(item.id, item.milestones[0].id);
  assert.equal(project(repository, item.id).locked, "0");
  assert.equal(project(repository, item.id).released, "1000000000");
  assert.equal(
    repository.getSnapshot().balances.creator,
    (balance + 1_000_000_000n).toString(),
  );
  assert.equal(project(repository, item.id).milestones[0].status, "released");
  assert.equal(project(repository, item.id).transactions[0].type, "release");
  atomicFailure(
    repository,
    () => repository.releaseMilestone(item.id, item.milestones[0].id),
    /approve/,
  );
  repository.setIdentity("backer-a");
  repository.contribute(item.id, "2000000000");
  repository.setIdentity("creator");
  repository.startMilestone(item.id, item.milestones[1].id);
  repository.submitMilestone(item.id, item.milestones[1].id, {
    summary: "Released library",
    demoUrl: "https://example.com/launch",
  });
  repository.setIdentity("backer-a");
  repository.vote(item.id, item.milestones[1].id, "approve");
  repository.setIdentity("backer-b");
  repository.vote(item.id, item.milestones[1].id, "approve");
  repository.setIdentity("creator");
  repository.releaseMilestone(item.id, item.milestones[1].id);
  assert.equal(project(repository, item.id).status, "completed");
  assert.equal(project(repository, item.id).released, "3000000000");
  repository.setIdentity("backer-a");
  atomicFailure(
    repository,
    () => repository.contribute(item.id, "1"),
    /not accepting/,
  );
});

test("navigation reload restores projects, identity, totals, fixed votes, messages and balances", () => {
  const { repository, storage, project: item } = fundedVote();
  repository.setIdentity("backer-a");
  repository.vote(item.id, item.milestones[0].id, "approve");
  repository.postMessage(item.id, "Thanks for the prototype", "message");
  const first = repository.getSnapshot();
  const restored = createDemoProjectRepository(storage, {
    now: () => timestamp,
  });
  assert.deepEqual(restored.getSnapshot(), first);
  atomicFailure(
    restored,
    () => restored.vote(item.id, item.milestones[0].id, "approve"),
    /already/,
  );
});

test("storage errors leave identity, projects, balance, accounting, votes and messages unchanged", () => {
  const { repository, storage, project: item } = setup();
  repository.setIdentity("backer-a");
  const saved = storage.getItem(PROJECT_STORAGE_KEY);
  storage.failWrites = true;
  atomicFailure(
    repository,
    () => repository.contribute(item.id, "10000000"),
    /Could not save/,
  );
  atomicFailure(
    repository,
    () => repository.setIdentity("creator"),
    /Could not save/,
  );
  atomicFailure(repository, () => repository.reset(), /Could not save/);
  assert.equal(storage.getItem(PROJECT_STORAGE_KEY), saved);
  storage.failWrites = false;
  repository.contribute(item.id, "10000000");
  storage.failWrites = true;
  atomicFailure(
    repository,
    () => repository.postMessage(item.id, "A failed post", "message"),
    /Could not save/,
  );
});

test("immutable snapshots are stable until a committed operation and subscriptions can be removed", () => {
  const { repository, project: item } = setup();
  const snapshot = repository.getSnapshot();
  assert.strictEqual(repository.getSnapshot(), snapshot);
  assert.throws(() => {
    snapshot.projects[0].title = "Unexpected mutation";
  }, TypeError);
  let notifications = 0;
  const unsubscribe = repository.subscribe(() => {
    notifications += 1;
  });
  repository.setIdentity("backer-a");
  assert.equal(notifications, 1);
  repository.setIdentity("backer-a");
  assert.equal(notifications, 1);
  atomicFailure(repository, () => repository.contribute(item.id, "0"));
  assert.equal(notifications, 1);
  unsubscribe();
  repository.contribute(item.id, "1");
  assert.equal(notifications, 1);
});

test("Reset Demo Data deterministically clears local projects, posts and votes and persists Visitor", () => {
  const { repository, storage, project: item } = fundedVote();
  repository.postMessage(item.id, "An update to be reset", "update");
  repository.reset();
  assert.deepEqual(repository.getSnapshot(), createProjectSeed());
  assert.deepEqual(
    createDemoProjectRepository(storage).getSnapshot(),
    createProjectSeed(),
  );
});

test("invalid or inconsistent browser storage recovers to deterministic local fixtures", () => {
  for (const corrupt of [
    "bad json",
    JSON.stringify({ version: 99 }),
    JSON.stringify({ ...createProjectSeed(), identityId: "not-an-identity" }),
  ]) {
    const storage = new MemoryStorage();
    storage.setItem(PROJECT_STORAGE_KEY, corrupt);
    assert.deepEqual(
      createDemoProjectRepository(storage).getSnapshot(),
      createProjectSeed(),
    );
  }
  const state = createProjectSeed();
  state.projects[0].raised = "1";
  const storage = new MemoryStorage();
  storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(state));
  assert.deepEqual(
    createDemoProjectRepository(storage).getSnapshot(),
    createProjectSeed(),
  );
});

test("u64-sized totals remain exact beyond Number precision and creator credit overflow is atomic", () => {
  const storage = new MemoryStorage();
  const state: ProjectState = createProjectSeed();
  state.balances["backer-a"] = MAX_LAMPORTS.toString();
  state.balances.creator = MAX_LAMPORTS.toString();
  storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(state));
  const repository = createDemoProjectRepository(storage, {
    now: () => timestamp,
  });
  repository.setIdentity("creator");
  const item = repository.createProject(
    input({
      goal: MAX_LAMPORTS.toString(),
      milestones: [
        {
          title: "Small release",
          description: "One lamport release",
          amount: "1",
        },
      ],
    }),
    true,
  );
  repository.setIdentity("backer-a");
  repository.contribute(item.id, MAX_LAMPORTS.toString());
  assert.equal(project(repository, item.id).raised, MAX_LAMPORTS.toString());
  assert.equal(repository.getSnapshot().balances["backer-a"], "0");
  repository.setIdentity("creator");
  repository.startMilestone(item.id, item.milestones[0].id);
  repository.submitMilestone(item.id, item.milestones[0].id, {
    summary: "One unit complete",
    evidenceUrl: "https://example.com/evidence",
  });
  repository.setIdentity("backer-a");
  repository.vote(item.id, item.milestones[0].id, "approve");
  repository.setIdentity("creator");
  atomicFailure(
    repository,
    () => repository.releaseMilestone(item.id, item.milestones[0].id),
    /u64/,
  );
});
