import type { QueryClient } from "@tanstack/react-query";
import type { PyContentCatalog } from "@/lib/content/catalogTypes";
import { queryKeys } from "@/query/keys";

/** Scan timestamps alone do not change any visible content or available actions. */
function catalogVersion(catalog: PyContentCatalog) {
  return JSON.stringify({
    scan_required: catalog.scan_required,
    items: catalog.items
      .map((item) => ({ ...item, scanned_at: undefined }))
      .sort((left, right) => left.item_id.localeCompare(right.item_id)),
  });
}

/** Refresh derived views when automatic or explicit scanning changes content. */
export async function refreshContentCatalogViews(
  client: QueryClient,
  owner: string,
  previous: PyContentCatalog | undefined,
  next: PyContentCatalog,
) {
  if (previous && catalogVersion(previous) === catalogVersion(next)) return;
  await invalidateContentCatalogViews(client, owner);
}

/** Refresh typed family lists after an atomic import without fabricating a catalog snapshot. */
export async function invalidateContentCatalogViews(
  client: QueryClient,
  owner: string,
) {
  await Promise.all(
    [
      queryKeys.avatarCatalog.all(owner),
      queryKeys.avatars.all(owner),
      queryKeys.gestures.all(owner),
      queryKeys.poses.all(owner),
      queryKeys.reactions.all(owner),
      queryKeys.particleEffects.all(owner),
      queryKeys.avatarEffects.all(owner),
      queryKeys.sceneEffects.all(owner),
      queryKeys.soundEffects.all(owner),
      queryKeys.appearanceImages.all(owner),
      queryKeys.idleStyles.all(owner),
    ].map((queryKey) => client.invalidateQueries({ queryKey })),
  );
}
