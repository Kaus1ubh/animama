import { getI18n } from "react-i18next";

import {
  apiErrorLine,
  readApiError,
  type ApiErrorText,
} from "@/lib/errors/apiError";
import { memoryErrorText } from "@/lib/memory-entries/errors";

/**
 * A failed Memory Manager request. `message` keeps the backend's English
 * detail for logs; display text comes from `memoryManagerErrorText`.
 */
export class MemoryManagerApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(
    status: number,
    detail: unknown,
    fallback = "Memory manager operation failed.",
  ) {
    super(readApiError(detail).message ?? fallback);
    this.name = "MemoryManagerApiError";
    this.status = status;
    this.detail = detail;
  }
}

function managerErrorSource(error: unknown): unknown {
  return error instanceof MemoryManagerApiError ? error.detail : error;
}

/**
 * Text for a failed Memory Manager action: the backend's English detail in
 * English, else `generic` with that detail secondary.
 */
export function memoryManagerErrorText(
  error: unknown,
  generic?: string,
): ApiErrorText {
  const t = getI18n().getFixedT(null, "memory");
  return memoryErrorText(
    error,
    generic ?? t("errors.managerFailed"),
    managerErrorSource,
  );
}

/** `memoryManagerErrorText` as one line, for toasts and single-line notices. */
export function memoryManagerErrorMessage(
  error: unknown,
  generic?: string,
): string {
  return apiErrorLine(memoryManagerErrorText(error, generic));
}
