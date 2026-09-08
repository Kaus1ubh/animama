import type { PyUserFileResponse } from "@/lib/content/catalogTypes";
import type { LibraryUploadStatus } from "@/lib/content/librarySearch";
import {
  USER_FILE_ACTIVE_JOB_STATUSES,
  USER_FILE_PROCESSING_STATUSES,
  formatFileSize,
  formatUserFileTimestamp,
  userFileStatusLabel,
} from "@/lib/user-files/uploads";

export const LIBRARY_UPLOAD_PAGE_SIZE = 48;
export const LIBRARY_UPLOAD_POLL_INTERVAL_MS = 3000;

export type LibraryUploadStatusTone =
  | "active"
  | "destructive"
  | "muted"
  | "success"
  | "warning";

export type LibraryUploadListRow = {
  key: string;
  name: string;
  extension: string;
  size: string;
  contentType: string | null;
  createdAt: string;
  chunkCount: number;
  status: string;
  statusLabel: string;
  statusTone: LibraryUploadStatusTone;
  active: boolean;
  error: string | null;
};

export type LibraryUploadViewState =
  | "loading"
  | "error"
  | "empty"
  | "no_results"
  | "ready";

function extensionLabel(value: string): string {
  const normalized = value.trim().replace(/^\./, "");
  return normalized ? normalized.toLocaleUpperCase() : "FILE";
}

function uploadStatusPresentation(
  file: PyUserFileResponse,
): Pick<LibraryUploadListRow, "active" | "statusLabel" | "statusTone"> {
  const jobStatus = file.latest_processing_job?.status;
  if (jobStatus === "queued") {
    return { active: true, statusLabel: "Queued", statusTone: "active" };
  }
  if (jobStatus === "running") {
    return { active: true, statusLabel: "Processing", statusTone: "active" };
  }

  switch (file.status) {
    case "ready":
      return { active: false, statusLabel: "Ready", statusTone: "success" };
    case "ready_keyword_only":
      return {
        active: false,
        statusLabel: "Keyword ready",
        statusTone: "warning",
      };
    case "failed":
      return {
        active: false,
        statusLabel: "Failed",
        statusTone: "destructive",
      };
    case "pending_upload":
      return {
        active: true,
        statusLabel: "Pending upload",
        statusTone: "active",
      };
    case "processing":
      return {
        active: true,
        statusLabel: "Processing",
        statusTone: "active",
      };
    case "uploaded":
      return {
        active: false,
        statusLabel: "Uploaded",
        statusTone: "muted",
      };
    default:
      return {
        active: false,
        statusLabel: userFileStatusLabel(file.status),
        statusTone: "muted",
      };
  }
}

/** Project one native Upload into compact, presentation-safe Library data. */
export function presentLibraryUpload(
  file: PyUserFileResponse,
): LibraryUploadListRow {
  const status = uploadStatusPresentation(file);
  return {
    key: `upload:${file.file_id}`,
    name: file.original_filename,
    extension: extensionLabel(file.normalized_extension),
    size: formatFileSize(file.stored_size_bytes ?? file.declared_size_bytes),
    contentType:
      file.detected_content_type ?? file.declared_content_type ?? null,
    createdAt: formatUserFileTimestamp(file.created_at),
    chunkCount: file.chunk_count ?? 0,
    status: file.status,
    statusLabel: status.statusLabel,
    statusTone: status.statusTone,
    active: status.active,
    error: file.last_error ?? file.latest_processing_job?.last_error ?? null,
  };
}

/** Filter the complete installation Upload list by its own native lifecycle. */
export function filterLibraryUploads(
  files: readonly PyUserFileResponse[],
  options: {
    query?: string;
    status: LibraryUploadStatus;
  },
): PyUserFileResponse[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  return files.filter((file) => {
    if (options.status !== "all" && file.status !== options.status) {
      return false;
    }
    if (!query) return true;
    return [
      file.original_filename,
      file.normalized_extension,
      file.detected_content_type,
      file.declared_content_type,
    ].some((value) => value?.toLocaleLowerCase().includes(query));
  });
}

/** True while backend file or processing-job state still needs polling. */
export function hasActiveLibraryUpload(
  files: readonly PyUserFileResponse[],
): boolean {
  return files.some((file) => {
    if (USER_FILE_PROCESSING_STATUSES.has(file.status)) return true;
    const jobStatus = file.latest_processing_job?.status;
    return Boolean(jobStatus && USER_FILE_ACTIVE_JOB_STATUSES.has(jobStatus));
  });
}

/** Keep the existing three-second poll only while active work exists. */
export function libraryUploadRefetchInterval(
  files: readonly PyUserFileResponse[],
  pollActive: boolean,
): number | false {
  return pollActive && hasActiveLibraryUpload(files)
    ? LIBRARY_UPLOAD_POLL_INTERVAL_MS
    : false;
}

/** Resolve mutually exclusive list states for predictable empty/error copy. */
export function libraryUploadViewState(options: {
  isPending: boolean;
  isError: boolean;
  totalCount: number;
  filteredCount: number;
}): LibraryUploadViewState {
  if (options.isPending) return "loading";
  if (options.isError) return "error";
  if (options.totalCount === 0) return "empty";
  if (options.filteredCount === 0) return "no_results";
  return "ready";
}
