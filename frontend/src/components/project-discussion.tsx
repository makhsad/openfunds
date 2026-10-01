"use client";

import { MessageSquare } from "lucide-react";
import { DiscussionMessage } from "@/components/discussion-message";
import { MessageComposer } from "@/components/message-composer";
import { SectionHeading } from "@/components/ui";
import { discussionScopeKey } from "@/lib/discussion";
import type { ProjectDiscussionProps } from "@/types/discussion";

export function ProjectDiscussion(props: ProjectDiscussionProps) {
  const messages = props.messages.filter(
    (message) =>
      message.projectId === props.projectId &&
      message.campaignId === props.campaignId,
  );
  return (
    <section
      id="discussion"
      className="project-discussion"
      aria-labelledby="discussion-title"
    >
      <SectionHeading
        eyebrow="BUILD IT TOGETHER"
        title="Project Discussion"
        titleId="discussion-title"
      >
        <span className="discussion-count">
          <MessageSquare size={15} aria-hidden="true" />
          {messages.length} posts
        </span>
      </SectionHeading>
      <p className="section-description">
        A shared space for backers and creators. Ask questions, share feedback,
        and follow project updates.
      </p>
      <div className="discussion-card">
        {messages.length ? (
          <ol className="discussion-messages" aria-label="Discussion posts">
            {messages.map((message) => (
              <li key={message.id}>
                <DiscussionMessage message={message} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="discussion-empty">
            No messages yet. Start the conversation.
          </p>
        )}
        <MessageComposer
          key={discussionScopeKey(props)}
          currentUserRole={props.currentUserRole}
          canPost={props.canPost}
          isSubmitting={props.isSubmitting}
          onSendMessage={props.onSendMessage}
          onSendUpdate={props.onSendUpdate}
        />
      </div>
    </section>
  );
}
