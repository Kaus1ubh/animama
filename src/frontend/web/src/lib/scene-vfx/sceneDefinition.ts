import { parseSceneVFXEntry } from "./catalog";
import type { SceneVFXEntry } from "./types";

/**
 * Turn a stored `animama/scene-effect/1` definition into the runtime entry the
 * Scene layers draw. Stored marquee items name their image by logical name
 * (`{ kind: "image", image }`); `imageUrl` maps each name to a URL the page
 * can load. Shared by the runtime catalog and the review tools, so a Scene
 * Effect plays the same in chat and in review renders.
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
  if (projected.kind === "background_layers") {
    const marquee = record(projected.marquee);
    if (!marquee || !Array.isArray(marquee.items))
      throw new Error("scene_vfx_definition_invalid");
    marquee.items = marquee.items.map((rawItem) => {
      const item = record(rawItem);
      if (!item) throw new Error("scene_vfx_definition_invalid");
      if (item.kind !== "image") return item;
      const logicalName = typeof item.image === "string" ? item.image : null;
      const src = logicalName ? imageUrl(logicalName) : null;
      if (!logicalName || !src) throw new Error("scene_vfx_resource_invalid");
      referencedImages.add(logicalName);
      return { id: item.id, kind: "png", label: item.label, src };
    });
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
