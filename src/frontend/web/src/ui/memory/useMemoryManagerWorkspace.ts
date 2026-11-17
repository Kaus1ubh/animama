import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type {
  PyMemoryManagerApproval,
  PyMemoryManagerRunResponse,
} from "@/lib/content/catalogTypes";
import { memoryManagerApprovalDecisionRequest } from "@/lib/memory-manager/approval-feedback";
import {
  MemoryManagerApiError,
  memoryManagerErrorMessage,
} from "@/lib/memory-manager/errors";
import {
  isEpisodeProcessingComposerLocked,
  isRecoverableMemoryManagerRun,
  memoryManagerRunCapabilities,
  resolveMemoryManagerSessionRunId,
  specializedMemoryManagerRunBlockReason,
  startNewMemoryManagerConversation,
} from "@/lib/memory-manager/workspace-state";
import {
  createEpisodeProcessingOptimisticSubmission,
  createMemoryManagerOptimisticSubmission,
  createReflectionOptimisticSubmission,
  memoryManagerMarkdownAnimationDurationMs,
  newMemoryManagerAssistantMessage,
  restoreMemoryManagerComposer,
  type MemoryManagerOptimisticSubmission,
} from "@/lib/memory-manager/transcript-projection";
import {
  useCurrentMemoryManagerRun,
  useMemoryManagerRun,
} from "@/query/hooks/useMemoryManagerRun";
import { useAppendMemoryManagerMessage } from "@/query/mutations/useAppendMemoryManagerMessage";
import { useCompleteMemoryManagerRun } from "@/query/mutations/useCompleteMemoryManagerRun";
import { useCreateEpisodeProcessingMemoryManagerRun } from "@/query/mutations/useCreateEpisodeProcessingMemoryManagerRun";
import { useCreateMemoryManagerRun } from "@/query/mutations/useCreateMemoryManagerRun";
import { useCreateReflectionMemoryManagerRun } from "@/query/mutations/useCreateReflectionMemoryManagerRun";
import { useDecideMemoryManagerApproval } from "@/query/mutations/useDecideMemoryManagerApproval";
import { useUndoMemoryManagerApproval } from "@/query/mutations/useUndoMemoryManagerApproval";

type UseMemoryManagerWorkspaceOptions = {
  runId?: string | null;
  onRunCreated: (runId: string) => void;
  onRunRecovered: (runId: string) => void;
  onRunCleared: () => void;
  onPendingEpisodesChanged: () => void;
};

/** The Anima whose `MEMORIES.md` a Reflection curates. */
export type MemoryManagerReflectionTarget = {
  animaId: string;
  /** Owner-facing name used until the server-owned message arrives. */
  animaName: string;
};

