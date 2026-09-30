import { ArrowUpRight, LockKeyhole, Target, Wallet } from "lucide-react";
import { formatSol } from "@/lib/amounts";
import type { Campaign } from "@/types/crowdfunding";

export function ProjectStats({ campaign }: { campaign: Campaign }) {
  const stats = [
    {
      label: "Goal",
      value: campaign.goal,
      detail: "The idea, fully funded",
      icon: Target,
      color: "blue",
    },
    {
      label: "Raised",
      value: campaign.raised,
      detail: `Backed by ${campaign.backers} believers`,
      icon: Wallet,
      color: "teal",
    },
    {
      label: "Locked",
      value: campaign.locked,
      detail: "Held for future milestones",
      icon: LockKeyhole,
      color: "blue",
    },
    {
      label: "Released",
      value: campaign.released,
      detail: "Progress made possible",
      icon: ArrowUpRight,
      color: "teal",
    },
  ];
  return (
    <section aria-label="Project funding statistics" className="stats-grid">
      {stats.map(({ label, value, detail, icon: Icon, color }) => (
        <div className="stat" key={label}>
          <div className="stat-label">
            <span>{label}</span>
            <span className={`stat-icon ${color}`}>
              <Icon size={18} aria-hidden="true" />
            </span>
          </div>
          <p className="stat-value">
            {formatSol(value)} <span>SOL</span>
          </p>
          <p className="stat-detail">{detail}</p>
        </div>
      ))}
    </section>
  );
}
