import { validateDiscussionSend } from "@/lib/discussion";
import type { DemoOutcome } from "@/types/crowdfunding";
import type {
  DiscussionMessageData,
  DiscussionMessageType,
  DiscussionRole,
  DiscussionScope,
} from "@/types/discussion";

export interface MockDiscussionRequest extends DiscussionScope {
  text: string;
  type: DiscussionMessageType;
  role: DiscussionRole;
  canPost: boolean;
  authorName: string;
  outcome: DemoOutcome;
}

/** Purely local async simulation. The caller owns messages in React state. */
export async function simulateDiscussionSend(
  request: MockDiscussionRequest,
  signal?: AbortSignal,
  delayMs = 1500,
): Promise<DiscussionMessageData> {
  const text = validateDiscussionSend(
    request.text,
    request.role,
    request.canPost,
    request.type,
  );
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Discussion closed."));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Discussion closed."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", abort, { once: true });
  });
  if (signal?.aborted) throw new Error("Discussion closed.");
  if (request.outcome === "error")
    throw new Error(
      "The demo post could not be sent. Your draft is saved. Choose Success in Demo controls and try again.",
    );
  if (request.outcome === "cancel")
    throw new Error(
      "The demo post was cancelled. Your draft is saved; you can try again.",
    );
  return {
    id: `demo-discussion-${crypto.randomUUID()}`,
    projectId: request.projectId,
    campaignId: request.campaignId,
    text,
    role: request.role,
    authorName: request.authorName,
    type: request.type,
    createdAt: new Date().toISOString(),
  };
}
