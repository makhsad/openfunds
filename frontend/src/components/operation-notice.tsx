import { AlertCircle, CheckCircle2, CircleSlash, X } from "lucide-react";
import { Spinner } from "@/components/ui";
import type { OperationState } from "@/types/crowdfunding";

export function OperationNotice({
  operation,
  onCancel,
  onDismiss,
}: {
  operation: OperationState;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  if (operation.status === "idle") return null;
  const Icon =
    operation.status === "success"
      ? CheckCircle2
      : operation.status === "error"
        ? AlertCircle
        : CircleSlash;
  return (
    <div
      className={`operation-notice operation-${operation.status}`}
      role={operation.status === "error" ? "alert" : "status"}
      aria-live={operation.status === "error" ? "assertive" : "polite"}
    >
      {operation.status === "pending" ? (
        <Spinner />
      ) : (
        <Icon size={19} aria-hidden="true" />
      )}
      <p>{operation.message}</p>
      {operation.status === "pending" ? (
        <button className="text-button" onClick={onCancel}>
          Cancel
        </button>
      ) : (
        <button
          className="icon-button"
          onClick={onDismiss}
          aria-label="Dismiss message"
        >
          <X size={17} />
        </button>
      )}
    </div>
  );
}
