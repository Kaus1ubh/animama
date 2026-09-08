import type { RuntimeCatalogEntry } from "@/lib/runtime-content/types";
import { buildContentPreviewRuntime } from "./targets";
import type { ContentPreviewTarget } from "./types";

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
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The selected content could not be prepared for preview.";
}
