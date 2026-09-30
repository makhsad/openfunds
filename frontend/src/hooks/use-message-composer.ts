"use client";

import { useEffect, useRef, useState } from "react";
import { canSendDiscussion, validateDiscussionSend } from "@/lib/discussion";
import type {
  DiscussionMessageType,
  ProjectDiscussionProps,
} from "@/types/discussion";

export type ComposerProps = Pick<
  ProjectDiscussionProps,
  | "currentUserRole"
  | "canPost"
  | "isSubmitting"
  | "onSendMessage"
  | "onSendUpdate"
>;

/** Form state only; no messages, demo identity, or persistence lives in the view. */
export function useMessageComposer(props: ComposerProps) {
  const [text, setText] = useState("");
  const [type, setType] = useState<DiscussionMessageType>("message");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const locked = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A downgraded creator can never keep an update mode selected.
  const effectiveType = props.currentUserRole === "creator" ? type : "message";
  const allowed = canSendDiscussion(
    props.currentUserRole,
    props.canPost,
    effectiveType,
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (locked.current || props.isSubmitting) return;
    locked.current = true;
    setError("");
    setSuccess("");
    try {
      const normalized = validateDiscussionSend(
        text,
        props.currentUserRole,
        props.canPost,
        effectiveType,
      );
      setPending(true);
      await (effectiveType === "update"
        ? props.onSendUpdate(normalized)
        : props.onSendMessage(normalized));
      if (mounted.current) {
        setText("");
        setSuccess(
          effectiveType === "update"
            ? "Project update published."
            : "Message sent.",
        );
      }
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to send. Your draft is saved; please try again.",
        );
    } finally {
      locked.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return {
    text,
    type: effectiveType,
    setType,
    allowed,
    error,
    success,
    pending: pending || props.isSubmitting,
    submit,
    changeText: (value: string) => {
      setText(value);
      setError("");
      setSuccess("");
    },
  };
}
