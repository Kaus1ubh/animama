import { describe, expect, it } from "vitest";

import type { PyMemoryManagerApproval } from "@/lib/content/catalogTypes";
import {
  canShowMemoryManagerApprovalUndo,
  isAppliedMemoryManagerApproval,
  memoryManagerApprovalStatusLabel,
} from "@/lib/memory-manager/approval-undo";

function approval(
  update: Partial<PyMemoryManagerApproval> = {},
): PyMemoryManagerApproval {
  return {
    id: "approval-1",
    run_id: "run-1",
    status: "approved",
    can_undo: true,
    preview: {
      operation: "update",
      path: "profile.md",
      unified_diff: "",
    },
    ...update,
  };
}

describe("approval Undo presentation", () => {
  it("shows Undo only for an eligible approved patch", () => {
    expect(canShowMemoryManagerApprovalUndo(approval())).toBe(true);
    expect(
      canShowMemoryManagerApprovalUndo(approval({ can_undo: false })),
    ).toBe(false);
    expect(canShowMemoryManagerApprovalUndo(approval(), true)).toBe(false);
    expect(
      canShowMemoryManagerApprovalUndo(
        approval({ undone_at: "2026-07-16T20:00:00Z", undo_version: 3 }),
      ),
    ).toBe(false);
  });

  it("keeps the approval truthful after Undo", () => {
    expect(memoryManagerApprovalStatusLabel(approval())).toBe("Approved");
    expect(
      memoryManagerApprovalStatusLabel(
        approval({ undone_at: "2026-07-16T20:00:00Z", undo_version: 3 }),
      ),
    ).toBe("Approved · Undone");
    expect(
      memoryManagerApprovalStatusLabel(approval({ status: "rejected" })),
    ).toBe("Rejected");
  });

  it("treats only an approved change that was not undone as applied", () => {
    expect(isAppliedMemoryManagerApproval(approval())).toBe(true);
    // Undo reverts the file, so the change no longer stands.
    expect(
      isAppliedMemoryManagerApproval(
        approval({ undone_at: "2026-07-16T20:00:00Z", undo_version: 3 }),
      ),
    ).toBe(false);
    expect(
      isAppliedMemoryManagerApproval(approval({ status: "pending" })),
    ).toBe(false);
    expect(
      isAppliedMemoryManagerApproval(approval({ status: "rejected" })),
    ).toBe(false);
  });
});
