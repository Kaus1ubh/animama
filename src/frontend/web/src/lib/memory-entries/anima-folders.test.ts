import { describe, expect, it } from "vitest";

import type {
  PyAnimaIdentityItem,
  PyMemoryEntryHeader,
} from "@/lib/content/catalogTypes";
import type { MemoryEntryDraft } from "./workspace-drafts";
import {
  animaFolderFiles,
  buildMemoryAnimaFolders,
  isAnimaWorkspacePath,
  isReservedUserMemoryEntry,
  animaIdForManagerPath,
  managerPathLabel,
  removedAnimaFileDrafts,
  resolveWorkspaceSelection,
} from "./anima-folders";

function header(
  animaId: string,
  file: "IDENTITY.md" | "MEMORIES.md",
  overrides: Partial<PyMemoryEntryHeader> = {},
): PyMemoryEntryHeader {
  return {
    id: `${file === "IDENTITY.md" ? "identity" : "memories"}-${animaId}`,
    anima_id: animaId,
    scope: "anima",
    type: "file",
    name: file,
    path: file,
    kind: file === "IDENTITY.md" ? "anima_identity" : "anima_memories",
    version: 1,
    metadata: {},
    ...overrides,
  };
}

function identity(
  animaId: string,
  displayName: string,
  entry: Partial<PyMemoryEntryHeader> | null = {},
  memories: Partial<PyMemoryEntryHeader> | null = {},
): PyAnimaIdentityItem {
  return {
    anima_id: animaId,
    display_name: displayName,
    aggregate_revision: 2,
    identity_status: entry ? "ready" : "repair_required",
    entry: entry ? header(animaId, "IDENTITY.md", entry) : null,
    memories_entry: memories ? header(animaId, "MEMORIES.md", memories) : null,
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
    expect(folders[2]?.identity.path).toBe("Animas/Annie (2)/IDENTITY.md");
  });

  it("holds each Anima's identity and memories under its label path", () => {
    const [annie] = buildMemoryAnimaFolders([identity("a", "Annie")]);

    expect(annie?.identity).toEqual({
      name: "IDENTITY.md",
      path: "Animas/Annie/IDENTITY.md",
      entry: expect.objectContaining({ id: "identity-a" }),
    });
    expect(annie?.memories).toEqual({
      name: "MEMORIES.md",
      path: "Animas/Annie/MEMORIES.md",
      entry: expect.objectContaining({ id: "memories-a" }),
    });
    expect(annie && animaFolderFiles(annie).map((file) => file.name)).toEqual([
      "IDENTITY.md",
      "MEMORIES.md",
    ]);
  });

  it("keeps a missing MEMORIES.md addressable independently of identity", () => {
    const [annie] = buildMemoryAnimaFolders([identity("a", "Annie", {}, null)]);

    expect(annie?.identity.entry?.id).toBe("identity-a");
    expect(annie?.memories).toEqual({
      name: "MEMORIES.md",
      path: "Animas/Annie/MEMORIES.md",
      entry: null,
    });
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
    expect(folders[0]?.identity.entry?.id).toBe("identity-a");
    expect(folders[1]).toMatchObject({
      label: "Broken",
      identity: { entry: null },
      memories: { entry: { id: "memories-b" } },
    });
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
    const entries = [
      profile,
      folders[0]!.identity.entry!,
      folders[1]!.identity.entry!,
      folders[1]!.memories.entry!,
    ];

    expect(
      resolveWorkspaceSelection({
        entries,
        folders,
        entryId: null,
        path: "Animas/Annie (2)/IDENTITY.md",
      }),
    ).toEqual({ header: folders[1]!.identity.entry, pinEntryId: true });
    expect(
      resolveWorkspaceSelection({
        entries,
        folders,
        entryId: null,
        path: "Animas/Annie (2)/MEMORIES.md",
      }),
    ).toEqual({ header: folders[1]!.memories.entry, pinEntryId: true });
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
    const selected = before[1]!.memories.entry!;

    expect(
      resolveWorkspaceSelection({
        entries: [profile, selected],
        folders: after,
        entryId: selected.id,
        path: null,
      }).header,
    ).toBe(selected);
  });

  it.each(["IDENTITY.md", "MEMORIES.md"])(
    "never resolves the stored Anima path %s as a user path",
    (path) => {
      const folders = buildMemoryAnimaFolders([identity("a", "Annie")]);
      expect(
        resolveWorkspaceSelection({
          entries: animaFolderFiles(folders[0]!).map((file) => file.entry!),
          folders,
          entryId: null,
          path,
        }).header,
      ).toBeNull();
    },
  );

  it("does not resolve the label path of a missing MEMORIES.md", () => {
    const folders = buildMemoryAnimaFolders([identity("a", "Annie", {}, null)]);
    expect(
      resolveWorkspaceSelection({
        entries: [folders[0]!.identity.entry!],
        folders,
        entryId: null,
        path: "Animas/Annie/MEMORIES.md",
      }),
    ).toEqual({ header: null, pinEntryId: false });
  });
});

