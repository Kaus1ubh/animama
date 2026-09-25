import { describe, expect, it } from "vitest";

import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import type { MemoryAnimaFolder } from "./anima-folders";
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

  it("keeps empty Animas and Episodes roots visible and expanded", () => {
    const tree = buildMemoryWorkspaceTree([]);

    expect(tree).toEqual([
      {
        kind: "anima-root",
        id: "virtual:animas",
        label: "Animas",
        children: [],
      },
      {
        kind: "episode-root",
        id: "virtual:episodes",
        label: "Episodes",
        children: [],
      },
    ]);
    expect([...defaultMemoryWorkspaceExpandedIds(tree)]).toEqual([
      "virtual:animas",
      "virtual:episodes",
    ]);
  });

  it("lists one protected folder per Anima above Episodes", () => {
    const identityA = entry("identity-a", "IDENTITY.md", "file", null, {
      scope: "anima",
      anima_id: "a",
      kind: "anima_identity",
    });
    const identityB = entry("identity-b", "IDENTITY.md", "file", null, {
      scope: "anima",
      anima_id: "b",
      kind: "anima_identity",
    });
    const folders: MemoryAnimaFolder[] = [
      {
        animaId: "a",
        label: "Annie",
        path: "Animas/Annie/IDENTITY.md",
        entry: identityA,
      },
      {
        animaId: "b",
        label: "Annie (2)",
        path: "Animas/Annie (2)/IDENTITY.md",
        entry: identityB,
      },
      { animaId: "c", label: "Broken", path: "", entry: null },
    ];
    const tree = buildMemoryWorkspaceTree(
      [...entries, identityA, identityB],
      "en-US",
      folders,
    );

    expect(tree.map((node) => node.label)).toEqual([
      "Animas",
      "Episodes",
      "notes",
      "profile.md",
    ]);
    const animas = tree[0];
    expect(animas?.children.map((node) => [node.id, node.label])).toEqual([
      ["virtual:animas:a", "Annie"],
      ["virtual:animas:b", "Annie (2)"],
      ["virtual:animas:c", "Broken"],
    ]);
    expect(animas?.children[1]?.children).toEqual([
      expect.objectContaining({
        kind: "file",
        id: "identity-b",
        label: "IDENTITY.md",
        displayPath: "Animas/Annie (2)/IDENTITY.md",
      }),
    ]);
    expect(animas?.children[2]?.children).toEqual([]);
    expect(memoryWorkspaceAncestorIds(tree, "identity-b")).toEqual([
      "virtual:animas",
      "virtual:animas:b",
    ]);
    expect(
      filterMemoryWorkspaceTree(tree, "annie (2)/identity")[0]?.children,
    ).toHaveLength(1);
    for (const nodeId of ["virtual:animas", "virtual:animas:a", "identity-a"]) {
      expect(
        memoryCreationTarget(findMemoryWorkspaceNode(tree, nodeId)),
      ).toEqual({ parentId: null, disabled: true });
    }
    expect(initialMemoryWorkspaceFileId([identityA, ...entries])).toBe(
      "profile",
    );
    expect(
      initialMemoryWorkspaceFileId([identityA, entry("z", "z.md", "file")]),
    ).toBe("z");
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
      ["anima-root", "Animas"],
      ["episode-root", "Episodes"],
      ["directory", "archive"],
      ["directory", "notes"],
      ["file", "profile.md"],
      ["file", "z-last.md"],
    ]);
    const episodes = tree[1];
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
      "virtual:animas",
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
    const reservedTree = buildMemoryWorkspaceTree([
      entry("reserved", "animas", "directory"),
      entry("old", "animas/old.md", "file", "reserved"),
    ]);
    for (const nodeId of ["reserved", "old"]) {
      expect(
        memoryCreationTarget(findMemoryWorkspaceNode(reservedTree, nodeId)),
      ).toEqual({ parentId: null, disabled: true });
    }
  });
});

function isEpisodeEntry(item: PyMemoryEntryHeader) {
  return item.path === "episodes" || item.path.startsWith("episodes/");
}
