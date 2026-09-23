import { parseParticleVFXRuntimeConfig } from "../runtimeConfig";
import { DEFAULT_IMPORTED_CATALOG_DRAFT } from "./constants";
import { createParticleVFXEditorDraftFromImport } from "./draft";
import { readJsonObject } from "./json";

/** Reopen catalog metadata alongside its Quarks definition without losing defaults. */
export function createParticleVFXEditorDraftFromContent(
  definition: unknown,
  item: {
    item_id: string;
    name: string;
    description?: string | null;
    metadata?: unknown;
  },
) {
  const defaults = readJsonObject(
    readJsonObject(item.metadata)?.runtime_defaults,
  );
  const config = readJsonObject(readJsonObject(defaults?.slots)?.particle_vfx);
  const runtimeId =
    typeof defaults?.runtime_id === "string" && defaults.runtime_id.trim()
      ? defaults.runtime_id
      : item.item_id;
  return createParticleVFXEditorDraftFromImport(definition, {
    ...(config
      ? parseParticleVFXRuntimeConfig(config, DEFAULT_IMPORTED_CATALOG_DRAFT)
      : DEFAULT_IMPORTED_CATALOG_DRAFT),
    id: runtimeId,
    label: item.name,
    description: item.description ?? "",
    assetPath: `/effects/vfx/quark/${runtimeId}.json`,
  });
}
