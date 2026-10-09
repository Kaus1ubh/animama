import {
  PARTICLE_VFX_EDITOR_TEXTURES,
  createParticleVFXEditorDraftFromImport,
  validateParticleVFXContentReadiness,
  type ParticleVFXEditorCatalogDraft,
  type ParticleVFXEditorDraft,
  type ParticleVFXShapeAutoFit,
  type ParticleVFXTransform,
} from "@/lib/avatar/particle-vfx";
import { readParticleVFXTextureFile } from "@/lib/avatar/particle-vfx/editor/textureFiles";
import type { ParticleVFXEditorTextureFile } from "@/lib/avatar/particle-vfx/editor/types";
import {
  PARTICLE_TEXTURE_LIMITS,
  detectEffectArtFormat,
} from "@/lib/effects/effectArtLimits";
import { normalizeRuntimeContentId } from "@/lib/runtime-content/runtimeId";

const MAX_TEXTURES = PARTICLE_TEXTURE_LIMITS.count;
const MAX_TEXTURE_BYTES = PARTICLE_TEXTURE_LIMITS.bytes;
const MAX_TEXTURE_TOTAL_BYTES = PARTICLE_TEXTURE_LIMITS.totalBytes;
const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const MIB = 1024 * 1024;
const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
const MAX_DURATION_SECONDS = 30;
const MAX_PARTICLES = 512;

type TextureType = {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
};

export type ParticleVFXContentPackageTexture = {
  logicalReference: string;
  packageReference: string;
  file: File;
  ordinal: number;
};

export type ParticleVFXContentPackageResource = {
  logicalReference: string;
  previewUrl: string;
  blob: Blob | null;
  contentType: string | null;
};

export type ParticleVFXContentPackage = {
  normalizedDraft: ParticleVFXEditorDraft;
  manifestFile: File;
  textures: readonly ParticleVFXContentPackageTexture[];
  authoringManifest: Record<string, unknown>;
  notices: readonly string[];
};

export class ParticleVFXContentPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParticleVFXContentPackageError";
  }
}

/**
 * Construct a standalone, deterministic private Particle VFX package.
 * Texture bytes come from `resources`, then from the draft's own texture
 * files, then from the built-in set. Temporary delivery URLs are read only
 * from the resource inventory and never copied into the normalized authoring
 * manifest. The normalized draft carries every packaged texture's bytes under
 * its package path, so the saved effect reopens without refetching them.
 */
