import { getI18n } from "react-i18next";

import { apiErrorText } from "@/lib/errors/apiError";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/user-profile/display-name";

type ProfileErrorDetail = {
  code?: unknown;
  /** Hosted denials repeat their code here for compatibility. */
  error?: unknown;
  field?: unknown;
  reason?: unknown;
  /** A short user-facing sentence from a hosted denial. */
  message?: unknown;
  max_characters?: unknown;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function profileErrorDetail(value: unknown): ProfileErrorDetail {
  const envelope = objectValue(value);
  const detail = objectValue(envelope?.detail) ?? envelope;
  return detail ?? {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** The hosted denial's own message, bounded for display. */
function hostedMessage(detail: ProfileErrorDetail): string | null {
  return stringValue(detail.message)?.trim().slice(0, 200) ?? null;
}

/**
 * A hosted denial that lacks the parameters for its wording: the service's own
 * English message in English, otherwise `fallback`.
 */
function hostedText(detail: ProfileErrorDetail, fallback: string): string {
  return apiErrorText(
    {
      status: null,
      code: null,
      reason: null,
      field: null,
      params: {},
      message: hostedMessage(detail),
    },
    "profile",
    fallback,
  ).message;
}

function profileErrorMessage(
  code: string | null,
  reason: string | null,
  field: string | null,
  detail: ProfileErrorDetail,
): string {
  const t = getI18n().t;
  if (code === "user_profile_invalid" && field === "display_name") {
    if (reason === "required") return t("errors:profile.displayNameRequired");
    return t("errors:profile.displayNameLimit", {
      count: DISPLAY_NAME_MAX_LENGTH,
    });
  }
  if (code === "user_profile_missing") {
    return t("errors:profile.user_profile_missing");
  }
  if (code === "first_run_incomplete") {
    return t("errors:profile.first_run_incomplete");
  }
  // Hosted refusals are worded from their code and limit; only these codes
  // fall back to the service's message, so other payloads never become
  // display text.
  if (code === "display_name_too_long") {
    const maximum = detail.max_characters;
    return typeof maximum === "number" && Number.isSafeInteger(maximum)
      ? t("errors:profile.display_name_too_long", { count: maximum })
      : hostedText(detail, t("errors:profile.displayNameTooLong"));
  }
  if (code === "reauthentication_required") {
    return t("errors:profile.reauthentication_required");
  }
  return reason
    ? t("errors:profile.saveFailedReason", { reason })
    : t("errors:profile.saveFailed");
}

/** Preserve the stable FastAPI profile error contract for UI field handling. */
export class UserProfileApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly field: string | null;
  readonly reason: string | null;

  constructor(status: number, payload: unknown) {
    const detail = profileErrorDetail(payload);
    const code = stringValue(detail.code) ?? stringValue(detail.error);
    const field = stringValue(detail.field);
    const reason = stringValue(detail.reason);
    super(profileErrorMessage(code, reason, field, detail));
    this.name = "UserProfileApiError";
    this.status = status;
    this.code = code;
    this.field = field;
    this.reason = reason;
  }
}
