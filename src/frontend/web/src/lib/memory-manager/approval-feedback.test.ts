import { describe, expect, it } from "vitest";

import {
  MEMORY_MANAGER_REJECTION_FEEDBACK_MAX_CHARS,
  memoryManagerApprovalDecisionRequest,
  validateMemoryManagerRejectionFeedback,
} from "./approval-feedback";

describe("memory manager rejection feedback", () => {
  it("trims valid feedback for general and episode-processing approvals", () => {
    expect(
      validateMemoryManagerRejectionFeedback(
        "  Keep this in projects/animama.md instead.  ",
      ),
    ).toEqual({
      valid: true,
      feedback: "Keep this in projects/animama.md instead.",
    });
  });

  it("requires nonblank feedback when requesting changes", () => {
    expect(validateMemoryManagerRejectionFeedback(" \n ")).toMatchObject({
      valid: false,
    });
  });

  it("enforces the backend feedback limit", () => {
    expect(
      validateMemoryManagerRejectionFeedback(
        "a".repeat(MEMORY_MANAGER_REJECTION_FEEDBACK_MAX_CHARS),
      ),
    ).toMatchObject({ valid: true });
    expect(
      validateMemoryManagerRejectionFeedback(
        "a".repeat(MEMORY_MANAGER_REJECTION_FEEDBACK_MAX_CHARS + 1),
      ),
    ).toMatchObject({ valid: false });
  });

  it("builds plain and feedback-aware rejection requests", () => {
    expect(memoryManagerApprovalDecisionRequest("reject")).toEqual({
      decision: "reject",
    });
    expect(
      memoryManagerApprovalDecisionRequest(
        "reject",
        "  Use projects/animama.md.  ",
      ),
    ).toEqual({
      decision: "reject",
      feedback: "Use projects/animama.md.",
    });
    expect(memoryManagerApprovalDecisionRequest("approve")).toEqual({
      decision: "approve",
    });
    expect(() =>
      memoryManagerApprovalDecisionRequest("approve", "Not allowed"),
    ).toThrow("only allowed when rejecting");
  });
});
