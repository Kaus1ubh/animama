import { getI18n } from "react-i18next";

import { parseContentApiErrorDetail } from "@/lib/content/contentSaveErrors";
import { errorWording } from "@/lib/errors/apiError";

/** The message for a failure, naming the display names the server attached. */
function sharingErrorText(code: string, items: readonly string[]): string {
  if (!items.length) return sharingMessage(code);
  return code === "package_non_portable"
    ? getI18n().t("errors:sharing.nonPortableItems", { items })
    : getI18n().t("errors:sharing.withItems", {
        message: sharingMessage(code),
        items,
      });
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
export function sharingErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
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
