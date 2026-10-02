/* eslint-disable @next/next/no-img-element -- Demo project media includes local data URLs. */
"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  FolderHeart,
  MessageCircle,
  Plus,
  Vote,
} from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
import { asLamports, formatSol, percentOf } from "@/lib/amounts";
import { getUserContribution } from "@/services/project-repository";
import {
  DEMO_IDENTITIES,
  type Project,
  type ProjectState,
} from "@/types/project";
import "./editor.css";

export function ProjectDashboard() {
  const { state, setIdentity } = useProjects();
  const [tab, setTab] = useState<"mine" | "supported">("mine");
  if (!state)
    return (
      <section className="of-container of-page">
        <p role="status">Loading your dashboard…</p>
      </section>
    );
  if (state.identityId === "visitor")
    return (
      <section className="of-container of-page">
        <div className="of-card dashboard-visitor">
          <p className="of-eyebrow">Your workspace</p>
          <h1>Follow the ideas you believe in.</h1>
          <p>
            Select a demo identity to view created projects, supported projects
            and milestone reviews. Your activity stays in this browser.
          </p>
          <div className="dashboard-identity-options">
            <button
              className="of-button"
              onClick={() => setIdentity("creator")}
            >
              Use Creator
            </button>
            <button
              className="of-button secondary"
              onClick={() => setIdentity("backer-a")}
            >
              Use Backer A
            </button>
            <Link href="/projects?mode=demo" className="of-button secondary">
              Explore projects
            </Link>
          </div>
        </div>
      </section>
    );
  const identity = DEMO_IDENTITIES.find(
    (item) => item.id === state.identityId,
  )!;
  const own = state.projects.filter(
    (project) => project.creatorId === state.identityId,
  );
  const supported = state.projects.filter(
    (project) => asLamports(getUserContribution(state, project.id)) > 0n,
  );
  const contributionTotal = supported.reduce(
    (total, project) =>
      total + asLamports(getUserContribution(state, project.id)),
    0n,
  );
  const list = tab === "mine" ? own : supported;
  return (
    <section className="of-container of-page">
      <div className="dashboard-heading">
        <div>
          <p className="of-eyebrow">{identity.name} · demo workspace</p>
          <h1 className="of-page-title">My dashboard</h1>
          <p className="of-subtitle">
            Manage your projects and follow the progress you support.
          </p>
        </div>
        {state.identityId === "creator" && (
          <Link href="/create?mode=demo" className="of-button">
            <Plus size={16} aria-hidden="true" /> Create project
          </Link>
        )}
      </div>
      <div className="dashboard-summary" aria-label="Your demo activity">
        <div className="of-card">
          <p>Projects created</p>
          <strong>{own.length}</strong>
        </div>
        <div className="of-card">
          <p>Projects supported</p>
          <strong>{supported.length}</strong>
        </div>
        <div className="of-card">
          <p>Your contributions</p>
          <strong>{formatSol(contributionTotal.toString())} SOL</strong>
        </div>
      </div>
      <div
        className="dashboard-tabs"
        role="tablist"
        aria-label="Dashboard projects"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? "mine"
              : event.key === "End"
                ? "supported"
                : tab === "mine"
                  ? "supported"
                  : "mine";
          setTab(next);
          document.getElementById(`dashboard-${next}-tab`)?.focus();
        }}
      >
        <button
          id="dashboard-mine-tab"
          role="tab"
          aria-controls="dashboard-mine"
          aria-selected={tab === "mine"}
          tabIndex={tab === "mine" ? 0 : -1}
          onClick={() => setTab("mine")}
        >
          My Projects <span>{own.length}</span>
        </button>
        <button
          id="dashboard-supported-tab"
          role="tab"
          aria-controls="dashboard-supported"
          aria-selected={tab === "supported"}
          tabIndex={tab === "supported" ? 0 : -1}
          onClick={() => setTab("supported")}
        >
          Supported Projects <span>{supported.length}</span>
        </button>
      </div>
      <div
        role="tabpanel"
        id={`dashboard-${tab}`}
        aria-labelledby={`dashboard-${tab === "mine" ? "mine" : "supported"}-tab`}
        tabIndex={0}
      >
        <h2 className="dashboard-section-title">
          {tab === "mine" ? "Projects I create" : "Projects I support"}
        </h2>
        <p className="dashboard-section-intro">
          {tab === "mine"
            ? "Keep your story current and share progress with backers."
            : "Your contributions give you a voice in milestone reviews."}
        </p>
        {list.length ? (
          <div className="dashboard-list">
            {list.map((project) => (
              <DashboardProject
                key={project.id}
                project={project}
                state={state}
                owned={project.creatorId === state.identityId}
              />
            ))}
          </div>
        ) : (
          <div className="of-card dashboard-empty">
            <FolderHeart size={32} aria-hidden="true" />
            <h2>
              {tab === "mine" ? "No projects yet" : "Your support starts here"}
            </h2>
            <p>
              {tab === "mine"
                ? state.identityId === "creator"
                  ? "Create a project and save a draft while you refine your plan."
                  : "Creator can create projects in this demo. Choose Creator to try the creation flow."
                : "Explore projects and make a demo contribution to follow their progress here."}
            </p>
            {tab === "mine" && state.identityId === "creator" ? (
              <Link className="of-button" href="/create?mode=demo">
                Create your first project
              </Link>
            ) : (
              <Link className="of-button" href="/projects?mode=demo">
                Explore projects <ArrowRight size={15} aria-hidden="true" />
              </Link>
            )}
          </div>
        )}
      </div>
      <p className="of-muted dashboard-demo-note">
        Demo balance: {formatSol(state.balances[state.identityId])} SOL. Project
        activity and balances are local demo data.
      </p>
    </section>
  );
}

