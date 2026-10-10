import { getI18n } from "react-i18next";
import { SOURCE_LOCALE } from "@animama/runtime-contracts/locale";

/**
 * Wording for backend failures.
 *
 * The backend sends stable codes and parameters; the `errors` catalog words
 * them per area (`errors:<area>.<code>`). Backend English stays for logs and
 * API clients: an unworded code shows that English text in English, and a
 * translated generic message with the English as secondary detail elsewhere.
 */

/** The stable parts of an API failure. */
export type ApiErrorInfo = {
  status: number | null;
  code: string | null;
  reason: string | null;
  field: string | null;
  params: Record<string, unknown>;
  /** The backend's English detail, when it sent one. */
  message: string | null;
};

/** Text to show for a failure: `detail` is secondary technical text, if any. */
export type ApiErrorText = { message: string; detail: string | null };

/** Catalog areas holding wording for backend codes. */
export type ErrorArea =
  | "creation"
  | "loadout"
  | "contentSave"
  | "sharing"
  | "uploads"
  | "profile"
  | "modelConfiguration"
  | "webSearch";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Read a failure thrown by the generated client (`{ detail }`, `{ data: { detail } }`,
 * a string `detail`, or an `Error`).
 */
export function readApiError(error: unknown): ApiErrorInfo {
  const root = record(error);
  const envelope = record(root?.data) ?? root;
  const detail = envelope?.detail;
  const body = record(detail);
  const status =
    typeof root?.status === "number"
      ? root.status
      : typeof record(root?.response)?.status === "number"
        ? (record(root?.response)?.status as number)
        : null;
  return {
    status,
    code: text(body?.code),
    reason: text(body?.reason),
    field: text(body?.field),
    params: record(body?.params) ?? {},
    message:
      text(body?.message) ??
      text(detail) ??
      (error instanceof Error ? text(error.message) : null),
  };
}

/** Catalog wording for one code in an area, or `null` when the code is not worded. */
export function errorWording(
  area: ErrorArea,
  code: string,
  params: Record<string, unknown> = {},
): string | null {
  const i18n = getI18n();
  const key = `errors:${area}.${code}`;
  if (!i18n?.exists(key)) return null;
  // Backend codes are runtime values, so these keys cannot be typed literals.
  const translate = i18n.t as (key: string, options?: object) => string;
  return translate(key, params);
}

/**
 * The text for a failure in an area. `fallback` names the generic message used
 * when the code is not worded (default `errors:generic.unexpected`).
 */
export function apiErrorText(
  info: ApiErrorInfo,
  area: ErrorArea,
  fallback?: string,
): ApiErrorText {
  const worded =
    (info.code && errorWording(area, info.code, info.params)) ??
    (info.reason && errorWording(area, info.reason, info.params));
  if (worded) return { message: worded, detail: null };
  const i18n = getI18n();
  const english =
    (i18n?.resolvedLanguage ?? i18n?.language ?? SOURCE_LOCALE) ===
    SOURCE_LOCALE;
  if (english && info.message) return { message: info.message, detail: null };
  const translate = i18n.t as (key: string) => string;
  return {
    message: fallback ?? translate("errors:generic.unexpected"),
    detail: info.message,
  };
}

/** One string for places that show a single line: the message, then any detail. */
export function apiErrorLine({ message, detail }: ApiErrorText): string {
  return detail
    ? getI18n().t("errors:generic.withDetail", { message, detail })
    : message;
}
