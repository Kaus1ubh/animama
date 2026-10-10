import { getI18n } from "react-i18next";

import { getUnsupportedAdvancedBehaviorLabels } from "./advancedBehaviors";
import { readJsonObject } from "./json";
import { PARTICLE_VFX_EDITOR_TEXTURES } from "./constants";
import { validateParticleVFXEditorDraft } from "./validation";
import type {
  JsonObject,
  ParticleVFXContentReadiness,
  ParticleVFXEditorDraft,
  ParticleVFXEditorValidationIssue,
} from "./types";

const MAX_MANIFEST_MIB = 5;
const MAX_MANIFEST_BYTES = MAX_MANIFEST_MIB * 1024 * 1024;
const MAX_SYSTEMS = 8;
const MAX_RESOURCES = 64;
const MAX_NODES = 128;
const MAX_TEXTURES = 16;
const MAX_DURATION_SECONDS = 30;
const MAX_PARTICLES = 512;
const RUNTIME_ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export type ParticleVFXContentReadinessOptions = {
  /** Exact logical references whose bytes can be included in the package. */
  resolvableTextureReferences?: ReadonlySet<string>;
  /** Exact retained App references that the package builder will normalize. */
  trustedLegacyTextureReferences?: ReadonlySet<string>;
  /** UI Locale for issue messages; the active locale by default. */
  language?: string;
};

/**
 * Apply the browser-visible portion of the private Particle Effect contract.
 *
 * The backend remains authoritative. This check prevents allocating an upload
 * draft for known-invalid creator output and deliberately excludes transport
 * concerns such as canonical image byte validation.
 */
