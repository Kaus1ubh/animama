import type { PyMemoryManagerRun } from "@/lib/content/catalogTypes";

type MemoryManagerRunStatus = PyMemoryManagerRun["status"] | null | undefined;

export type EpisodeProcessingPresentation = {
  state: "processing" | "waiting_approval" | "processed" | "failed";
  title: string;
  description: string;
};

export type MemoryManagerRunCapabilities = {
  closed: boolean;
  canStartNew: boolean;
  completeBeforeStartNew: boolean;
};

export function isClosedMemoryManagerRun(status: MemoryManagerRunStatus) {
  return status === "completed" || status === "failed";
}

/** Only unresolved approvals survive a fresh Memory workspace session. */
export function isRecoverableMemoryManagerRun(status: MemoryManagerRunStatus) {
  return status === "waiting_approval";
}

/** Keeps runs created in this mount, but filters historical initial run IDs. */
export function resolveMemoryManagerSessionRunId({
  runId,
  initialRunId,
  status,
  isSessionOwned,
}: {
  runId: string | null | undefined;
  initialRunId: string | null | undefined;
  status: MemoryManagerRunStatus;
  isSessionOwned: boolean;
}) {
  if (!runId) return null;
  if (runId !== initialRunId || isSessionOwned) return runId;
  return isRecoverableMemoryManagerRun(status) ? runId : null;
}

/** Derives lifecycle controls from persisted state and current request locks. */
export function memoryManagerRunCapabilities({
  runId,
  status,
  isBusy,
  hasPendingApproval,
}: {
  runId: string | null | undefined;
  status: MemoryManagerRunStatus;
  isBusy: boolean;
  hasPendingApproval: boolean;
}): MemoryManagerRunCapabilities {
  const persisted = Boolean(runId);
  const closed = isClosedMemoryManagerRun(status);
  const locked = isBusy || hasPendingApproval;
  return {
    closed,
    canStartNew: !locked,
    completeBeforeStartNew: persisted && !closed,
  };
}

/** Keeps the composer locked until a specialized fixed batch is finalized. */
export function isEpisodeProcessingComposerLocked(
  run: PyMemoryManagerRun | null | undefined,
) {
  return (
    run?.kind === "episode_processing" && run.task?.status === "processing"
  );
}

/** Builds safe processing copy from the public task summary only. */
export function episodeProcessingPresentation(
  run: PyMemoryManagerRun | null | undefined,
): EpisodeProcessingPresentation | null {
  if (run?.kind !== "episode_processing" || !run.task) return null;
  const count = run.task.batch_size;
  const noun = count === 1 ? "episode" : "episodes";
  if (run.task.status === "processed") {
    return {
      state: "processed",
      title: `Reviewed ${count} ${noun}`,
      description: run.task.has_more
        ? "This batch is complete. More pending episodes are ready for another batch, and this conversation is now in general Memory Manager mode."
        : "This batch is complete. You can continue with general Memory Manager questions in this conversation.",
    };
  }
  if (run.status === "failed") {
    return {
      state: "failed",
      title: `Episode review stopped for ${count} ${noun}`,
      description:
        "The fixed batch remains pending. Start another processing run when you are ready to retry.",
    };
  }
  if (run.status === "waiting_approval") {
    return {
      state: "waiting_approval",
      title: `Reviewing ${count} ${noun}`,
      description:
        "Review the proposed memory change below. The batch remains pending until the manager reaches its final response.",
    };
  }
  return {
    state: "processing",
    title: `Reviewing ${count} ${noun}`,
    description:
      "The Memory Manager is reviewing this fixed batch. Episode status changes only after terminal completion.",
  };
}

/** Specialized creation may supersede active runs but never a pending approval. */
export function canProcessPendingEpisodes({
  isBusy,
  isLoading,
  isError,
  hasPendingApproval,
}: {
  isBusy: boolean;
  isLoading: boolean;
  isError: boolean;
  hasPendingApproval: boolean;
}) {
  return !isBusy && !isLoading && !isError && !hasPendingApproval;
}

/** Clears a run only after any required completion succeeds. */
export async function startNewMemoryManagerConversation({
  runId,
  completeBeforeStartNew,
  complete,
  clear,
}: {
  runId: string | null | undefined;
  completeBeforeStartNew: boolean;
  complete: (runId: string) => Promise<unknown>;
  clear: () => void;
}) {
  if (!runId) return;
  if (completeBeforeStartNew) await complete(runId);
  clear();
}
