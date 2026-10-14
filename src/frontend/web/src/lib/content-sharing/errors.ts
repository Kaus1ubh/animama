import { getI18n } from "react-i18next";

import { parseContentApiErrorDetail } from "@/lib/content/contentSaveErrors";
import { errorWording, failureLine } from "@/lib/errors/apiError";

/**
 * The message for a failure, naming the display names the server attached.
 * A code whose advice differs when it names items (such as opening each named
 * item in its creator) has its own named form; without names the code's own
 * wording applies (an import refusal names no items the importer could open).
 */
function sharingErrorText(code: string, items: readonly string[]): string {
  if (!items.length) return sharingMessage(code);
  switch (code) {
    case "package_non_portable":
      return getI18n().t("errors:sharing.nonPortableItems", { items });
    case "package_dependency_missing":
      return getI18n().t("errors:sharing.dependencyMissingItems", { items });
    case "scene_emoji_item_removed":
      return getI18n().t("errors:sharing.sceneEmojiItems", { items });
    default:
      return getI18n().t("errors:sharing.withItems", {
        message: sharingMessage(code),
        items,
      });
  }
}

/** Retain an HTTP classification without exposing private backend error details. */
export class SharingError extends Error {
  readonly code: string;
  readonly status: number | null;
  /** Display names the server attached, such as items that cannot be exported. */
  readonly items: readonly string[];
  constructor(
    code: string,
    status: number | null = null,
    items: readonly string[] = [],
  ) {
    super(sharingErrorText(code, items));
    this.code = code;
    this.status = status;
    this.items = items;
  }
}

/** Wording for a package operation code (`errors:sharing.<code>`), with a generic fallback. */
export function sharingMessage(code: string): string {
  return (
    errorWording("sharing", code) ?? getI18n().t("errors:sharing.unexpected")
  );
}
/**
 * One line for a package failure: a worded failure as it is, other English
 * primary in English and secondary detail elsewhere (`failureLine`).
 */
export function sharingErrorMessage(error: unknown): string {
  if (error instanceof SharingError) return error.message;
  if (error instanceof Error)
    return failureLine(error, getI18n().t("errors:sharing.unexpected"));
  const code = parseContentApiErrorDetail(error)?.code;
  return code
    ? sharingMessage(code)
    : getI18n().t("errors:sharing.package_transport_unavailable");
}

/** An already removed temporary cache needs no further deletion. Other failures retain recovery. */
export function isAbsentPackageStage(error: unknown): boolean {
  return (
    error instanceof SharingError &&
    ["package_stage_unavailable", "package_export_unavailable"].includes(
      error.code,
    )
  );
}
