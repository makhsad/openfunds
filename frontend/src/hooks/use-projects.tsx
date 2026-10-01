"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createDemoProjectRepository } from "@/services/project-repository";
import type { CampaignRepository, DemoIdentityId } from "@/types/project";
import type { DemoOutcome } from "@/types/crowdfunding";

function useProjectStore() {
  const [repository, setRepository] = useState<CampaignRepository | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<DemoOutcome>("success");
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    try {
      // Hydrate the external browser repository only after server hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRepository(createDemoProjectRepository(window.localStorage));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Browser storage is unavailable.",
      );
    }
    return () => operation.current?.abort();
  }, []);
  const state = useSyncExternalStore(
    repository?.subscribe ?? (() => () => {}),
    repository?.getSnapshot ?? (() => null),
    () => null,
  );
  async function run(action: () => unknown, success: string) {
    if (!repository || operation.current) return false;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError(null);
    setNotice(null);
    const selectedOutcome = outcome;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 450);
        controller.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("Demo operation cancelled. Nothing changed."));
          },
          { once: true },
        );
      });
      if (controller.signal.aborted || selectedOutcome === "cancel")
        throw new Error("Demo operation cancelled. Nothing changed.");
      if (selectedOutcome === "error")
        throw new Error(
          "Demo operation failed. Nothing changed. Select Success and try again.",
        );
      action();
      setNotice(success);
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to complete this operation.",
      );
      return false;
    } finally {
      operation.current = null;
      setPending(false);
    }
  }
  function setIdentity(id: DemoIdentityId) {
    if (!repository || operation.current) return;
    try {
      repository.setIdentity(id);
      setError(null);
      setNotice(null);
    } catch (cause) {
      setError(String(cause));
    }
  }
  function resetDemo() {
    if (!repository || operation.current) return;
    try {
      repository.reset();
      setNotice("Demo data reset to the original sample projects.");
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }
  return {
    state,
    repository,
    pending,
    error,
    notice,
    outcome,
    setOutcome,
    run,
    cancel: () => operation.current?.abort(),
    setIdentity,
    resetDemo,
  };
}

const ProjectContext = createContext<ReturnType<typeof useProjectStore> | null>(
  null,
);
export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const value = useProjectStore();
  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}
export function useProjects() {
  const value = useContext(ProjectContext);
  if (!value) throw new Error("ProjectProvider is required.");
  return value;
}
