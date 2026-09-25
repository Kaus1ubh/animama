import { describe, expect, it } from "vitest";

import type {
  PyAnimaIdentityItem,
  PyMemoryEntryHeader,
} from "@/lib/content/catalogTypes";
import type { MemoryEntryDraft } from "./workspace-drafts";
import {
  buildMemoryAnimaFolders,
  isAnimaWorkspacePath,
  isReservedUserMemoryEntry,
  removedIdentityDrafts,
  resolveWorkspaceSelection,
} from "./anima-folders";

function identity(
  animaId: string,
  displayName: string,
  entry: Partial<PyMemoryEntryHeader> | null = {},
): PyAnimaIdentityItem {
  return {
    anima_id: animaId,
    display_name: displayName,
    aggregate_revision: 2,
    identity_status: entry ? "ready" : "repair_required",
    entry: entry
      ? {
          id: `identity-${animaId}`,
          anima_id: animaId,
          scope: "anima",
          type: "file",
          name: "IDENTITY.md",
          path: "IDENTITY.md",
          kind: "anima_identity",
          version: 1,
          metadata: {},
          ...entry,
        }
      : null,
  };
}

describe("Anima memory folders", () => {
  it("keeps creation order and suffixes duplicate names", () => {
    const folders = buildMemoryAnimaFolders([
      identity("a", "Annie"),
      identity("b", "Caitlin"),
      identity("c", "Annie"),
      identity("d", "Annie"),
    ]);

    expect(folders.map((folder) => [folder.animaId, folder.label])).toEqual([
      ["a", "Annie"],
      ["b", "Caitlin"],
      ["c", "Annie (2)"],
      ["d", "Annie (3)"],
    ]);
    expect(folders[2]?.path).toBe("Animas/Annie (2)/IDENTITY.md");
  });

  it("never gives a duplicate a label that another Anima really uses", () => {
    const folders = buildMemoryAnimaFolders([
      identity("a", "Annie"),
      identity("b", "Annie"),
      identity("c", "Annie (2)"),
    ]);

    expect(folders.map((folder) => folder.label)).toEqual([
      "Annie",
      "Annie (3)",
      "Annie (2)",
    ]);
  });

  it("follows renames and keeps missing identities visible", () => {
    const folders = buildMemoryAnimaFolders([
      identity("a", "  Annie Two  "),
      identity("b", "Broken", null),
    ]);

    expect(folders[0]?.label).toBe("Annie Two");
    expect(folders[0]?.entry?.id).toBe("identity-a");
    expect(folders[1]).toMatchObject({ label: "Broken", entry: null });
  });

  it("recognizes the reserved user-scope animas path", () => {
    const user = (path: string): PyMemoryEntryHeader => ({
      id: path,
      scope: "user",
      type: "file",
      name: path,
      path,
      version: 1,
      metadata: {},
    });
    expect(isReservedUserMemoryEntry(user("Animas"))).toBe(true);
    expect(isReservedUserMemoryEntry(user("animas/old.md"))).toBe(true);
    expect(isReservedUserMemoryEntry(user("animals.md"))).toBe(false);
    expect(isReservedUserMemoryEntry(user("notes/animas.md"))).toBe(false);
    expect(
      isReservedUserMemoryEntry({ ...user("animas"), scope: "anima" }),
    ).toBe(false);
  });

  it("identifies workspace label paths", () => {
    expect(isAnimaWorkspacePath("Animas/Annie/IDENTITY.md")).toBe(true);
    expect(isAnimaWorkspacePath("animas/old.md")).toBe(false);
    expect(isAnimaWorkspacePath(null)).toBe(false);
  });
});

function draft(entryId: string, dirty: boolean): MemoryEntryDraft {
  return {
    entryId,
    baseVersion: 1,
    baselineContent: "base",
    baselineDescription: "",
    content: dirty ? "edited" : "base",
    description: "",
    conflict: false,
  };
}

describe("workspace identity selection", () => {
  const profile: PyMemoryEntryHeader = {
    id: "profile",
    scope: "user",
    type: "file",
    name: "PROFILE.md",
    path: "PROFILE.md",
    version: 1,
    metadata: {},
  };

  it("pins a label-path selection to the identity entry ID", () => {
    const folders = buildMemoryAnimaFolders([
      identity("a", "Annie"),
      identity("b", "Annie"),
    ]);
    const entries = [profile, folders[0]!.entry!, folders[1]!.entry!];

    expect(
      resolveWorkspaceSelection({
        entries,
        folders,
        entryId: null,
        path: "Animas/Annie (2)/IDENTITY.md",
      }),
    ).toEqual({ header: folders[1]!.entry, pinEntryId: true });
    expect(
      resolveWorkspaceSelection({
        entries,
        folders,
        entryId: null,
        path: "PROFILE.md",
      }),
    ).toEqual({ header: profile, pinEntryId: false });
  });

  it("keeps an entry-ID selection across renames and label shifts", () => {
    const before = buildMemoryAnimaFolders([
      identity("a", "Annie"),
      identity("b", "Annie"),
    ]);
    const after = buildMemoryAnimaFolders([identity("b", "Annie")]);
    const selected = before[1]!.entry!;

    expect(
      resolveWorkspaceSelection({
        entries: [profile, selected],
        folders: after,
        entryId: selected.id,
        path: null,
      }).header,
    ).toBe(selected);
  });

  it("never resolves identity stored paths as user paths", () => {
    const folders = buildMemoryAnimaFolders([identity("a", "Annie")]);
    expect(
      resolveWorkspaceSelection({
        entries: [folders[0]!.entry!],
        folders,
        entryId: null,
        path: "IDENTITY.md",
      }).header,
    ).toBeNull();
  });
});

describe("removed identity drafts", () => {
  it("drops drafts for deleted Animas and reports only dirty ones", () => {
    const previous = buildMemoryAnimaFolders([
      identity("a", "Annie"),
      identity("b", "Caitlin"),
      identity("c", "Mika"),
    ]);
    const current = buildMemoryAnimaFolders([
      identity("a", "Annie"),
      identity("c", "Mika", null),
    ]);
    const drafts = {
      "identity-a": draft("identity-a", true),
      "identity-b": draft("identity-b", true),
      "identity-c": draft("identity-c", false),
    };

    const result = removedIdentityDrafts({ previous, current, drafts });

    expect(Object.keys(result.drafts)).toEqual(["identity-a"]);
    expect(result.notices).toEqual([
      { entryId: "identity-b", label: "Caitlin", reason: "deleted" },
    ]);
  });

  it("explains a dirty draft whose identity now needs repair", () => {
    const previous = buildMemoryAnimaFolders([identity("a", "Annie")]);
    const current = buildMemoryAnimaFolders([identity("a", "Annie", null)]);
    const result = removedIdentityDrafts({
      previous,
      current,
      drafts: { "identity-a": draft("identity-a", true) },
    });

    expect(result.drafts).toEqual({});
    expect(result.notices).toEqual([
      { entryId: "identity-a", label: "Annie", reason: "unavailable" },
    ]);
  });

  it("returns the same drafts object when nothing was removed", () => {
    const folders = buildMemoryAnimaFolders([identity("a", "Annie")]);
    const drafts = { "identity-a": draft("identity-a", true) };
    expect(
      removedIdentityDrafts({ previous: folders, current: folders, drafts })
        .drafts,
    ).toBe(drafts);
  });
});
