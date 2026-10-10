import type { RuntimeCatalogEntry } from "@/lib/runtime-content/types";
import { getI18n } from "react-i18next";

import { buildContentPreviewRuntime } from "./targets";
import type { ContentPreviewTarget } from "./types";
import { failureLine } from "@/lib/errors/apiError";

export type PreparedContentPreview = {
  target: ContentPreviewTarget;
  runtime: ReturnType<typeof buildContentPreviewRuntime>;
  entry: RuntimeCatalogEntry;
  entryKey: string;
};

/** Resolve target-local entries without performing private network access. */
export function resolveContentPreviewEntry(
  target: ContentPreviewTarget,
  privateEntry: RuntimeCatalogEntry | null = null,
): RuntimeCatalogEntry | null {
  if (target.sourceType === "resolved_entry") return target.entry;
  if (target.sourceType === "resolved_action") return target.entry;
  return privateEntry;
}

/** Materialize one exact, presentation-independent preview runtime. */
export function prepareContentPreview(
  target: ContentPreviewTarget,
  entry: RuntimeCatalogEntry,
): PreparedContentPreview {
  return {
    target,
    entry,
    runtime: buildContentPreviewRuntime(target, entry),
    entryKey: `${target.key}:${entry.content_revision}`,
  };
}

/** Normalize preparation failures for either preview presentation. */
export function contentPreviewPreparationError(error: unknown): string {
  const t = getI18n().getFixedT(null, "actionEditor");
  return failureLine(error, t("preview.errors.prepareFailed"));
}
