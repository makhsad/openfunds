import { FlaskConical, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { DemoOutcome, Scenario } from "@/types/crowdfunding";
import { discussionRoleLabels } from "@/lib/discussion";
import type { DiscussionRole } from "@/types/discussion";

export type HistoryPreview = "normal" | "empty" | "loading";

export function DemoControls({
  scenario,
  outcome,
  history,
  disabled,
  discussion,
  onScenario,
  onOutcome,
  onHistory,
  onReset,
}: {
  scenario: Scenario;
  outcome: DemoOutcome;
  history: HistoryPreview;
  disabled: boolean;
  discussion: {
    role: DiscussionRole;
    contextIndex: number;
    contexts: readonly { label: string }[];
    canPost: boolean;
    isSubmitting: boolean;
    onRole: (role: DiscussionRole) => void;
    onContext: (index: number) => void;
    onCanPost: (allowed: boolean) => void;
  };
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
              disabled={disabled || discussion.isSubmitting}
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
        <fieldset className="discussion-demo-settings">
          <legend>Discussion simulation</legend>
          <div className="demo-settings">
            <label>
              Discussion role
              <select
                value={discussion.role}
                disabled={disabled || discussion.isSubmitting}
                onChange={(event) =>
                  discussion.onRole(event.target.value as DiscussionRole)
                }
              >
                {Object.entries(discussionRoleLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Discussion context
              <select
                value={discussion.contextIndex}
                disabled={disabled}
                onChange={(event) =>
                  discussion.onContext(Number(event.target.value))
                }
              >
                {discussion.contexts.map(({ label }, index) => (
                  <option key={index} value={index}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="demo-posting-toggle">
              <input
                type="checkbox"
                checked={discussion.canPost}
                disabled={disabled || discussion.isSubmitting}
                onChange={(event) => discussion.onCanPost(event.target.checked)}
              />
              Allow discussion posting
            </label>
          </div>
          <p className="discussion-demo-note">
            Roles are simulated and independent of the wallet. Added messages
            disappear after a page reload. Switching discussion contexts clears
            the draft; each thread keeps its own posts until reset or reload.
          </p>
        </fieldset>
      </details>
    </aside>
  );
}
