import type {
  DiscussionMessageType,
  DiscussionRole,
  DiscussionScope,
} from "@/types/discussion";

export const discussionRoleLabels: Record<DiscussionRole, string> = {
  visitor: "Visitor",
  connected_non_backer: "Connected non-backer",
  backer: "Backer",
  creator: "Creator",
};

/** Tuple encoding avoids collisions even if IDs contain separators. */
export function discussionScopeKey({
  projectId,
  campaignId,
}: DiscussionScope): string {
  return JSON.stringify([projectId, campaignId]);
}

export function canSendDiscussion(
  role: DiscussionRole,
  canPost: boolean,
  type: DiscussionMessageType,
): boolean {
  return (
    canPost && (role === "creator" || (role === "backer" && type === "message"))
  );
}

export function validateDiscussionSend(
  text: string,
  role: DiscussionRole,
  canPost: boolean,
  type: DiscussionMessageType,
): string {
  if (!canSendDiscussion(role, canPost, type))
    throw new Error("You do not have permission to publish this post.");
  const normalized = text.trim();
  if (!normalized) throw new Error("Write a message before sending.");
  return normalized;
}

export function discussionReadOnlyReason(role: DiscussionRole): string {
  if (role === "visitor") return "Connect your wallet to join the discussion.";
  if (role === "connected_non_backer")
    return "Support this project to join the discussion.";
  return "Posting is currently disabled for this discussion.";
}
