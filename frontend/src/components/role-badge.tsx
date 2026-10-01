import { discussionRoleLabels } from "@/lib/discussion";
import type { DiscussionRole } from "@/types/discussion";

export function RoleBadge({ role }: { role: DiscussionRole }) {
  return (
    <span className={`role-badge role-${role}`}>
      {discussionRoleLabels[role]}
    </span>
  );
}
