import {
  ArrowRight,
  BadgeCheck,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { SectionHeading } from "@/components/ui";

export function FundFlow() {
  const steps = [
    { title: "Backers", subtitle: "Back the idea", icon: Users },
    {
      title: "OpenFunds Vault",
      subtitle: "Funds stay locked",
      icon: ShieldCheck,
    },
    {
      title: "Approved Milestone",
      subtitle: "The community votes",
      icon: BadgeCheck,
    },
    { title: "Creator", subtitle: "Build the next step", icon: Wallet },
  ];
  return (
    <section
      id="how-it-works"
      className="fund-flow"
      aria-labelledby="flow-title"
    >
      <SectionHeading
        title="Good ideas. Accountable funding."
        titleId="flow-title"
      />
      <p className="section-description">
        You back the vision. Milestones keep it moving.
      </p>
      <ol className="flow-steps">
        {steps.map(({ title, subtitle, icon: Icon }, index) => (
          <li key={title}>
            <span className={`flow-icon flow-icon-${index}`}>
              <Icon size={23} aria-hidden="true" />
            </span>
            <h3>{title}</h3>
            <p>{subtitle}</p>
            {index < steps.length - 1 && (
              <ArrowRight className="flow-arrow" size={18} aria-hidden="true" />
            )}
          </li>
        ))}
      </ol>
      <p className="flow-footnote">
        <ShieldCheck size={15} aria-hidden="true" />
        In this demo, every step is simulated. No real SOL moves.
      </p>
    </section>
  );
}
