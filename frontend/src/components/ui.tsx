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
    <span className={`brand official-brand${compact ? " compact" : ""}`}>
      {/* The supplied original asset is used unchanged, including its wordmark. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/openfunds-logo.png"
        alt="OpenFunds"
        width={124}
        height={88}
      />
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
