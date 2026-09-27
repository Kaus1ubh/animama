import { describe, expect, it } from "vitest";

import type { PyMemoryManagerRun } from "@/lib/content/catalogTypes";
import {
  episodeProcessingPresentation,
  isEpisodeProcessingComposerLocked,
  isRecoverableMemoryManagerRun,
  memoryManagerRunCapabilities,
  reflectionPresentation,
  resolveMemoryManagerSessionRunId,
  specializedMemoryManagerRunBlockReason,
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

  it("allows repeated specialized runs unless work or an approval locks them", () => {
    expect(
      specializedMemoryManagerRunBlockReason({
        isBusy: false,
        isLoading: false,
        isError: false,
        hasPendingApproval: false,
      }),
    ).toBeNull();
    expect(
      specializedMemoryManagerRunBlockReason({
        isBusy: false,
        isLoading: false,
        isError: false,
        hasPendingApproval: true,
      }),
    ).not.toBeNull();
    expect(
      specializedMemoryManagerRunBlockReason({
        isBusy: true,
        isLoading: false,
        isError: false,
        hasPendingApproval: false,
      }),
    ).not.toBeNull();
    expect(
      specializedMemoryManagerRunBlockReason({
        isBusy: false,
        isLoading: true,
        isError: false,
        hasPendingApproval: false,
      }),
    ).not.toBeNull();
    expect(
      specializedMemoryManagerRunBlockReason({
        isBusy: false,
        isLoading: false,
        isError: true,
        hasPendingApproval: false,
      }),
    ).not.toBeNull();
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

  it("explains why a specialized run cannot start", () => {
    const idle = {
      isBusy: false,
      isLoading: false,
      isError: false,
      hasPendingApproval: false,
    };
    expect(specializedMemoryManagerRunBlockReason(idle)).toBeNull();
    expect(
      specializedMemoryManagerRunBlockReason({
        ...idle,
        isBusy: true,
        hasPendingApproval: true,
      }),
    ).toContain("pending memory change");
    expect(
      specializedMemoryManagerRunBlockReason({ ...idle, isError: true }),
    ).toContain("could not load");
    expect(
      specializedMemoryManagerRunBlockReason({ ...idle, isBusy: true }),
    ).toContain("still working");
    expect(
      specializedMemoryManagerRunBlockReason({ ...idle, isLoading: true }),
    ).toContain("still working");
  });

  it("presents a Reflection with its Anima and turn counts", () => {
    const run: PyMemoryManagerRun = {
      id: "run-1",
      status: "active",
      kind: "reflection",
      task: null,
      reflection: {
        anima_id: "anima-1",
        anima_name: "Annie",
        turn_count: 12,
        remaining_turn_count: 3,
        started_at: "2026-09-26T12:00:00Z",
      },
    };

    // Follow-up messages stay available throughout a Reflection.
    expect(isEpisodeProcessingComposerLocked(run)).toBe(false);
    expect(episodeProcessingPresentation(run)).toBeNull();
    expect(reflectionPresentation(run)).toMatchObject({
      state: "active",
      title: "Reflecting on 12 turns with Annie · 3 more remain",
    });
    expect(
      reflectionPresentation({ ...run, status: "waiting_approval" }),
    ).toMatchObject({
      state: "waiting_approval",
      title: "Reflecting on 12 turns with Annie · 3 more remain",
    });
  });

  it("titles a completed Reflection in the past tense", () => {
    const run: PyMemoryManagerRun = {
      id: "run-1",
      status: "completed",
      kind: "reflection",
      reflection: {
        anima_id: "anima-1",
        anima_name: "Annie",
        turn_count: 12,
        remaining_turn_count: 0,
        started_at: "2026-09-26T12:00:00Z",
      },
    };
    const applied = reflectionPresentation(run, { hasAppliedChange: true });
    expect(applied).toMatchObject({
      state: "completed",
      title: "Reflected on 12 turns with Annie",
    });
    expect(applied?.description).toContain("count as reflected");
    expect(reflectionPresentation(run)?.description).toContain(
      "remain for the next Reflection",
    );
  });

  it("keeps a stopped Reflection's copy true to what was applied", () => {
    const run: PyMemoryManagerRun = {
      id: "run-1",
      status: "failed",
      kind: "reflection",
      reflection: {
        anima_id: "anima-1",
        anima_name: "Annie",
        turn_count: 12,
        remaining_turn_count: 0,
        started_at: "2026-09-26T12:00:00Z",
      },
    };

    const unchanged = reflectionPresentation(run);
    expect(unchanged).toMatchObject({
      state: "failed",
      title: "Reflection on 12 turns with Annie stopped",
    });
    expect(unchanged?.description).toContain(
      "Annie's MEMORIES.md and these turns are unchanged",
    );
    // The cause is not assumed to be model availability.
    expect(unchanged?.description).not.toContain("available");

    // Approval commits the change and its coverage before the model resumes,
    // so a later failure must not claim the file is unchanged.
    const applied = reflectionPresentation(run, { hasAppliedChange: true });
    expect(applied).toMatchObject({
      state: "failed",
      title: "Reflection on 12 turns with Annie stopped",
    });
    expect(applied?.description).not.toContain("unchanged");
    expect(applied?.description).toContain("applied MEMORIES.md change stands");
    expect(applied?.description).toContain("count as reflected");
  });

  it("uses singular counts and omits the remainder when none remain", () => {
    const run: PyMemoryManagerRun = {
      id: "run-1",
      status: "active",
      kind: "reflection",
      reflection: {
        anima_id: "anima-1",
        anima_name: "Annie",
        turn_count: 1,
        remaining_turn_count: 0,
        started_at: "2026-09-26T12:00:00Z",
      },
    };
    expect(reflectionPresentation(run)?.title).toBe(
      "Reflecting on 1 turn with Annie",
    );
    expect(
      reflectionPresentation({
        ...run,
        reflection: { ...run.reflection!, remaining_turn_count: 1 },
      })?.title,
    ).toBe("Reflecting on 1 turn with Annie · 1 more remains");
  });

  it("presents no Reflection for other run kinds or a missing summary", () => {
    expect(reflectionPresentation(null)).toBeNull();
    expect(
      reflectionPresentation({
        id: "run-1",
        status: "active",
        kind: "general",
      }),
    ).toBeNull();
    expect(
      reflectionPresentation({
        id: "run-1",
        status: "active",
        kind: "reflection",
        reflection: null,
      }),
    ).toBeNull();
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
