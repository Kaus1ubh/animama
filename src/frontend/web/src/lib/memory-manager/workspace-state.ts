import type { PyMemoryManagerRun } from "@/lib/content/catalogTypes";

type MemoryManagerRunStatus = PyMemoryManagerRun["status"] | null | undefined;

/** Status banner for a specialized run (episode processing or Reflection). */
export type MemoryManagerRunPresentation = {
  state:
    | "processing"
    | "active"
    | "waiting_approval"
    | "processed"
    | "completed"
    | "failed";
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
): MemoryManagerRunPresentation | null {
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

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Builds Reflection copy from the public summary only. The composer stays
 * available, so follow-ups refine the proposal like any other conversation.
 * `hasAppliedChange` reports an approved, not undone, change in this run:
 * approval commits the file and the turns' coverage before the manager
 * resumes, so a later stop leaves that change in place.
 */
export function reflectionPresentation(
  run: PyMemoryManagerRun | null | undefined,
  { hasAppliedChange = false }: { hasAppliedChange?: boolean } = {},
): MemoryManagerRunPresentation | null {
  if (run?.kind !== "reflection" || !run.reflection) return null;
  const {
    anima_name: name,
    turn_count: count,
    remaining_turn_count: remaining,
  } = run.reflection;
  const turns = countLabel(count, "turn", "turns");
  if (run.status === "failed") {
    return {
      state: "failed",
      title: `Reflection on ${turns} with ${name} stopped`,
      description: hasAppliedChange
        ? "The applied MEMORIES.md change stands and these turns count as reflected. The conversation stopped before it finished; the error below explains why."
        : `${name}'s MEMORIES.md and these turns are unchanged, so they remain for the next Reflection. The error below explains why it stopped.`,
    };
  }
  const remainder =
    remaining > 0
      ? ` · ${remaining} more ${remaining === 1 ? "remains" : "remain"}`
      : "";
  if (run.status === "completed") {
    return {
      state: "completed",
      title: `Reflected on ${turns} with ${name}${remainder}`,
      description: hasAppliedChange
        ? "The applied MEMORIES.md change stands and these turns count as reflected."
        : "No change from this Reflection was applied, so these turns remain for the next Reflection.",
    };
  }
  const title = `Reflecting on ${turns} with ${name}${remainder}`;
  if (run.status === "waiting_approval") {
    return {
      state: "waiting_approval",
      title,
      description:
        "Review the proposed MEMORIES.md change below. These turns count as reflected only once a change from this Reflection is applied.",
    };
  }
  return {
    state: "active",
    title,
    description:
      "These turns count as reflected once a MEMORIES.md change from this Reflection is applied. Reply to refine it.",
  };
}

/**
 * Owner-facing reason a specialized run cannot start, or null when it can.
 * Specialized creation may supersede active runs but never a pending approval.
 */
export function specializedMemoryManagerRunBlockReason({
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
  if (hasPendingApproval) {
    return "Approve or reject the pending memory change in the Memory Manager first.";
  }
  if (isError) {
    return "The Memory Manager conversation could not load. Retry it first.";
  }
  if (isBusy || isLoading) {
    return "The Memory Manager is still working. Try again when it finishes.";
  }
  return null;
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
