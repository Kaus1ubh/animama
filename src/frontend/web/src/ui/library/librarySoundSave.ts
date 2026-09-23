import type { CatalogSaveInput } from "@/lib/content/catalogApi";
import type { PyCatalogViewItem } from "@/lib/content/catalogTypes";

/** Rename/replacement updates the same Local identity and never drops hidden metadata. */
export function librarySoundSaveInput(
  item: PyCatalogViewItem,
  name: string,
  file: File,
  operationId: string,
): CatalogSaveInput {
  if (item.origin !== "owned")
    throw new Error("Included sounds are read-only.");
  if (!item.revision_sha256 || !item.logical_key)
    throw new Error("Reload this sound before editing it.");
  return {
    kind: "sound_effect",
    // Updates resolve the original storage locator by catalogItemId. Keep this
    // required route token portable; display names may contain Unicode/punctuation.
    entryName: "sound",
    catalogItemId: item.item_id,
    expectedRevision: item.revision_sha256,
    operationId,
    files: [file],
    metadata: {
      ...item.metadata,
      schema_version: 1,
      id: item.logical_key,
      name: name.trim(),
      description: item.description ?? undefined,
    },
  };
}
