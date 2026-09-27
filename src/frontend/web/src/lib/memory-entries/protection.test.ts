import { describe, expect, it } from "vitest";

import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import {
  canDeleteMemoryEntry,
  canEditMemoryEntry,
  isAnimaIdentityEntry,
  isAnimaMemoriesEntry,
  isBlankAnimaIdentityDraft,
  isRequiredMemoryEntry,
} from "./protection";

describe("required Anima identity", () => {
  const identity: PyMemoryEntryHeader = {
    id: "identity",
    anima_id: "anima",
    scope: "anima",
    type: "file",
    name: "identity.md",
    path: "identity.md",
    version: 1,
  };

  it("protects a legacy untyped identity by its canonical path", () => {
    expect(isRequiredMemoryEntry(identity)).toBe(true);
    expect(canDeleteMemoryEntry(identity)).toBe(false);
    expect(canDeleteMemoryEntry({ ...identity, path: "IDENTITY.md" })).toBe(
      false,
    );
  });

  it("allows explicit repair of a legacy directory obstructing the reserved path", () => {
    expect(canDeleteMemoryEntry({ ...identity, type: "directory" })).toBe(true);
  });
});

describe("required Anima memories", () => {
  const memories: PyMemoryEntryHeader = {
    id: "memories",
    anima_id: "anima",
    scope: "anima",
    type: "file",
    name: "MEMORIES.md",
    path: "MEMORIES.md",
    kind: "anima_memories",
    version: 1,
  };

  it("recognizes MEMORIES.md by kind or by its Anima-scope path", () => {
    expect(isAnimaMemoriesEntry(memories)).toBe(true);
    expect(isAnimaMemoriesEntry({ ...memories, kind: null })).toBe(true);
    expect(
      isAnimaMemoriesEntry({ ...memories, kind: null, path: "memories.md" }),
    ).toBe(true);
    expect(
      isAnimaMemoriesEntry({ ...memories, scope: "user", anima_id: null }),
    ).toBe(false);
    expect(isAnimaMemoriesEntry({ ...memories, type: "directory" })).toBe(
      false,
    );
    expect(isAnimaIdentityEntry(memories)).toBe(false);
  });

  it("is editable but cannot be deleted", () => {
    expect(isRequiredMemoryEntry(memories)).toBe(true);
    expect(canEditMemoryEntry(memories)).toBe(true);
    expect(canDeleteMemoryEntry(memories)).toBe(false);
  });

  it("may be saved blank, unlike the identity", () => {
    expect(isBlankAnimaIdentityDraft(memories, "  \n")).toBe(false);
    expect(
      isBlankAnimaIdentityDraft(
        {
          ...memories,
          name: "IDENTITY.md",
          path: "IDENTITY.md",
          kind: "anima_identity",
        },
        "  \n",
      ),
    ).toBe(true);
  });
});

describe("workspace editing rules", () => {
  const user = (path: string): PyMemoryEntryHeader => ({
    id: path,
    scope: "user",
    type: "file",
    name: path,
    path,
    version: 1,
  });

  it("keeps a pre-existing reserved animas entry read-only but deletable", () => {
    expect(canEditMemoryEntry(user("animas/old.md"))).toBe(false);
    expect(canDeleteMemoryEntry(user("animas/old.md"))).toBe(true);
    expect(canEditMemoryEntry(user("notes.md"))).toBe(true);
  });

  it("recognizes Anima identity for nonblank saves", () => {
    expect(
      isAnimaIdentityEntry({
        ...user("IDENTITY.md"),
        scope: "anima",
        anima_id: "a",
        kind: "anima_identity",
      }),
    ).toBe(true);
    expect(isAnimaIdentityEntry(user("IDENTITY.md"))).toBe(false);
  });
});
