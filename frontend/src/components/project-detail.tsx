"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ExternalLink,
  Flag,
  LockKeyhole,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
import { ProjectDiscussion } from "@/components/project-discussion";
import { FundFlow } from "@/components/fund-flow";
import {
  asLamports,
  formatSol,
  parseSol,
  percentOf,
  voteResults,
} from "@/lib/amounts";
import {
  getIdentity,
  getProjectRole,
  getUserContribution,
} from "@/services/project-repository";
import type { Project, ProjectMilestone } from "@/types/project";

const TABS = ["Overview", "Milestones", "Discussion", "Transactions"] as const;
type Tab = (typeof TABS)[number];
const statusText = (value: string) => value.replaceAll("_", " ");

export function ProjectDetail({ id }: { id: string }) {
  const { state, repository, pending, run } = useProjects();
  const [tab, setTab] = useState<Tab>("Overview");
  const [amount, setAmount] = useState("0.1");
  const [amountError, setAmountError] = useState<string | null>(null);
  useEffect(() => {
    function readHash() {
      const selected = TABS.find(
        (item) => `#${item.toLowerCase()}` === window.location.hash,
      );
      if (selected) setTab(selected);
    }
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);
  if (!state || !repository)
    return (
      <div className="of-container of-page of-empty" role="status">
        Loading project…
      </div>
    );
  const project = state.projects.find((item) => item.id === id);
  if (
    !project ||
    (project.status === "draft" && project.creatorId !== state.identityId)
  )
    return (
      <div className="of-container of-page of-empty">
        <Flag size={32} />
        <h1>Project not found</h1>
        <p>This project is unavailable or is a private draft.</p>
        <Link className="of-button" href="/projects?mode=demo">
          Explore projects
        </Link>
      </div>
    );
  const role = getProjectRole(state, project);
  const contribution = getUserContribution(state, id);
  const progress = percentOf(project.raised, project.goal);
  const creator = role === "creator";
  const canContribute =
    state.identityId !== "visitor" &&
    !creator &&
    project.status !== "draft" &&
    project.status !== "completed" &&
    asLamports(project.raised) < asLamports(project.goal);
  function changeTab(next: Tab) {
    setTab(next);
    window.history.replaceState(null, "", `#${next.toLowerCase()}`);
  }
  async function contribute(event: React.FormEvent) {
    event.preventDefault();
    setAmountError(null);
    let lamports: string;
    try {
      lamports = parseSol(amount);
    } catch (cause) {
      setAmountError(
        cause instanceof Error ? cause.message : "Enter a valid amount.",
      );
      return;
    }
    await run(
      () => repository!.contribute(id, lamports),
      "Demo contribution saved. You are now a backer of this project.",
    );
  }
  return (
    <div className="of-container of-page of-detail">
      <div className="of-detail-top">
        <Link className="of-text-link muted" href="/projects?mode=demo">
          <ArrowLeft size={15} /> All projects
        </Link>
        <span className="of-local-chip">
          <ShieldCheck size={13} /> Local demo project
        </span>
      </div>
      <div className="of-detail-cover">
        <img
          src={project.coverUrl || "/images/project-community.svg"}
          alt={`${project.title} cover`}
        />
        <span className={`of-badge ${project.status}`}>
          {project.status === "funding" ? "In funding" : project.status}
        </span>
      </div>
      <div className="of-detail-grid">
        <div className="of-detail-main">
          <header className="of-project-heading">
            <img
              className="of-detail-logo"
              src={project.logoUrl || "/images/project-community.svg"}
              alt={`${project.title} logo`}
            />
            <div>
              <span className="of-eyebrow">{project.category}</span>
              <h1>{project.title}</h1>
              <p>{project.shortDescription}</p>
              <div className="of-creator-line">
                <span className="of-avatar">
                  {project.creatorName.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  by <strong>{project.creatorName}</strong>
                </span>
                <span className="of-local-chip">Demo creator</span>
              </div>
            </div>
          </header>
          {creator && (
            <div className="of-owner-tools">
              <span>
                <Flag size={15} /> Your project workspace
              </span>
              <Link className="of-text-link" href={`/projects/${id}/edit`}>
                Edit project <ArrowUpRight size={14} />
              </Link>
              {project.status === "draft" && (
                <button
                  className="of-button small"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => repository.publishProject(id),
                      "Project published in Explore.",
                    )
                  }
                >
                  Publish Project
                </button>
              )}
            </div>
          )}
          <div className="of-tabs" role="tablist" aria-label="Project sections">
            {TABS.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                id={`tab-${item.toLowerCase()}`}
                aria-selected={tab === item}
                aria-controls={`panel-${item.toLowerCase()}`}
                tabIndex={tab === item ? 0 : -1}
                onClick={() => changeTab(item)}
                onKeyDown={(event) => {
                  if (
                    event.key === "ArrowRight" ||
                    event.key === "ArrowLeft" ||
                    event.key === "Home" ||
                    event.key === "End"
                  ) {
                    event.preventDefault();
                    const index =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? TABS.length - 1
                          : (TABS.indexOf(item) +
                              (event.key === "ArrowRight" ? 1 : -1) +
                              TABS.length) %
                            TABS.length;
                    changeTab(TABS[index]);
                    document
                      .getElementById(`tab-${TABS[index].toLowerCase()}`)
                      ?.focus();
                  }
                }}
              >
                {item}
                {item === "Discussion" && (
                  <span>
                    {
                      state.messages.filter(
                        (message) => message.projectId === id,
                      ).length
                    }
                  </span>
                )}
              </button>
            ))}
          </div>
          <section
            className="of-tab-panel"
            role="tabpanel"
            id={`panel-${tab.toLowerCase()}`}
            aria-labelledby={`tab-${tab.toLowerCase()}`}
            tabIndex={0}
          >
            {tab === "Overview" && <ProjectOverview project={project} />}
            {tab === "Milestones" && (
              <div className="of-milestones">
                <div className="of-section-heading">
                  <div>
                    <p className="of-eyebrow">A CLEAR PATH FORWARD</p>
                    <h2>Project milestones</h2>
                  </div>
                  <span className="of-local-chip">Local demo voting</span>
                </div>
                <p className="of-subtitle">
                  Follow each step, review the evidence, and have a say in what
                  happens next.
                </p>
                {project.milestones.map((milestone, index) => (
                  <MilestonePanel
                    key={milestone.id}
                    project={project}
                    milestone={milestone}
                    index={index}
                  />
                ))}
                <p className="of-local-note">
                  Approval needs 60% of the fixed contribution snapshot. The
                  result closes after every eligible backer votes. Approved
                  funds remain locked until the creator confirms a separate demo
                  release.
                </p>
              </div>
            )}
            {tab === "Discussion" && (
              <ProjectDiscussion
                projectId={id}
                campaignId={String(project.campaignId)}
                messages={state.messages}
                currentUserRole={role}
                canPost={role === "creator" || role === "backer"}
                isSubmitting={pending}
                onSendMessage={async (text) => {
                  if (
                    !(await run(
                      () => repository.postMessage(id, text, "message"),
                      "Message posted to this project.",
                    ))
                  )
                    throw new Error("Message was not sent.");
                }}
                onSendUpdate={async (text) => {
                  if (
                    !(await run(
                      () => repository.postMessage(id, text, "update"),
                      "Project update published.",
                    ))
                  )
                    throw new Error("Update was not sent.");
                }}
              />
            )}
            {tab === "Transactions" && (
              <ProjectTransactions project={project} />
            )}
          </section>
        </div>
        <aside
          className="of-funding-card"
          aria-label="Project funding statistics"
        >
          <span className={`of-badge ${project.status}`}>
            {project.status === "funding" ? "In funding" : project.status}
          </span>
          <p className="of-funding-amount">
            <strong>{formatSol(project.raised)}</strong> /{" "}
            {formatSol(project.goal)} SOL <span>{progress}%</span>
          </p>
          <div
            className="of-progress"
            role="progressbar"
            aria-label="Funding progress"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <dl className="of-funding-stats">
            <div>
              <dt>Backers</dt>
              <dd>{project.backers}</dd>
            </div>
            <div>
              <dt>Locked</dt>
              <dd>{formatSol(project.locked)} SOL</dd>
            </div>
            <div>
              <dt>Released</dt>
              <dd>{formatSol(project.released)} SOL</dd>
            </div>
          </dl>
          <form className="of-contribute" onSubmit={contribute}>
            <h2>Back the next step.</h2>
            <p>Support this project with a demo contribution.</p>
            <div className="of-quick-amounts">
              {["0.1", "0.5", "1"].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={amount === value ? "selected" : ""}
                  disabled={!canContribute || pending}
                  onClick={() => {
                    setAmount(value);
                    setAmountError(null);
                  }}
                >
                  {value} SOL
                </button>
              ))}
            </div>
            <label className="of-field">
              Contribution amount
              <span className="of-amount-input">
                <input
                  inputMode="decimal"
                  aria-describedby={
                    amountError ? "contribution-error" : "demo-balance"
                  }
                  value={amount}
                  disabled={!canContribute || pending}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setAmountError(null);
                  }}
                />
                <span>SOL</span>
              </span>
            </label>
            <p className="of-input-note" id="demo-balance">
              Demo balance: {formatSol(state.balances[state.identityId])} SOL
            </p>
            {amountError && (
              <p className="of-error" role="alert" id="contribution-error">
                {amountError}
              </p>
            )}
            <button
              className="of-button"
              type="submit"
              disabled={!canContribute || pending}
            >
              {pending ? "Processing…" : "Contribute (demo)"}
              <ArrowUpRight size={16} />
            </button>
            {!canContribute && (
              <p className="of-input-note">
                {creator
                  ? "Creators manage their own project. Switch to Backer A or B to support it."
                  : state.identityId === "visitor"
                    ? "Select a Backer demo identity to contribute."
                    : "Contributions are closed for this project."}
              </p>
            )}
          </form>
          <div className="of-your-contribution">
            <span>Your contribution</span>
            <strong>{formatSol(contribution)} SOL</strong>
            <small>{getIdentity(state.identityId).name} · Demo identity</small>
          </div>
          <p className="of-vault-note">
            <LockKeyhole size={15} /> Demo vault accounting stays separate for
            every project. No real SOL moves.
          </p>
        </aside>
      </div>
    </div>
  );
}