export async function buildParticleVFXContentPackage({
  draft,
  resources,
  fetcher = fetch,
  signal,
}: {
  draft: ParticleVFXEditorDraft;
  resources: readonly ParticleVFXContentPackageResource[];
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<ParticleVFXContentPackage> {
  const rawJson = cloneJson(draft.quarksJson);
  const { catalog, notices } = normalizeCatalogForPrivateContent(draft.catalog);
  validateRuntimeDefaults(catalog);
  const references = collectRawImageReferences(rawJson);
  if (references.length > MAX_TEXTURES) {
    throw new ParticleVFXContentPackageError(
      `Particle Effects support at most ${MAX_TEXTURES} unique textures.`,
    );
  }
  const resourcesByReference = new Map<
    string,
    ParticleVFXContentPackageResource
  >();
  for (const resource of resources) {
    if (resourcesByReference.has(resource.logicalReference)) {
      throw new ParticleVFXContentPackageError(
        `Texture ${resource.logicalReference} has an ambiguous resource source.`,
      );
    }
    resourcesByReference.set(resource.logicalReference, resource);
  }
  for (const [logicalReference, file] of Object.entries(draft.textureFiles)) {
    if (!resourcesByReference.has(logicalReference))
      resourcesByReference.set(logicalReference, {
        logicalReference,
        previewUrl: "",
        blob: file.blob,
        contentType: file.blob.type || null,
      });
  }

  const usedNames = new Set<string>();
  const rewritten = new Map<string, string>();
  const textures: ParticleVFXContentPackageTexture[] = [];
  const textureFiles: Record<string, ParticleVFXEditorTextureFile> = {};
  let packageBytes = 0;
  let textureBytes = 0;
  for (const [index, logicalReference] of references.entries()) {
    signal?.throwIfAborted();
    const source = resolveTextureSource(
      logicalReference,
      resourcesByReference.get(logicalReference),
    );
    const blob = await loadTextureBlob(source, fetcher, signal);
    if (!blob.size) {
      throw new ParticleVFXContentPackageError(
        `Texture ${logicalReference} is empty.`,
      );
    }
    // Size, format and header dimensions, checked before anything decodes
    // it. An unreadable format is reported below with the content type.
    const read = await readParticleVFXTextureFile(blob, {
      formats: ["png", "jpeg", "webp"],
    });
    if (!read.ok && read.reason !== "format") {
      throw new ParticleVFXContentPackageError(
        `Texture ${logicalReference}: ${read.message}`,
      );
    }
    textureBytes += blob.size;
    if (textureBytes > MAX_TEXTURE_TOTAL_BYTES) {
      throw new ParticleVFXContentPackageError(
        `Textures in one Particle Effect must total at most ${MAX_TEXTURE_TOTAL_BYTES / MIB} MiB.`,
      );
    }
    const detected = read.ok ? await detectTextureType(blob) : null;
    const declaredValue = source.contentType || blob.type;
    const declared = normalizeTextureContentType(declaredValue);
    if (
      !detected ||
      (declaredValue && !declared) ||
      (declared && declared.contentType !== detected.contentType)
    ) {
      throw new ParticleVFXContentPackageError(
        `Texture ${logicalReference} has mismatched or unsupported image bytes.`,
      );
    }
    const filename = uniqueTextureFilename(
      logicalReference,
      detected.extension,
      usedNames,
    );
    const packageReference = `textures/${filename}`;
    const file = new File([blob], filename, { type: detected.contentType });
    packageBytes += file.size;
    rewritten.set(logicalReference, packageReference);
    if (read.ok) textureFiles[packageReference] = { ...read.file, blob: file };
    textures.push({
      logicalReference,
      packageReference,
      file,
      ordinal: index + 1,
    });
  }

  rewriteImageReferences(rawJson, rewritten);
  const normalizedDraft = createParticleVFXEditorDraftFromImport(
    rawJson,
    catalog,
    textureFiles,
  );
  const readiness = validateParticleVFXContentReadiness(normalizedDraft, {
    resolvableTextureReferences: new Set(
      textures.map((texture) => texture.packageReference),
    ),
  });
  if (!readiness.ready) {
    const issue = readiness.issues.find(({ severity }) => severity === "error");
    throw new ParticleVFXContentPackageError(
      issue?.message ??
        "This Particle VFX is not ready to save as a Particle Effect.",
    );
  }

  const manifestFile = new File(
    [JSON.stringify(normalizedDraft.quarksJson)],
    `${safeStem(normalizedDraft.catalog.id, "particle-vfx")}.json`,
    { type: "application/json" },
  );
  if (manifestFile.size > MAX_MANIFEST_BYTES) {
    throw new ParticleVFXContentPackageError(
      "Particle VFX manifest exceeds the 5 MiB limit.",
    );
  }
  packageBytes += manifestFile.size;
  if (packageBytes > MAX_PACKAGE_BYTES) {
    throw new ParticleVFXContentPackageError(
      "Particle VFX package exceeds the 64 MiB limit.",
    );
  }

  return {
    normalizedDraft,
    manifestFile,
    textures,
    authoringManifest: buildAuthoringManifest(normalizedDraft.catalog),
    notices,
  };
}

function collectRawImageReferences(json: Record<string, unknown>): string[] {
  const images = Array.isArray(json.images) ? json.images : [];
  const references: string[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of images.entries()) {
    const image = recordValue(raw);
    const reference = typeof image?.url === "string" ? image.url.trim() : "";
    if (!reference) continue;
    if (!isPotentialLogicalReference(reference)) {
      throw new ParticleVFXContentPackageError(
        `Texture reference ${index + 1} is unsafe or non-portable.`,
      );
    }
    if (!seen.has(reference)) {
      seen.add(reference);
      references.push(reference);
    }
  }
  return references;
}

function resolveTextureSource(
  reference: string,
  exact: ParticleVFXContentPackageResource | undefined,
): { blob: Blob | null; url: string | null; contentType: string | null } {
  if (exact) {
    return {
      blob: exact.blob,
      url: exact.blob ? null : safePublicUrl(exact.previewUrl),
      contentType: exact.contentType,
    };
  }
  if (reference.includes("..")) {
    throw new ParticleVFXContentPackageError(
      `Texture ${reference} is not available from the exact App source.`,
    );
  }
  const curated = PARTICLE_VFX_EDITOR_TEXTURES.find(
    (texture) => texture.relativeUrl === reference,
  );
  if (!curated) {
    throw new ParticleVFXContentPackageError(
      `Texture ${reference} is not available to the content entry.`,
    );
  }
  return {
    blob: null,
    url: safePublicUrl(curated.publicUrl),
    contentType: null,
  };
}

async function loadTextureBlob(
  source: { blob: Blob | null; url: string | null; contentType: string | null },
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<Blob> {
  if (source.blob) return source.blob;
  if (!source.url) {
    throw new ParticleVFXContentPackageError(
      "A texture resource is unresolved.",
    );
  }
  const response = await fetcher(source.url, { signal });
  if (!response.ok) {
    throw new ParticleVFXContentPackageError(
      `Texture fetch failed with HTTP ${response.status}.`,
    );
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TEXTURE_BYTES) {
    throw new ParticleVFXContentPackageError(
      `A texture exceeds the ${MAX_TEXTURE_BYTES / MIB} MiB limit.`,
    );
  }
  const blob = await response.blob();
  const responseType = response.headers.get("content-type")?.split(";")[0];
  return responseType && !blob.type
    ? blob.slice(0, blob.size, responseType)
    : blob;
}

async function detectTextureType(blob: Blob): Promise<TextureType | null> {
  const format = detectEffectArtFormat(
    new Uint8Array(await blob.slice(0, 12).arrayBuffer()),
  );
  if (format === "png") return { contentType: "image/png", extension: "png" };
  if (format === "jpeg") return { contentType: "image/jpeg", extension: "jpg" };
  if (format === "webp")
    return { contentType: "image/webp", extension: "webp" };
  return null;
}

function normalizeTextureContentType(value: string): TextureType | null {
  const normalized = value.trim().toLowerCase().split(";")[0];
  if (normalized === "image/png")
    return { contentType: normalized, extension: "png" };
  if (normalized === "image/jpeg" || normalized === "image/jpg") {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (normalized === "image/webp")
    return { contentType: normalized, extension: "webp" };
  return null;
}

function uniqueTextureFilename(
  reference: string,
  extension: TextureType["extension"],
  used: Set<string>,
): string {
  const basename =
    reference.replaceAll("\\", "/").split("/").at(-1) ?? "texture";
  const sourceStem = basename.replace(/\.[^.]+$/, "");
  const stem = safeStem(sourceStem, "texture");
  let filename = `${stem}.${extension}`;
  let suffix = 2;
  while (used.has(filename.toLocaleLowerCase("en-US"))) {
    filename = `${stem}-${suffix}.${extension}`;
    suffix += 1;
  }
  used.add(filename.toLocaleLowerCase("en-US"));
  return filename;
}

function rewriteImageReferences(
  json: Record<string, unknown>,
  rewritten: ReadonlyMap<string, string>,
): void {
  if (!Array.isArray(json.images)) return;
  for (const raw of json.images) {
    const image = recordValue(raw);
    if (typeof image?.url !== "string") continue;
    const replacement = rewritten.get(image.url.trim());
    if (replacement) image.url = replacement;
  }
}

function normalizeCatalogForPrivateContent(
  input: ParticleVFXEditorCatalogDraft,
): { catalog: ParticleVFXEditorCatalogDraft; notices: string[] } {
  const notices: string[] = [];
  const maxDurationSec = Math.min(
    input.performanceBudget.maxDurationSec,
    MAX_DURATION_SECONDS,
  );
  const maxParticles = Math.min(
    input.performanceBudget.maxParticles,
    MAX_PARTICLES,
  );
  if (maxDurationSec !== input.performanceBudget.maxDurationSec) {
    notices.push(
      "Maximum duration was reduced to the private 30-second limit.",
    );
  }
  if (maxParticles !== input.performanceBudget.maxParticles) {
    notices.push(
      "Particle budget was reduced to the private 512-particle limit.",
    );
  }
  return {
    catalog: {
      ...input,
      id: safeRuntimeId(input.id),
      assetPath: "",
      defaultDurationSec: Math.min(input.defaultDurationSec, maxDurationSec),
      defaultTransform: cloneJson(input.defaultTransform),
      performanceBudget: {
        ...input.performanceBudget,
        maxDurationSec,
        maxParticles,
      },
      shapeAutoFit: input.shapeAutoFit
        ? cloneJson(input.shapeAutoFit)
        : undefined,
    },
    notices,
  };
}

function validateRuntimeDefaults(catalog: ParticleVFXEditorCatalogDraft): void {
  if (!catalog.label.trim() || catalog.label.length > 120) {
    throw new ParticleVFXContentPackageError(
      "Particle VFX name must contain 1 to 120 characters.",
    );
  }
  if (catalog.description.length > 500) {
    throw new ParticleVFXContentPackageError(
      "Particle VFX description must contain at most 500 characters.",
    );
  }
  const transform = catalog.defaultTransform;
  validateNumber(transform.depthOffset, -100, 100, "depth offset");
  for (const [field, triple] of Object.entries({
    offset: transform.offset,
    rotation: transform.rotation,
    scale: transform.scale,
  })) {
    const minimum = field === "scale" ? Number.MIN_VALUE : -100;
    for (const component of Object.values(triple)) {
      validateNumber(component, minimum, 100, `${field} transform`);
    }
  }
  const fit = catalog.shapeAutoFit;
  if (!fit) return;
  const dimensions = [fit.padding, fit.minSize, fit.maxSize].filter(
    (value): value is NonNullable<typeof value> => value !== undefined,
  );
  for (const value of dimensions) {
    const entries = Object.values(value).filter(
      (component): component is number => component !== undefined,
    );
    if (!entries.length) {
      throw new ParticleVFXContentPackageError(
        "Rectangle auto-fit dimensions cannot be empty.",
      );
    }
    for (const component of entries) {
      validateNumber(component, 0, 100, "rectangle auto-fit dimension");
    }
  }
  for (const dimension of ["width", "height"] as const) {
    const minimum = fit.minSize?.[dimension];
    const maximum = fit.maxSize?.[dimension];
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      throw new ParticleVFXContentPackageError(
        `Rectangle auto-fit ${dimension} minimum exceeds its maximum.`,
      );
    }
  }
  if (
    fit.emitterNames &&
    (fit.emitterNames.length < 1 ||
      fit.emitterNames.length > 8 ||
      new Set(fit.emitterNames).size !== fit.emitterNames.length ||
      fit.emitterNames.some((name) => !name.trim() || name.length > 120))
  ) {
    throw new ParticleVFXContentPackageError(
      "Rectangle auto-fit emitter names must be unique and match up to eight emitters.",
    );
  }
}

function validateNumber(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ParticleVFXContentPackageError(
      `Particle VFX ${label} is outside the supported content range.`,
    );
  }
}

function buildAuthoringManifest(
  catalog: ParticleVFXEditorCatalogDraft,
): Record<string, unknown> {
  return {
    schema: "animama/particle-vfx-authoring/1",
    authoring: { schema_version: 1, tool: "particle_vfx_creator" },
    runtime_defaults: {
      schema_version: 1,
      runtime_id: safeRuntimeId(catalog.id),
      slots: {
        particle_vfx: {
          label: catalog.label,
          description: catalog.description,
          anchor: catalog.defaultAnchor,
          duration_seconds: catalog.defaultDurationSec,
          max_duration_seconds: catalog.performanceBudget.maxDurationSec,
          preload_tier:
            catalog.preloadTier === "tierA"
              ? "tier_a"
              : catalog.preloadTier === "tierB"
                ? "tier_b"
                : "none",
          follow_anchor: catalog.defaultFollowAnchor,
          transform: transformConfig(catalog.defaultTransform),
          looping_allowed: catalog.performanceBudget.loopingAllowed,
          can_coexist: catalog.performanceBudget.canCoexist,
          max_particles: catalog.performanceBudget.maxParticles,
          ...(catalog.shapeAutoFit
            ? { shape_auto_fit: shapeAutoFitConfig(catalog.shapeAutoFit) }
            : {}),
        },
      },
    },
  };
}

function transformConfig(value: ParticleVFXTransform) {
  return {
    offset: value.offset,
    depth_offset: value.depthOffset,
    rotation: value.rotation,
    scale: value.scale,
  };
}

function shapeAutoFitConfig(value: ParticleVFXShapeAutoFit) {
  return {
    kind: "avatar_bounds_rectangle",
    ...(value.padding ? { padding: value.padding } : {}),
    ...(value.minSize ? { min_size: value.minSize } : {}),
    ...(value.maxSize ? { max_size: value.maxSize } : {}),
    ...(value.emitterNames ? { emitter_names: value.emitterNames } : {}),
  };
}

function safePublicUrl(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) {
    throw new ParticleVFXContentPackageError(
      "Public texture resources must be same-origin paths.",
    );
  }
  return value;
}

function isPotentialLogicalReference(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized.includes("?") ||
    normalized.includes("#") ||
    /^(?:data|file|https?|javascript|blob):/i.test(normalized)
  ) {
    return false;
  }
  try {
    if (decodeURIComponent(normalized) !== normalized) return false;
  } catch {
    return false;
  }
  return normalized.split("/").every((part) => part && part !== ".");
}

function safeStem(value: string, fallback: string): string {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || fallback
  );
}

function safeRuntimeId(value: string): string {
  const bounded = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64)
    .replace(/[-_]+$/g, "");
  try {
    return normalizeRuntimeContentId(bounded);
  } catch {
    return "custom-particle-vfx";
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
