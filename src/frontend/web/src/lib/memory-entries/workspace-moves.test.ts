import { describe, expect, it } from "vitest";

import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import type { MemoryEntryDrafts } from "@/lib/memory-entries/workspace-drafts";
import {
  canMoveMemoryEntry,
  memoryEntrySubtree,
  memoryMoveDestinations,
  memoryMovePaths,
  projectMemoryMovePath,
  rebaseMemoryEntryDraftsAfterMove,
  validateMemoryMoveDestination,
} from "./workspace-moves";

function entry(
  id: string,
  path: string,
  type: "file" | "directory",
  parentId: string | null = null,
  overrides: Partial<PyMemoryEntryHeader> = {},
): PyMemoryEntryHeader {
  return {
    id,
    parent_id: parentId,
    scope: "user",
    type,
    name: path.split("/").at(-1) ?? path,
    path,
    version: 1,
    metadata: {},
    ...overrides,
  };
}

const entries = [
  entry("archive", "archive", "directory"),
  entry("notes", "notes", "directory"),
  entry("project", "notes/project", "directory", "notes"),
  entry("draft", "notes/project/draft.md", "file", "project"),
  entry("loose", "loose.md", "file"),
  entry("profile", "profile.md", "file", null, { kind: "user_profile" }),
  entry("episodes", "episodes", "directory"),
  entry("episode", "episodes/2026-07-13.md", "file", "episodes", {
    kind: "episode_log",
  }),
];

function draft(entryId: string, { conflict = false, dirty = true } = {}) {
  return {
    entryId,
    baseVersion: 1,
    baselineContent: "saved",
    baselineDescription: "description",
    content: dirty ? "my draft" : "saved",
    description: "description",
    conflict,
  };
}

