import { parseContentApiErrorDetail } from "@/lib/content/contentSaveErrors";

/** Retain an HTTP classification without exposing private backend error details. */
export class SharingError extends Error {
  readonly code: string;
  readonly status: number | null;
  constructor(code: string, status: number | null = null) {
    super(sharingMessage(code));
    this.code = code;
    this.status = status;
  }
}

const messages: Record<string, string> = {
  package_transport_unavailable:
    "Animama could not be reached. Check the local app and retry.",
  package_invalid:
    "This file is not a supported .animama package. Ask its creator to export it again.",
  package_request_invalid:
    "This package request is invalid. Review your selection and try again.",
  package_stage_expired:
    "This import review expired. Discard it and choose the file again.",
  package_export_expired:
    "This export expired. Go back and prepare a new review.",
  package_stage_unavailable:
    "This import is no longer available. Check its result before starting again.",
  package_export_unavailable:
    "This export is no longer available. Go back and prepare a new review.",
  package_destination_changed:
    "Your Library changed. Refresh the import review to see the new names before importing.",
  package_prerequisite_changed:
    "Anima settings changed. Refresh the review before importing.",
  package_review_mismatch:
    "The review changed. Refresh it and check the contents before importing.",
  package_export_source_changed:
    "Selected content changed. Refresh the summary and review it again.",
  package_stage_disk_full:
    "There is not enough disk space for this package. Free some space and retry.",
  package_disk_full:
    "There is not enough disk space for this package. Free some space and retry.",
  package_stage_quota:
    "Other package operations are using the temporary storage limit. Close their reviews or try again later.",
  package_stage_limit:
    "Two package operations are already open. Close an earlier review or wait for its cache to expire, then retry.",
  package_part_changed:
    "This file differs from the interrupted upload. Choose the original file or discard this import.",
  package_size_invalid:
    "This package exceeds the supported size or file count. Export fewer items at a time.",
  package_stage_active:
    "This package is still being processed. Check its progress again shortly.",
  package_name_exhausted:
    "An imported name cannot be suffixed safely. Rename the source content and export it again.",
  package_anima_import_unavailable:
    "Anima creation is not ready on this installation. Check the default model settings, then refresh the review.",
};

export function sharingMessage(code: string): string {
  return (
    messages[code] ??
    "Animama could not finish this package operation. Your selection is preserved; retry or review the file again."
  );
}
export function sharingErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const code = parseContentApiErrorDetail(error)?.code;
  return code
    ? sharingMessage(code)
    : "Animama could not be reached. Check the local app and retry.";
}

/** An already removed temporary cache needs no further deletion. Other failures retain recovery. */
export function isAbsentPackageStage(error: unknown): boolean {
  return (
    error instanceof SharingError &&
    ["package_stage_unavailable", "package_export_unavailable"].includes(
      error.code,
    )
  );
}
