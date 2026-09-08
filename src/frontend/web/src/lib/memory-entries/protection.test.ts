import { describe, expect, it } from "vitest";

import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import { canDeleteMemoryEntry, isRequiredMemoryEntry } from "./protection";

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
