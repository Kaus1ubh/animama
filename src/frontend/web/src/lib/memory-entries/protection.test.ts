import { describe, expect, it } from "vitest";

import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import {
  canDeleteMemoryEntry,
  canEditMemoryEntry,
  isAnimaIdentityEntry,
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
