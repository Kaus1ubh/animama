"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  canProcessPendingEpisodes,
  isEpisodeProcessingComposerLocked,
  isRecoverableMemoryManagerRun,
  memoryManagerRunCapabilities,
  resolveMemoryManagerSessionRunId,
  startNewMemoryManagerConversation,
} from "@/lib/memory-manager/workspace-state";
import {
  createEpisodeProcessingOptimisticSubmission,
  createMemoryManagerOptimisticSubmission,
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
import { useDecideMemoryManagerApproval } from "@/query/mutations/useDecideMemoryManagerApproval";
import { useUndoMemoryManagerApproval } from "@/query/mutations/useUndoMemoryManagerApproval";

type UseMemoryManagerWorkspaceOptions = {
  runId?: string | null;
  onRunCreated: (runId: string) => void;
  onRunRecovered: (runId: string) => void;
  onRunCleared: () => void;
  onPendingEpisodesChanged: () => void;
};

/** Owns inline manager state even while another workspace tab or mode is shown. */
export function useMemoryManagerWorkspace({
  runId,
  onRunCreated,
  onRunRecovered,
  onRunCleared,
  onPendingEpisodesChanged,
}: UseMemoryManagerWorkspaceOptions) {
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
  const canProcessEpisodes = canProcessPendingEpisodes({
    isBusy,
    isLoading,
    isError,
    hasPendingApproval,
  });

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
    if (assistantAnimationTimeoutRef.current !== null) {
      window.clearTimeout(assistantAnimationTimeoutRef.current);
      assistantAnimationTimeoutRef.current = null;
    }
    setAnimatingAssistantMessageId(null);
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
      const animatedMessage = newMemoryManagerAssistantMessage(
        updatedSnapshot.messages ?? [],
        pendingSubmission.baselineMessageIds,
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
          ? "Failed to send memory-manager message."
          : "Failed to start memory manager.",
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
          ? "Memory change applied."
          : "Memory change rejected.",
        {
          description:
            updated.status === "approved"
              ? "The approved diff was committed."
              : updated.decision_feedback
                ? "Your feedback was sent to the Memory Manager."
                : "No memory files were changed.",
        },
      );
      onPendingEpisodesChanged();
    } catch (error) {
      toast.error("Failed to record approval decision.", {
        description: memoryManagerErrorMessage(error),
      });
    }
  };

  const undo = async (approval: PyMemoryManagerApproval) => {
    try {
      const result = await undoApproval.mutateAsync({ approval });
      toast.success("Memory change undone.", {
        description: result.deleted
          ? "The approved file was removed as a new Version."
          : `The earlier content was restored as Version ${result.undo_version}.`,
      });
    } catch (error) {
      const stale =
        error instanceof MemoryManagerApiError && error.status === 409;
      toast.error(
        stale
          ? "This memory change can no longer be undone."
          : "Failed to undo the approved memory change.",
        {
          description: stale
            ? "Open Versions to inspect the latest file and explicitly Revert if needed."
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
      toast.error("Failed to complete memory-manager run.", {
        description: memoryManagerErrorMessage(error),
      });
      return false;
    }
  };

  const processPending = async (pendingEpisodeCount: number) => {
    if (!canProcessEpisodes || processingInFlightRef.current) return;
    processingInFlightRef.current = true;
    if (assistantAnimationTimeoutRef.current !== null) {
      window.clearTimeout(assistantAnimationTimeoutRef.current);
      assistantAnimationTimeoutRef.current = null;
    }
    setAnimatingAssistantMessageId(null);
    const pendingSubmission = createEpisodeProcessingOptimisticSubmission(
      pendingEpisodeCount,
      snapshot?.messages ?? [],
    );
    setOptimisticSubmission(pendingSubmission);
    try {
      const created = await createEpisodeProcessingRun.mutateAsync({
        body: { auto_approve_diffs: autoApproveDiffs },
      });
      sessionRunIdsRef.current.add(created.run.id);
      onRunCreated(created.run.id);
      const animatedMessage = newMemoryManagerAssistantMessage(
        created.messages ?? [],
        pendingSubmission.baselineMessageIds,
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
      setOptimisticSubmission(null);
      onPendingEpisodesChanged();
    } catch (error) {
      setOptimisticSubmission(null);
      if (error instanceof MemoryManagerApiError && error.status === 409) {
        onPendingEpisodesChanged();
      }
      toast.error("Failed to process pending episodes.", {
        description: memoryManagerErrorMessage(error),
      });
    } finally {
      processingInFlightRef.current = false;
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
    canProcessEpisodes,
    episodeProcessingComposerLocked,
    hasPendingApproval,
    isBusy,
    isSending:
      createRun.isPending ||
      createEpisodeProcessingRun.isPending ||
      appendMessage.isPending,
    isProcessingEpisodes: createEpisodeProcessingRun.isPending,
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
    retry: runId ? runQuery.refetch : currentRunQuery.refetch,
  };
}

export type MemoryManagerWorkspaceController = ReturnType<
  typeof useMemoryManagerWorkspace
>;
