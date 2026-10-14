import { getI18n } from "react-i18next";

import type {
  AnimaCreationDiagnostic,
  AnimaCreationErrorDetail,
} from "@animama/runtime-contracts/sdk";

import { apiErrorText, errorWording, type ApiErrorText } from "./apiError";
import { loadoutFailureWording } from "./loadoutErrors";

/** Issue codes the creator makes itself; their message is already interface text. */
const LOCAL_ISSUE_CODES = new Set(["draft_invalid", "validation_unavailable"]);

/**
 * Codes with several backend causes and no cause code: the backend message
 * names the cause, so it stays as secondary detail under the wording.
 */
const CAUSE_DETAIL_CODES = new Set(["anima_creation_defaults_unavailable"]);

/** Keep the backend's cause as detail for a worded multi-cause code. */
function withCause(
  code: string,
  message: string | null,
  text: ApiErrorText,
): ApiErrorText {
  return CAUSE_DETAIL_CODES.has(code) &&
    !text.detail &&
    message &&
    message !== text.message
    ? { message: text.message, detail: message }
    : text;
}

function creationText(
  code: string,
  message: string | null,
  fallback: string,
): ApiErrorText {
  return apiErrorText(
    { status: null, code, reason: null, field: null, params: {}, message },
    "creation",
    fallback,
  );
}

/**
 * Text for a failed creation request, worded from its code. An unworded code
 * keeps the backend English (as detail outside English); a multi-cause code
 * keeps it as detail in every locale.
 */
export function creationFailureText(
  detail: Pick<AnimaCreationErrorDetail, "code" | "message">,
): ApiErrorText {
  return withCause(
    detail.code,
    detail.message,
    creationText(
      detail.code,
      detail.message,
      getI18n().t("errors:creation.failed"),
    ),
  );
}

/**
 * Text for a creation issue, warning or repair diagnostic. Creation reports
 * Loadout failures with their Loadout code, so those use the Loadout wording.
 */
export function creationIssueText(
  issue: Pick<AnimaCreationDiagnostic, "code" | "message">,
): ApiErrorText {
  if (LOCAL_ISSUE_CODES.has(issue.code))
    return { message: issue.message, detail: null };
  const worded =
    errorWording("creation", issue.code) ?? loadoutFailureWording(issue.code);
  if (worded)
    return withCause(issue.code, issue.message, {
      message: worded,
      detail: null,
    });
  return creationText(
    issue.code,
    issue.message,
    getI18n().t("errors:creation.issue"),
  );
}
