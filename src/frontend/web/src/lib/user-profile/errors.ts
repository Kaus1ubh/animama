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

function profileErrorMessage(
  code: string | null,
  reason: string | null,
  field: string | null,
  detail: ProfileErrorDetail,
): string {
  if (code === "user_profile_invalid" && field === "display_name") {
    if (reason === "required") return "Enter a display name.";
    return "Display name must be 80 characters or fewer.";
  }
  if (code === "user_profile_missing") {
    return "Your local personalization is unavailable. Try again.";
  }
  if (code === "first_run_incomplete") {
    return "Finish first-run setup before editing personalization.";
  }
  // Hosted refusals explain themselves; only these codes show the service's
  // message, so other payloads never become display text.
  if (code === "display_name_too_long") {
    const maximum = detail.max_characters;
    return (
      hostedMessage(detail) ??
      (typeof maximum === "number" && Number.isSafeInteger(maximum)
        ? `Display names can be up to ${maximum} characters.`
        : "This display name is too long.")
    );
  }
  if (code === "reauthentication_required") {
    return (
      hostedMessage(detail) ?? "Sign in again to change your display name."
    );
  }
  return reason
    ? `Could not save your personalization (${reason}).`
    : "Could not save your personalization. Try again.";
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
