import { FlaskConical, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { DemoOutcome, Scenario } from "@/types/crowdfunding";

export type HistoryPreview = "normal" | "empty" | "loading";

export function DemoControls({
  scenario,
  outcome,
  history,
  disabled,
  onScenario,
  onOutcome,
  onHistory,
  onReset,
}: {
  scenario: Scenario;
  outcome: DemoOutcome;
  history: HistoryPreview;
  disabled: boolean;
  onScenario: (value: Scenario) => void;
  onOutcome: (value: DemoOutcome) => void;
  onHistory: (value: HistoryPreview) => void;
  onReset: () => void;
}) {
  return (
    <aside className="demo-banner" aria-label="Demo mode controls">
      <div className="demo-summary">
        <div className="demo-description">
          <span className="demo-tag">
            <FlaskConical size={13} aria-hidden="true" />
            Demo mode
          </span>
          <p>
            A real idea. A simulated experience.
            <span> Wallet, balance, and operations are mocked.</span>
          </p>
        </div>
        <div className="scenario-toggle" aria-label="Demo scenario">
          <button
            aria-pressed={scenario === "voting"}
            disabled={disabled}
            onClick={() => onScenario("voting")}
          >
            Voting
          </button>
          <button
            aria-pressed={scenario === "funding"}
            disabled={disabled}
            onClick={() => onScenario("funding")}
          >
            Funding
          </button>
        </div>
      </div>
      <details className="demo-details">
        <summary>
          <SlidersHorizontal size={13} aria-hidden="true" />
          Demo controls
        </summary>
        <div className="demo-settings">
          <label>
            Operation outcome
            <select
              value={outcome}
              disabled={disabled}
              onChange={(event) => onOutcome(event.target.value as DemoOutcome)}
            >
              <option value="success">Success</option>
              <option value="error">Error</option>
              <option value="cancel">Cancellation</option>
            </select>
          </label>
          <label>
            History preview
            <select
              value={history}
              disabled={disabled}
              onChange={(event) =>
                onHistory(event.target.value as HistoryPreview)
              }
            >
              <option value="normal">Populated</option>
              <option value="empty">Empty</option>
              <option value="loading">Loading</option>
            </select>
          </label>
          <button
            className="button button-secondary"
            disabled={disabled}
            onClick={onReset}
          >
            <RotateCcw size={14} aria-hidden="true" />
            Reset demo
          </button>
          <p>
            Switching scenarios or resetting starts fresh and replays loading.
            Demo changes last until refresh.
          </p>
        </div>
      </details>
    </aside>
  );
}
