import { createDefaultParticleVFXTransform } from "./catalog";
import { isParticleVFXAnchor, normalizeParticleVFXTransform } from "./runtime";
import type { ParticleVFXCatalogEntry, ParticleVFXShapeAutoFit } from "./types";

type ParticleVFXRuntimeDefaults = Omit<
  ParticleVFXCatalogEntry,
  "id" | "label" | "description" | "assetPath"
>;

/** Decode stored runtime defaults consistently for playback and authoring reopen. */
export function parseParticleVFXRuntimeConfig(
  config: Record<string, unknown>,
  fallback?: ParticleVFXRuntimeDefaults,
): ParticleVFXRuntimeDefaults {
  const transform = normalizeParticleVFXTransform(
    recordValue(config.transform)
      ? {
          offset: axisValue(config.transform, "offset"),
          rotation: axisValue(config.transform, "rotation"),
          scale: axisValue(config.transform, "scale"),
          depthOffset: finiteNumber(
            recordValue(config.transform)?.depth_offset,
          ),
        }
      : undefined,
  );
  const shapeAutoFit =
    particleShapeAutoFit(config.shape_auto_fit) ?? fallback?.shapeAutoFit;
  return {
    defaultAnchor: isParticleVFXAnchor(config.anchor)
      ? config.anchor
      : (fallback?.defaultAnchor ?? "root"),
    defaultDurationSec:
      positiveNumber(config.duration_seconds) ??
      fallback?.defaultDurationSec ??
      1,
    defaultFollowAnchor:
      typeof config.follow_anchor === "boolean"
        ? config.follow_anchor
        : (fallback?.defaultFollowAnchor ?? true),
    defaultTransform: recordValue(config.transform)
      ? transform
      : (fallback?.defaultTransform ?? createDefaultParticleVFXTransform()),
    preloadTier:
      config.preload_tier === "tier_a"
        ? "tierA"
        : config.preload_tier === "tier_b"
          ? "tierB"
          : config.preload_tier === "none"
            ? "none"
            : (fallback?.preloadTier ?? "none"),
    performanceBudget: {
      maxDurationSec: Math.min(
        30,
        positiveNumber(config.max_duration_seconds) ??
          Math.max(
            positiveNumber(config.duration_seconds) ?? 30,
            fallback?.performanceBudget.maxDurationSec ?? 0,
          ),
      ),
      maxParticles: Math.min(
        512,
        positiveInteger(config.max_particles) ??
          fallback?.performanceBudget.maxParticles ??
          512,
      ),
      loopingAllowed:
        typeof config.looping_allowed === "boolean"
          ? config.looping_allowed
          : (fallback?.performanceBudget.loopingAllowed ?? true),
      canCoexist:
        typeof config.can_coexist === "boolean"
          ? config.can_coexist
          : (fallback?.performanceBudget.canCoexist ?? true),
    },
    ...(shapeAutoFit ? { shapeAutoFit } : {}),
  };
}

/**
 * The stored form of an effect's runtime defaults
 * (`runtime_defaults.slots.particle_vfx`), as the creator's Save writes it
 * and `parseParticleVFXRuntimeConfig` reads it back.
 */
export function particleVFXRuntimeSlotConfig(
  entry: Omit<ParticleVFXCatalogEntry, "id" | "assetPath">,
): Record<string, unknown> {
  const transform = entry.defaultTransform;
  const autoFit = entry.shapeAutoFit;
  return {
    label: entry.label,
    description: entry.description,
    anchor: entry.defaultAnchor,
    duration_seconds: entry.defaultDurationSec,
    max_duration_seconds: entry.performanceBudget.maxDurationSec,
    preload_tier:
      entry.preloadTier === "tierA"
        ? "tier_a"
        : entry.preloadTier === "tierB"
          ? "tier_b"
          : "none",
    follow_anchor: entry.defaultFollowAnchor,
    transform: {
      offset: transform.offset,
      depth_offset: transform.depthOffset,
      rotation: transform.rotation,
      scale: transform.scale,
    },
    looping_allowed: entry.performanceBudget.loopingAllowed,
    can_coexist: entry.performanceBudget.canCoexist,
    max_particles: entry.performanceBudget.maxParticles,
    ...(autoFit
      ? {
          shape_auto_fit: {
            kind: "avatar_bounds_rectangle",
            ...(autoFit.padding ? { padding: autoFit.padding } : {}),
            ...(autoFit.minSize ? { min_size: autoFit.minSize } : {}),
            ...(autoFit.maxSize ? { max_size: autoFit.maxSize } : {}),
            ...(autoFit.emitterNames
              ? { emitter_names: autoFit.emitterNames }
              : {}),
          },
        }
      : {}),
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function axisValue(value: unknown, key: string) {
  const axis = recordValue(recordValue(value)?.[key]);
  return axis
    ? {
        x: finiteNumber(axis.x),
        y: finiteNumber(axis.y),
        z: finiteNumber(axis.z),
      }
    : undefined;
}

function particleShapeAutoFit(
  value: unknown,
): ParticleVFXShapeAutoFit | undefined {
  const raw = recordValue(value);
  if (raw?.kind !== "avatar_bounds_rectangle") return undefined;
  const dimensions = (input: unknown) => {
    const candidate = recordValue(input);
    if (!candidate) return undefined;
    const width = finiteNumber(candidate.width);
    const height = finiteNumber(candidate.height);
    return width === undefined && height === undefined
      ? undefined
      : {
          ...(width === undefined ? {} : { width }),
          ...(height === undefined ? {} : { height }),
        };
  };
  const emitterNames = Array.isArray(raw.emitter_names)
    ? raw.emitter_names.filter(
        (name): name is string => typeof name === "string" && name.length > 0,
      )
    : undefined;
  return {
    kind: "avatarBoundsRectangle",
    ...(dimensions(raw.padding) ? { padding: dimensions(raw.padding) } : {}),
    ...(dimensions(raw.min_size) ? { minSize: dimensions(raw.min_size) } : {}),
    ...(dimensions(raw.max_size) ? { maxSize: dimensions(raw.max_size) } : {}),
    ...(emitterNames?.length ? { emitterNames } : {}),
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}
