import { parseParticleVFXRuntimeConfig } from "./runtimeConfig";
import type { ParticleVFXCatalogEntry } from "./types";

/**
 * Animama's Included Particle Effects, read at build time from their
 * descriptors (`content/included/vfx/particle/quark/<stem>/<stem>.json`), as
 * the Included Gestures and Reactions are. The backend serves the same
 * content at runtime; this synchronous list backs the animation debug panel,
 * the creator's draft-from-catalog helper and legacy `public_url` runtime
 * entries, so there is no hand-written copy to fall out of date. Each effect's
 * manifest and textures load on demand from `/effects/vfx/quark/<stem>/`.
 */
const rawDescriptors = import.meta.glob(
  [
    "../../../../../../../content/included/vfx/particle/quark/*/*.json",
    "!../../../../../../../content/included/vfx/particle/quark/*/particle.json",
  ],
  { eager: true, import: "default" },
) as Record<string, unknown>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** One descriptor as a catalog entry; a malformed Included descriptor throws. */
function includedParticleVFXEntry(
  modulePath: string,
  raw: unknown,
): ParticleVFXCatalogEntry {
  const [stem, file] = modulePath.split("/").slice(-2);
  const descriptor = record(raw);
  const runtimeDefaults = record(descriptor?.runtime_defaults);
  const slot = record(record(runtimeDefaults?.slots)?.particle_vfx);
  if (
    !stem ||
    file !== `${stem}.json` ||
    descriptor?.content_type !== "particle_effect" ||
    runtimeDefaults?.runtime_id !== stem ||
    !slot
  ) {
    throw new Error(
      `Included Particle Effect ${modulePath} is not a particle_effect descriptor with runtime ID "${stem}".`,
    );
  }
  return {
    id: stem,
    label: text(slot.label) ?? text(descriptor.name) ?? stem,
    description: text(slot.description) ?? text(descriptor.description) ?? "",
    assetPath: `/effects/vfx/quark/${stem}/particle.json`,
    ...parseParticleVFXRuntimeConfig(slot),
  };
}

export const AVATAR_PARTICLE_VFX_CATALOG: readonly ParticleVFXCatalogEntry[] =
  Object.entries(rawDescriptors)
    .map(([modulePath, raw]) => includedParticleVFXEntry(modulePath, raw))
    .sort((left, right) => left.id.localeCompare(right.id));

const PARTICLE_VFX_CATALOG_BY_ID = new Map<string, ParticleVFXCatalogEntry>(
  AVATAR_PARTICLE_VFX_CATALOG.map((entry) => [entry.id, entry]),
);

export function getParticleVFXCatalogEntryById(
  effectId: string,
): ParticleVFXCatalogEntry | null {
  return PARTICLE_VFX_CATALOG_BY_ID.get(effectId) ?? null;
}

export function getParticleVFXCatalogIds(): string[] {
  return AVATAR_PARTICLE_VFX_CATALOG.map((entry) => entry.id);
}
