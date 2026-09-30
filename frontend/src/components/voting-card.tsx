import { Check, CheckCircle2, ThumbsDown, ThumbsUp, Vote } from "lucide-react";
import { formatSol, percentOf, voteResults } from "@/lib/amounts";
import { InfoNote, Spinner } from "@/components/ui";
import type { Campaign, DemoWallet, VoteChoice } from "@/types/crowdfunding";

export function VotingCard({
  campaign,
  wallet,
  pending,
  voting,
  onVote,
  onConnect,
}: {
  campaign: Campaign;
  wallet: DemoWallet | null;
  pending: boolean;
  voting: boolean;
  onVote: (choice: VoteChoice) => Promise<boolean>;
  onConnect: () => void;
}) {
  const vote = campaign.voting;
  if (!vote)
    return (
      <section id="voting" className="card voting-card">
        <div className="card-heading">
          <span className="icon-tile">
            <Vote size={20} aria-hidden="true" />
          </span>
          <h2>Every backer has a voice</h2>
        </div>
        <p className="muted mt-4 text-sm leading-6">
          Voting opens after the funding snapshot is fixed. Switch to the Voting
          scenario to review the MVP milestone.
        </p>
      </section>
    );
  const results = voteResults(vote);
  const milestone = campaign.milestones.find(
    (item) => item.id === vote.milestoneId,
  );
  const segments = [
    { label: "Approve", value: results.approve, className: "approve" },
    { label: "Reject", value: results.reject, className: "reject" },
    { label: "Not voted", value: results.notVoted, className: "not-voted" },
  ];
  return (
    <section
      id="voting"
      className="card voting-card"
      aria-labelledby="vote-title"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">YOUR VOICE MATTERS</span>
        <span className="live-label">
          <span className="status-dot" />
          Live vote
        </span>
      </div>
      <h2 id="vote-title">Let’s build the {milestone?.title}.</h2>
      <p className="voting-intro">
        Should the next{" "}
        <strong>{formatSol(milestone?.amount ?? "0")} SOL</strong> be released
        to the creator?
      </p>
      <div className="threshold-label">
        <span>Approval threshold</span>
        <strong>{vote.thresholdPercent}%</strong>
      </div>
      <div className="vote-bar-wrap">
        <div className="vote-bar" aria-hidden="true">
          {segments.map((segment) => (
            <div
              key={segment.label}
              className={segment.className}
              style={{ width: `${segment.value}%` }}
            />
          ))}
        </div>
        <span
          className="threshold-marker"
          style={{ left: `${vote.thresholdPercent}%` }}
          aria-hidden="true"
        />
      </div>
      <dl className="vote-results">
        {segments.map((segment) => (
          <div key={segment.label}>
            <dt>
              <i className={segment.className} />
              {segment.label}
            </dt>
            <dd>{segment.value}%</dd>
          </div>
        ))}
      </dl>
      <p className="snapshot-note">
        Based on all {formatSol(vote.totalWeight)} SOL in the fixed contribution
        snapshot, including uncast votes.
      </p>
      {results.thresholdReached && (
        <p className="vote-success" role="status">
          <CheckCircle2 size={17} aria-hidden="true" />
          <span>
            Approval threshold reached. Funds stay locked in this demo; release
            is a separate operation.
          </span>
        </p>
      )}
      {vote.userVote ? (
        <p className="voted-note">
          <Check size={17} aria-hidden="true" />
          You voted {vote.userVote}. Your vote is recorded.
        </p>
      ) : (
        <>
          {wallet && (
            <p className="voting-weight">
              Your voting weight{" "}
              <strong>
                {percentOf(vote.userWeight, vote.totalWeight)}% ·{" "}
                {formatSol(vote.userWeight)} SOL
              </strong>
            </p>
          )}
          {wallet ? (
            <div className="vote-actions">
              <button
                className="button button-approve"
                disabled={pending || vote.userWeight === "0"}
                onClick={() => void onVote("approve")}
              >
                {voting ? (
                  <Spinner />
                ) : (
                  <ThumbsUp size={16} aria-hidden="true" />
                )}
                Approve
              </button>
              <button
                className="button button-reject"
                disabled={pending || vote.userWeight === "0"}
                onClick={() => void onVote("reject")}
              >
                <ThumbsDown size={16} aria-hidden="true" />
                Reject
              </button>
            </div>
          ) : (
            <>
              <div className="vote-actions">
                <button className="button button-approve" disabled>
                  <ThumbsUp size={16} aria-hidden="true" />
                  Approve
                </button>
                <button className="button button-reject" disabled>
                  <ThumbsDown size={16} aria-hidden="true" />
                  Reject
                </button>
              </div>
              <button
                className="text-button connect-vote"
                disabled={pending}
                onClick={onConnect}
              >
                Connect demo wallet to vote <span aria-hidden="true">→</span>
              </button>
            </>
          )}
        </>
      )}
      <InfoNote>
        One vote per backer, weighted by their contribution at the snapshot.
      </InfoNote>
    </section>
  );
}
