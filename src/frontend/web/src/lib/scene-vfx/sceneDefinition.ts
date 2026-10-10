import { parseSceneVFXEntry } from "./catalog";
import type { SceneVFXEntry } from "./types";

/**
 * Turn a stored `animama/scene-effect/1` definition into the runtime entry the
 * Scene layers draw. Stored marquee and scatter items name their image by
 * logical name (`{ kind: "image", image }`), as does a tile (`image`);
 * `imageUrl` maps each name to a URL the page can load. Shared by the runtime
 * catalog and the review tools, so a Scene Effect plays the same in chat and
 * in review renders.
 *
 * Throws `scene_vfx_definition_invalid` for a malformed definition and
 * `scene_vfx_resource_invalid` for an item whose image has no URL.
 */
export function sceneEntryFromDefinition(
  definition: Record<string, unknown>,
  identity: { id: string; label: string },
  imageUrl: (logicalName: string) => string | null | undefined,
  extra: Record<string, unknown> = {},
): { entry: SceneVFXEntry; referencedImages: ReadonlySet<string> } {
  const projected = structuredClone(definition);
  const referencedImages = new Set<string>();
  const imageSrc = (logicalName: unknown) => {
    const src = typeof logicalName === "string" ? imageUrl(logicalName) : null;
    if (typeof logicalName !== "string" || !src)
      throw new Error("scene_vfx_resource_invalid");
    referencedImages.add(logicalName);
    return src;
  };
  const projectItems = (items: unknown) => {
    if (!Array.isArray(items)) throw new Error("scene_vfx_definition_invalid");
    return items.map((rawItem) => {
      const item = record(rawItem);
      if (!item) throw new Error("scene_vfx_definition_invalid");
      if (item.kind !== "image") return item;
      return {
        id: item.id,
        kind: "png",
        label: item.label,
        src: imageSrc(item.image),
      };
    });
  };
  if (projected.kind === "background_layers") {
    const marquee = record(projected.marquee);
    if (!marquee) throw new Error("scene_vfx_definition_invalid");
    marquee.items = projectItems(marquee.items);
    if (projected.tile !== undefined) {
      const tile = record(projected.tile);
      if (!tile) throw new Error("scene_vfx_definition_invalid");
      const { image, ...rest } = tile;
      projected.tile = { ...rest, src: imageSrc(image) };
    }
    if (projected.scatters !== undefined) {
      if (!Array.isArray(projected.scatters))
        throw new Error("scene_vfx_definition_invalid");
      projected.scatters = projected.scatters.map((rawLayer) => {
        const layer = record(rawLayer);
        if (!layer) throw new Error("scene_vfx_definition_invalid");
        return { ...layer, items: projectItems(layer.items) };
      });
    }
  }
  return {
    entry: parseSceneVFXEntry({
      ...projected,
      ...extra,
      id: identity.id,
      label: identity.label,
      enabled: true,
    }),
    referencedImages,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