function ProjectOverview({ project }: { project: Project }) {
  return (
    <div className="of-overview">
      <section>
        <p className="of-eyebrow">THE IDEA</p>
        <h2>Built with purpose.</h2>
        <p className="of-long-text">{project.description}</p>
      </section>
      <div className="of-plan-grid">
        {[
          ["What we're building", project.plan.what],
          ["Why it matters", project.plan.why],
          ["Who it's for", project.plan.audience],
          ["The roadmap", project.plan.roadmap],
        ].map(([title, text]) => (
          <section key={title}>
            <h3>{title}</h3>
            <p className="of-long-text">{text}</p>
          </section>
        ))}
      </div>
      {Object.values(project.links).some(Boolean) && (
        <div className="of-project-links">
          {Object.entries(project.links)
            .filter(([, url]) => url)
            .map(([name, url]) => (
              <a
                className="of-button secondary small"
                key={name}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {name[0].toUpperCase() + name.slice(1)}{" "}
                <ExternalLink size={13} />
              </a>
            ))}
        </div>
      )}
      {!!project.gallery?.length && (
        <section>
          <h3>A closer look</h3>
          <div className="of-gallery">
            {project.gallery.map((url, index) => (
              <a
                key={index}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  src={url}
                  alt={`${project.title} gallery image ${index + 1}`}
                />
              </a>
            ))}
          </div>
        </section>
      )}
      <FundFlow />
    </div>
  );
}

