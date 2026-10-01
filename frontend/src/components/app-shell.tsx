"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, CircleHelp, FlaskConical, X } from "lucide-react";
import { Brand } from "@/components/ui";
import { useProjects } from "@/hooks/use-projects";
import { DEMO_IDENTITIES } from "@/types/project";
import type { DemoIdentityId } from "@/types/project";
import type { DemoOutcome } from "@/types/crowdfunding";

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const {
    state,
    pending,
    error,
    notice,
    outcome,
    setOutcome,
    cancel,
    setIdentity,
    resetDemo,
  } = useProjects();
  if (path === "/demo") return children;
  return (
    <div className="of-app">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="of-demo-banner" role="region" aria-label="Demo mode">
        <span className="of-container">
          <FlaskConical size={14} aria-hidden="true" />
          <strong>Demo workspace</strong>
          <span>
            Explore the experience. Balances, votes and releases are simulated.
          </span>
        </span>
      </div>
      <header className="of-header">
        <div className="of-container of-navbar">
          <Link className="of-brand-link" href="/" aria-label="OpenFunds home">
            <Brand />
          </Link>
          <nav aria-label="Main navigation">
            {[
              ["/projects", "Explore Projects"],
              ["/create", "Create Project"],
              ["/dashboard", "Dashboard"],
              ["/#how-it-works", "How It Works"],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                aria-current={path === href ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="of-identity">
            <span className="of-avatar">
              {state?.identityId === "creator"
                ? "CR"
                : state?.identityId === "backer-a"
                  ? "BA"
                  : state?.identityId === "backer-b"
                    ? "BB"
                    : "V"}
            </span>
            <label>
              <span>DEMO IDENTITY</span>
              <select
                aria-label="Demo identity"
                disabled={!state || pending}
                value={state?.identityId ?? "visitor"}
                onChange={(event) =>
                  setIdentity(event.target.value as DemoIdentityId)
                }
              >
                {DEMO_IDENTITIES.map((identity) => (
                  <option key={identity.id} value={identity.id}>
                    {identity.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="of-footer">
        <div className="of-container of-footer-main">
          <div>
            <Link href="/" aria-label="OpenFunds home">
              <Brand />
            </Link>
            <p>Good ideas deserve a fair start.</p>
          </div>
          <nav aria-label="Footer navigation">
            <Link href="/projects">
              Explore projects <ArrowUpRight size={13} />
            </Link>
            <Link href="/create">Start a project</Link>
            <Link href="/demo">Original demo lab</Link>
          </nav>
          <div className="of-footer-note">
            <strong>Built for a more accountable future.</strong>
            <p>
              Local demo · No real SOL moves.
              <br />
              Wallet and on-chain actions are not connected.
            </p>
          </div>
        </div>
        <div className="of-container of-footer-bottom">
          <span>OpenFunds · Hackathon preview</span>
          <details className="of-demo-settings">
            <summary>
              <CircleHelp size={14} /> Demo controls
            </summary>
            <div>
              <label>
                Next operation
                <select
                  aria-label="Next demo operation"
                  value={outcome}
                  disabled={pending}
                  onChange={(event) =>
                    setOutcome(event.target.value as DemoOutcome)
                  }
                >
                  <option value="success">Success</option>
                  <option value="error">Fail</option>
                  <option value="cancel">Cancel</option>
                </select>
              </label>
              <button
                type="button"
                className="of-button secondary"
                disabled={pending}
                onClick={resetDemo}
              >
                Reset Demo Data
              </button>
              <p>Reset removes projects and changes saved in this browser.</p>
            </div>
          </details>
        </div>
      </footer>
      {(pending || error || notice) && (
        <div
          className={`of-notification ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          <span>
            {pending ? "Processing your demo operation…" : (error ?? notice)}
          </span>
          {pending && (
            <button
              type="button"
              aria-label="Cancel demo operation"
              onClick={cancel}
            >
              <X size={15} /> Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
