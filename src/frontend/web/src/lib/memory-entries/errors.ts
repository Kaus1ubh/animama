"use client";

import { getI18n } from "react-i18next";

import {
  apiErrorLine,
  apiErrorText,
  readApiError,
  type ApiErrorText,
} from "@/lib/errors/apiError";

/**
 * A failed memory entry request. `message` keeps the backend's English detail
 * for logs; display text comes from `memoryEntryErrorText`.
 */
export class MemoryEntryApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(
    status: number,
    detail: unknown,
    fallback = "Memory operation failed.",
  ) {
    super(readApiError(detail).message ?? fallback);
    this.name = "MemoryEntryApiError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Text for a failed memory request. Memory services send English detail
 * without codes, so English shows that detail and other locales show `generic`
 * (the translated failure of the action) with the English detail secondary.
 * `source` unwraps the response body a typed error keeps.
 */
export function memoryErrorText(
  error: unknown,
  generic: string,
  source: (error: unknown) => unknown = (value) => value,
): ApiErrorText {
  const info = readApiError(source(error));
  const message =
    info.message ??
    (typeof error === "string" && error.trim() ? error.trim() : null);
  return apiErrorText({ ...info, message }, null, generic);
}

function entryErrorSource(error: unknown): unknown {
  return error instanceof MemoryEntryApiError ? error.detail : error;
}

/** Text for a failed memory entry action; `generic` names the action that failed. */
export function memoryEntryErrorText(
  error: unknown,
  generic?: string,
): ApiErrorText {
  const t = getI18n().getFixedT(null, "memory");
  return memoryErrorText(
    error,
    generic ?? t("errors.entryFailed"),
    entryErrorSource,
  );
}

/** `memoryEntryErrorText` as one line, for toasts and single-line notices. */
export function memoryEntryErrorMessage(
  error: unknown,
  generic?: string,
): string {
  return apiErrorLine(memoryEntryErrorText(error, generic));
}

export function isMemoryEntryConflict(error: unknown): boolean {
  return error instanceof MemoryEntryApiError && error.status === 409;
}
