"use client";

type ErrorDetail = {
  detail?: unknown;
  message?: unknown;
};

export class MemoryEntryApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(
    status: number,
    detail: unknown,
    fallback = "Memory operation failed.",
  ) {
    super(memoryEntryErrorMessage(detail, fallback));
    this.name = "MemoryEntryApiError";
    this.status = status;
    this.detail = detail;
  }
}

function isErrorDetail(value: unknown): value is ErrorDetail {
  return typeof value === "object" && value !== null;
}

export function memoryEntryErrorMessage(
  error: unknown,
  fallback = "Memory operation failed.",
): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (isErrorDetail(error)) {
    const detail = error.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
    const message = error.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
}

export function isMemoryEntryConflict(error: unknown): boolean {
  return error instanceof MemoryEntryApiError && error.status === 409;
}