function DashboardProject({
  project,
  state,
  owned,
}: {
  project: Project;
  state: ProjectState;
  owned: boolean;
}) {
  const contribution = getUserContribution(state, project.id);
  const progress = percentOf(project.raised, project.goal);
  const milestone =
    project.milestones.find((item) => item.status !== "released") ??
    project.milestones.at(-1);
  const eligibleVote = project.milestones.some(
    (item) =>
      item.status === "voting" &&
      asLamports(item.voting?.weights[state.identityId] ?? "0") > 0n &&
      !item.voting?.votes[state.identityId],
  );
  return (
    <article className="of-card dashboard-project" aria-label={project.title}>
      <div className="dashboard-project-title">
        {project.logoUrl ? (
          <img src={project.logoUrl} alt="" />
        ) : (
          <span className="dashboard-logo-placeholder" aria-hidden="true">
            {project.title.slice(0, 1)}
          </span>
        )}
        <div>
          <h3>
            <Link href={`/projects/${project.id}`}>{project.title}</Link>
          </h3>
          <p>
            {project.category} · {project.creatorName}
          </p>
        </div>
      </div>
      <div className="dashboard-project-metrics">
        <div>
          <small>{owned ? "Raised" : "Your contribution"}</small>
          <strong>
            {formatSol(owned ? project.raised : contribution)} SOL
          </strong>
        </div>
        <div>
          <small>Backers</small>
          <strong>{project.backers}</strong>
        </div>
        <div>
          <small>Status</small>
          <strong>
            {project.status === "draft"
              ? "Draft"
              : project.status === "completed"
                ? "Completed"
                : project.status === "active"
                  ? "In progress"
                  : "In funding"}
          </strong>
        </div>
      </div>
      <div className="dashboard-project-progress">
        <div>
          <span>
            {formatSol(project.raised)} / {formatSol(project.goal)} SOL
          </span>
          <span>{progress}% funded</span>
        </div>
        <progress
          max={100}
          value={progress}
          aria-label={`${project.title} funding progress`}
        />
      </div>
      <div className="dashboard-project-footer">
        <div className="dashboard-current">
          Current milestone: <strong>{milestone?.title ?? "—"}</strong>
          <br />
          {eligibleVote ? (
            <span className="dashboard-vote-note">
              Your milestone vote is ready.
            </span>
          ) : milestone ? (
            milestone.status.replaceAll("_", " ")
          ) : (
            ""
          )}
        </div>
        <div className="dashboard-project-actions">
          <Link href={`/projects/${project.id}`} className="of-button">
            {project.status === "draft" ? "Preview draft" : "View project"}
          </Link>
          {owned && (
            <Link
              href={`/projects/${project.id}/edit`}
              className="of-button secondary"
            >
              Edit project
            </Link>
          )}
          {owned && project.status !== "draft" && (
            <Link
              href={`/projects/${project.id}#milestones`}
              className="of-button secondary"
            >
              Manage milestones
            </Link>
          )}
          {project.status !== "draft" && (
            <Link
              href={`/projects/${project.id}#discussion`}
              className="of-button secondary"
            >
              <MessageCircle size={13} aria-hidden="true" /> Discussion
            </Link>
          )}
          {eligibleVote && (
            <Link
              href={`/projects/${project.id}#milestones`}
              className="of-button secondary"
            >
              <Vote size={13} aria-hidden="true" /> Vote
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
