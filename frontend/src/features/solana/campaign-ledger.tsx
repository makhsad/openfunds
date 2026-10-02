"use client";

import { ExternalLink, RefreshCw } from "lucide-react";
import { formatSol } from "@/lib/amounts";
import type { DevnetActivity, DevnetSupport } from "@/lib/solana/devnet-ledger";

function Address({ value }: { value: string }) {
  return (
    <a
      className="ledger-address"
      href={`https://explorer.solana.com/address/${encodeURIComponent(value)}?cluster=devnet`}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span>{value}</span>
      <ExternalLink size={13} aria-hidden="true" />
    </a>
  );
}

export function CampaignLedger({
  creator,
  backers,
  backersError,
  activity,
  activityError,
  loading,
  hasMore,
  onMore,
}: {
  creator: string;
  backers: DevnetSupport[] | null;
  backersError: string | null;
  activity: DevnetActivity[] | null;
  activityError: string | null;
  loading: boolean;
  hasMore: boolean;
  onMore: () => void;
}) {
  return (
    <>
      <section className="ledger-panel" aria-labelledby="backers-heading">
        <h2 id="backers-heading">Campaign backers</h2>
        <p>
          Recorded contributions from every wallet. These amounts come from
          Devnet and are shared across devices.
        </p>
        {backersError ? (
          <p className="ledger-error" role="alert">
            Could not read the campaign backers. {backersError}
          </p>
        ) : backers === null ? (
          <p role="status">Reading recorded contributions…</p>
        ) : backers.length === 0 ? (
          <p>No contributions have been recorded for this campaign.</p>
        ) : (
          <ul className="ledger-backers">
            {backers.map((backer) => (
              <li
                key={backer.contributionAddress}
                aria-label={`Backer ${backer.backerAddress}`}
              >
                <div>
                  <Address value={backer.backerAddress} />
                  <small>
                    {backer.backerAddress === creator
                      ? "Creator's own contribution"
                      : "Sponsor"}
                  </small>
                </div>
                <strong>
                  {formatSol(backer.totalContributedLamports)} SOL
                </strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ledger-panel" aria-labelledby="activity-heading">
        <h2 id="activity-heading">Campaign activity</h2>
        <p>
          Confirmed campaign transactions read from Devnet. Activity remains
          available after reload and on another device. Failed or unreadable
          transactions never count as contributions.
        </p>
        {activityError && (
          <p className="ledger-error" role="alert">
            Could not read campaign activity. {activityError} Existing campaign
            totals are read independently.
          </p>
        )}
        {activity === null ? (
          !activityError && <p role="status">Reading campaign activity…</p>
        ) : activity.length === 0 ? (
          <p>
            No verified campaign activity was found in this page of history.
          </p>
        ) : (
          <ul className="ledger-activity">
            {activity.map((item) => {
              const confirmed =
                item.status === "confirmed" || item.status === "finalized";
              const title =
                item.status === "failed"
                  ? "Failed transaction"
                  : item.status === "unavailable"
                    ? "Transaction details unavailable"
                    : item.kind === "initialize"
                      ? "Campaign created"
                      : "Contribution received";
              return (
                <li key={item.signature}>
                  <div className="ledger-row">
                    <strong>{title}</strong>
                    <span
                      className={`ledger-status ${confirmed ? "confirmed" : ""}`}
                    >
                      {item.status === "finalized"
                        ? "Finalized"
                        : item.status === "confirmed"
                          ? "Confirmed"
                          : item.status === "failed"
                            ? "Failed"
                            : "Unverified"}
                    </span>
                  </div>
                  {item.actorAddress && <Address value={item.actorAddress} />}
                  <dl className="ledger-money">
                    {confirmed &&
                      item.kind === "contribution" &&
                      item.amountLamports !== null && (
                        <div>
                          <dt>Received by campaign vault</dt>
                          <dd>{formatSol(item.amountLamports)} SOL</dd>
                        </div>
                      )}
                    {item.feeLamports !== null && (
                      <div>
                        <dt>Network fee</dt>
                        <dd>{formatSol(item.feeLamports)} SOL</dd>
                      </div>
                    )}
                    {item.storageRentLamports !== null &&
                      BigInt(item.storageRentLamports) > 0n && (
                        <div>
                          <dt>Account storage</dt>
                          <dd>{formatSol(item.storageRentLamports)} SOL</dd>
                        </div>
                      )}
                    {item.walletDebitLamports !== null && (
                      <div>
                        <dt>Wallet debit</dt>
                        <dd>{formatSol(item.walletDebitLamports)} SOL</dd>
                      </div>
                    )}
                  </dl>
                  {confirmed && item.kind === "contribution" && (
                    <p className="ledger-destination">
                      Destination: <Address value={item.vaultAddress} />
                    </p>
                  )}
                  <div className="ledger-row">
                    <small>
                      {item.blockTime === null
                        ? "Time unavailable"
                        : new Date(item.blockTime * 1000).toLocaleString()}
                    </small>
                    <a
                      href={`https://explorer.solana.com/tx/${encodeURIComponent(item.signature)}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View transaction{" "}
                      <ExternalLink size={13} aria-hidden="true" />
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {hasMore && (
          <button
            className="of-button secondary"
            disabled={loading}
            onClick={onMore}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {loading ? "Loading activity…" : "Load older activity"}
          </button>
        )}
        <p className="ledger-footnote">
          History is paginated. Campaign totals and backer amounts come from
          current accounts, rather than the transactions shown in this page.
        </p>
      </section>
      <style jsx>{`
        .ledger-panel {
          margin-top: 22px;
          padding: 26px;
          border: 1px solid var(--of-line);
          border-radius: 16px;
          background: white;
          min-width: 0;
        }
        .ledger-panel h2 {
          font-size: 21px;
          letter-spacing: -0.5px;
        }
        .ledger-panel > p {
          color: var(--of-muted);
          margin: 10px 0 18px;
        }
        .ledger-panel :global(.ledger-address) {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          max-width: 100%;
          overflow-wrap: anywhere;
          font-family: ui-monospace, monospace;
          font-size: 12px;
          color: #075cad;
        }
        .ledger-panel :global(.ledger-address span) {
          min-width: 0;
        }
        .ledger-panel :global(.ledger-address svg) {
          flex: none;
        }
        .ledger-backers,
        .ledger-activity {
          list-style: none;
          padding: 0;
          margin: 16px 0;
        }
        .ledger-backers li {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          border-top: 1px solid var(--of-line);
          padding: 16px 0;
        }
        .ledger-backers li > div {
          min-width: 0;
        }
        .ledger-backers small {
          display: block;
          margin-top: 5px;
          color: var(--of-muted);
        }
        .ledger-backers strong {
          flex: none;
        }
        .ledger-activity li {
          border: 1px solid var(--of-line);
          border-radius: 12px;
          padding: 18px;
          margin-bottom: 12px;
        }
        .ledger-row {
          display: flex;
          gap: 14px;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: center;
          margin: 8px 0;
        }
        .ledger-row > a {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #075cad;
        }
        .ledger-status {
          background: #fff3dc;
          color: #774409;
          border-radius: 20px;
          font-weight: 700;
          font-size: 11px;
          padding: 5px 10px;
        }
        .ledger-status.confirmed {
          background: #dbf7ed;
          color: #006352;
        }
        .ledger-money {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          margin: 18px 0;
        }
        .ledger-money dt {
          color: var(--of-muted);
          font-size: 12px;
        }
        .ledger-money dd {
          margin: 6px 0 0;
          font-weight: 700;
          overflow-wrap: anywhere;
        }
        .ledger-destination {
          font-size: 12px;
          overflow-wrap: anywhere;
        }
        .ledger-error {
          background: #fff3f1;
          color: #8d2e1d !important;
          border: 1px solid #efc0b7;
          border-radius: 10px;
          padding: 14px;
        }
        .ledger-footnote {
          font-size: 12px;
        }
        @media (max-width: 650px) {
          .ledger-panel {
            padding: 18px;
          }
          .ledger-money {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .ledger-backers li {
            flex-wrap: wrap;
          }
        }
      `}</style>
    </>
  );
}
