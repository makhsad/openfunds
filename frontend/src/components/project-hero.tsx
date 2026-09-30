import {
  ArrowDown,
  CheckCircle2,
  Lightbulb,
  ShieldCheck,
  Users,
  Vote,
} from "lucide-react";
import type { Campaign } from "@/types/crowdfunding";

function FundingIllustration() {
  const steps = [
    {
      title: "Project idea",
      detail: "A vision worth building",
      icon: Lightbulb,
    },
    {
      title: "Community support",
      detail: "Backers make it possible",
      icon: Users,
    },
    {
      title: "Backer voting",
      detail: "A shared decision at every step",
      icon: Vote,
    },
    {
      title: "Milestone complete",
      detail: "Approved progress. Funds released.",
      icon: CheckCircle2,
    },
  ];
  return (
    <div
      className="funding-art"
      role="img"
      aria-label="Milestone funding: project idea, community support, backer voting, then a completed milestone."
    >
      <div className="art-orbit orbit-one" />
      <div className="art-orbit orbit-two" />
      <span className="floating-symbol symbol-community">
        <Users size={25} aria-hidden="true" />
      </span>
      <span className="floating-symbol symbol-idea">
        <Lightbulb size={23} aria-hidden="true" />
      </span>
      <span className="art-dot dot-one" />
      <span className="art-dot dot-two" />
      <div className="funding-window" aria-hidden="true">
        <div className="window-bar">
          <div className="window-dots">
            <i />
            <i />
            <i />
          </div>
          <span>From idea to impact</span>
          <span>↗</span>
        </div>
        <div className="funding-journey">
          {steps.map(({ title, detail, icon: Icon }, index) => (
            <div
              className={`journey-step journey-step-${index + 1}`}
              key={title}
            >
              <span className="journey-icon">
                <Icon size={19} />
              </span>
              <div>
                <strong>{title}</strong>
                <span>{detail}</span>
              </div>
              <span className="journey-number">0{index + 1}</span>
              {index < steps.length - 1 && (
                <ArrowDown size={12} className="journey-arrow" />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="art-caption" aria-hidden="true">
        <span />
        Progress, powered by people
      </div>
    </div>
  );
}

export function ProjectHero({ campaign }: { campaign: Campaign }) {
  return (
    <section
      id="project"
      className="project-hero"
      aria-labelledby="project-title"
    >
      <div className="hero-copy">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-community">
            <Users size={14} aria-hidden="true" />
            {campaign.category}
          </span>
          <span className="hero-stage">
            <span className="status-dot" />
            {campaign.phase === "voting"
              ? "Milestone voting is live"
              : "Open for contributions"}
          </span>
        </div>
        <h1 id="project-title">
          Fund ideas. <br />
          <span className="hero-accent">
            Build together<span className="hero-period">.</span>
          </span>
        </h1>
        <p className="hero-description">{campaign.description}</p>
        <div className="creator">
          <span className="creator-avatar">B3</span>
          <div>
            <span className="creator-label">Created by</span>
            <strong>
              {campaign.creator}
              <ShieldCheck size={15} aria-label="Demo creator" />
            </strong>
          </div>
          <span className="creator-divider" />
          <div className="campaign-identity">
            <span className="creator-label">Demo campaign</span>
            <strong>{campaign.title}</strong>
          </div>
        </div>
      </div>
      <FundingIllustration />
    </section>
  );
}
