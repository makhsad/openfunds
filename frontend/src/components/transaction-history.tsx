import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock3,
  Inbox,
  Vote,
} from "lucide-react";
import { SectionHeading } from "@/components/ui";
import { formatSol } from "@/lib/amounts";
import type { Transaction } from "@/types/crowdfunding";

export function TransactionHistory({
  transactions,
  loading = false,
  preview = false,
}: {
  transactions: Transaction[];
  loading?: boolean;
  preview?: boolean;
}) {
  return (
    <section className="history-section" aria-labelledby="history-title">
      <SectionHeading
        eyebrow="EVERY STEP, IN THE OPEN"
        title="A little transparency goes a long way."
        titleId="history-title"
      >
        <span className="history-demo-label">
          <Clock3 size={14} aria-hidden="true" />
          Demo activity
        </span>
      </SectionHeading>
      <p className="section-description">
        Transaction history · A shared record of contributions, votes, and
        progress.
      </p>
      {preview && (
        <p className="preview-note">
          History preview only. Campaign balances and records are unchanged.
        </p>
      )}
      <div className="history-card" aria-busy={loading}>
        {loading ? (
          <div className="history-loading" role="status">
            <span className="sr-only">Loading transaction history…</span>
            {[1, 2, 3].map((row) => (
              <div key={row} className="skeleton h-12" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="empty-history">
            <Inbox size={30} aria-hidden="true" />
            <h3>No activity yet</h3>
            <p>Contributions and milestone votes will appear here.</p>
          </div>
        ) : (
          <div
            className="table-scroll"
            role="region"
            aria-label="Demo transaction history"
            tabIndex={0}
          >
            <table>
              <caption className="sr-only">
                Simulated operations. All times in UTC. These are not blockchain
                transactions.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Transaction</th>
                  <th scope="col">Amount</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => {
                  const Icon =
                    transaction.type === "contribution"
                      ? ArrowDownLeft
                      : transaction.type === "release"
                        ? ArrowUpRight
                        : Vote;
                  return (
                    <tr key={transaction.id}>
                      <td>
                        <div className="transaction-type">
                          <span
                            className={`transaction-icon transaction-${transaction.type}`}
                          >
                            <Icon size={17} aria-hidden="true" />
                          </span>
                          <div>
                            <strong>
                              {transaction.type === "contribution"
                                ? "Contribution"
                                : transaction.type === "release"
                                  ? "Milestone release"
                                  : `${transaction.voteChoice === "approve" ? "Approve" : "Reject"} vote`}
                            </strong>
                            <time dateTime={transaction.createdAt}>
                              {new Intl.DateTimeFormat("en-GB", {
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                                timeZone: "UTC",
                              }).format(new Date(transaction.createdAt))}{" "}
                              UTC
                            </time>
                          </div>
                        </div>
                      </td>
                      <td className="transaction-amount">
                        {transaction.amount === null ? (
                          <span aria-label="No funds transferred">—</span>
                        ) : (
                          <>
                            {formatSol(transaction.amount)} <span>SOL</span>
                          </>
                        )}
                      </td>
                      <td>{transaction.sender}</td>
                      <td>{transaction.recipient}</td>
                      <td>
                        <span
                          className="confirmed-badge"
                          aria-label="Confirmed (simulated)"
                        >
                          <Check size={12} aria-hidden="true" />
                          Confirmed
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="history-note">
        Demo records only. No on-chain transactions or Explorer links.
      </p>
    </section>
  );
}
