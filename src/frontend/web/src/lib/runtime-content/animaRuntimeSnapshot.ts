import type { RuntimeCatalogEntry } from "./types";
import { normalizeRuntimeImagePresentation } from "./imagePresentation";

/** Resolve the primary file URL for one internal avatar-player entry. */
export function runtimeContentEntryUrl(
  entry: RuntimeCatalogEntry | null | undefined,
): string | null {
  if (!entry) return null;
  if (entry.source.type === "public_url") return entry.source.url;
  if (entry.source.type === "runtime_catalog") return null;
  const preferred =
    entry.source.files.find((file) => file.role === "model") ??
    entry.source.files.find((file) => file.role === "animation") ??
    entry.source.files.find((file) => file.role === "manifest") ??
    entry.source.files.find((file) => file.role === "audio") ??
    entry.source.files.find((file) => file.role === "image") ??
    entry.source.files[0];
  return preferred?.url ?? null;
}

/** Stable identity for abort/disposal ownership in the avatar player. */
export function runtimeContentEntryLoadKey(
  effectiveRevision: string,
  entry: RuntimeCatalogEntry | null | undefined,
): string | null {
  return entry
    ? `${effectiveRevision}:${entry.slot}:${entry.runtime_id}:${entry.content_revision}`
    : null;
}

/** Project the selected image lane without exposing storage details. */
export function runtimeImagePresentation(
  entry: RuntimeCatalogEntry | null | undefined,
) {
  return normalizeRuntimeImagePresentation(entry?.config);
}
