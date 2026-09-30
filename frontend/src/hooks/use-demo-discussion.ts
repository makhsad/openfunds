"use client";

import { useEffect, useRef, useState } from "react";
import { discussionScopeKey } from "@/lib/discussion";
import {
  createMockDiscussionMessages,
  demoDiscussionContexts,
} from "@/services/mock-discussion-data";
import { simulateDiscussionSend } from "@/services/mock-discussion";
import type { DemoOutcome } from "@/types/crowdfunding";
import type {
  DiscussionMessageData,
  DiscussionMessageType,
  DiscussionRole,
} from "@/types/discussion";

export function useDemoDiscussion(outcome: DemoOutcome) {
  const [contextIndex, setContextIndex] = useState(0);
  const [role, setRole] = useState<DiscussionRole>("visitor");
  const [canPost, setCanPost] = useState(true);
  const [messagesByScope, setMessagesByScope] = useState<
    Record<string, DiscussionMessageData[]>
  >(() =>
    Object.fromEntries(
      demoDiscussionContexts.map((context) => [
        discussionScopeKey(context),
        createMockDiscussionMessages(context),
      ]),
    ),
  );
  const [pendingScopes, setPendingScopes] = useState<string[]>([]);
  const requests = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const active = requests.current;
    return () => {
      active.forEach((controller) => controller.abort());
      active.clear();
    };
  }, []);

  const context = demoDiscussionContexts[contextIndex];
  const key = discussionScopeKey(context);

  async function send(text: string, type: DiscussionMessageType) {
    // Capture both IDs before awaiting. A late completion may only update its own thread.
    const scope = key;
    if (requests.current.has(scope))
      throw new Error("A post is already being sent. Please wait.");
    const controller = new AbortController();
    requests.current.set(scope, controller);
    setPendingScopes((previous) => [...previous, scope]);
    try {
      const message = await simulateDiscussionSend(
        {
          projectId: context.projectId,
          campaignId: context.campaignId,
          text,
          type,
          role,
          canPost,
          outcome,
          authorName:
            role === "creator" ? context.creator : "You (demo backer)",
        },
        controller.signal,
      );
      if (!controller.signal.aborted)
        setMessagesByScope((previous) => ({
          ...previous,
          [scope]: [...(previous[scope] ?? []), message],
        }));
    } finally {
      requests.current.delete(scope);
      if (!controller.signal.aborted)
        setPendingScopes((previous) =>
          previous.filter((item) => item !== scope),
        );
    }
  }

  return {
    context,
    contextIndex,
    setContextIndex,
    role,
    setRole,
    canPost,
    setCanPost,
    messages: messagesByScope[key] ?? [],
    isSubmitting: pendingScopes.includes(key),
    hasPending: pendingScopes.length > 0,
    onSendMessage: (text: string) => send(text, "message"),
    onSendUpdate: (text: string) => send(text, "update"),
  };
}