function MilestonePanel({
  project,
  milestone,
  index,
}: {
  project: Project;
  milestone: ProjectMilestone;
  index: number;
}) {
  const { state, repository, pending, run } = useProjects();
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [demoUrl, setDemoUrl] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  if (!state || !repository) return null;
  const creator = project.creatorId === state.identityId;
  const canStart =
    creator &&
    ["locked", "rejected"].includes(milestone.status) &&
    project.status !== "draft" &&
    project.milestones
      .slice(0, index)
      .every((item) => item.status === "released");
  const voting = milestone.voting;
  const userWeight = voting?.weights[state.identityId] ?? "0";
  const userVote = voting?.votes[state.identityId];
  const canVote =
    milestone.status === "voting" &&
    !creator &&
    !userVote &&
    asLamports(userWeight) > 0n;
  const results = voting
    ? voteResults({
        milestoneId: milestone.id,
        ...voting,
        userWeight,
        userVote: userVote ?? null,
      })
    : null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      await run(
        () =>
          repository!.submitMilestone(project.id, milestone.id, {
            summary,
            evidenceUrl,
            demoUrl,
            githubUrl,
          }),
        "Milestone submitted. Local voting uses a fixed backer snapshot.",
      )
    )
      setSubmitting(false);
  }
  return (
    <article
      className={`of-milestone ${milestone.status}`}
      aria-label={milestone.title}
    >
      <div className="of-milestone-heading">
        <span className="of-milestone-number">
          {milestone.status === "released" ? <Check size={17} /> : index + 1}
        </span>
        <div>
          <h3>{milestone.title}</h3>
          <p>{milestone.description}</p>
        </div>
        <strong>{formatSol(milestone.amount)} SOL</strong>
        <span className={`of-badge ${milestone.status}`}>
          {statusText(milestone.status)}
        </span>
      </div>
      {milestone.submission && (
        <div className="of-submission">
          <p className="of-eyebrow">CREATOR’S COMPLETION REPORT</p>
          <p className="of-long-text">{milestone.submission.summary}</p>
          <div className="of-project-links">
            {[
              ["Evidence", milestone.submission.evidenceUrl],
              ["Demo", milestone.submission.demoUrl],
              ["GitHub", milestone.submission.githubUrl],
            ]
              .filter(([, url]) => url)
              .map(([label, url]) => (
                <a
                  className="of-text-link"
                  key={label}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {label} <ExternalLink size={13} />
                </a>
              ))}
          </div>
        </div>
      )}
      {voting && results && (
        <div className="of-voting">
          <div className="of-voting-heading">
            <h4>Community review</h4>
            <span>Local demo voting</span>
          </div>
          <p>
            Fixed snapshot: <strong>{formatSol(voting.totalWeight)} SOL</strong>{" "}
            · Required approval: {voting.thresholdPercent}%
          </p>
          <div
            className="of-vote-bar"
            role="img"
            aria-label={`Approve ${results.approve}%, Reject ${results.reject}%, Uncast ${results.notVoted}%`}
          >
            <span
              className="approve"
              style={{ width: `${results.approve}%` }}
            />
            <span className="reject" style={{ width: `${results.reject}%` }} />
          </div>
          <dl className="vote-results">
            <div>
              <dt>Approve weight</dt>
              <dd>
                {results.approve}% · {formatSol(voting.approveWeight)} SOL
              </dd>
            </div>
            <div>
              <dt>Reject weight</dt>
              <dd>
                {results.reject}% · {formatSol(voting.rejectWeight)} SOL
              </dd>
            </div>
            <div>
              <dt>Uncast weight</dt>
              <dd>
                {results.notVoted}% ·{" "}
                {formatSol(
                  (
                    asLamports(voting.totalWeight) -
                    asLamports(voting.approveWeight) -
                    asLamports(voting.rejectWeight)
                  ).toString(),
                )}{" "}
                SOL
              </dd>
            </div>
          </dl>
          <p className="of-input-note">
            Your snapshot weight: {formatSol(userWeight)} SOL. Later
            contributions do not change this vote.
          </p>
          {canVote && (
            <div className="of-vote-actions">
              <button
                className="of-button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => repository.vote(project.id, milestone.id, "approve"),
                    "Your demo approval was recorded.",
                  )
                }
              >
                Approve
              </button>
              <button
                className="of-button secondary"
                disabled={pending}
                onClick={() =>
                  run(
                    () => repository.vote(project.id, milestone.id, "reject"),
                    "Your demo rejection was recorded.",
                  )
                }
              >
                Reject
              </button>
            </div>
          )}
          {userVote && (
            <p className="of-vote-confirmation">
              <Check size={15} /> You voted {userVote}. Your vote is final.
            </p>
          )}
          {!canVote && !userVote && milestone.status === "voting" && (
            <p className="of-input-note">
              {creator
                ? "Creators cannot vote on their own milestone."
                : "Only backers in the fixed voting snapshot can vote."}
            </p>
          )}
          {milestone.status !== "voting" && (
            <p
              className={`of-vote-confirmation ${milestone.status === "rejected" ? "negative" : ""}`}
            >
              {milestone.status === "rejected"
                ? "Review closed. Approval threshold was not met."
                : "Review closed. The community approved this milestone."}
            </p>
          )}
        </div>
      )}
      {(canStart ||
        (creator &&
          ["in_progress", "approved"].includes(milestone.status))) && (
        <div className="of-milestone-actions">
          {canStart && (
            <button
              className="of-button secondary small"
              disabled={pending}
              onClick={() =>
                run(
                  () => repository.startMilestone(project.id, milestone.id),
                  "Milestone started.",
                )
              }
            >
              Start Milestone
            </button>
          )}
          {creator && milestone.status === "in_progress" && !submitting && (
            <button
              className="of-button small"
              disabled={pending}
              onClick={() => setSubmitting(true)}
            >
              Submit for Review
            </button>
          )}
          {creator && milestone.status === "approved" && (
            <button
              className="of-button small"
              disabled={pending}
              onClick={() =>
                run(
                  () => repository.releaseMilestone(project.id, milestone.id),
                  "Demo funds released for this milestone. No blockchain transaction was sent.",
                )
              }
            >
              Release demo funds
            </button>
          )}
        </div>
      )}
      {submitting && (
        <form className="of-submission-form" onSubmit={submit}>
          <h4>Show what you’ve built.</h4>
          <label className="of-field">
            Completion summary
            <textarea
              required
              rows={3}
              value={summary}
              disabled={pending}
              onChange={(event) => setSummary(event.target.value)}
            />
          </label>
          <div className="of-form-grid">
            {[
              ["Evidence URL", evidenceUrl, setEvidenceUrl],
              ["Demo URL", demoUrl, setDemoUrl],
              ["GitHub URL", githubUrl, setGithubUrl],
            ].map(([label, value, setter]) => (
              <label className="of-field" key={label as string}>
                {label as string}
                <input
                  type="url"
                  placeholder="https://"
                  value={value as string}
                  disabled={pending}
                  onChange={(event) =>
                    (setter as (value: string) => void)(event.target.value)
                  }
                />
              </label>
            ))}
          </div>
          <p className="of-input-note">
            Add at least one evidence, demo, or GitHub link. Submitting captures
            every current backer’s contribution as a fixed voting weight.
          </p>
          <div className="of-vote-actions">
            <button className="of-button small" disabled={pending}>
              Start demo voting
            </button>
            <button
              type="button"
              className="of-button secondary small"
              disabled={pending}
              onClick={() => setSubmitting(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {milestone.status === "locked" && !canStart && (
        <p className="of-input-note of-milestone-lock">
          <LockKeyhole size={13} />{" "}
          {index > 0
            ? "The previous milestone must be released before this step begins."
            : "The creator will start this milestone when the project is ready."}
        </p>
      )}
    </article>
  );
}

function ProjectTransactions({ project }: { project: Project }) {
  return (
    <section>
      <div className="of-section-heading">
        <div>
          <p className="of-eyebrow">A SHARED RECORD</p>
          <h2>Project transactions</h2>
        </div>
      </div>
      <p className="of-subtitle">
        Local demo activity for this project. No Solana transaction signatures
        are generated.
      </p>
      {project.transactions.length ? (
        <div
          className="of-table-wrap"
          role="region"
          aria-label="Scrollable project transactions"
          tabIndex={0}
        >
          <table className="of-table">
            <caption className="sr-only">
              Local demo project transactions
            </caption>
            <thead>
              <tr>
                <th>Type</th>
                <th>Demo identity</th>
                <th>Amount</th>
                <th>Time</th>
                <th>Status</th>
                <th>Network</th>
              </tr>
            </thead>
            <tbody>
              {project.transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>
                    <span className={`of-transaction-icon ${transaction.type}`}>
                      {transaction.type === "vote" ? (
                        <Check size={12} />
                      ) : (
                        <ArrowUpRight size={12} />
                      )}
                    </span>
                    {transaction.type[0].toUpperCase() +
                      transaction.type.slice(1)}
                    {transaction.voteChoice && (
                      <small> · {transaction.voteChoice}</small>
                    )}
                  </td>
                  <td>{transaction.sender}</td>
                  <td>
                    {transaction.amount
                      ? `${formatSol(transaction.amount)} SOL`
                      : "—"}
                  </td>
                  <td>
                    <time dateTime={transaction.createdAt}>
                      {new Date(transaction.createdAt).toLocaleDateString(
                        "en-US",
                        { month: "short", day: "numeric" },
                      )}{" "}
                      ·{" "}
                      {new Date(transaction.createdAt).toLocaleTimeString(
                        "en-US",
                        { hour: "2-digit", minute: "2-digit" },
                      )}
                    </time>
                  </td>
                  <td>
                    <span className={`of-badge ${transaction.status}`}>
                      {transaction.status}
                    </span>
                  </td>
                  <td>
                    {transaction.signature ? (
                      <a
                        href={`https://explorer.solana.com/tx/${encodeURIComponent(transaction.signature)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="View verified transaction on Solana Explorer"
                      >
                        <ExternalLink size={14} />
                      </a>
                    ) : (
                      <span className="of-input-note">Demo</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="of-empty compact">
          <MessageSquare size={25} />
          <h3>No transactions yet</h3>
          <p>Contributions, votes, and demo releases will appear here.</p>
        </div>
      )}
    </section>
  );
}
