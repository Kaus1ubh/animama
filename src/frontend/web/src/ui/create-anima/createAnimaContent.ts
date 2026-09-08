import type { ItemRevisionRef } from "@animama/runtime-contracts/sdk";

/** Convert a catalog preview/item to the exact immutable reference used by drafts. */
export function itemReference(item: {
  item_id: string;
  revision_sha256: string;
}): ItemRevisionRef {
  return {
    item_id: item.item_id,
    revision_sha256: item.revision_sha256,
  };
}
