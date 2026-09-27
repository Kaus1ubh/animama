import type { PyMemoryManagerApproval } from "@/lib/content/catalogTypes";

export function memoryManagerApprovalStatusLabel(
  approval: PyMemoryManagerApproval,
) {
  if (approval.status === "pending") return "Pending review";
  if (approval.status === "rejected") return "Rejected";
  return isAppliedMemoryManagerApproval(approval)
    ? "Approved"
    : "Approved · Undone";
}

/** An approved change still stands until it is undone. */
export function isAppliedMemoryManagerApproval(
  approval: PyMemoryManagerApproval,
) {
  return (
    approval.status === "approved" &&
    !approval.undone_at &&
    !approval.undo_version
  );
}

export function canShowMemoryManagerApprovalUndo(
  approval: PyMemoryManagerApproval,
  requestRunning = false,
) {
  return (
    !requestRunning &&
    approval.can_undo === true &&
    isAppliedMemoryManagerApproval(approval)
  );
}
