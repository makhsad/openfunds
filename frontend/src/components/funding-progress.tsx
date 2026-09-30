import { Check } from "lucide-react";
import { formatSol, percentOf } from "@/lib/amounts";
import type { Campaign } from "@/types/crowdfunding";

export function FundingProgress({ campaign }: { campaign: Campaign }) {
  const percent = percentOf(campaign.raised, campaign.goal);
  return (
    <div className="funding-progress">
      <div className="flex items-baseline justify-between gap-3">
        <p>
          <strong>{formatSol(campaign.raised)} SOL</strong>
          <span> raised of {formatSol(campaign.goal)} SOL</span>
        </p>
        <strong className="text-teal">{percent}%</strong>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label="Funding progress"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div style={{ width: `${percent}%` }} />
      </div>
      <p className="funding-caption">
        {percent === 100 ? (
          <>
            <Check size={14} aria-hidden="true" />
            Fully funded. Now, let’s make it happen.
          </>
        ) : (
          "Every contribution brings this idea a little closer."
        )}
      </p>
    </div>
  );
}
