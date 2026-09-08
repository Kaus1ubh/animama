import { describe, expect, it } from "vitest";

import {
  canProcessPendingEpisodes,
  episodeProcessingPresentation,
  isEpisodeProcessingComposerLocked,
  isRecoverableMemoryManagerRun,
  memoryManagerRunCapabilities,
  resolveMemoryManagerSessionRunId,
  startNewMemoryManagerConversation,
} from "./workspace-state";

describe("memory manager workspace state", () => {
  it("keeps New available before the first message", () => {
    expect(
      memoryManagerRunCapabilities({
        runId: null,
        status: null,
        isBusy: false,
        hasPendingApproval: false,
      }),
    ).toEqual({
      closed: false,
      canStartNew: true,
      completeBeforeStartNew: false,
    });
  });

  it("recovers only runs with unresolved approvals on a fresh route session", () => {
    expect(isRecoverableMemoryManagerRun("waiting_approval")).toBe(true);
    expect(isRecoverableMemoryManagerRun("active")).toBe(false);
    expect(isRecoverableMemoryManagerRun("completed")).toBe(false);
    expect(isRecoverableMemoryManagerRun("failed")).toBe(false);
    expect(isRecoverableMemoryManagerRun(null)).toBe(false);
  });

  it("filters historical initial runs but keeps runs owned by this mount", () => {
    for (const status of ["active", "completed", "failed"] as const) {
      expect(
        resolveMemoryManagerSessionRunId({
          runId: "run-initial",
          initialRunId: "run-initial",
          status,
          isSessionOwned: false,
        }),
      ).toBeNull();
    }
    expect(
      resolveMemoryManagerSessionRunId({
        runId: "run-initial",
        initialRunId: "run-initial",
        status: "waiting_approval",
        isSessionOwned: false,
      }),
    ).toBe("run-initial");
    expect(
      resolveMemoryManagerSessionRunId({
        runId: "run-initial",
        initialRunId: "run-initial",
        status: "active",
        isSessionOwned: true,
      }),
    ).toBe("run-initial");
    expect(
      resolveMemoryManagerSessionRunId({
        runId: "run-created-here",
        initialRunId: "run-initial",
        status: "active",
        isSessionOwned: false,
      }),
    ).toBe("run-created-here");
  });

  it("allows active runs to start new through implicit completion", () => {
    expect(
      memoryManagerRunCapabilities({
        runId: "run-1",
        status: "active",
        isBusy: false,
        hasPendingApproval: false,
      }),
    ).toMatchObject({
      canStartNew: true,
      completeBeforeStartNew: true,
    });
  });

  it("locks active controls during requests and pending approvals", () => {
    for (const state of [
      { isBusy: true, hasPendingApproval: false },
      { isBusy: false, hasPendingApproval: true },
    ]) {
      expect(
        memoryManagerRunCapabilities({
          runId: "run-1",
          status: "waiting_approval",
          ...state,
        }),
      ).toMatchObject({ canStartNew: false });
    }
  });

  it("starts new immediately from completed and failed runs", () => {
    for (const status of ["completed", "failed"] as const) {
      expect(
        memoryManagerRunCapabilities({
          runId: "run-1",
          status,
          isBusy: false,
          hasPendingApproval: false,
        }),
      ).toMatchObject({
        closed: true,
        canStartNew: true,
        completeBeforeStartNew: false,
      });
    }
  });

  it("treats unresolved run-load state as requiring completion", () => {
    expect(
      memoryManagerRunCapabilities({
        runId: "run-1",
        status: null,
        isBusy: false,
        hasPendingApproval: false,
      }),
    ).toMatchObject({
      completeBeforeStartNew: true,
    });
  });

  it("allows repeated processing unless work or an approval locks it", () => {
    expect(
      canProcessPendingEpisodes({
        isBusy: false,
        isLoading: false,
        isError: false,
        hasPendingApproval: false,
      }),
    ).toBe(true);
    expect(
      canProcessPendingEpisodes({
        isBusy: false,
        isLoading: false,
        isError: false,
        hasPendingApproval: true,
      }),
    ).toBe(false);
    expect(
      canProcessPendingEpisodes({
        isBusy: true,
        isLoading: false,
        isError: false,
        hasPendingApproval: false,
      }),
    ).toBe(false);
    expect(
      canProcessPendingEpisodes({
        isBusy: false,
        isLoading: true,
        isError: false,
        hasPendingApproval: false,
      }),
    ).toBe(false);
    expect(
      canProcessPendingEpisodes({
        isBusy: false,
        isLoading: false,
        isError: true,
        hasPendingApproval: false,
      }),
    ).toBe(false);
  });

  it("presents processing, approval, and post-processing general mode", () => {
    const run = {
      id: "run-1",
      status: "active" as const,
      kind: "episode_processing" as const,
      task: {
        kind: "episode_processing" as const,
        status: "processing" as const,
        batch_size: 50,
        has_more: true,
        started_at: "2026-07-15T20:00:00Z",
      },
      usage_metadata: {},
      metadata: {},
    };
    expect(isEpisodeProcessingComposerLocked(run)).toBe(true);
    expect(episodeProcessingPresentation(run)).toMatchObject({
      state: "processing",
      title: "Reviewing 50 episodes",
    });
    expect(
      episodeProcessingPresentation({ ...run, status: "waiting_approval" }),
    ).toMatchObject({ state: "waiting_approval" });

    const processed = {
      ...run,
      task: {
        ...run.task,
        status: "processed" as const,
        processed_at: "2026-07-15T20:05:00Z",
      },
    };
    expect(isEpisodeProcessingComposerLocked(processed)).toBe(false);
    expect(episodeProcessingPresentation(processed)).toMatchObject({
      state: "processed",
      title: "Reviewed 50 episodes",
    });
    expect(episodeProcessingPresentation(processed)?.description).toContain(
      "general Memory Manager mode",
    );
    expect(
      episodeProcessingPresentation({ ...run, status: "failed" }),
    ).toMatchObject({ state: "failed" });
  });

  it("completes active runs before clearing them", async () => {
    const events: string[] = [];
    await startNewMemoryManagerConversation({
      runId: "run-1",
      completeBeforeStartNew: true,
      complete: async (runId) => {
        events.push(`complete:${runId}`);
      },
      clear: () => events.push("clear"),
    });
    expect(events).toEqual(["complete:run-1", "clear"]);
  });

  it("does nothing when New is selected in an empty conversation", async () => {
    const events: string[] = [];
    await startNewMemoryManagerConversation({
      runId: null,
      completeBeforeStartNew: false,
      complete: async () => {
        events.push("complete");
      },
      clear: () => events.push("clear"),
    });
    expect(events).toEqual([]);
  });

  it("retains the current run when completion fails", async () => {
    let cleared = false;
    await expect(
      startNewMemoryManagerConversation({
        runId: "run-1",
        completeBeforeStartNew: true,
        complete: async () => {
          throw new Error("completion failed");
        },
        clear: () => {
          cleared = true;
        },
      }),
    ).rejects.toThrow("completion failed");
    expect(cleared).toBe(false);
  });

  it("clears closed runs without calling completion", async () => {
    let completed = false;
    let cleared = false;
    await startNewMemoryManagerConversation({
      runId: "run-1",
      completeBeforeStartNew: false,
      complete: async () => {
        completed = true;
      },
      clear: () => {
        cleared = true;
      },
    });
    expect(completed).toBe(false);
    expect(cleared).toBe(true);
  });
});