describe("memory workspace moves", () => {
  it("protects generated and required entries while allowing ordinary entries", () => {
    expect(canMoveMemoryEntry(entries[3]!)).toBe(true);
    expect(canMoveMemoryEntry(entries[5]!)).toBe(false);
    expect(canMoveMemoryEntry(entries[6]!)).toBe(false);
    expect(canMoveMemoryEntry(entries[7]!)).toBe(false);
  });

  it("rejects moves into a pre-existing reserved animas directory", () => {
    const reserved = entry("reserved", "Animas", "directory");
    expect(
      validateMemoryMoveDestination({
        source: entries[4]!,
        destination: reserved,
        entries: [...entries, reserved],
      }),
    ).toEqual({
      valid: false,
      reason: "The animas path is reserved for Anima identities.",
    });
  });

  it("collects a directory subtree from stable parent IDs", () => {
    expect(memoryEntrySubtree(entries, "notes").map((item) => item.id)).toEqual(
      ["notes", "project", "draft"],
    );
    expect(memoryEntrySubtree(entries, "missing")).toEqual([]);
  });

  it("validates root, same-parent, self, descendant, file, and ordinary destinations", () => {
    const notes = entries[1]!;
    const project = entries[2]!;
    const draftEntry = entries[3]!;
    const loose = entries[4]!;
    const foreign = entry("foreign", "foreign", "directory", null, {
      anima_id: "anima-1",
      scope: "anima",
    });

    expect(
      validateMemoryMoveDestination({
        source: draftEntry,
        destination: entries[0]!,
        entries,
      }).valid,
    ).toBe(true);
    expect(
      validateMemoryMoveDestination({
        source: draftEntry,
        destination: project,
        entries,
      }).valid,
    ).toBe(false);
    expect(
      validateMemoryMoveDestination({
        source: notes,
        destination: notes,
        entries,
      }).valid,
    ).toBe(false);
    expect(
      validateMemoryMoveDestination({
        source: draftEntry,
        destination: entries[6]!,
        entries,
      }).valid,
    ).toBe(false);
    expect(
      validateMemoryMoveDestination({
        source: draftEntry,
        destination: foreign,
        entries: [...entries, foreign],
      }).valid,
    ).toBe(false);
    expect(
      validateMemoryMoveDestination({
        source: notes,
        destination: project,
        entries,
      }).valid,
    ).toBe(false);
    expect(
      validateMemoryMoveDestination({
        source: notes,
        destination: loose,
        entries,
      }).valid,
    ).toBe(false);
    expect(
      validateMemoryMoveDestination({
        source: loose,
        destination: null,
        entries,
      }).valid,
    ).toBe(false);
    expect(
      validateMemoryMoveDestination({
        source: draftEntry,
        destination: null,
        entries,
      }).valid,
    ).toBe(true);
  });

  it("builds a root-first directory picker with invalid choices disabled", () => {
    const destinations = memoryMoveDestinations(entries, entries[3]!);

    expect(destinations.map((item) => item.path)).toEqual([
      null,
      "archive",
      "notes",
      "notes/project",
    ]);
    expect(destinations[0]?.disabled).toBe(false);
    expect(destinations.at(-1)?.disabled).toBe(true);
  });

  it("projects selected and descendant paths without touching unrelated entries", () => {
    expect(
      projectMemoryMovePath("notes/project/draft.md", "notes", "archive/notes"),
    ).toBe("archive/notes/project/draft.md");
    expect(
      projectMemoryMovePath("loose.md", "notes", "archive/notes"),
    ).toBeNull();
    expect(
      memoryMovePaths(
        memoryEntrySubtree(entries, "notes"),
        "notes",
        "archive/notes",
      ),
    ).toEqual([
      {
        entryId: "notes",
        type: "directory",
        oldPath: "notes",
        newPath: "archive/notes",
      },
      {
        entryId: "project",
        type: "directory",
        oldPath: "notes/project",
        newPath: "archive/notes/project",
      },
      {
        entryId: "draft",
        type: "file",
        oldPath: "notes/project/draft.md",
        newPath: "archive/notes/project/draft.md",
      },
    ]);
  });

  it("rebases move-only drafts while preserving content, dirty state, and existing conflicts", () => {
    const drafts: MemoryEntryDrafts = {
      draft: draft("draft"),
      loose: draft("loose"),
      project: draft("project", { dirty: false }),
    };
    const before = memoryEntrySubtree(entries, "notes");
    const refreshed = before.map((item) => ({
      ...item,
      path:
        projectMemoryMovePath(item.path, "notes", "archive/notes") ?? item.path,
      version: item.version + 1,
    }));

    const rebased = rebaseMemoryEntryDraftsAfterMove({
      drafts,
      beforeEntries: before,
      refreshedEntries: refreshed,
      oldRootPath: "notes",
      newRootPath: "archive/notes",
    });

    expect(rebased.draft).toMatchObject({
      baseVersion: 2,
      content: "my draft",
      baselineContent: "saved",
      conflict: false,
    });
    expect(rebased.loose).toBe(drafts.loose);
    expect(rebased.project).toMatchObject({
      baseVersion: 2,
      content: "saved",
      baselineContent: "saved",
      conflict: false,
    });
  });

  it("retains an existing conflict on an affected draft", () => {
    const before = memoryEntrySubtree(entries, "notes");
    const drafts = { draft: draft("draft", { conflict: true }) };
    const refreshed = before.map((item) => ({
      ...item,
      path:
        projectMemoryMovePath(item.path, "notes", "archive/notes") ?? item.path,
      version: item.version + 1,
    }));

    const rebased = rebaseMemoryEntryDraftsAfterMove({
      drafts,
      beforeEntries: before,
      refreshedEntries: refreshed,
      oldRootPath: "notes",
      newRootPath: "archive/notes",
    });

    expect(rebased.draft).toMatchObject({
      baseVersion: 2,
      content: "my draft",
      baselineContent: "saved",
      conflict: true,
    });
  });

  it("marks a dirty draft conflicted when refreshed state is not move-only", () => {
    const before = memoryEntrySubtree(entries, "notes");
    const drafts = { draft: draft("draft") };
    const refreshed = before.map((item) => ({
      ...item,
      path:
        projectMemoryMovePath(item.path, "notes", "archive/notes") ?? item.path,
      version: item.id === "draft" ? 3 : 2,
    }));

    const rebased = rebaseMemoryEntryDraftsAfterMove({
      drafts,
      beforeEntries: before,
      refreshedEntries: refreshed,
      oldRootPath: "notes",
      newRootPath: "archive/notes",
    });

    expect(rebased.draft?.baseVersion).toBe(1);
    expect(rebased.draft?.conflict).toBe(true);
  });
});
