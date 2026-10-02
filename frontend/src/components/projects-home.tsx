"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleCheck,
  Layers,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
import { ProjectCard } from "@/components/project-card";
import { DevnetOverview } from "@/features/solana/devnet-overview";

export function ProjectsHome({ live = false }: { live?: boolean }) {
  const { state } = useProjects();
  const projects =
    state?.projects
      .filter((project) => project.status !== "draft")
      .slice(0, 3) ?? [];
  const browse = live ? "/projects" : "/projects?mode=demo";
  const create = live ? "/create" : "/create?mode=demo";
  return (
    <>
      <section className="of-hero">
        <div className="of-container of-hero-grid">
          <div className="of-hero-copy">
            <span className="of-eyebrow">
              <span className="of-solana-mark">≋</span> IDEAS WORTH BUILDING.
              TOGETHER.
            </span>
            <h1>
              Big ideas.
              <br />
              <span>Shared progress.</span>
            </h1>
            <p className="of-hero-lede">
              {live
                ? "Shared campaign funding on Solana Devnet."
                : "Milestone-based crowdfunding on Solana."}
            </p>
            <p className="of-hero-description">
              {live ? (
                <>
                  Create a campaign. Contribute test SOL.
                  <br />
                  See sponsor contributions and confirmed transactions across
                  devices.
                </>
              ) : (
                <>
                  Fund projects. Track progress. Approve milestones.
                  <br />
                  Release funds step by step.
                </>
              )}
            </p>
            <div className="of-hero-actions">
              <Link className="of-button" href={browse}>
                Explore Projects <ArrowUpRight size={17} />
              </Link>
              <Link className="of-button secondary" href={create}>
                Create Project <ArrowRight size={17} />
              </Link>
            </div>
            <div className="of-hero-trust">
              <ShieldCheck size={16} />
              <span>Clear plans</span>
              <i />
              <span>{live ? "Shared chain data" : "Community decisions"}</span>
              <i />
              <span>Visible progress</span>
            </div>
          </div>
          <div
            className="of-hero-visual"
            aria-label="OpenFunds milestone funding concept"
          >
            <div className="of-visual-grid" />
            <div className="of-hero-logo-card">
              <img
                src="/images/openfunds-logo.png"
                alt="Official OpenFunds logo"
              />
              <span className="of-visual-label">
                GOOD IDEAS. ACCOUNTABLE FUNDING.
              </span>
              <div className="of-visual-progress">
                <span />
                <span />
                <span />
              </div>
              <div className="of-visual-milestone">
                <span>
                  <CircleCheck size={18} />{" "}
                  {live ? "Campaign funding" : "Prototype"}
                </span>
                <strong>
                  {live ? "Confirmed on Devnet" : "Community approved"}
                </strong>
              </div>
            </div>
            <div className="of-float-card of-float-top">
              <Users size={19} />
              <div>
                <strong>Backed by people</strong>
                <span>Built for shared success</span>
              </div>
            </div>
            <div className="of-float-card of-float-bottom">
              <ShieldCheck size={22} />
              <div>
                <strong>
                  {live
                    ? "Visible sponsor contributions"
                    : "One milestone at a time"}
                </strong>
                <span>A clear path from idea to impact</span>
              </div>
              <Check size={15} />
            </div>
            <span className="of-hero-orbit orbit-one" />
            <span className="of-hero-orbit orbit-two" />
          </div>
        </div>
      </section>
      <section className="of-container of-section">
        <div className="of-section-heading">
          <div>
            <p className="of-eyebrow">DISCOVER WHAT’S NEXT</p>
            <h2>
              {live
                ? "Live campaigns and actual test SOL funding."
                : "Ideas with a little more possibility."}
            </h2>
          </div>
          <Link className="of-text-link" href={browse}>
            View all projects <ArrowRight size={17} />
          </Link>
        </div>
        {live ? (
          <DevnetOverview mode="catalog" compact />
        ) : (
          <div className="of-project-grid">
            {projects.length
              ? projects.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))
              : [1, 2, 3].map((item) => (
                  <div key={item} className="of-card of-skeleton" role="status">
                    Loading projects…
                  </div>
                ))}
          </div>
        )}
      </section>
      <section className="of-how" id="how-it-works">
        <div className="of-container">
          <div className="of-centered-heading">
            <p className="of-eyebrow">FROM IDEA TO IMPACT</p>
            <h2>A better way to build, together.</h2>
            <p>
              A clear plan, a supportive community, and progress you can follow.
            </p>
          </div>
          <div className="of-steps">
            {(live
              ? [
                  {
                    icon: Sparkles,
                    title: "Create a campaign",
                    text: "Connect the creator's Phantom wallet and confirm campaign creation on Devnet.",
                  },
                  {
                    icon: Users,
                    title: "Share the campaign",
                    text: "Give sponsors the campaign's public link. Each device reads the same blockchain accounts.",
                  },
                  {
                    icon: Layers,
                    title: "Contribute test SOL",
                    text: "Sponsors confirm a contribution in Phantom. Funds enter the campaign's program-controlled vault.",
                  },
                  {
                    icon: CircleCheck,
                    title: "Follow the movement",
                    text: "Both parties can see totals, individual backers and confirmed transactions after reload.",
                  },
                ]
              : [
                  {
                    icon: Sparkles,
                    title: "Share the vision",
                    text: "Creators set a goal and break their project into achievable milestones.",
                  },
                  {
                    icon: Users,
                    title: "Back what matters",
                    text: "Support the ideas you believe in and join the project conversation.",
                  },
                  {
                    icon: Layers,
                    title: "Review the progress",
                    text: "Backers review evidence and vote on each completed milestone.",
                  },
                  {
                    icon: CircleCheck,
                    title: "Keep building",
                    text: "Approved steps unlock the next part of the journey.",
                  },
                ]
            ).map(({ icon: Icon, title, text }, i) => (
              <article key={title}>
                <span className="of-step-number">0{i + 1}</span>
                <Icon size={26} />
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
          <p className="of-local-note">
            {live ? (
              <>
                Devnet uses test SOL. Milestone voting and withdrawals are
                planned and are available only as simulations in the separate
                demo.
              </>
            ) : (
              <>
                Try the complete journey in demo mode. Contributions, voting and
                releases use local browser data.
              </>
            )}
          </p>
        </div>
      </section>
      <section className="of-container of-section of-why">
        <div>
          <p className="of-eyebrow">WHY OPENFUNDS</p>
          <h2>
            Trust grows with
            <br />
            every step forward.
          </h2>
          <Link className="of-text-link" href={create}>
            Bring your idea to life <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="of-why-list">
          {(live
            ? [
                [
                  "One shared campaign",
                  "The public campaign link keeps the same creator selected when a sponsor connects or switches wallets.",
                ],
                [
                  "Funding you can verify",
                  "Campaign totals and each sponsor's recorded contribution come from program-owned Devnet accounts.",
                ],
                [
                  "A clear destination",
                  "Funds remain in the campaign vault. The creator's personal wallet balance is shown separately.",
                ],
              ]
            : [
                [
                  "A plan everyone can see",
                  "Know what will be built, how much each step costs, and what comes next.",
                ],
                [
                  "A voice for every backer",
                  "Contribution-weighted decisions keep supporters involved throughout the journey.",
                ],
                [
                  "One shared conversation",
                  "Updates and discussion keep creators and their project backers connected.",
                ],
              ]
          ).map(([title, text]) => (
            <article key={title}>
              <ShieldCheck size={22} />
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