export function validateParticleVFXContentReadiness(
  draft: ParticleVFXEditorDraft,
  options: ParticleVFXContentReadinessOptions = {},
): ParticleVFXContentReadiness {
  const t = getI18n().getFixedT(options.language ?? null, "particles");
  const issues = validateParticleVFXEditorDraft(draft, options.language).map(
    promoteContentBlockingIssue,
  );
  const push = (
    code: ParticleVFXEditorValidationIssue["code"],
    message: string,
    target: string,
  ) => issues.push({ severity: "error", code, message, target });
  const serialized = JSON.stringify(draft.quarksJson);
  const estimatedManifestBytes = new TextEncoder().encode(serialized).length;

  if (
    draft.catalog.id.length > 64 ||
    !RUNTIME_ID_PATTERN.test(draft.catalog.id)
  ) {
    push("asset-runtime-id", t("issues.runtimeId"), "catalog.id");
  }
  if (estimatedManifestBytes > MAX_MANIFEST_BYTES) {
    push(
      "asset-manifest-limit",
      t("issues.manifestLimit", { size: MAX_MANIFEST_MIB }),
      "json",
    );
  }

  const resourceKeys = ["geometries", "materials", "textures", "images"];
  for (const key of resourceKeys) {
    const resources = draft.quarksJson[key];
    if (!Array.isArray(resources) || resources.length > MAX_RESOURCES) {
      push(
        "asset-resource-limit",
        t("issues.resourceLimit", { key, max: MAX_RESOURCES }),
        key,
      );
    }
  }

  const { nodeCount, systemCount, unsupportedNode } = inspectNodes(
    draft.quarksJson.object,
  );
  if (nodeCount > MAX_NODES) {
    push(
      "asset-node-limit",
      t("issues.nodeLimit", { max: MAX_NODES }),
      "object",
    );
  }
  if (systemCount < 1 || systemCount > MAX_SYSTEMS) {
    push(
      "asset-system-limit",
      t("issues.systemLimit", { min: 1, max: MAX_SYSTEMS }),
      "object.children",
    );
  }
  if (unsupportedNode) {
    push("unsupported-asset-structure", t("issues.unsupportedNodes"), "object");
  }

  const images = Array.isArray(draft.quarksJson.images)
    ? draft.quarksJson.images
    : [];
  const uniqueTextureReferences: string[] = [];
  const seenReferences = new Set<string>();
  const basenames = new Map<string, string>();
  const curated = new Set(
    PARTICLE_VFX_EDITOR_TEXTURES.map((texture) =>
      normalizeLogicalReference(texture.relativeUrl),
    ).filter((value): value is string => value !== null),
  );
  const resolvable = options.resolvableTextureReferences ?? curated;
  for (const [index, rawImage] of images.entries()) {
    const url = readJsonObject(rawImage)?.url;
    if (typeof url !== "string") continue;
    const logicalReference =
      normalizeLogicalReference(url) ??
      (options.trustedLegacyTextureReferences?.has(url) ? url : null);
    if (!logicalReference) {
      push(
        "unsafe-texture-reference",
        t("issues.unsafeTextureReference"),
        `images.${index}.url`,
      );
      continue;
    }
    const basename = logicalReference.split("/").at(-1) ?? logicalReference;
    const portableName = basename.normalize("NFC").toLocaleLowerCase("en-US");
    const priorReference = basenames.get(portableName);
    if (priorReference && priorReference !== logicalReference) {
      push(
        "ambiguous-texture-filename",
        t("issues.ambiguousTextureFilename", {
          first: priorReference,
          second: logicalReference,
        }),
        `images.${index}.url`,
      );
    } else {
      basenames.set(portableName, logicalReference);
    }
    if (!seenReferences.has(logicalReference)) {
      seenReferences.add(logicalReference);
      uniqueTextureReferences.push(logicalReference);
    }
    if (!resolvable.has(logicalReference)) {
      push(
        "unresolved-texture",
        t("issues.unresolvedTexture", { texture: logicalReference }),
        `images.${index}.url`,
      );
    }
  }
  if (uniqueTextureReferences.length > MAX_TEXTURES) {
    push(
      "asset-resource-limit",
      t("issues.tooManyTextures", { max: MAX_TEXTURES }),
      "images",
    );
  }

  const maximumDuration = draft.catalog.performanceBudget.maxDurationSec;
  if (
    !Number.isFinite(maximumDuration) ||
    maximumDuration <= 0 ||
    maximumDuration > MAX_DURATION_SECONDS ||
    draft.catalog.defaultDurationSec <= 0 ||
    draft.catalog.defaultDurationSec > maximumDuration
  ) {
    push(
      "invalid-runtime-defaults",
      t("issues.invalidRuntimeDefaults", { seconds: MAX_DURATION_SECONDS }),
      "catalog.performanceBudget.maxDurationSec",
    );
  }
  if (
    draft.emitters.some(
      (emitter) =>
        emitter.durationSec === null ||
        emitter.durationSec > maximumDuration ||
        emitter.durationSec > MAX_DURATION_SECONDS,
    )
  ) {
    push("asset-duration-limit", t("issues.durationLimit"), "emitters");
  }
  if (
    draft.emitters.some((emitter) => emitter.looping) &&
    !draft.catalog.performanceBudget.loopingAllowed
  ) {
    push(
      "asset-looping-metadata",
      t("issues.loopingMetadata"),
      "catalog.performanceBudget.loopingAllowed",
    );
  }
  const estimatedParticles = estimateParticles(draft.quarksJson);
  if (
    estimatedParticles > MAX_PARTICLES ||
    draft.catalog.performanceBudget.maxParticles > MAX_PARTICLES ||
    draft.catalog.performanceBudget.maxParticles < estimatedParticles
  ) {
    push(
      "particle-budget-exceeded",
      t("issues.particleLimit", { max: MAX_PARTICLES }),
      "catalog.performanceBudget.maxParticles",
    );
  }

  for (const emitter of draft.emitters) {
    const target = `emitter:${emitter.name}`;
    if (
      emitter.shape.type === "unsupported" ||
      !Number.isInteger(emitter.renderer.renderMode) ||
      emitter.renderer.renderMode < 0 ||
      emitter.renderer.renderMode > 5 ||
      emitter.startLife === null ||
      emitter.startSpeed === null ||
      emitter.startSize === null ||
      emitter.startRotation === null ||
      emitter.emissionOverTime === null ||
      emitter.emissionOverDistance === null ||
      emitter.startColorGenerator.mode === "unsupported" ||
      emitter.colorOverLife.mode === "unsupported" ||
      emitter.frameOverLife.mode === "unsupported" ||
      getUnsupportedAdvancedBehaviorLabels(emitter.advancedBehaviors).length > 0
    ) {
      push(
        "unsupported-asset-structure",
        t("issues.unportableEmitter"),
        target,
      );
    }
  }

  return {
    ready: !issues.some((issue) => issue.severity === "error"),
    issues,
    uniqueTextureReferences,
    estimatedManifestBytes,
  };
}

