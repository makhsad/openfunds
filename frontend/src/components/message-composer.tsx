"use client";

import { useId } from "react";
import { LockKeyhole, Send } from "lucide-react";
import {
  useMessageComposer,
  type ComposerProps,
} from "@/hooks/use-message-composer";
import { discussionReadOnlyReason } from "@/lib/discussion";
import { RoleBadge } from "@/components/role-badge";
import { Spinner } from "@/components/ui";

export function MessageComposer(props: ComposerProps) {
  const form = useMessageComposer(props);
  const id = useId();
  return (
    <div className="message-composer">
      <div className="composer-heading">
        <h3>Join the conversation</h3>
        <RoleBadge role={props.currentUserRole} />
      </div>
      {!form.allowed ? (
        <p className="discussion-readonly">
          <LockKeyhole size={16} aria-hidden="true" />
          {discussionReadOnlyReason(props.currentUserRole)}
        </p>
      ) : (
        <form onSubmit={form.submit} noValidate aria-busy={form.pending}>
          {props.currentUserRole === "creator" && (
            <div className="composer-modes" aria-label="Post type">
              <button
                type="button"
                aria-pressed={form.type === "message"}
                disabled={form.pending}
                onClick={() => form.setType("message")}
              >
                Message
              </button>
              <button
                type="button"
                aria-pressed={form.type === "update"}
                disabled={form.pending}
                onClick={() => form.setType("update")}
              >
                Project Update
              </button>
            </div>
          )}
          <label htmlFor={id}>
            {form.type === "update" ? "Your project update" : "Your message"}
          </label>
          <textarea
            id={id}
            rows={4}
            placeholder="Write a message..."
            value={form.text}
            onChange={(event) => form.changeText(event.target.value)}
            disabled={form.pending}
            aria-invalid={Boolean(form.error)}
            aria-describedby={form.error ? `${id}-error` : `${id}-help`}
          />
          <div className="composer-footer">
            <p id={`${id}-help`}>
              Share a question, feedback, or progress with the community.
            </p>
            <button
              className="button button-primary"
              type="submit"
              disabled={form.pending || !form.text.trim()}
            >
              {form.pending ? (
                <Spinner />
              ) : (
                <Send size={15} aria-hidden="true" />
              )}
              {form.pending
                ? "Sending…"
                : form.type === "update"
                  ? "Publish Project Update"
                  : "Send message"}
            </button>
          </div>
          {form.error && (
            <p id={`${id}-error`} className="field-error" role="alert">
              {form.error}
            </p>
          )}
          {form.success && (
            <p className="composer-success" role="status">
              {form.success}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
