import { asLamports } from "../lib/amounts";
import { validateDiscussionSend } from "../lib/discussion";
import type { Lamports } from "../types/crowdfunding";
import type { DiscussionRole } from "../types/discussion";
import {
  CATEGORIES,
  DEMO_IDENTITIES,
  type CampaignRepository,
  type DemoIdentityId,
  type MilestoneSubmission,
  type Project,
  type ProjectInput,
  type ProjectMilestone,
  type ProjectState,
} from "../types/project";
import { createProjectSeed } from "./project-seed";

export { CATEGORIES, DEMO_IDENTITIES } from "../types/project";
export type {
  CampaignRepository,
  ProjectState,
  ProjectInput,
} from "../types/project";
export const PROJECT_STORAGE_KEY = "openfunds.projects.v1";
export const MAX_LAMPORTS = 18_446_744_073_709_551_615n;
export interface ProjectStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface RepositoryOptions {
  now?: () => string;
}

export function getIdentity(id: DemoIdentityId) {
  const identity = DEMO_IDENTITIES.find((item) => item.id === id);
  if (!identity) throw new Error("Choose a valid demo identity.");
  return identity;
}
export function getUserContribution(
  state: ProjectState,
  projectId: string,
  identityId: string = state.identityId,
): Lamports {
  return state.contributions[projectId]?.[identityId] ?? "0";
}
export function getProjectRole(
  state: ProjectState,
  project: Project,
): DiscussionRole {
  if (state.identityId === "visitor") return "visitor";
  if (state.identityId === project.creatorId) return "creator";
  return asLamports(getUserContribution(state, project.id)) > 0n
    ? "backer"
    : "connected_non_backer";
}
function amount(value: Lamports, positive = false): bigint {
  if (typeof value !== "string")
    throw new Error("Use integer lamports for amounts.");
  const result = asLamports(value);
  if (result > MAX_LAMPORTS)
    throw new Error("Amount exceeds the supported u64 limit.");
  if (positive && result === 0n)
    throw new Error("Amount must be greater than zero.");
  return result;
}
function checkedAdd(left: Lamports, right: Lamports): Lamports {
  return amount((amount(left) + amount(right)).toString()).toString();
}
function requiredText(
  value: string,
  label: string,
  required: boolean,
  max = 10_000,
): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const result = value.trim();
  if (required && !result) throw new Error(`${label} is required.`);
  if (result.length > max)
    throw new Error(`${label} is too long (maximum ${max} characters).`);
  return result;
}
function externalUrl(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Use a valid https:// or http:// link.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Use a valid https:// or http:// link without credentials.",
    );
  return url.href;
}
function imageUrl(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  const image = value.trim();
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image))
    return image;
  if (/^\/(?!\/)[A-Za-z0-9/_.-]+$/.test(image)) return image;
  throw new Error("Choose a PNG, JPEG, or WebP image from your device.");
}
/** Shared service validation; forms are not the security/permission boundary. */
export function validateProjectInput(
  input: ProjectInput,
  publish: boolean,
): ProjectInput {
  const goal = amount(input.goal, true).toString();
  if (!(CATEGORIES as readonly string[]).includes(input.category))
    throw new Error("Choose a project category.");
  if (
    !Array.isArray(input.milestones) ||
    input.milestones.length < 1 ||
    input.milestones.length > 5
  )
    throw new Error("Add between 1 and 5 milestones.");
  let allocated = 0n;
  const milestones = input.milestones.map((milestone) => {
    const budget = amount(milestone.amount, true);
    allocated += budget;
    return {
      title: requiredText(milestone.title, "Milestone title", true, 120),
      description: requiredText(
        milestone.description,
        "Milestone description",
        publish,
      ),
      amount: budget.toString(),
    };
  });
  if (allocated > amount(goal))
    throw new Error("Milestone budgets cannot exceed the funding goal.");
  if ((input.gallery?.length ?? 0) > 3)
    throw new Error("Choose up to 3 gallery images.");
  const logoUrl = imageUrl(input.logoUrl);
  const coverUrl = imageUrl(input.coverUrl);
  const gallery = (input.gallery ?? [])
    .map((image) => imageUrl(image))
    .filter((image): image is string => !!image);
  if (
    [logoUrl, coverUrl, ...gallery].reduce(
      (total, image) => total + (image?.length ?? 0),
      0,
    ) > 3_000_000
  )
    throw new Error(
      "Project images are too large. Use smaller images (up to 2 MB combined).",
    );
  return {
    title: requiredText(input.title, "Project title", true, 120),
    shortDescription: requiredText(
      input.shortDescription,
      "Short description",
      publish,
      280,
    ),
    description: requiredText(input.description, "Full description", publish),
    category: input.category,
    goal,
    logoUrl,
    coverUrl,
    gallery,
    milestones,
    plan: {
      what: requiredText(input.plan?.what, "What are we building", publish),
      why: requiredText(input.plan?.why, "Why is it needed", publish),
      audience: requiredText(input.plan?.audience, "Who is it for", publish),
      roadmap: requiredText(input.plan?.roadmap, "Project roadmap", publish),
    },
    links: {
      website: externalUrl(input.links?.website),
      github: externalUrl(input.links?.github),
      demo: externalUrl(input.links?.demo),
    },
  };
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
function readStoredState(storage?: ProjectStorage): ProjectState {
  try {
    const saved = storage?.getItem(PROJECT_STORAGE_KEY);
    if (!saved) return createProjectSeed();
    const state: ProjectState = JSON.parse(saved);
    if (
      state.version !== 1 ||
      !Array.isArray(state.projects) ||
      !Array.isArray(state.messages)
    )
      throw new Error("Unsupported saved data.");
    getIdentity(state.identityId);
    for (const identity of DEMO_IDENTITIES) amount(state.balances[identity.id]);
    const ids = new Set<string>();
    for (const project of state.projects) {
      if (
        !project.id ||
        ids.has(project.id) ||
        !project.creatorId ||
        !Number.isSafeInteger(project.campaignId) ||
        project.campaignId < 1
      )
        throw new Error("Invalid project.");
      ids.add(project.id);
      if (
        !["draft", "funding", "active", "completed"].includes(project.status) ||
        !Array.isArray(project.transactions)
      )
        throw new Error("Invalid project state.");
      validateProjectInput(project, project.status !== "draft");
      if (
        amount(project.locked) + amount(project.released) !==
          amount(project.raised) ||
        amount(project.raised) > amount(project.goal)
      )
        throw new Error("Invalid accounting.");
      const contributions = Object.values(
        state.contributions[project.id] ?? {},
      );
      if (
        contributions.reduce((sum, value) => sum + amount(value), 0n) !==
          amount(project.raised) ||
        contributions.filter((value) => amount(value) > 0n).length !==
          project.backers
      )
        throw new Error("Invalid contributions.");
      for (const milestone of project.milestones) {
        if (
          ![
            "locked",
            "in_progress",
            "submitted",
            "voting",
            "approved",
            "rejected",
            "released",
          ].includes(milestone.status)
        )
          throw new Error("Invalid milestone.");
        if (milestone.voting) {
          const vote = milestone.voting;
          if (
            Object.values(vote.weights).reduce(
              (sum, value) => sum + amount(value),
              0n,
            ) !== amount(vote.totalWeight) ||
            vote.thresholdPercent !== 60
          )
            throw new Error("Invalid vote snapshot.");
          let approve = 0n,
            reject = 0n;
          for (const [identity, choice] of Object.entries(vote.votes)) {
            const weight = amount(vote.weights[identity], true);
            if (choice === "approve") approve += weight;
            else if (choice === "reject") reject += weight;
            else throw new Error("Invalid vote.");
          }
          if (
            approve !== amount(vote.approveWeight) ||
            reject !== amount(vote.rejectWeight) ||
            approve + reject > amount(vote.totalWeight)
          )
            throw new Error("Invalid vote totals.");
        } else if (milestone.status === "voting")
          throw new Error("Missing vote snapshot.");
      }
    }
    if (
      state.messages.some(
        (message) =>
          !ids.has(message.projectId) ||
          typeof message.text !== "string" ||
          !["creator", "backer"].includes(message.role) ||
          !["message", "update"].includes(message.type),
      )
    )
      throw new Error("Invalid discussion.");
    return state;
  } catch {
    // Browser storage is local demo data, never a blockchain source of truth.
    return createProjectSeed();
  }
}

/** Browser persistence boundary. A real Solana repository must implement its own verified operations. */
export function createDemoProjectRepository(
  storage?: ProjectStorage,
  options: RepositoryOptions = {},
): CampaignRepository {
  let state = deepFreeze(readStoredState(storage));
  const listeners = new Set<() => void>();
  const now = options.now ?? (() => new Date().toISOString());
  function commit(next: ProjectState) {
    const serialized = JSON.stringify(next);
    try {
      storage?.setItem(PROJECT_STORAGE_KEY, serialized);
    } catch {
      throw new Error(
        "Could not save demo data. Browser storage may be full or unavailable. Reduce image sizes and try again.",
      );
    }
    // Keep in-memory and reloaded snapshots identical, including optional fields.
    state = deepFreeze(JSON.parse(serialized) as ProjectState);
    for (const listener of listeners) listener();
  }
  function mutate(action: (next: ProjectState) => void) {
    const next = structuredClone(state);
    action(next);
    commit(next);
  }
  function findProject(next: ProjectState, id: string): Project {
    const project = next.projects.find((item) => item.id === id);
    if (!project) throw new Error("Project not found.");
    return project;
  }
  function requireCreator(next: ProjectState, project: Project) {
    if (next.identityId === "visitor" || next.identityId !== project.creatorId)
      throw new Error("Only the project creator can do this.");
  }
  function findMilestone(project: Project, id: string): ProjectMilestone {
    const milestone = project.milestones.find((item) => item.id === id);
    if (!milestone) throw new Error("Milestone not found.");
    return milestone;
  }
  function checkPrevious(project: Project, milestone: ProjectMilestone) {
    const index = project.milestones.indexOf(milestone);
    if (
      project.milestones
        .slice(0, index)
        .some((item) => item.status !== "released")
    )
      throw new Error("Complete and release earlier milestones first.");
  }
  function addTransaction(
    project: Project,
    transaction: Omit<
      Project["transactions"][number],
      "id" | "createdAt" | "status"
    >,
  ) {
    project.transactions.unshift({
      ...transaction,
      id: `demo-${project.id}-${project.transactions.length + 1}`,
      createdAt: now(),
      status: "confirmed",
    });
  }
  function refreshPhase(project: Project) {
    project.phase = project.milestones.some((item) => item.status === "voting")
      ? "voting"
      : "funding";
  }
  return {
    mode: "demo",
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setIdentity(id) {
      getIdentity(id);
      if (state.identityId !== id)
        mutate((next) => {
          next.identityId = id;
        });
    },
    reset() {
      commit(createProjectSeed());
    },
    createProject(input, publish) {
      let id = "";
      mutate((next) => {
        if (next.identityId !== "creator")
          throw new Error(
            "Select the Creator demo identity to create a project.",
          );
        const fields = validateProjectInput(input, publish);
        const campaignId =
          Math.max(
            0,
            ...next.projects
              .filter((project) => project.creatorId === next.identityId)
              .map((project) => project.campaignId),
          ) + 1;
        if (!Number.isSafeInteger(campaignId))
          throw new Error("Campaign identifier limit reached.");
        const slug =
          fields.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "project";
        id = `${slug}-${campaignId}`;
        while (next.projects.some((project) => project.id === id)) id += "-new";
        next.projects.unshift({
          ...fields,
          id,
          campaignId,
          creatorId: next.identityId,
          creatorName: getIdentity(next.identityId).name,
          creator: getIdentity(next.identityId).name,
          status: publish ? "funding" : "draft",
          phase: "funding",
          raised: "0",
          locked: "0",
          released: "0",
          backers: 0,
          createdAt: now(),
          transactions: [],
          milestones: fields.milestones.map((milestone, index) => ({
            ...milestone,
            id: `${id}-milestone-${index + 1}`,
            status: "locked",
          })),
        });
        next.contributions[id] = {};
      });
      return findProject(state, id);
    },
    updateProject(id, input, publish = false) {
      mutate((next) => {
        const project = findProject(next, id);
        requireCreator(next, project);
        const fields = validateProjectInput(
          input,
          publish || project.status !== "draft",
        );
        if (
          amount(project.raised) > 0n &&
          (fields.goal !== project.goal ||
            fields.milestones.length !== project.milestones.length ||
            fields.milestones.some(
              (milestone, index) =>
                milestone.amount !== project.milestones[index].amount,
            ))
        )
          throw new Error(
            "Funding has started: the goal, milestone count, order, and budgets are locked.",
          );
        const milestones: ProjectMilestone[] = fields.milestones.map(
          (milestone, index) => ({
            ...project.milestones[index],
            ...milestone,
            id: project.milestones[index]?.id ?? `${id}-milestone-${index + 1}`,
            status: project.milestones[index]?.status ?? "locked",
          }),
        );
        Object.assign(project, fields, { milestones });
        if (publish && project.status === "draft") project.status = "funding";
      });
      return findProject(state, id);
    },
    publishProject(id) {
      mutate((next) => {
        const project = findProject(next, id);
        requireCreator(next, project);
        if (project.status !== "draft")
          throw new Error("This project is already published.");
        validateProjectInput(project, true);
        project.status = "funding";
      });
      return findProject(state, id);
    },
    contribute(id, value) {
      mutate((next) => {
        const project = findProject(next, id);
        if (next.identityId === "visitor")
          throw new Error("Select a demo identity before contributing.");
        if (next.identityId === project.creatorId)
          throw new Error("Creators cannot contribute to their own project.");
        if (project.status === "draft" || project.status === "completed")
          throw new Error("This project is not accepting contributions.");
        const contribution = amount(value, true);
        if (contribution > amount(next.balances[next.identityId]))
          throw new Error("Not enough SOL in your demo wallet.");
        if (amount(project.raised) + contribution > amount(project.goal))
          throw new Error("Your contribution would exceed the funding goal.");
        const balances =
          next.contributions[id] ?? (next.contributions[id] = {});
        const previous = balances[next.identityId] ?? "0";
        balances[next.identityId] = checkedAdd(previous, value);
        project.raised = checkedAdd(project.raised, value);
        project.locked = checkedAdd(project.locked, value);
        if (amount(previous) === 0n) project.backers += 1;
        next.balances[next.identityId] = (
          amount(next.balances[next.identityId]) - contribution
        ).toString();
        addTransaction(project, {
          type: "contribution",
          amount: contribution.toString(),
          sender: getIdentity(next.identityId).name,
          recipient: "Demo project vault",
        });
      });
    },
    startMilestone(id, milestoneId) {
      mutate((next) => {
        const project = findProject(next, id);
        requireCreator(next, project);
        if (project.status === "draft" || project.status === "completed")
          throw new Error("Publish the project before starting a milestone.");
        const milestone = findMilestone(project, milestoneId);
        checkPrevious(project, milestone);
        if (!["locked", "rejected"].includes(milestone.status))
          throw new Error("This milestone has already started.");
        if (amount(project.locked) < amount(milestone.amount))
          throw new Error(
            "This milestone needs more funding before it can start.",
          );
        milestone.status = "in_progress";
        delete milestone.submission;
        delete milestone.voting;
        project.status = "active";
      });
    },
    submitMilestone(id, milestoneId, submission) {
      mutate((next) => {
        const project = findProject(next, id);
        requireCreator(next, project);
        const milestone = findMilestone(project, milestoneId);
        checkPrevious(project, milestone);
        if (milestone.status !== "in_progress")
          throw new Error(
            "Start this milestone before submitting it for review.",
          );
        const evidence: MilestoneSubmission = {
          summary: requiredText(submission.summary, "Completion summary", true),
          evidenceUrl: externalUrl(submission.evidenceUrl),
          demoUrl: externalUrl(submission.demoUrl),
          githubUrl: externalUrl(submission.githubUrl),
        };
        if (!evidence.evidenceUrl && !evidence.demoUrl && !evidence.githubUrl)
          throw new Error(
            "Add at least one evidence, demo, or GitHub link for review.",
          );
        const weights = Object.fromEntries(
          Object.entries(next.contributions[id] ?? {}).filter(
            ([identity, value]) =>
              identity !== project.creatorId &&
              identity !== "visitor" &&
              amount(value) > 0n,
          ),
        );
        const totalWeight = Object.values(weights).reduce(
          (total, value) => total + amount(value),
          0n,
        );
        if (!totalWeight)
          throw new Error(
            "At least one backer is required before voting can begin.",
          );
        milestone.submission = evidence;
        milestone.status = "voting";
        milestone.voting = {
          weights,
          votes: {},
          totalWeight: totalWeight.toString(),
          approveWeight: "0",
          rejectWeight: "0",
          thresholdPercent: 60,
        };
        refreshPhase(project);
      });
    },
    vote(id, milestoneId, choice) {
      mutate((next) => {
        const project = findProject(next, id);
        if (
          next.identityId === "visitor" ||
          next.identityId === project.creatorId
        )
          throw new Error("Only eligible project backers can vote.");
        const milestone = findMilestone(project, milestoneId);
        if (milestone.status !== "voting" || !milestone.voting)
          throw new Error("Voting is closed for this milestone.");
        const voting = milestone.voting,
          weight = voting.weights[next.identityId] ?? "0";
        if (amount(weight) === 0n)
          throw new Error(
            "You were not a backer when this voting snapshot began.",
          );
        if (voting.votes[next.identityId])
          throw new Error("You have already voted on this milestone.");
        if (choice !== "approve" && choice !== "reject")
          throw new Error("Choose Approve or Reject.");
        voting.votes[next.identityId] = choice;
        if (choice === "approve")
          voting.approveWeight = checkedAdd(voting.approveWeight, weight);
        else voting.rejectWeight = checkedAdd(voting.rejectWeight, weight);
        if (
          amount(voting.approveWeight) + amount(voting.rejectWeight) ===
          amount(voting.totalWeight)
        )
          milestone.status =
            amount(voting.approveWeight) * 100n >=
            amount(voting.totalWeight) * BigInt(voting.thresholdPercent)
              ? "approved"
              : "rejected";
        addTransaction(project, {
          type: "vote",
          amount: null,
          voteChoice: choice,
          sender: getIdentity(next.identityId).name,
          recipient: milestone.title,
        });
        refreshPhase(project);
      });
    },
    releaseMilestone(id, milestoneId) {
      mutate((next) => {
        const project = findProject(next, id);
        requireCreator(next, project);
        const milestone = findMilestone(project, milestoneId);
        checkPrevious(project, milestone);
        if (milestone.status !== "approved")
          throw new Error(
            "Backers must approve this milestone before a demo release.",
          );
        if (amount(milestone.amount) > amount(project.locked))
          throw new Error("The demo vault does not hold enough funds.");
        project.locked = (
          amount(project.locked) - amount(milestone.amount)
        ).toString();
        project.released = checkedAdd(project.released, milestone.amount);
        milestone.status = "released";
        next.balances[next.identityId] = checkedAdd(
          next.balances[next.identityId],
          milestone.amount,
        );
        if (project.milestones.every((item) => item.status === "released"))
          project.status = "completed";
        addTransaction(project, {
          type: "release",
          amount: milestone.amount,
          sender: "Demo project vault",
          recipient: project.creatorName,
        });
      });
    },
    postMessage(id, text, type) {
      mutate((next) => {
        const project = findProject(next, id),
          role = getProjectRole(next, project);
        if (project.status === "draft")
          throw new Error(
            "Publish this project before opening its discussion.",
          );
        const normalized = validateDiscussionSend(
          text,
          role,
          role === "creator" || role === "backer",
          type,
        );
        if (normalized.length > 4000)
          throw new Error("Keep messages under 4,000 characters.");
        const createdAt = now(),
          authorName = getIdentity(next.identityId).name;
        const previous = next.messages.findLast(
          (message) =>
            message.projectId === id && message.authorName === authorName,
        );
        if (
          previous &&
          previous.text === normalized &&
          previous.type === type &&
          Math.abs(Date.parse(createdAt) - Date.parse(previous.createdAt)) <
            1500
        )
          throw new Error("This message was just sent.");
        next.messages.push({
          id: `demo-message-${next.messages.length + 1}`,
          projectId: id,
          campaignId: String(project.campaignId),
          authorName,
          role,
          text: normalized,
          type,
          createdAt,
        });
      });
    },
  };
}
