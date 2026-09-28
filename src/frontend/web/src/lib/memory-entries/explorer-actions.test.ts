import { describe, expect, it } from "vitest";

import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import {
  memoryExplorerProtectedRowActions,
  memoryExplorerRowActions,
} from "./explorer-actions";

function entry(
  path: string,
  type: "file" | "directory",
  overrides: Partial<PyMemoryEntryHeader> = {},
): PyMemoryEntryHeader {
  return {
    id: path,
    parent_id: null,
    scope: "user",
    type,
    name: path.split("/").at(-1) ?? path,
    path,
    version: 1,
    metadata: {},
    ...overrides,
  };
}

describe("memory explorer row actions", () => {
  it("gives ordinary files the same rename, move, and delete action order", () => {
    expect(memoryExplorerRowActions(entry("notes.md", "file"))).toEqual([
      { id: "rename", label: "Rename", separatorBefore: false },
      { id: "move", label: "Move to…" },
      {
        id: "delete",
        label: "Delete",
        destructive: true,
        separatorBefore: true,
      },
    ]);
  });

  it("lets a pre-existing reserved animas directory move out but not gain children", () => {
    expect(
      memoryExplorerRowActions(entry("animas", "directory")).map(
        (action) => action.id,
      ),
    ).toEqual(["rename", "move", "delete"]);
  });

  it("adds child creation actions to ordinary directories", () => {
    expect(
      memoryExplorerRowActions(entry("projects", "directory")).map(
        (action) => action.id,
      ),
    ).toEqual(["new-file", "new-directory", "rename", "move", "delete"]);
  });

  it("shows disabled mutation actions for generated or required files", () => {
    const protectedFileActions = [
      { id: "rename", label: "Rename", disabled: true, separatorBefore: false },
      { id: "move", label: "Move to…", disabled: true },
      {
        id: "delete",
        label: "Delete",
        disabled: true,
        destructive: true,
        separatorBefore: true,
      },
    ];

    expect(
      memoryExplorerRowActions(
        entry("episodes/2026-07-16.md", "file", { kind: "episode_log" }),
      ),
    ).toEqual(protectedFileActions);
    expect(
      memoryExplorerRowActions(
        entry("profile.md", "file", { kind: "user_profile" }),
      ),
    ).toEqual(protectedFileActions);
    for (const [path, kind] of [
      ["IDENTITY.md", "anima_identity"],
      ["MEMORIES.md", "anima_memories"],
    ]) {
      expect(
        memoryExplorerRowActions(
          entry(path, "file", { scope: "anima", anima_id: "annie", kind }),
        ),
      ).toEqual(protectedFileActions);
    }
  });

  it("shows every directory action disabled for virtual episode groups", () => {
    expect(memoryExplorerProtectedRowActions("directory")).toEqual([
      { id: "new-file", label: "New file", disabled: true },
      { id: "new-directory", label: "New directory", disabled: true },
      {
        id: "rename",
        label: "Rename",
        disabled: true,
        separatorBefore: true,
      },
      { id: "move", label: "Move to…", disabled: true },
      {
        id: "delete",
        label: "Delete",
        disabled: true,
        destructive: true,
        separatorBefore: true,
      },
    ]);
  });
});
