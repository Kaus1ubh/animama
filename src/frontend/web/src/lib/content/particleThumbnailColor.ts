import {
  getStartColorDraftPreviewColor,
  readStartColorDraft,
} from "@/lib/avatar/particle-vfx/editor/colors";
import {
  readJsonObject,
  readJsonArrayObjects,
} from "@/lib/avatar/particle-vfx/editor/json";
import type { JsonObject } from "@/lib/avatar/particle-vfx/editor/types";

/** Representative RGB tint for the first emitter using the displayed texture. */
export function particleThumbnailColor(document: unknown, texturePath: string) {
  const root = readJsonObject(document);
  if (!root) return null;
  const image = readJsonArrayObjects(root.images).find((entry) => {
    if (typeof entry.url !== "string") return false;
    const path = entry.url.replace(/^\.\//, "");
    return texturePath === path || texturePath.endsWith(`/${path}`);
  });
  if (!image) return null;
  const textures = readJsonArrayObjects(root.textures)
    .filter((texture) => texture.image === image.uuid)
    .map((texture) => texture.uuid);
  const materials = readJsonArrayObjects(root.materials).filter((material) =>
    textures.includes(material.map),
  );
  function findEmitter(node: JsonObject): JsonObject | null {
    const ps = readJsonObject(node.ps);
    if (ps && materials.some((material) => material.uuid === ps.material))
      return ps;
    for (const child of readJsonArrayObjects(node.children)) {
      const found = findEmitter(child);
      if (found) return found;
    }
    return null;
  }
  const ps = findEmitter(readJsonObject(root.object) ?? {});
  if (!ps) return null;
  const start = getStartColorDraftPreviewColor(
    readStartColorDraft(ps.startColor),
  );
  const behavior = readJsonArrayObjects(ps.behaviors).find(
    (value) => value.type === "ColorOverLife",
  );
  const life = getStartColorDraftPreviewColor(
    readStartColorDraft(behavior?.color),
  );
  const material = materials.find((value) => value.uuid === ps.material);
  const hex = typeof material?.color === "number" ? material.color : 0xffffff;
  // Ignore fade-in alpha: a static icon should remain visible at the first color.
  return {
    r: start.r * life.r * (((hex >> 16) & 255) / 255),
    g: start.g * life.g * (((hex >> 8) & 255) / 255),
    b: start.b * life.b * ((hex & 255) / 255),
  };
}
