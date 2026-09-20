import { describe, expect, it } from "vitest";

import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import {
  buildMemoryWorkspaceTree,
  defaultMemoryWorkspaceExpandedIds,
  filterMemoryWorkspaceTree,
  findMemoryWorkspaceNode,
  initialMemoryWorkspaceFileId,
  memoryCreationTarget,
  memoryWorkspaceAncestorIds,
} from "./workspace-tree";

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
  entry("notes", "notes", "directory"),
  entry("note", "notes/note.md", "file", "notes"),
  entry("profile", "profile.md", "file"),
  entry("episodes", "episodes", "directory"),
  entry("year", "episodes/2026", "directory", "episodes"),
  entry("month", "episodes/2026/07", "directory", "year"),
  entry("day-11", "episodes/2026/07/2026-07-11.md", "file", "month", {
    kind: "episode_log",
  }),
  entry("day-12", "episodes/2026/07/2026-07-12.md", "file", "month", {
    kind: "episode_log",
  }),
  entry("legacy", "episodes/legacy.md", "file", "episodes", {
    kind: "episode_log",
  }),
];

describe("memory workspace tree", () => {
  it.each(["PROFILE.md", "profile.md"])(
    "opens the profile first with %s spelling",
    (path) => {
      expect(
        initialMemoryWorkspaceFileId([
          entry("first", "a.md", "file"),
          entry("profile", path, "file"),
        ]),
      ).toBe("profile");
    },
  );

  it("keeps an empty Episodes root visible and expanded", () => {
    const tree = buildMemoryWorkspaceTree([]);

    expect(tree).toEqual([
      {
        kind: "episode-root",
        id: "virtual:episodes",
        label: "Episodes",
        children: [],
      },
    ]);
    expect([...defaultMemoryWorkspaceExpandedIds(tree)]).toEqual([
      "virtual:episodes",
    ]);
  });

  it("pins Episodes above sorted physical roots and preserves virtual groups", () => {
    const tree = buildMemoryWorkspaceTree(
      [
        ...entries,
        entry("archive", "archive", "directory"),
        entry("z-last", "z-last.md", "file"),
      ],
      "en-US",
    );

    expect(tree.map((node) => [node.kind, node.label])).toEqual([
      ["episode-root", "Episodes"],
      ["directory", "archive"],
      ["directory", "notes"],
      ["file", "profile.md"],
      ["file", "z-last.md"],
    ]);
    const episodes = tree[0];
    expect(episodes?.children.map((node) => node.label)).toEqual([
      "July 2026",
      "Other episodes",
    ]);
    expect(episodes?.children[0]?.children.map((node) => node.label)).toEqual([
      "July 12, 2026",
      "July 11, 2026",
    ]);
  });

  it("expands Episodes and its newest month by default", () => {
    const tree = buildMemoryWorkspaceTree(entries, "en-US");
    expect([...defaultMemoryWorkspaceExpandedIds(tree)]).toEqual([
      "virtual:episodes",
      "virtual:episodes:2026-07",
    ]);
  });

  it("retains ancestors during search and exposes expandable matches", () => {
    const tree = buildMemoryWorkspaceTree(entries, "en-US");
    const filtered = filterMemoryWorkspaceTree(tree, "July 12");

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.kind).toBe("episode-root");
    expect(filtered[0]?.children[0]?.children[0]?.id).toBe("day-12");
    expect(memoryWorkspaceAncestorIds(tree, "day-12")).toEqual([
      "virtual:episodes",
      "virtual:episodes:2026-07",
    ]);
  });

  it("selects profile, then ordinary files, then the newest episode", () => {
    expect(initialMemoryWorkspaceFileId(entries)).toBe("profile");
    expect(
      initialMemoryWorkspaceFileId(entries.filter((e) => e.id !== "profile")),
    ).toBe("note");
    expect(
      initialMemoryWorkspaceFileId(entries.filter((e) => isEpisodeEntry(e))),
    ).toBe("day-12");
  });

  it("resolves physical creation targets and protects virtual episodes", () => {
    const tree = buildMemoryWorkspaceTree(entries, "en-US");
    expect(
      memoryCreationTarget(findMemoryWorkspaceNode(tree, "notes")),
    ).toEqual({
      parentId: "notes",
      disabled: false,
    });
    expect(memoryCreationTarget(findMemoryWorkspaceNode(tree, "note"))).toEqual(
      {
        parentId: "notes",
        disabled: false,
      },
    );
    expect(
      memoryCreationTarget(findMemoryWorkspaceNode(tree, "virtual:episodes")),
    ).toEqual({ parentId: null, disabled: true });
  });
});

function isEpisodeEntry(item: PyMemoryEntryHeader) {
  return item.path === "episodes" || item.path.startsWith("episodes/");
}
