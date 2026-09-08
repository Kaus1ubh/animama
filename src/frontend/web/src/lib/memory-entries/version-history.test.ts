import { describe, expect, it } from "vitest";

import type { PyMemoryEntryVersionSummary } from "@/lib/content/catalogTypes";
import {
  flattenMemoryEntryVersionPages,
  memoryVersionOperationLabel,
  memoryVersionSubtitle,
  memoryVersionTitle,
} from "./version-history";

function summary(
  version: number,
  operation: PyMemoryEntryVersionSummary["operation"] = "update",
): PyMemoryEntryVersionSummary {
  return {
    entry_id: "mem-1",
    scope: "user",
    type: "file",
    name: "profile.md",
    path: "profile.md",
    version,
    operation,
  };
}

describe("memory version history", () => {
  it("flattens cursor pages newest first without duplicate versions", () => {
    expect(
      flattenMemoryEntryVersionPages([
        { entry_id: "mem-1", versions: [summary(4), summary(3)] },
        { entry_id: "mem-1", versions: [summary(3), summary(2)] },
      ]).map((item) => item.version),
    ).toEqual([4, 3, 2]);
  });

  it("labels every selection as an adjacent change", () => {
    expect(memoryVersionTitle(8)).toBe("Changes in Version 8");
    expect(memoryVersionSubtitle(8)).toBe("Version 7 → Version 8");
    expect(memoryVersionSubtitle(1)).toBe("Created in Version 1");
  });

  it("uses understandable operation labels", () => {
    expect(memoryVersionOperationLabel("create")).toBe("Created");
    expect(memoryVersionOperationLabel("update")).toBe("Updated");
    expect(memoryVersionOperationLabel("move")).toBe("Moved");
    expect(memoryVersionOperationLabel("delete")).toBe("Deleted");
    expect(memoryVersionOperationLabel("undo")).toBe("Undone");
    expect(memoryVersionOperationLabel("revert")).toBe("Reverted");
  });
});
