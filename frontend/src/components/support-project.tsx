"use client";

import { useState } from "react";
import { ArrowUpRight, Heart, LockKeyhole, ShieldCheck } from "lucide-react";
import { asLamports, formatSol, parseSol } from "@/lib/amounts";
import { FundingProgress } from "@/components/funding-progress";
import { Spinner } from "@/components/ui";
import type { Campaign, DemoWallet, Lamports } from "@/types/crowdfunding";

interface SupportProjectProps {
  campaign: Campaign;
  wallet: DemoWallet | null;
  pending: boolean;
  supporting: boolean;
  onSupport: (amount: Lamports) => Promise<boolean>;
  onConnect: () => void;
}

export function SupportProject({
  campaign,
  wallet,
  pending,
  supporting,
  onSupport,
  onConnect,
}: SupportProjectProps) {
  const [amount, setAmount] = useState("0.01");
  const [error, setError] = useState("");
  const closed =
    campaign.phase === "voting" ||
    asLamports(campaign.raised) >= asLamports(campaign.goal);
  const remaining = (
    asLamports(campaign.goal) - asLamports(campaign.raised)
  ).toString();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || closed) return;
    if (!wallet) {
      onConnect();
      return;
    }
    try {
      const lamports = parseSol(amount);
      if (asLamports(lamports) > asLamports(wallet.balance))
        throw new Error("This amount exceeds your demo wallet balance.");
      if (asLamports(lamports) > asLamports(remaining))
        throw new Error(
          `You can contribute up to ${formatSol(remaining)} SOL to complete the goal.`,
        );
      setError("");
      if (await onSupport(lamports)) setAmount("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Enter a valid SOL amount.",
      );
    }
  }
  return (
    <section className="card support-card" aria-labelledby="support-title">
      <div className="card-heading">
        <span className="icon-tile">
          <Heart size={20} aria-hidden="true" />
        </span>
        <div>
          <h2 id="support-title">Back a brighter future</h2>
          <p>Small contributions. Real possibilities.</p>
        </div>
      </div>
      <FundingProgress campaign={campaign} />
      {closed && (
        <div className="closed-notice">
          <LockKeyhole size={17} aria-hidden="true" />
          <div>
            <strong>
              {campaign.phase === "voting"
                ? "Contributions are paused"
                : "Funding goal reached"}
            </strong>
            <p>
              {campaign.phase === "voting"
                ? "Backers are reviewing the next milestone. Your voice is the next step."
                : "This demo is fully funded. Reset the scenario to try again."}
            </p>
          </div>
        </div>
      )}
      <form onSubmit={submit} noValidate>
        <label htmlFor="support-amount">Your contribution</label>
        <div className={`amount-input ${error ? "invalid" : ""}`}>
          <input
            id="support-amount"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setError("");
            }}
            disabled={closed || pending}
            aria-invalid={Boolean(error)}
            aria-describedby={
              error ? "amount-error amount-help" : "amount-help"
            }
          />
          <span>SOL</span>
        </div>
        <div
          className="quick-amounts"
          aria-label="Suggested contribution amounts"
        >
          {["0.01", "0.05", "0.1"].map((value) => (
            <button
              key={value}
              type="button"
              disabled={closed || pending}
              aria-pressed={amount === value}
              onClick={() => {
                setAmount(value);
                setError("");
              }}
            >
              {value} SOL
            </button>
          ))}
        </div>
        <p id="amount-help" className="field-help">
          {wallet
            ? `Demo balance: ${formatSol(wallet.balance)} SOL`
            : "Connect a demo wallet to get started."}
          {!closed && <span>Up to {formatSol(remaining)} SOL remaining</span>}
        </p>
        {error && (
          <p id="amount-error" className="field-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button button-primary support-button"
          type="submit"
          disabled={closed || pending}
        >
          {supporting ? (
            <Spinner />
          ) : closed ? (
            <LockKeyhole size={16} aria-hidden="true" />
          ) : (
            <Heart size={16} aria-hidden="true" />
          )}
          {supporting
            ? "Confirming…"
            : closed
              ? "Funding closed"
              : wallet
                ? "Support Project"
                : "Connect to support"}
          {!closed && !supporting && (
            <ArrowUpRight size={17} className="ml-auto" aria-hidden="true" />
          )}
        </button>
      </form>
      <p className="support-footnote">
        <ShieldCheck size={14} aria-hidden="true" />
        Funds follow approved progress.
      </p>
    </section>
  );
}
