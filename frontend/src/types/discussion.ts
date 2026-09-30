export type DiscussionRole =
  "visitor" | "connected_non_backer" | "backer" | "creator";
export type DiscussionMessageType = "message" | "update";

export interface DiscussionScope {
  projectId: string;
  campaignId: string;
}

export interface DiscussionMessageData extends DiscussionScope {
  id: string;
  authorName?: string;
  walletAddress?: string;
  role: DiscussionRole;
  text: string;
  createdAt: string;
  type: DiscussionMessageType;
}

export interface ProjectDiscussionProps extends DiscussionScope {
  messages: readonly DiscussionMessageData[];
  currentUserRole: DiscussionRole;
  canPost: boolean;
  isSubmitting: boolean;
  onSendMessage: (text: string) => Promise<void>;
  onSendUpdate: (text: string) => Promise<void>;
}
