import type { PyMemoryManagerApproval } from "@/lib/content/catalogTypes";

export function memoryManagerApprovalStatusLabel(
  approval: PyMemoryManagerApproval,
) {
  if (approval.status === "pending") return "Pending review";
  if (approval.status === "rejected") return "Rejected";
  return approval.undone_at || approval.undo_version
    ? "Approved · Undone"
    : "Approved";
}

export function canShowMemoryManagerApprovalUndo(
  approval: PyMemoryManagerApproval,
  requestRunning = false,
) {
  return (
    !requestRunning &&
    approval.status === "approved" &&
    approval.can_undo === true &&
    !approval.undone_at &&
    !approval.undo_version
  );
}