/** Owns inline manager state even while another workspace tab or mode is shown. */
export function useMemoryManagerWorkspace({
  runId,
  onRunCreated,
  onRunRecovered,
  onRunCleared,
  onPendingEpisodesChanged,
}: UseMemoryManagerWorkspaceOptions) {
  const { t } = useTranslation("memory");
  const [composer, setComposer] = useState("");
  const [optimisticSubmission, setOptimisticSubmission] =
    useState<MemoryManagerOptimisticSubmission | null>(null);
  const [animatingAssistantMessageId, setAnimatingAssistantMessageId] =
    useState<string | null>(null);
  const [autoApproveDiffs, setAutoApproveDiffs] = useState(false);
  const assistantAnimationTimeoutRef = useRef<number | null>(null);
  const submissionInFlightRef = useRef(false);
  const processingInFlightRef = useRef(false);
  const initialRunIdRef = useRef(runId ?? null);
  const sessionRunIdsRef = useRef(new Set<string>());
  const dismissedInitialRunIdRef = useRef<string | null>(null);
  const recoveredRunIdRef = useRef<string | null>(null);
  const createRun = useCreateMemoryManagerRun();
  const createEpisodeProcessingRun =
    useCreateEpisodeProcessingMemoryManagerRun();
  const createReflectionRun = useCreateReflectionMemoryManagerRun();
  const appendMessage = useAppendMemoryManagerMessage();
  const completeRun = useCompleteMemoryManagerRun();
  const decideApproval = useDecideMemoryManagerApproval();
  const undoApproval = useUndoMemoryManagerApproval();
  const runQuery = useMemoryManagerRun(runId, {
    enabled: Boolean(runId),
  });
  const currentRunQuery = useCurrentMemoryManagerRun({ enabled: !runId });
  const isSessionOwnedRun = Boolean(
    runId && sessionRunIdsRef.current.has(runId),
  );
  const isInitialRunUnresolved = Boolean(
    runId &&
    runId === initialRunIdRef.current &&
    !isSessionOwnedRun &&
    (runQuery.isFetching || !runQuery.isSuccess),
  );
  const selectedRunId = resolveMemoryManagerSessionRunId({
    runId,
    initialRunId: initialRunIdRef.current,
    status: isInitialRunUnresolved ? null : runQuery.data?.run.status,
    isSessionOwned: isSessionOwnedRun,
  });
  const currentSnapshot = !runId ? (currentRunQuery.data ?? null) : null;
  const recoveredSnapshot = isRecoverableMemoryManagerRun(
    currentSnapshot?.run.status,
  )
    ? currentSnapshot
    : null;
  const effectiveRunId = selectedRunId ?? recoveredSnapshot?.run.id ?? null;
  const snapshot = selectedRunId ? (runQuery.data ?? null) : recoveredSnapshot;
  const isLoading = runId ? runQuery.isLoading : currentRunQuery.isLoading;
  const isError = runId ? runQuery.isError : currentRunQuery.isError;
  const hasPendingApproval = (snapshot?.approvals ?? []).some(
    (approval) => approval.status === "pending",
  );
  const isBusy =
    createRun.isPending ||
    createEpisodeProcessingRun.isPending ||
    createReflectionRun.isPending ||
    appendMessage.isPending ||
    completeRun.isPending ||
    decideApproval.isPending ||
    undoApproval.isPending ||
    (runId ? runQuery.isFetching : currentRunQuery.isFetching);
  const capabilities = useMemo(
    () =>
      memoryManagerRunCapabilities({
        runId: effectiveRunId,
        status: snapshot?.run.status,
        isBusy: isBusy || isLoading || isError,
        hasPendingApproval,
      }),
    [
      hasPendingApproval,
      effectiveRunId,
      isError,
      isBusy,
      isLoading,
      snapshot?.run.status,
    ],
  );
  const episodeProcessingComposerLocked = isEpisodeProcessingComposerLocked(
    snapshot?.run,
  );
  const specializedRunBlockReason = specializedMemoryManagerRunBlockReason({
    isBusy,
    isLoading,
    isError,
    hasPendingApproval,
  });
  const canStartSpecializedRun = specializedRunBlockReason === null;

  useEffect(
    () => () => {
      if (assistantAnimationTimeoutRef.current !== null) {
        window.clearTimeout(assistantAnimationTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (
      !runId ||
      runId !== initialRunIdRef.current ||
      sessionRunIdsRef.current.has(runId) ||
      runQuery.isFetching ||
      !runQuery.isSuccess
    ) {
      return;
    }
    if (isRecoverableMemoryManagerRun(runQuery.data?.run.status)) {
      sessionRunIdsRef.current.add(runId);
      return;
    }
    if (dismissedInitialRunIdRef.current === runId) return;
    dismissedInitialRunIdRef.current = runId;
    onRunCleared();
  }, [
    onRunCleared,
    runId,
    runQuery.data?.run.status,
    runQuery.isFetching,
    runQuery.isSuccess,
  ]);

  useEffect(() => {
    if (runId) {
      recoveredRunIdRef.current = null;
      return;
    }
    if (currentRunQuery.isFetching) return;
    if (!recoveredSnapshot) return;
    if (recoveredRunIdRef.current === recoveredSnapshot.run.id) return;
    recoveredRunIdRef.current = recoveredSnapshot.run.id;
    sessionRunIdsRef.current.add(recoveredSnapshot.run.id);
    onRunRecovered(recoveredSnapshot.run.id);
  }, [currentRunQuery.isFetching, onRunRecovered, recoveredSnapshot, runId]);

  /** Stops the previous reply's reveal before another request begins. */
  const stopAssistantReveal = () => {
    if (assistantAnimationTimeoutRef.current !== null) {
      window.clearTimeout(assistantAnimationTimeoutRef.current);
      assistantAnimationTimeoutRef.current = null;
    }
    setAnimatingAssistantMessageId(null);
  };

  /** Animates the reply added after one request's baseline until it is shown. */
  const revealAssistantReply = (
    messages: PyMemoryManagerRunResponse["messages"],
    baselineMessageIds: readonly string[],
  ) => {
    const animatedMessage = newMemoryManagerAssistantMessage(
      messages ?? [],
      baselineMessageIds,
    );
    setAnimatingAssistantMessageId(animatedMessage?.id ?? null);
    const revealDuration = animatedMessage
      ? memoryManagerMarkdownAnimationDurationMs(animatedMessage.content)
      : 0;
    if (revealDuration > 0) {
      assistantAnimationTimeoutRef.current = window.setTimeout(() => {
        setAnimatingAssistantMessageId(null);
        assistantAnimationTimeoutRef.current = null;
      }, revealDuration);
    }
  };

  /**
   * Creates a specialized run behind its optimistic request line. Returns
   * false when gated; request errors propagate after the line is removed.
   */
  const startSpecializedRun = async (
    pendingSubmission: MemoryManagerOptimisticSubmission,
    create: () => Promise<PyMemoryManagerRunResponse>,
  ) => {
    if (!canStartSpecializedRun || processingInFlightRef.current) return false;
    processingInFlightRef.current = true;
    stopAssistantReveal();
    setOptimisticSubmission(pendingSubmission);
    try {
      const created = await create();
      sessionRunIdsRef.current.add(created.run.id);
      onRunCreated(created.run.id);
      revealAssistantReply(
        created.messages,
        pendingSubmission.baselineMessageIds,
      );
      return true;
    } finally {
      setOptimisticSubmission(null);
      processingInFlightRef.current = false;
    }
  };

  const submit = async () => {
    const content = composer.trim();
    if (
      !content ||
      submissionInFlightRef.current ||
      hasPendingApproval ||
      episodeProcessingComposerLocked ||
      capabilities.closed
    ) {
      return;
    }
    stopAssistantReveal();
    submissionInFlightRef.current = true;
    const pendingSubmission = createMemoryManagerOptimisticSubmission(
      content,
      snapshot?.messages ?? [],
    );
    setOptimisticSubmission(pendingSubmission);
    setComposer("");
    try {
      let updatedSnapshot: PyMemoryManagerRunResponse;
      if (effectiveRunId) {
        updatedSnapshot = await appendMessage.mutateAsync({
          runId: effectiveRunId,
          body: { content, auto_approve_diffs: autoApproveDiffs },
        });
      } else {
        const created = await createRun.mutateAsync({
          body: {
            message: content,
            auto_approve_diffs: autoApproveDiffs,
            metadata: { source: "memory_library" },
          },
        });
        sessionRunIdsRef.current.add(created.run.id);
        onRunCreated(created.run.id);
        updatedSnapshot = created;
      }
      revealAssistantReply(
        updatedSnapshot.messages,
        pendingSubmission.baselineMessageIds,
      );
      setOptimisticSubmission(null);
    } catch (error) {
      setOptimisticSubmission(null);
      setComposer((current) => restoreMemoryManagerComposer(current, content));
      if (
        !effectiveRunId &&
        error instanceof MemoryManagerApiError &&
        error.status === 409
      ) {
        const refreshed = await currentRunQuery.refetch();
        if (refreshed.data) {
          sessionRunIdsRef.current.add(refreshed.data.run.id);
          onRunRecovered(refreshed.data.run.id);
        }
      }
      toast.error(
        effectiveRunId
          ? t("manager.toasts.sendFailed")
          : t("manager.toasts.startFailed"),
        { description: memoryManagerErrorMessage(error) },
      );
    } finally {
      submissionInFlightRef.current = false;
    }
  };

  const decide = async (
    approval: PyMemoryManagerApproval,
    decision: "approve" | "reject",
    feedback?: string,
  ) => {
    try {
      const updated = await decideApproval.mutateAsync({
        approvalId: approval.id,
        body: memoryManagerApprovalDecisionRequest(decision, feedback),
      });
      toast.success(
        updated.status === "approved"
          ? t("manager.toasts.applied")
          : t("manager.toasts.rejected"),
        {
          description:
            updated.status === "approved"
              ? t("manager.toasts.appliedDescription")
              : updated.decision_feedback
                ? t("manager.toasts.feedbackSent")
                : t("manager.toasts.noFilesChanged"),
        },
      );
      onPendingEpisodesChanged();
    } catch (error) {
      toast.error(t("manager.toasts.decisionFailed"), {
        description: memoryManagerErrorMessage(error),
      });
    }
  };

  const undo = async (approval: PyMemoryManagerApproval) => {
    try {
      const result = await undoApproval.mutateAsync({ approval });
      toast.success(t("manager.toasts.undone"), {
        description: result.deleted
          ? t("manager.toasts.undoDeleted")
          : t("manager.toasts.undoRestored", { version: result.undo_version }),
      });
    } catch (error) {
      const stale =
        error instanceof MemoryManagerApiError && error.status === 409;
      toast.error(
        stale ? t("manager.toasts.undoStale") : t("manager.toasts.undoFailed"),
        {
          description: stale
            ? t("manager.toasts.undoStaleDescription")
            : memoryManagerErrorMessage(error),
        },
      );
    }
  };

  const startNew = async () => {
    if (!capabilities.canStartNew) return false;
    try {
      await startNewMemoryManagerConversation({
        runId: effectiveRunId,
        completeBeforeStartNew: capabilities.completeBeforeStartNew,
        complete: (id) => completeRun.mutateAsync({ runId: id }),
        clear: () => {
          if (effectiveRunId) sessionRunIdsRef.current.delete(effectiveRunId);
          onRunCleared();
        },
      });
      setAutoApproveDiffs(false);
      onPendingEpisodesChanged();
      return true;
    } catch (error) {
      toast.error(t("manager.toasts.completeFailed"), {
        description: memoryManagerErrorMessage(error),
      });
      return false;
    }
  };

  const processPending = async (pendingEpisodeCount: number) => {
    try {
      const started = await startSpecializedRun(
        createEpisodeProcessingOptimisticSubmission(
          pendingEpisodeCount,
          snapshot?.messages ?? [],
        ),
        () =>
          createEpisodeProcessingRun.mutateAsync({
            body: { auto_approve_diffs: autoApproveDiffs },
          }),
      );
      if (started) onPendingEpisodesChanged();
    } catch (error) {
      if (error instanceof MemoryManagerApiError && error.status === 409) {
        onPendingEpisodesChanged();
      }
      toast.error(t("manager.toasts.processFailed"), {
        description: memoryManagerErrorMessage(error),
      });
    }
  };

  /**
   * Starts a Reflection for one Anima, superseding an active conversation.
   * A refusal (such as nothing to reflect) keeps the current transcript and
   * explains the backend reason; a model failure arrives as a failed run.
   */
  const reflect = async (target: MemoryManagerReflectionTarget) => {
    try {
      await startSpecializedRun(
        createReflectionOptimisticSubmission(
          target.animaName,
          snapshot?.messages ?? [],
        ),
        () =>
          createReflectionRun.mutateAsync({
            body: {
              anima_id: target.animaId,
              auto_approve_diffs: autoApproveDiffs,
            },
          }),
      );
    } catch (error) {
      toast.error(t("manager.toasts.reflectionFailed"), {
        description: memoryManagerErrorMessage(error),
      });
    }
  };

  return {
    runId: effectiveRunId,
    snapshot,
    composer,
    setComposer,
    optimisticSubmission,
    animatingAssistantMessageId,
    autoApproveDiffs,
    setAutoApproveDiffs,
    capabilities,
    canStartSpecializedRun,
    specializedRunBlockReason,
    episodeProcessingComposerLocked,
    hasPendingApproval,
    isBusy,
    isSending:
      createRun.isPending ||
      createEpisodeProcessingRun.isPending ||
      createReflectionRun.isPending ||
      appendMessage.isPending,
    isProcessingEpisodes: createEpisodeProcessingRun.isPending,
    isReflecting: createReflectionRun.isPending,
    isCompleting: completeRun.isPending,
    isDeciding: decideApproval.isPending,
    isUndoing: undoApproval.isPending,
    isLoading,
    isError,
    submit,
    decide,
    undo,
    startNew,
    processPending,
    reflect,
    retry: runId ? runQuery.refetch : currentRunQuery.refetch,
  };
}

export type MemoryManagerWorkspaceController = ReturnType<
  typeof useMemoryManagerWorkspace
>;
