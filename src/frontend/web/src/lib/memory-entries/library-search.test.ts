import { describe, expect, it } from "vitest";

import {
  memorySearchFromUrl,
  modeForMemoryEntrySelection,
  normalizeMemorySearch,
  shouldBlockMemoryWorkspaceExit,
} from "./library-search";

describe("memory library search", () => {
  it("defaults missing and invalid modes to Manual", () => {
    expect(normalizeMemorySearch({})).toEqual({
      tab: "memory",
      mode: "manual",
    });
    expect(normalizeMemorySearch({ mode: "invalid" })).toEqual({
      tab: "memory",
      mode: "manual",
    });
  });

  it("normalizes canonical workspace state", () => {
    expect(
      normalizeMemorySearch({
        tab: "memory",
        mode: "manager",
        entryId: "entry-1",
        managerRunId: "run-1",
      }),
    ).toEqual({
      tab: "memory",
      mode: "manager",
      entryId: "entry-1",
      managerRunId: "run-1",
    });
  });

  it("maps User and Episodes links to Memory and drops directory state", () => {
    expect(
      normalizeMemorySearch({
        tab: "user",
        directory: "notes/work",
        entryId: "entry-1",
      }),
    ).toEqual({ tab: "memory", mode: "manual", entryId: "entry-1" });
    expect(
      normalizeMemorySearch({ tab: "episodes", path: "episodes/x.md" }),
    ).toEqual({
      tab: "memory",
      mode: "manager",
      path: "episodes/x.md",
    });
  });

  it("drops legacy manager task state after normalizing Manager mode", () => {
    expect(
      normalizeMemorySearch({
        tab: "user",
        managerOpen: "true",
        managerTask: "process-pending-episodes",
      }),
    ).toEqual({
      tab: "memory",
      mode: "manager",
    });
  });

  it("preserves hidden workspace state while Uploads is visible", () => {
    expect(
      normalizeMemorySearch({
        tab: "uploads",
        mode: "manager",
        entryId: "entry-1",
        managerRunId: "run-1",
      }),
    ).toEqual({
      tab: "uploads",
      mode: "manager",
      entryId: "entry-1",
      managerRunId: "run-1",
    });
  });

  it("honors explicit Manual mode while dropping legacy task state", () => {
    expect(
      normalizeMemorySearch({
        tab: "memory",
        mode: "manual",
        managerRunId: "run-1",
        managerTask: "process-pending-episodes",
      }),
    ).toEqual({
      tab: "memory",
      mode: "manual",
      managerRunId: "run-1",
    });
  });

  it("infers Manager mode for legacy run links without an explicit mode", () => {
    expect(normalizeMemorySearch({ managerRunId: "run-1" })).toEqual({
      tab: "memory",
      mode: "manager",
      managerRunId: "run-1",
    });
  });

  it("preserves valid state from a full-reload URL", () => {
    const url = new URL(
      "http://localhost:5173/a/memories?tab=episodes&entryId=episode-1&managerOpen=true",
    );

    expect(memorySearchFromUrl(url)).toEqual({
      tab: "memory",
      mode: "manager",
      entryId: "episode-1",
    });
  });

  it("opens generated episode selections in Memory Manager", () => {
    expect(modeForMemoryEntrySelection("manual", true)).toBe("manager");
    expect(modeForMemoryEntrySelection("manager", true)).toBe("manager");
    expect(modeForMemoryEntrySelection("manual", false)).toBe("manual");
  });
});

describe("dirty workspace navigation", () => {
  const memory = { pathname: "/memories", search: { tab: "memory" } };

  it("allows file, mode, and Memory-only search changes", () => {
    expect(
      shouldBlockMemoryWorkspaceExit(memory, {
        pathname: "/memories",
        search: { tab: "memory" },
      }),
    ).toBe(false);
  });

  it("blocks Uploads and other routes", () => {
    expect(
      shouldBlockMemoryWorkspaceExit(memory, {
        pathname: "/memories",
        search: { tab: "uploads" },
      }),
    ).toBe(true);
    expect(
      shouldBlockMemoryWorkspaceExit(memory, {
        pathname: "/animas",
        search: {},
      }),
    ).toBe(true);
  });
});
