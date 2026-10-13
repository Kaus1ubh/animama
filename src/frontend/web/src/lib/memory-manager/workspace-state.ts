import { getI18n } from "react-i18next";

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

/**
 * Builds safe processing copy from the public task summary only, worded in
 * the active UI Locale.
 */
export function episodeProcessingPresentation(
  run: PyMemoryManagerRun | null | undefined,
): MemoryManagerRunPresentation | null {
  if (run?.kind !== "episode_processing" || !run.task) return null;
  const t = getI18n().getFixedT(null, "memory");
  const count = run.task.batch_size;
  if (run.task.status === "processed") {
    return {
      state: "processed",
      title: t("manager.episodes.processedTitle", { count }),
      description: run.task.has_more
        ? t("manager.episodes.processedMoreDescription")
        : t("manager.episodes.processedDescription"),
    };
  }
  if (run.status === "failed") {
    return {
      state: "failed",
      title: t("manager.episodes.failedTitle", { count }),
      description: t("manager.episodes.failedDescription"),
    };
  }
  if (run.status === "waiting_approval") {
    return {
      state: "waiting_approval",
      title: t("manager.episodes.reviewingTitle", { count }),
      description: t("manager.episodes.waitingDescription"),
    };
  }
  return {
    state: "processing",
    title: t("manager.episodes.reviewingTitle", { count }),
    description: t("manager.episodes.processingDescription"),
  };
}

/**
 * Builds Reflection copy from the public summary only, worded in the active
 * UI Locale. The composer stays
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
  const t = getI18n().getFixedT(null, "memory");
  const {
    anima_name: name,
    turn_count: count,
    remaining_turn_count: remaining,
  } = run.reflection;
  const turns = t("manager.reflection.turns", { count });
  if (run.status === "failed") {
    return {
      state: "failed",
      title: t("manager.reflection.failedTitle", { turns, name }),
      description: hasAppliedChange
        ? t("manager.reflection.failedAppliedDescription")
        : t("manager.reflection.failedUnchangedDescription", { name }),
    };
  }
  /** Appends how many turns remain for a later Reflection, when any do. */
  const withRemainder = (title: string) =>
    remaining > 0
      ? t("manager.reflection.titleWithRemaining", {
          title,
          remaining: t("manager.reflection.remaining", { count: remaining }),
        })
      : title;
  if (run.status === "completed") {
    return {
      state: "completed",
      title: withRemainder(
        t("manager.reflection.completedTitle", { turns, name }),
      ),
      description: hasAppliedChange
        ? t("manager.reflection.completedAppliedDescription")
        : t("manager.reflection.completedUnchangedDescription"),
    };
  }
  const title = withRemainder(
    t("manager.reflection.activeTitle", { turns, name }),
  );
  if (run.status === "waiting_approval") {
    return {
      state: "waiting_approval",
      title,
      description: t("manager.reflection.waitingDescription"),
    };
  }
  return {
    state: "active",
    title,
    description: t("manager.reflection.activeDescription"),
  };
}

/**
 * Owner-facing reason a specialized run cannot start, or null when it can,
 * worded in the active UI Locale. Specialized creation may supersede active
 * runs but never a pending approval.
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
  const t = getI18n().getFixedT(null, "memory");
  if (hasPendingApproval) return t("manager.blocked.pendingApproval");
  if (isError) return t("manager.blocked.loadFailed");
  if (isBusy || isLoading) return t("manager.blocked.busy");
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