/** Match the backend's conservative live-particle estimate for Save gating. */
function estimateParticles(quarksJson: JsonObject): number {
  const systems: JsonObject[] = [];
  const visit = (rawNode: unknown) => {
    const node = readJsonObject(rawNode);
    if (!node) return;
    if (node.type === "ParticleEmitter") {
      const system = readJsonObject(node.ps);
      if (system) systems.push(system);
    }
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(quarksJson.object);

  const maximumDuration = Math.max(
    0,
    ...systems.map((system) => finiteNumber(system.duration) ?? Infinity),
  );
  let total = 0;
  for (const system of systems) {
    const duration = finiteNumber(system.duration);
    const emissionRate = nonnegativeGeneratorMaximum(system.emissionOverTime);
    if (!duration || !Number.isFinite(emissionRate)) return Infinity;
    const bursts = Array.isArray(system.emissionBursts)
      ? system.emissionBursts
      : [];
    let burstParticles = 0;
    for (const rawBurst of bursts) {
      const burst = readJsonObject(rawBurst);
      const count = nonnegativeGeneratorMaximum(burst?.count);
      const cycle = finiteNumber(burst?.cycle ?? 1);
      if (!burst || !Number.isFinite(count) || !cycle) return Infinity;
      burstParticles += count * Math.ceil(cycle);
    }
    const looping = system.looping === true;
    const activeDuration = looping ? maximumDuration : duration;
    const burstRepetitions = looping
      ? Math.ceil(maximumDuration / duration)
      : 1;
    total += Math.ceil(
      activeDuration * emissionRate + burstParticles * burstRepetitions,
    );
  }
  return total;
}

function nonnegativeGeneratorMaximum(value: unknown): number {
  const generator = readJsonObject(value);
  if (generator?.type === "ConstantValue") {
    const number = finiteNumber(generator.value, true);
    return number ?? Infinity;
  }
  if (generator?.type === "IntervalValue") {
    const a = finiteNumber(generator.a, true);
    const b = finiteNumber(generator.b, true);
    return a === null || b === null ? Infinity : Math.max(a, b);
  }
  return Infinity;
}

function finiteNumber(value: unknown, allowZero = false): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    (allowZero ? value >= 0 : value > 0)
    ? value
    : null;
}

function promoteContentBlockingIssue(
  issue: ParticleVFXEditorValidationIssue,
): ParticleVFXEditorValidationIssue {
  return issue.code === "embedded-texture-url" ||
    issue.code === "unsupported-shape" ||
    issue.code === "unsupported-render-mode" ||
    issue.code === "unsupported-behavior-settings" ||
    issue.code === "duration-over-budget" ||
    issue.code === "particle-budget-exceeded"
    ? { ...issue, severity: "error" }
    : issue;
}

function normalizeLogicalReference(value: string): string | null {
  const normalized = value.trim().replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("?") ||
    normalized.includes("#") ||
    /^(?:data|file|https?|javascript|blob):/i.test(normalized)
  ) {
    return null;
  }
  try {
    if (decodeURIComponent(normalized) !== normalized) return null;
  } catch {
    return null;
  }
  const parts = normalized.split("/");
  return parts.some((part) => !part || part === "." || part === "..")
    ? null
    : parts.join("/");
}

function inspectNodes(value: unknown): {
  nodeCount: number;
  systemCount: number;
  unsupportedNode: boolean;
} {
  let nodeCount = 0;
  let systemCount = 0;
  let unsupportedNode = false;
  const visit = (raw: unknown, depth: number) => {
    const node = readJsonObject(raw);
    if (!node || depth > 64) {
      unsupportedNode = true;
      return;
    }
    nodeCount += 1;
    if (node.type === "ParticleEmitter") systemCount += 1;
    else if (node.type !== "Group") unsupportedNode = true;
    const children =
      node.children === undefined
        ? []
        : Array.isArray(node.children)
          ? node.children
          : null;
    if (!children) {
      unsupportedNode = true;
      return;
    }
    for (const child of children) visit(child, depth + 1);
  };
  visit(value, 0);
  return { nodeCount, systemCount, unsupportedNode };
}

/** Narrow helper used by tests and future package construction. */
export function collectParticleVFXContentReferences(
  quarksJson: JsonObject,
): readonly string[] {
  const images = Array.isArray(quarksJson.images) ? quarksJson.images : [];
  return images.flatMap((image) => {
    const url = readJsonObject(image)?.url;
    const normalized =
      typeof url === "string" ? normalizeLogicalReference(url) : null;
    return normalized ? [normalized] : [];
  });
}
