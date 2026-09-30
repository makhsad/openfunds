import { LogOut, Wallet } from "lucide-react";
import { Brand, Spinner } from "@/components/ui";
import type { DemoWallet } from "@/types/crowdfunding";

export function Navbar({
  wallet,
  pending,
  connecting,
  loading,
  onConnect,
  onDisconnect,
}: {
  wallet: DemoWallet | null;
  pending: boolean;
  connecting: boolean;
  loading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <header className="site-header">
      <div className="page-shell navbar">
        <a href="#project" aria-label="OpenFunds home">
          <Brand />
        </a>
        <nav aria-label="Main navigation">
          <a href="#project">Project</a>
          <a href="#how-it-works">How It Works</a>
          <a href="#milestones">Milestones</a>
        </nav>
        <div className="wallet-actions">
          {wallet ? (
            <>
              <span className="wallet-connected">
                <span className="status-dot" />
                Demo wallet
              </span>
              <button
                className="icon-button"
                onClick={onDisconnect}
                disabled={pending}
                aria-label="Disconnect demo wallet"
                title="Disconnect demo wallet"
              >
                <LogOut size={17} />
              </button>
            </>
          ) : (
            <button
              className="button button-primary wallet-button"
              disabled={pending || loading}
              onClick={onConnect}
            >
              {connecting ? (
                <Spinner />
              ) : (
                <Wallet size={17} aria-hidden="true" />
              )}
              {connecting ? "Connecting…" : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