describe("removed Anima file drafts", () => {
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
      "memories-b": draft("memories-b", true),
      "identity-c": draft("identity-c", false),
    };

    const result = removedAnimaFileDrafts({ previous, current, drafts });

    expect(Object.keys(result.drafts)).toEqual(["identity-a"]);
    expect(result.notices).toEqual([
      {
        entryId: "identity-b",
        label: "Caitlin",
        fileName: "IDENTITY.md",
        reason: "deleted",
      },
      {
        entryId: "memories-b",
        label: "Caitlin",
        fileName: "MEMORIES.md",
        reason: "deleted",
      },
    ]);
  });

  it("explains a dirty draft whose file now needs repair", () => {
    const previous = buildMemoryAnimaFolders([identity("a", "Annie")]);
    const current = buildMemoryAnimaFolders([
      identity("a", "Annie", null, null),
    ]);
    const result = removedAnimaFileDrafts({
      previous,
      current,
      drafts: {
        "identity-a": draft("identity-a", true),
        "memories-a": draft("memories-a", true),
      },
    });

    expect(result.drafts).toEqual({});
    expect(result.notices).toEqual([
      {
        entryId: "identity-a",
        label: "Annie",
        fileName: "IDENTITY.md",
        reason: "unavailable",
      },
      {
        entryId: "memories-a",
        label: "Annie",
        fileName: "MEMORIES.md",
        reason: "unavailable",
      },
    ]);
  });

  it("keeps an identity draft when only MEMORIES.md disappears", () => {
    const previous = buildMemoryAnimaFolders([identity("a", "Annie")]);
    const current = buildMemoryAnimaFolders([identity("a", "Annie", {}, null)]);
    const identityDraft = draft("identity-a", true);
    const result = removedAnimaFileDrafts({
      previous,
      current,
      drafts: {
        "identity-a": identityDraft,
        "memories-a": draft("memories-a", false),
      },
    });

    expect(result.drafts).toEqual({ "identity-a": identityDraft });
    expect(result.notices).toEqual([]);
  });

  it("returns the same drafts object when nothing was removed", () => {
    const folders = buildMemoryAnimaFolders([identity("a", "Annie")]);
    const drafts = {
      "identity-a": draft("identity-a", true),
      "memories-a": draft("memories-a", true),
    };
    expect(
      removedAnimaFileDrafts({ previous: folders, current: folders, drafts })
        .drafts,
    ).toBe(drafts);
  });
});

describe("Memory Manager identity paths", () => {
  it("reads the Anima ID from identity manager paths only", () => {
    expect(animaIdForManagerPath("animas/anima-1/IDENTITY.md")).toBe("anima-1");
    expect(animaIdForManagerPath("animas/anima-1/identity.md")).toBe("anima-1");
    expect(animaIdForManagerPath("animas/anima-1/notes.md")).toBeNull();
    expect(animaIdForManagerPath("PROFILE.md")).toBeNull();
  });

  it("labels identity targets with their current folder path", () => {
    const folders = buildMemoryAnimaFolders([
      identity("anima-1", "Annie"),
      identity("anima-2", "Annie"),
    ]);
    expect(managerPathLabel("animas/anima-2/IDENTITY.md", folders)).toBe(
      "Animas/Annie (2)/IDENTITY.md",
    );
    expect(managerPathLabel("animas/gone/IDENTITY.md", folders)).toBe(
      "animas/gone/IDENTITY.md",
    );
    expect(managerPathLabel("notes/a.md", folders)).toBe("notes/a.md");
  });
});
