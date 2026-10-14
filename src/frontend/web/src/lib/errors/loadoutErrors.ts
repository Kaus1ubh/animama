import type { PyLoadoutDiagnostic } from "@animama/runtime-contracts/api-types";

import {
  apiErrorLine,
  apiErrorText,
  errorWording,
  readApiError,
  type ApiErrorText,
} from "./apiError";

/**
 * Loadout failures carry only a code, so their wording uses the code's
 * `_failure` variant (i18next context) when the warning wording for the same
 * code needs parameters, such as `gesture_semantic_key_conflict`.
 */
const FAILURE = { context: "failure" } as const;

/** Wording for a Loadout failure code, or `null` when the code is not worded. */
export function loadoutFailureWording(code: string): string | null {
  return errorWording("loadout", code, FAILURE);
}

/**
 * Text for a failed Loadout request (plan, commit or preview). `fallback`
 * names the action that failed, such as "Review failed.".
 */
export function loadoutFailureText(
  error: unknown,
  fallback: string,
): ApiErrorText {
  const info = readApiError(error);
  return apiErrorText(
    { ...info, params: { ...info.params, ...FAILURE } },
    "loadout",
    fallback,
  );
}

/**
 * Text for a Loadout warning, worded from its code and parameters; an unworded
 * code falls back like any API failure (English detail kept secondary).
 */
export function loadoutWarningText(warning: PyLoadoutDiagnostic): string {
  return apiErrorLine(
    apiErrorText(
      {
        status: null,
        code: warning.code,
        reason: null,
        field: null,
        params: warning.params ?? {},
        message: warning.message,
      },
      "loadout",
    ),
  );
}
