export type ContentApiErrorDetail = {
  code: string | null;
  field: string | null;
  reason: string | null;
  details: Record<string, unknown>;
};

const NETWORK_SAVE_MESSAGE =
  "Animama could not be reached. Check that the local stack is running, then retry. Your draft is preserved.";
const UNKNOWN_SAVE_MESSAGE =
  "Animama encountered an unexpected error while saving. Your draft is preserved; retry or check the backend logs.";

const CONTENT_SAVE_MESSAGES: Record<string, string> = {
  catalog_revision_conflict:
    "This item changed since you opened it. Reload the latest version before saving. Your draft is preserved.",
  content_path_exists:
    "Another item already uses this name. Choose a different name and try again. Your draft is preserved.",
  invalid_entry_name:
    "Use a name containing letters, numbers, spaces, periods, underscores, or hyphens. Your draft is preserved.",
  content_path_invalid:
    "Use a name containing letters, numbers, spaces, periods, underscores, or hyphens. Your draft is preserved.",
  content_file_empty:
    "The selected file is empty. Choose a valid exported file. Your draft is preserved.",
  content_file_too_large:
    "The selected file exceeds the supported size limit. Reduce its size and retry. Your draft is preserved.",
  content_entry_too_large:
    "The combined files exceed the supported entry size. Remove or reduce companion files. Your draft is preserved.",
  duplicate_companion_path:
    "Two files would be saved to the same path. Rename one of them and retry. Your draft is preserved.",
  unsupported_standalone_extension:
    "This file type is not supported for this content kind. Choose a supported export format. Your draft is preserved.",
  standalone_extension_change_requires_new_item:
    "Changing the primary file type requires saving this as a new item. Your draft is preserved.",
  content_not_found:
    "The original item no longer exists. Return to the Library or save this draft as a new item. Your draft is preserved.",
  content_destination_mismatch:
    "This draft no longer matches the original item. Reload the item before saving. Your draft is preserved.",
  saved_content_invalid:
    "The saved files did not produce a valid content item. Correct the source and retry. Your draft is preserved.",
  descriptor_not_supported:
    "This creator produced descriptor data that the content kind does not support. Your draft is preserved; retry or check the backend logs.",
  standalone_requires_one_file:
    "This content kind requires exactly one primary file. Choose a single file and retry. Your draft is preserved.",
  invalid_companion_paths:
    "One or more companion file paths are invalid. Rename the affected files and retry. Your draft is preserved.",
  content_metadata_too_large:
    "The item details exceed the supported size limit. Shorten the description or configuration and retry. Your draft is preserved.",
  content_descriptor_too_large:
    "The content definition exceeds the supported size limit. Simplify it and retry. Your draft is preserved.",
};

const CONTENT_SAVE_FIELDS: Record<string, string> = {
  content_path_exists: "name",
  invalid_entry_name: "name",
  content_file_empty: "files",
  content_file_too_large: "files",
  content_entry_too_large: "files",
  duplicate_companion_path: "files",
  unsupported_standalone_extension: "files",
  standalone_extension_change_requires_new_item: "files",
  standalone_requires_one_file: "files",
  invalid_companion_paths: "files",
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Extract stable content error fields from direct and legacy API envelopes. */
export function parseContentApiErrorDetail(
  value: unknown,
): ContentApiErrorDetail | null {
  const root = objectValue(value);
  if (!root) return null;
  const data = objectValue(root.data);
  const envelope = data ?? root;
  const detail = objectValue(envelope.detail);
  if (!detail) return null;
  return {
    code: stringValue(detail.code),
    field: stringValue(detail.field),
    reason: stringValue(detail.reason),
    details: objectValue(detail.details) ?? {},
  };
}

function sentence(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function contentSaveMessage(detail: ContentApiErrorDetail): string {
  if (detail.code === "content_invalid") {
    const reason = detail.reason
      ? `Content validation failed: ${sentence(detail.reason)}`
      : "The content did not pass validation.";
    return `${reason} Correct the source and retry. Your draft is preserved.`;
  }
  return detail.code
    ? (CONTENT_SAVE_MESSAGES[detail.code] ?? UNKNOWN_SAVE_MESSAGE)
    : UNKNOWN_SAVE_MESSAGE;
}

function isNetworkFailure(error: Error): boolean {
  return /failed to fetch|fetch failed|load failed|network(?:error| request failed)/i.test(
    error.message,
  );
}

/** Actionable failure exposed consistently by every typed content creator. */
export class ContentSaveApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly reason: string | null;
  readonly details: Record<string, unknown>;
  /** Canonical creator control associated with the failure, when known. */
  readonly field: string | null;

  constructor(
    status: number | null,
    code: string | null,
    message: string,
    reason: string | null = null,
    details: Record<string, unknown> = {},
    field: string | null = null,
  ) {
    super(message);
    this.name = "ContentSaveApiError";
    this.status = status;
    this.code = code;
    this.reason = reason;
    this.details = details;
    this.field = field;
  }
}

/** Build a local creator failure that points at one corrective control. */
export function contentSaveFieldError(
  message: string,
  field: string,
): ContentSaveApiError {
  return new ContentSaveApiError(null, null, message, null, {}, field);
}

/** Normalize generated-client, browser, and legacy Save failures once. */
export function toContentSaveApiError(
  cause: unknown,
  status: number | null = null,
): ContentSaveApiError {
  if (cause instanceof ContentSaveApiError) return cause;

  const detail = parseContentApiErrorDetail(cause);
  if (detail) {
    return new ContentSaveApiError(
      status,
      detail.code,
      contentSaveMessage(detail),
      detail.reason,
      detail.details,
      detail.field ??
        (detail.code ? (CONTENT_SAVE_FIELDS[detail.code] ?? null) : null),
    );
  }

  if (status !== null) {
    return new ContentSaveApiError(status, null, UNKNOWN_SAVE_MESSAGE);
  }

  if (cause instanceof Error) {
    return new ContentSaveApiError(
      null,
      null,
      isNetworkFailure(cause)
        ? NETWORK_SAVE_MESSAGE
        : cause.message.trim() || UNKNOWN_SAVE_MESSAGE,
    );
  }

  if (typeof cause === "string" && cause.trim()) {
    return new ContentSaveApiError(null, null, cause.trim());
  }

  return new ContentSaveApiError(null, null, UNKNOWN_SAVE_MESSAGE);
}
