import { ArrowUpRight, Check, LockKeyhole, Vote } from "lucide-react";
import { SectionHeading, StatusBadge } from "@/components/ui";
import { formatSol } from "@/lib/amounts";
import type { Milestone } from "@/types/crowdfunding";

export function MilestoneList({ milestones }: { milestones: Milestone[] }) {
  const released = milestones.filter(
    (milestone) => milestone.status === "released",
  ).length;
  return (
    <section id="milestones" aria-labelledby="milestones-title">
      <SectionHeading
        eyebrow="THE ROAD AHEAD"
        title="One milestone at a time"
        titleId="milestones-title"
      >
        <span className="section-counter">
          {released} of {milestones.length} completed
        </span>
      </SectionHeading>
      <p className="section-description">
        A clear plan. Shared decisions. Funding that follows progress.
      </p>
      <ol className="milestone-list">
        {milestones.map((milestone, index) => {
          const active = milestone.status === "voting";
          return (
            <li
              key={milestone.id}
              className={`milestone-card milestone-${milestone.status}`}
            >
              <div className="milestone-marker">
                {milestone.status === "released" ? (
                  <Check size={20} aria-hidden="true" />
                ) : (
                  <span>0{index + 1}</span>
                )}
              </div>
              <div className="milestone-content">
                <div className="milestone-topline">
                  <span className="eyebrow">MILESTONE 0{index + 1}</span>
                  <StatusBadge status={milestone.status} />
                </div>
                <div className="milestone-title-row">
                  <h3>{milestone.title}</h3>
                  <p>
                    {formatSol(milestone.amount)} <span>SOL</span>
                  </p>
                </div>
                <p className="milestone-description">{milestone.description}</p>
                <div className="milestone-bottom">
                  {active ? (
                    <>
                      <span>
                        <Vote size={14} aria-hidden="true" />
                        Your vote shapes what’s next
                      </span>
                      <a href="#voting">
                        Review & vote
                        <ArrowUpRight size={15} aria-hidden="true" />
                      </a>
                    </>
                  ) : milestone.status === "released" ? (
                    <span>
                      <Check size={14} aria-hidden="true" />
                      Approved by backers · Funds released
                    </span>
                  ) : (
                    <span>
                      <LockKeyhole size={13} aria-hidden="true" />
                      Unlocks after community approval
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
