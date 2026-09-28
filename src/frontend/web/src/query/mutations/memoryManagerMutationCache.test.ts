import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type {
  PyMemoryManagerApproval,
  PyMemoryManagerRunResponse,
} from "@/lib/content/catalogTypes";
import { queryKeys } from "@/query/keys";
import {
  invalidateApprovedIdentityDefinitions,
  publishMemoryManagerApproval,
  publishMemoryManagerSnapshot,
} from "./memoryManagerMutationCache";

function snapshot(
  status: PyMemoryManagerRunResponse["run"]["status"],
  taskStatus: "processing" | "processed" = "processing",
): PyMemoryManagerRunResponse {
  return {
    run: {
      id: "run-episode-processing",
      status,
      kind: "episode_processing",
      task: {
        kind: "episode_processing",
        status: taskStatus,
        batch_size: 50,
        has_more: true,
        started_at: "2026-07-15T20:00:00Z",
      },
      usage_metadata: {},
      metadata: {},
    },
    messages: [],
    approvals: [],
  };
}

describe("memory manager mutation cache", () => {
  it("publishes an open specialized run by ID and as current", () => {
    const queryClient = new QueryClient();
    const next = snapshot("waiting_approval");

    publishMemoryManagerSnapshot(queryClient, "user-1", next);

    expect(
      queryClient.getQueryData(
        queryKeys.memoryManager.run("user-1", next.run.id),
      ),
    ).toEqual(next);
    expect(
      queryClient.getQueryData(queryKeys.memoryManager.current("user-1")),
    ).toEqual(next);
  });

  it("keeps a closed snapshot by ID but clears current", () => {
    const queryClient = new QueryClient();
    const next = snapshot("failed");

    publishMemoryManagerSnapshot(queryClient, "user-1", next);

    expect(
      queryClient.getQueryData(
        queryKeys.memoryManager.run("user-1", next.run.id),
      ),
    ).toEqual(next);
    expect(
      queryClient.getQueryData(queryKeys.memoryManager.current("user-1")),
    ).toBeNull();
  });

  it("keeps a processed specialized run current for general follow-up", () => {
    const queryClient = new QueryClient();
    const next = snapshot("active", "processed");

    publishMemoryManagerSnapshot(queryClient, "user-1", next);

    expect(
      queryClient.getQueryData(queryKeys.memoryManager.current("user-1")),
    ).toEqual(next);
  });

  it("publishes an Undo audit update without touching unrelated snapshots", () => {
    const queryClient = new QueryClient();
    const current = snapshot("active", "processed");
    const approval: PyMemoryManagerApproval = {
      id: "approval-1",
      run_id: current.run.id,
      status: "approved",
      can_undo: true,
      preview: {
        operation: "update",
        path: "profile.md",
        unified_diff: "",
      },
    };
    current.approvals = [approval];
    publishMemoryManagerSnapshot(queryClient, "user-1", current);

    const undone = {
      ...approval,
      can_undo: false,
      undone_at: "2026-07-16T20:00:00Z",
      undo_version: 3,
    };
    publishMemoryManagerApproval(queryClient, "user-1", undone);

    const byId = queryClient.getQueryData<PyMemoryManagerRunResponse>(
      queryKeys.memoryManager.run("user-1", current.run.id),
    );
    const currentRun = queryClient.getQueryData<PyMemoryManagerRunResponse>(
      queryKeys.memoryManager.current("user-1"),
    );
    expect(byId?.approvals).toEqual([undone]);
    expect(currentRun?.approvals).toEqual([undone]);
  });
});

describe("identity approval invalidation", () => {
  function approval(
    path: string,
    status: PyMemoryManagerApproval["status"],
  ): PyMemoryManagerApproval {
    return {
      id: `${path}-${status}`,
      run_id: "run",
      status,
      operation_metadata: {},
      can_undo: false,
      preview: {
        operation: "update",
        path,
        unified_diff: "",
      },
    } as PyMemoryManagerApproval;
  }

  it("refreshes definitions only for approved identity targets", async () => {
    const queryClient = new QueryClient();
    const annie = queryKeys.animas.detail("owner", "anima-1");
    const caitlin = queryKeys.animas.detail("owner", "anima-2");
    const reflected = queryKeys.animas.detail("owner", "anima-3");
    queryClient.setQueryData(annie, {});
    queryClient.setQueryData(caitlin, {});
    queryClient.setQueryData(reflected, {});

    await invalidateApprovedIdentityDefinitions(queryClient, "owner", [
      approval("animas/anima-1/IDENTITY.md", "approved"),
      approval("animas/anima-2/IDENTITY.md", "pending"),
      // MEMORIES.md is not part of the Anima definition.
      approval("animas/anima-3/MEMORIES.md", "approved"),
      approval("notes/a.md", "approved"),
    ]);

    expect(queryClient.getQueryState(annie)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(caitlin)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(reflected)?.isInvalidated).toBe(false);
  });
});
