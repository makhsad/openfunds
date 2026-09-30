"use client";

import { useState } from "react";
import { ArrowUpRight, ChevronRight, Heart } from "lucide-react";
import { useCrowdfunding } from "@/hooks/use-crowdfunding";
import { Navbar } from "@/components/navbar";
import { ProjectHero } from "@/components/project-hero";
import { ProjectStats } from "@/components/project-stats";
import { SupportProject } from "@/components/support-project";
import { MilestoneList } from "@/components/milestone-list";
import { VotingCard } from "@/components/voting-card";
import { FundFlow } from "@/components/fund-flow";
import { TransactionHistory } from "@/components/transaction-history";
import { DemoControls, type HistoryPreview } from "@/components/demo-controls";
import { OperationNotice } from "@/components/operation-notice";
import { Brand } from "@/components/ui";
import type { DemoOutcome, Scenario } from "@/types/crowdfunding";

function CampaignExperience({
  scenario,
  onScenario,
  onReset,
}: {
  scenario: Scenario;
  onScenario: (scenario: Scenario) => void;
  onReset: () => void;
}) {
  const {
    data,
    loadError,
    operation,
    pending,
    connect,
    disconnect,
    onSupport,
    onVote,
    setOutcome,
    cancel,
    dismiss,
  } = useCrowdfunding(scenario);
  const [outcome, updateOutcome] = useState<DemoOutcome>("success");
  const [history, setHistory] = useState<HistoryPreview>("normal");
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Navbar
        wallet={data?.wallet ?? null}
        pending={pending}
        connecting={
          operation.status === "pending" && operation.kind === "connect"
        }
        loading={!data}
        onConnect={() => void connect()}
        onDisconnect={disconnect}
      />
      <main id="main-content" className="page-shell" tabIndex={-1}>
        <div className="page-intro">
          <div className="breadcrumb">
            <span>Ideas with impact</span>
            <ChevronRight size={13} aria-hidden="true" />
            <span>Project spotlight</span>
          </div>
          <span className="intro-note">
            <span className="status-dot" />
            Built on trust. Backed by you.
          </span>
        </div>
        <DemoControls
          scenario={scenario}
          outcome={outcome}
          history={history}
          disabled={pending || !data}
          onScenario={onScenario}
          onOutcome={(value) => {
            updateOutcome(value);
            setOutcome(value);
          }}
          onHistory={setHistory}
          onReset={onReset}
        />
        {loadError ? (
          <div className="load-error" role="alert">
            <h1>We couldn’t load the demo.</h1>
            <p>{loadError}</p>
            <button className="button button-primary" onClick={onReset}>
              Try again
            </button>
          </div>
        ) : !data ? (
          <div className="page-loading" role="status" aria-busy="true">
            <span className="sr-only">Loading campaign…</span>
            <div className="skeleton h-96" />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className="skeleton h-32" />
              ))}
            </div>
            <div className="skeleton h-80" />
          </div>
        ) : (
          <>
            <ProjectHero campaign={data.campaign} />
            <ProjectStats campaign={data.campaign} />
            <div className="campaign-grid">
              <div className="campaign-main">
                <MilestoneList milestones={data.campaign.milestones} />
                <FundFlow />
              </div>
              <aside
                className="campaign-sidebar"
                aria-label="Support and voting"
              >
                <SupportProject
                  campaign={data.campaign}
                  wallet={data.wallet}
                  pending={pending}
                  supporting={
                    operation.status === "pending" &&
                    operation.kind === "support"
                  }
                  onSupport={onSupport}
                  onConnect={() => void connect()}
                />
                <VotingCard
                  campaign={data.campaign}
                  wallet={data.wallet}
                  pending={pending}
                  voting={
                    operation.status === "pending" && operation.kind === "vote"
                  }
                  onVote={onVote}
                  onConnect={() => void connect()}
                />
              </aside>
            </div>
            <TransactionHistory
              transactions={
                history === "empty" ? [] : data.campaign.transactions
              }
              loading={history === "loading"}
              preview={history !== "normal"}
            />
            <div className="closing-note">
              <span className="closing-heart">
                <Heart size={20} aria-hidden="true" />
              </span>
              <div>
                <h2>The next big thing starts with us.</h2>
                <p>Back the builders. Be part of the progress.</p>
              </div>
              <a href="#project">
                Back to the project
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
          </>
        )}
      </main>
      <footer className="page-shell site-footer">
        <a href="#project" aria-label="OpenFunds home">
          <Brand />
        </a>
        <p>Good ideas deserve a fair start.</p>
        <span>OpenFunds MVP · Demo only</span>
      </footer>
      <OperationNotice
        operation={operation}
        onCancel={cancel}
        onDismiss={dismiss}
      />
    </>
  );
}

export function CampaignPage() {
  const [scenario, setScenario] = useState<Scenario>("voting");
  const [revision, setRevision] = useState(0);
  return (
    <CampaignExperience
      key={`${scenario}-${revision}`}
      scenario={scenario}
      onScenario={setScenario}
      onReset={() => setRevision((value) => value + 1)}
    />
  );
}
