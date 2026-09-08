export const USER_FILE_ALLOWED_EXTENSIONS = [
  ".txt",
  ".md",
  ".rst",
  ".org",
  ".json",
  ".csv",
  ".tsv",
  ".html",
  ".htm",
  ".xml",
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
] as const;

export const USER_FILE_UPLOAD_ACCEPT = USER_FILE_ALLOWED_EXTENSIONS.join(",");
export const MAX_USER_FILE_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

export const USER_FILE_UPLOAD_RESTRICTIONS = {
  allowedFileTypes: USER_FILE_ALLOWED_EXTENSIONS.map((extension) => extension),
  maxFileSize: MAX_USER_FILE_UPLOAD_SIZE_BYTES,
};

export const USER_FILE_PROCESSING_STATUSES = new Set([
  "pending_upload",
  "processing",
]);

export const USER_FILE_ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);

export function formatFileSize(sizeBytes: number | null | undefined): string {
  if (!Number.isFinite(sizeBytes) || !sizeBytes || sizeBytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"] as const;
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const formatted =
    value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}

export function formatUserFileTimestamp(value: string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function userFileStatusLabel(status: string | null | undefined) {
  if (!status) return "Unknown";
  return status.replaceAll("_", " ");
}

export function getUserFileErrorMessage(
  error: unknown,
  fallback = "Operation failed.",
) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}
