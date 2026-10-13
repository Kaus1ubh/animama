import { getI18n } from "react-i18next";
import {
  PARTICLE_VFX_EDITOR_TEXTURES,
  createParticleVFXEditorDraftFromImport,
  validateParticleVFXContentReadiness,
  type ParticleVFXEditorCatalogDraft,
  type ParticleVFXEditorDraft,
  type ParticleVFXShapeAutoFit,
  type ParticleVFXTransform,
} from "@/lib/avatar/particle-vfx";
import { WordedError } from "@/lib/errors/apiError";
import { normalizeRuntimeContentId } from "@/lib/runtime-content/runtimeId";

const MAX_TEXTURES = 16;
const MAX_TEXTURE_BYTES = 25 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
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

/** A package refusal, worded in the UI Locale from the catalog. */
export class ParticleVFXContentPackageError extends WordedError {
  constructor(message: string) {
    super(message);
    this.name = "ParticleVFXContentPackageError";
  }
}

/**
 * Construct a standalone, deterministic private Particle VFX package.
 * Temporary delivery URLs are read only from the resource inventory and never
 * copied into the normalized authoring manifest.
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
  const t = getI18n().getFixedT(null, "library");
  const rawJson = cloneJson(draft.quarksJson);
  const { catalog, notices } = normalizeCatalogForPrivateContent(draft.catalog);
  validateRuntimeDefaults(catalog);
  const references = collectRawImageReferences(rawJson);
  if (references.length > MAX_TEXTURES) {
    throw new ParticleVFXContentPackageError(
      t("content.particle.tooManyTextures", { count: MAX_TEXTURES }),
    );
  }
  const resourcesByReference = new Map<
    string,
    ParticleVFXContentPackageResource
  >();
  for (const resource of resources) {
    if (resourcesByReference.has(resource.logicalReference)) {
      throw new ParticleVFXContentPackageError(
        t("content.particle.textureAmbiguous", {
          texture: resource.logicalReference,
        }),
      );
    }
    resourcesByReference.set(resource.logicalReference, resource);
  }

  const usedNames = new Set<string>();
  const rewritten = new Map<string, string>();
  const textures: ParticleVFXContentPackageTexture[] = [];
  let packageBytes = 0;
  for (const [index, logicalReference] of references.entries()) {
    signal?.throwIfAborted();
    const source = resolveTextureSource(
      logicalReference,
      resourcesByReference.get(logicalReference),
    );
    const blob = await loadTextureBlob(source, fetcher, signal);
    if (!blob.size) {
      throw new ParticleVFXContentPackageError(
        t("content.particle.textureEmpty", { texture: logicalReference }),
      );
    }
    if (blob.size > MAX_TEXTURE_BYTES) {
      throw new ParticleVFXContentPackageError(
        t("content.particle.textureTooLarge", { texture: logicalReference }),
      );
    }
    const detected = await detectTextureType(blob);
    const declaredValue = source.contentType || blob.type;
    const declared = normalizeTextureContentType(declaredValue);
    if (
      !detected ||
      (declaredValue && !declared) ||
      (declared && declared.contentType !== detected.contentType)
    ) {
      throw new ParticleVFXContentPackageError(
        t("content.particle.textureMismatched", { texture: logicalReference }),
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
  );
  const readiness = validateParticleVFXContentReadiness(normalizedDraft, {
    resolvableTextureReferences: new Set(
      textures.map((texture) => texture.packageReference),
    ),
  });
  if (!readiness.ready) {
    const issue = readiness.issues.find(({ severity }) => severity === "error");
    throw new ParticleVFXContentPackageError(
      issue?.message ?? t("content.particle.notReady"),
    );
  }

  const manifestFile = new File(
    [JSON.stringify(normalizedDraft.quarksJson)],
    `${safeStem(normalizedDraft.catalog.id, "particle-vfx")}.json`,
    { type: "application/json" },
  );
  if (manifestFile.size > MAX_MANIFEST_BYTES) {
    throw new ParticleVFXContentPackageError(
      t("content.particle.manifestTooLarge"),
    );
  }
  packageBytes += manifestFile.size;
  if (packageBytes > MAX_PACKAGE_BYTES) {
    throw new ParticleVFXContentPackageError(
      t("content.particle.packageTooLarge"),
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
  const t = getI18n().getFixedT(null, "library");
  const images = Array.isArray(json.images) ? json.images : [];
  const references: string[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of images.entries()) {
    const image = recordValue(raw);
    const reference = typeof image?.url === "string" ? image.url.trim() : "";
    if (!reference) continue;
    if (!isPotentialLogicalReference(reference)) {
      throw new ParticleVFXContentPackageError(
        t("content.particle.referenceUnsafe", { index: index + 1 }),
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
  const t = getI18n().getFixedT(null, "library");
  if (exact) {
    return {
      blob: exact.blob,
      url: exact.blob ? null : safePublicUrl(exact.previewUrl),
      contentType: exact.contentType,
    };
  }
  if (reference.includes("..")) {
    throw new ParticleVFXContentPackageError(
      t("content.particle.textureNotInApp", { texture: reference }),
    );
  }
  const curated = PARTICLE_VFX_EDITOR_TEXTURES.find(
    (texture) => texture.relativeUrl === reference,
  );
  if (!curated) {
    throw new ParticleVFXContentPackageError(
      t("content.particle.textureNotAvailable", { texture: reference }),
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
  const t = getI18n().getFixedT(null, "library");
  if (!source.url) {
    throw new ParticleVFXContentPackageError(
      t("content.particle.textureUnresolved"),
    );
  }
  const response = await fetcher(source.url, { signal });
  if (!response.ok) {
    throw new ParticleVFXContentPackageError(
      t("content.particle.textureFetchFailed", { status: response.status }),
    );
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TEXTURE_BYTES) {
    throw new ParticleVFXContentPackageError(
      t("content.particle.aTextureTooLarge"),
    );
  }
  const blob = await response.blob();
  const responseType = response.headers.get("content-type")?.split(";")[0];
  return responseType && !blob.type
    ? blob.slice(0, blob.size, responseType)
    : blob;
}

async function detectTextureType(blob: Blob): Promise<TextureType | null> {
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { contentType: "image/png", extension: "png" };
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }
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
  const t = getI18n().getFixedT(null, "library");
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
    notices.push(t("content.particle.durationReduced"));
  }
  if (maxParticles !== input.performanceBudget.maxParticles) {
    notices.push(t("content.particle.budgetReduced"));
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
  const t = getI18n().getFixedT(null, "library");
  if (!catalog.label.trim() || catalog.label.length > 120) {
    throw new ParticleVFXContentPackageError(t("content.particle.nameLength"));
  }
  if (catalog.description.length > 500) {
    throw new ParticleVFXContentPackageError(
      t("content.particle.descriptionLength"),
    );
  }
  const transform = catalog.defaultTransform;
  validateNumber(
    transform.depthOffset,
    -100,
    100,
    t("content.particle.settings.depthOffset"),
  );
  const transforms = [
    [transform.offset, -100, t("content.particle.settings.offset")],
    [transform.rotation, -100, t("content.particle.settings.rotation")],
    [transform.scale, Number.MIN_VALUE, t("content.particle.settings.scale")],
  ] as const;
  for (const [triple, minimum, setting] of transforms) {
    for (const component of Object.values(triple)) {
      validateNumber(component, minimum, 100, setting);
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
        t("content.particle.autoFitEmpty"),
      );
    }
    for (const component of entries) {
      validateNumber(
        component,
        0,
        100,
        t("content.particle.settings.autoFitDimension"),
      );
    }
  }
  for (const dimension of ["width", "height"] as const) {
    const minimum = fit.minSize?.[dimension];
    const maximum = fit.maxSize?.[dimension];
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      throw new ParticleVFXContentPackageError(
        dimension === "width"
          ? t("content.particle.autoFitWidthRange")
          : t("content.particle.autoFitHeightRange"),
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
      t("content.particle.autoFitEmitters"),
    );
  }
}

/** `setting` is the worded name of the checked setting. */
function validateNumber(
  value: number,
  minimum: number,
  maximum: number,
  setting: string,
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    const t = getI18n().getFixedT(null, "library");
    throw new ParticleVFXContentPackageError(
      t("content.particle.outOfRange", { setting }),
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
    const t = getI18n().getFixedT(null, "library");
    throw new ParticleVFXContentPackageError(
      t("content.particle.publicTextureOrigin"),
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

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
