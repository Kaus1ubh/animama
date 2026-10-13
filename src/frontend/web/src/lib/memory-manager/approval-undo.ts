import { getI18n } from "react-i18next";

import type { PyMemoryManagerApproval } from "@/lib/content/catalogTypes";

/** Status badge text for an approval, worded in the active UI Locale. */
export function memoryManagerApprovalStatusLabel(
  approval: PyMemoryManagerApproval,
) {
  const t = getI18n().getFixedT(null, "memory");
  if (approval.status === "pending")
    return t("manager.approval.status.pending");
  if (approval.status === "rejected")
    return t("manager.approval.status.rejected");
  return isAppliedMemoryManagerApproval(approval)
    ? t("manager.approval.status.approved")
    : t("manager.approval.status.approvedUndone");
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
