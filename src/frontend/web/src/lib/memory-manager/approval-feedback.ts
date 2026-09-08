import type { PyMemoryManagerApprovalDecisionRequest } from "@/lib/content/catalogTypes";

export const MEMORY_MANAGER_REJECTION_FEEDBACK_MAX_CHARS = 2000;

export type MemoryManagerRejectionFeedbackValidation =
  | { valid: true; feedback: string }
  | { valid: false; error: string };

/** Normalizes and validates feedback used to request a revised approval. */
export function validateMemoryManagerRejectionFeedback(
  value: string,
): MemoryManagerRejectionFeedbackValidation {
  const feedback = value.trim();
  if (!feedback) {
    return { valid: false, error: "Enter feedback before requesting changes." };
  }
  if (feedback.length > MEMORY_MANAGER_REJECTION_FEEDBACK_MAX_CHARS) {
    return {
      valid: false,
      error: `Feedback must be ${MEMORY_MANAGER_REJECTION_FEEDBACK_MAX_CHARS.toLocaleString()} characters or fewer.`,
    };
  }
  return { valid: true, feedback };
}

/** Builds the backend decision body while keeping plain rejection available. */
export function memoryManagerApprovalDecisionRequest(
  decision: "approve" | "reject",
  feedback?: string,
): PyMemoryManagerApprovalDecisionRequest {
  if (decision === "approve") {
    if (feedback?.trim()) {
      throw new Error("Feedback is only allowed when rejecting an approval.");
    }
    return { decision };
  }
  if (feedback === undefined) return { decision };
  const validated = validateMemoryManagerRejectionFeedback(feedback);
  if (!validated.valid) throw new Error(validated.error);
  return { decision, feedback: validated.feedback };
}
