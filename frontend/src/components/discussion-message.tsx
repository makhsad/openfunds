import { Megaphone, MessageSquare } from "lucide-react";
import { RoleBadge } from "@/components/role-badge";
import type { DiscussionMessageData } from "@/types/discussion";

export function DiscussionMessage({
  message,
}: {
  message: DiscussionMessageData;
}) {
  const author =
    message.authorName ||
    (message.walletAddress
      ? `${message.walletAddress.slice(0, 6)}…${message.walletAddress.slice(-4)}`
      : "Demo participant");
  const isUpdate = message.type === "update" && message.role === "creator";
  const Icon = isUpdate ? Megaphone : MessageSquare;
  return (
    <article
      className={`discussion-message ${isUpdate ? "discussion-update" : ""}`}
    >
      <div className="discussion-avatar" aria-hidden="true">
        {author.slice(0, 2).toUpperCase()}
      </div>
      <div className="discussion-message-body">
        <div className="discussion-message-meta">
          <strong title={message.walletAddress}>{author}</strong>
          <RoleBadge role={message.role} />
          <time dateTime={message.createdAt}>
            {new Intl.DateTimeFormat("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "UTC",
            }).format(new Date(message.createdAt))}{" "}
            UTC
          </time>
        </div>
        <span className="discussion-message-type">
          <Icon size={13} aria-hidden="true" />
          {isUpdate ? "Project Update" : "Message"}
        </span>
        <p className="discussion-message-text">{message.text}</p>
      </div>
    </article>
  );
}
