import { describe, expect, it } from "vitest";

import type {
  PyMemoryEntryResponse,
  PyMemoryEntryVersionDetail,
} from "@/lib/content/catalogTypes";
import {
  memoryEntryRevertAction,
  memoryEntryRevertComparison,
} from "@/lib/memory-entries/revert-workflow";

const entry: PyMemoryEntryResponse = {
  id: "entry-1",
  scope: "user",
  type: "file",
  name: "profile.md",
  path: "profile.md",
  version: 4,
  content: "Current content",
  description: "Current description",
};

const target: PyMemoryEntryVersionDetail = {
  entry_id: entry.id,
  scope: "user",
  type: "file",
  name: entry.name,
  path: entry.path,
  version: 2,
  operation: "update",
  content: "Historical content",
  description: "Historical description",
  previous_version: 1,
  unified_diff: "",
};

describe("memory entry Revert workflow", () => {
  it("gates older editable Versions through explicit draft discard", () => {
    expect(
      memoryEntryRevertAction({
        entry,
        targetVersion: 2,
        draftDirty: false,
        draftConflict: false,
      }),
    ).toBe("confirm");
    expect(
      memoryEntryRevertAction({
        entry,
        targetVersion: 2,
        draftDirty: true,
        draftConflict: false,
      }),
    ).toBe("discard");
    expect(
      memoryEntryRevertAction({
        entry,
        targetVersion: 4,
        draftDirty: false,
        draftConflict: false,
      }),
    ).toBe("hidden");
    expect(
      memoryEntryRevertAction({
        entry: { ...entry, kind: "episode_log" },
        targetVersion: 2,
        draftDirty: false,
        draftConflict: false,
      }),
    ).toBe("hidden");
  });

  it("previews exact content and description values", () => {
    expect(memoryEntryRevertComparison(entry, target)).toEqual({
      currentContent: "Current content",
      targetContent: "Historical content",
      currentDescription: "Current description",
      targetDescription: "Historical description",
      hasChanges: true,
    });
  });
});
