import {
  Check,
  CircleHelp,
  LoaderCircle,
  LockKeyhole,
  Vote,
} from "lucide-react";
import type { MilestoneStatus } from "@/types/crowdfunding";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <svg
        width="33"
        height="36"
        viewBox="0 0 33 36"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M3 11 16.5 3 30 11v14l-13.5 8L3 25V11Z"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path
          d="m3 11 13.5 8L30 11M16.5 19v14"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path d="m10 15 13.5-8" stroke="#20b7aa" strokeWidth="4" />
      </svg>
      {!compact && (
        <span>
          Open<span className="text-brand">Funds</span>
          <span className="brand-period">.</span>
        </span>
      )}
    </span>
  );
}

export function StatusBadge({ status }: { status: MilestoneStatus }) {
  const Icon =
    status === "released" ? Check : status === "voting" ? Vote : LockKeyhole;
  return (
    <span className={`badge badge-${status}`}>
      <Icon size={12} aria-hidden="true" />
      {status === "voting"
        ? "In voting"
        : status[0].toUpperCase() + status.slice(1)}
    </span>
  );
}

export function Spinner() {
  return <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />;
}

export function SectionHeading({
  eyebrow,
  title,
  titleId,
  children,
}: {
  eyebrow?: string;
  title: string;
  titleId?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 id={titleId}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

export function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="info-note">
      <CircleHelp size={15} className="shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
