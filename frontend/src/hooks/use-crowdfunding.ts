"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createMockClient,
  OperationCancelledError,
} from "@/services/mock-client";
import { formatSol } from "@/lib/amounts";
import type {
  CrowdfundingSnapshot,
  DemoOutcome,
  Lamports,
  OperationKind,
  OperationState,
  Scenario,
  VoteChoice,
} from "@/types/crowdfunding";

export function useCrowdfunding(scenario: Scenario) {
  const [client] = useState(() => createMockClient(scenario));
  const [data, setData] = useState<CrowdfundingSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operation, setOperation] = useState<OperationState>({
    status: "idle",
  });
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const loading = new AbortController();
    client
      .getSnapshot(loading.signal)
      .then(setData)
      .catch((error: unknown) => {
        if (!loading.signal.aborted)
          setLoadError(
            error instanceof Error ? error.message : "Unable to load the demo.",
          );
      });
    return () => {
      mounted.current = false;
      loading.abort();
      controller.current?.abort();
    };
  }, [client]);

  const run = useCallback(
    async (
      kind: OperationKind,
      action: (signal: AbortSignal) => Promise<CrowdfundingSnapshot>,
      success: string,
    ) => {
      if (controller.current || !data) return false;
      const pending = new AbortController();
      controller.current = pending;
      const messages = {
        connect: "Connecting your demo wallet…",
        support: "Confirming your simulated contribution…",
        vote: "Recording your simulated vote…",
      };
      setOperation({ status: "pending", kind, message: messages[kind] });
      try {
        const next = await action(pending.signal);
        if (!mounted.current) return false;
        setData(next);
        setOperation({ status: "success", message: success });
        return true;
      } catch (error) {
        if (mounted.current)
          setOperation({
            status:
              error instanceof OperationCancelledError ? "cancelled" : "error",
            message:
              error instanceof Error
                ? error.message
                : "Something went wrong. Please try again.",
          });
        return false;
      } finally {
        controller.current = null;
      }
    },
    [data],
  );

  return {
    data,
    loadError,
    operation,
    pending: operation.status === "pending",
    connect: () =>
      run(
        "connect",
        (signal) => client.connectWallet(signal),
        "Demo wallet connected. The balance is simulated.",
      ),
    disconnect: () => {
      if (!controller.current) {
        setData(client.disconnectWallet());
        setOperation({ status: "idle" });
      }
    },
    onSupport: (amount: Lamports) =>
      run(
        "support",
        (signal) => client.support(amount, signal),
        `${formatSol(amount)} SOL added to the demo vault. Thank you for backing this idea!`,
      ),
    onVote: (choice: VoteChoice) =>
      run(
        "vote",
        (signal) => client.vote(choice, signal),
        `Your ${choice} vote is recorded in this demo. No real transaction was sent.`,
      ),
    setOutcome: (outcome: DemoOutcome) => client.setOutcome(outcome),
    cancel: () => controller.current?.abort(),
    dismiss: () => setOperation({ status: "idle" }),
  };
}
