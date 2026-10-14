import { getI18n } from "react-i18next";

import { ContentSaveApiError } from "@/lib/content/contentSaveErrors";
import {
  apiErrorText,
  readApiError,
  type ApiErrorText,
} from "@/lib/errors/apiError";

/**
 * A creator failure already worded for the interface: `message` is in the
 * active UI Locale and `detail` is optional secondary technical text (backend
 * or browser English). Any other error's message is developer text.
 */
export class CreatorError extends Error {
  readonly detail: string | null;

  constructor(message: string, detail: string | null = null) {
    super(message);
    this.detail = detail;
  }
}

/**
 * Text for a caught creator failure. Worded failures keep their text; any
 * other error's English is shown as is in English and as secondary detail
 * under `fallback` elsewhere, as `apiErrorText` does for unworded codes.
 */
export function creatorErrorText(
  error: unknown,
  fallback: string = getI18n().t("errors:creation.operationFailed"),
): ApiErrorText {
  if (error instanceof CreatorError)
    return { message: error.message, detail: error.detail };
  // Content Save failures are worded from their codes when they are built.
  if (error instanceof ContentSaveApiError)
    return { message: error.message, detail: null };
  return apiErrorText(readApiError(error), "creation", fallback);
}

/**
 * The Library Avatar handoff failure. An interface-text reason reads inside
 * the sentence; backend or browser English outside English stays detail.
 */
export function libraryAvatarFailureText(error: unknown): ApiErrorText {
  const t = getI18n().getFixedT(null, "create");
  const reason = creatorErrorText(error);
  return reason.detail
    ? {
        message: t("controller.libraryAvatarUnavailable"),
        detail: reason.detail,
      }
    : {
        message: t("controller.libraryAvatarUnavailableReason", {
          reason: reason.message,
        }),
        detail: null,
      };
}
