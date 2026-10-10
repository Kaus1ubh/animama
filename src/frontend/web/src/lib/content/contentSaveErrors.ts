import { getI18n } from "react-i18next";

import {
  apiErrorLine,
  errorWording,
  readApiError,
  sourceLocaleActive,
  WordedError,
} from "@/lib/errors/apiError";

export type ContentApiErrorDetail = {
  code: string | null;
  /** Creator control (`name`, `files`) or a definition JSON path. */
  field: string | null;
  reason: string | null;
  /** Backend validator message, when the failure has one. */
  message: string | null;
  details: Record<string, unknown>;
};

/** Shown when the browser could not reach the backend. */
function networkSaveMessage(): string {
  return getI18n().t("errors:contentSave.network");
}

/** Shown for a failure with no worded code. */
function unknownSaveMessage(): string {
  return getI18n().t("errors:contentSave.unexpected");
}

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

/**
 * Extract stable content error fields from direct and legacy API envelopes
 * (`{ detail }` or `{ data: { detail } }` with an object `detail`).
 */
export function parseContentApiErrorDetail(
  value: unknown,
): ContentApiErrorDetail | null {
  const root = objectValue(value);
  const detail = objectValue((objectValue(root?.data) ?? root)?.detail);
  if (!detail) return null;
  const { code, field, reason, message } = readApiError(value);
  return {
    code,
    field,
    reason,
    message,
    details: objectValue(detail.details) ?? {},
  };
}

function sentence(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

/**
 * A validation sentence with the backend's English explanation: inside the
 * sentence in English, and after the translated sentence as secondary detail
 * in other locales.
 */
function explainedMessage(
  explanation: string | null,
  explained: (cause: string) => string,
  unexplained: () => string,
): string {
  if (!explanation) return unexplained();
  if (sourceLocaleActive()) return explained(sentence(explanation));
  return apiErrorLine({ message: unexplained(), detail: explanation });
}

/** Name the definition setting by its path below `definition`, e.g. `transform.offset.x`. */
function avatarEffectDefinitionMessage(detail: ContentApiErrorDetail): string {
  const setting =
    detail.field?.replace(/^definition\.(?=.)/, "") ?? "definition";
  const t = getI18n().t;
  return explainedMessage(
    detail.message,
    (cause) =>
      t("errors:contentSave.avatarEffectSettingInvalid", { setting, cause }),
    () =>
      t("errors:contentSave.avatarEffectSettingInvalidUnexplained", {
        setting,
      }),
  );
}

/**
 * Word a Save failure from its code. A validation failure keeps the backend's
 * explanation (a technical setting path or English validator text) as detail.
 */
function contentSaveMessage(detail: ContentApiErrorDetail): string {
  if (detail.code === "content_invalid") {
    if (detail.reason === "avatar_effect_definition_invalid")
      return avatarEffectDefinitionMessage(detail);
    const t = getI18n().t;
    return explainedMessage(
      detail.message ?? detail.reason,
      (explanation) =>
        t("errors:contentSave.validationFailed", { explanation }),
      () => t("errors:contentSave.validationFailedUnexplained"),
    );
  }
  return (
    (detail.code && errorWording("contentSave", detail.code)) ??
    unknownSaveMessage()
  );
}

function isNetworkFailure(error: Error): boolean {
  return /failed to fetch|fetch failed|load failed|network(?:error| request failed)/i.test(
    error.message,
  );
}

/** Actionable failure exposed consistently by every typed content creator. */
export class ContentSaveApiError extends WordedError {
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
    return new ContentSaveApiError(status, null, unknownSaveMessage());
  }

  if (cause instanceof Error) {
    return new ContentSaveApiError(
      null,
      null,
      isNetworkFailure(cause)
        ? networkSaveMessage()
        : cause.message.trim() || unknownSaveMessage(),
    );
  }

  if (typeof cause === "string" && cause.trim()) {
    return new ContentSaveApiError(null, null, cause.trim());
  }

  return new ContentSaveApiError(null, null, unknownSaveMessage());
}
