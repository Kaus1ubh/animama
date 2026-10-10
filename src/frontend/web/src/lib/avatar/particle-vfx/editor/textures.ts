import {
  BILLBOARD_GEOMETRY_UUID,
  DEFAULT_TEXTURE_ID,
  PARTICLE_VFX_EDITOR_TEXTURES,
} from "./constants";
import {
  ensureJsonArrayProperty,
  readJsonArrayObjects,
  readJsonObject,
} from "./json";
import { setFrameOverLifeDraft } from "./behaviors";
import type {
  JsonObject,
  ParticleVFXEditorBlending,
  ParticleVFXEditorTextureEntry,
} from "./types";

export type ParticleVFXMaterialAssets = {
  materialUuid: string;
  textureUuid: string;
  imageUuid: string;
};

export function getParticleVFXEditorTextureById(
  textureId: string,
): ParticleVFXEditorTextureEntry | null {
  return (
    PARTICLE_VFX_EDITOR_TEXTURES.find((texture) => texture.id === textureId) ??
    null
  );
}

export function ensureEmitterMaterialAssets(
  quarksJson: JsonObject,
  effectId: string,
  index: number,
  textureId: string,
): ParticleVFXMaterialAssets {
  ensureBillboardGeometry(quarksJson);
  const textureEntry =
    getParticleVFXEditorTextureById(textureId) ??
    getParticleVFXEditorTextureById(DEFAULT_TEXTURE_ID) ??
    PARTICLE_VFX_EDITOR_TEXTURES[0];
  const token = makeMaterialSafeId(`${effectId}-${index}`);
  const materialUuid = `animama-${token}-material`;
  const textureUuid = `animama-${token}-texture`;
  const imageUuid = `animama-${token}-image`;
  ensureJsonArrayProperty(quarksJson, "materials").push(
    createMaterialJson(
      materialUuid,
      textureUuid,
      textureEntry.recommendedBlending,
    ),
  );
  ensureJsonArrayProperty(quarksJson, "textures").push(
    createTextureJson(textureUuid, imageUuid, textureEntry.fileName),
  );
  ensureJsonArrayProperty(quarksJson, "images").push({
    uuid: imageUuid,
    url: textureEntry.relativeUrl,
  });
  return { materialUuid, textureUuid, imageUuid };
}

export function readEmitterTexture(
  quarksJson: JsonObject,
  ps: JsonObject,
): { id: string | null; url: string | null } | null {
  const material = readEmitterMaterial(quarksJson, ps);
  const textureUuid = typeof material?.map === "string" ? material.map : null;
  const texture = textureUuid
    ? readJsonArrayObjects(quarksJson.textures).find(
        (item) => item.uuid === textureUuid,
      )
    : null;
  const imageUuid = typeof texture?.image === "string" ? texture.image : null;
  const image = imageUuid
    ? readJsonArrayObjects(quarksJson.images).find(
        (item) => item.uuid === imageUuid,
      )
    : null;
  const url = typeof image?.url === "string" ? image.url : null;
  return {
    id: url ? textureIdFromUrl(url) : null,
    url,
  };
}

export function setEmitterTexture(
  quarksJson: JsonObject,
  ps: JsonObject,
  textureId: string,
): void {
  const textureEntry =
    getParticleVFXEditorTextureById(textureId) ??
    getParticleVFXEditorTextureById(DEFAULT_TEXTURE_ID) ??
    PARTICLE_VFX_EDITOR_TEXTURES[0];
  const material = ensureEmitterMaterial(quarksJson, ps);
  material.blending = blendingToThree(textureEntry.recommendedBlending);
  ps.renderMode = textureEntry.recommendedRenderMode;
  ps.uTileCount = textureEntry.atlas?.uTileCount ?? 1;
  ps.vTileCount = textureEntry.atlas?.vTileCount ?? 1;
  ps.blendTiles = textureEntry.atlas?.blendTiles ?? false;
  setFrameOverLifeDraft(
    ps,
    textureEntry.atlas?.frameOverLife
      ? {
          mode: "linear",
          ...textureEntry.atlas.frameOverLife,
        }
      : { mode: "off", startFrame: 0, endFrame: 0 },
  );
  let texture = readJsonArrayObjects(quarksJson.textures).find(
    (item) => item.uuid === material.map,
  );
  if (!texture) {
    const materialUuid =
      typeof ps.material === "string"
        ? ps.material
        : makeMaterialSafeId("material");
    const textureUuid = `${materialUuid}-texture`;
    const imageUuid = `${materialUuid}-image`;
    texture = createTextureJson(textureUuid, imageUuid, textureEntry.fileName);
    ensureJsonArrayProperty(quarksJson, "textures").push(texture);
    ensureJsonArrayProperty(quarksJson, "images").push({
      uuid: imageUuid,
      url: textureEntry.relativeUrl,
    });
    material.map = textureUuid;
  }
  texture.name = textureEntry.fileName;
  const imageUuid =
    typeof texture.image === "string" ? texture.image : `${texture.uuid}-image`;
  texture.image = imageUuid;
  const images = ensureJsonArrayProperty(quarksJson, "images");
  let image = images
    .map((item) => readJsonObject(item))
    .find((item) => item?.uuid === imageUuid);
  if (!image) {
    image = { uuid: imageUuid };
    images.push(image);
  }
  image.url = textureEntry.relativeUrl;
}

/**
 * Point an emitter at a texture the effect carries, by its package-relative
 * path. The art is a single image until the Atlas settings say otherwise, so
 * tiles and frame animation reset; blending and render mode stay.
 */
export function setEmitterTextureReference(
  quarksJson: JsonObject,
  ps: JsonObject,
  reference: string,
): void {
  setEmitterImageUrl(quarksJson, ps, reference);
  ps.uTileCount = 1;
  ps.vTileCount = 1;
  ps.blendTiles = false;
  setFrameOverLifeDraft(ps, { mode: "off", startFrame: 0, endFrame: 0 });
}

/** Change only the image an emitter's material draws. */
export function setEmitterImageUrl(
  quarksJson: JsonObject,
  ps: JsonObject,
  url: string,
): void {
  const material = ensureEmitterMaterial(quarksJson, ps);
  let texture = readJsonArrayObjects(quarksJson.textures).find(
    (item) => item.uuid === material.map,
  );
  if (!texture) {
    const textureUuid = `${String(material.uuid)}-texture`;
    texture = createTextureJson(textureUuid, `${textureUuid}-image`, "");
    ensureJsonArrayProperty(quarksJson, "textures").push(texture);
    material.map = textureUuid;
  }
  texture.name = url.split("/").at(-1) ?? url;
  const imageUuid =
    typeof texture.image === "string" ? texture.image : `${texture.uuid}-image`;
  texture.image = imageUuid;
  const images = ensureJsonArrayProperty(quarksJson, "images");
  let image = images
    .map((item) => readJsonObject(item))
    .find((item) => item?.uuid === imageUuid);
  if (!image) {
    image = { uuid: imageUuid };
    images.push(image);
  }
  image.url = url;
}

export function readEmitterMaterial(
  quarksJson: JsonObject,
  ps: JsonObject,
): JsonObject | null {
  const materialUuid = typeof ps.material === "string" ? ps.material : null;
  return materialUuid
    ? (readJsonArrayObjects(quarksJson.materials).find(
        (item) => item.uuid === materialUuid,
      ) ?? null)
    : null;
}

export function ensureEmitterMaterial(
  quarksJson: JsonObject,
  ps: JsonObject,
): JsonObject {
  const existing = readEmitterMaterial(quarksJson, ps);
  if (existing) return existing;
  const materialUuid =
    typeof ps.material === "string" ? ps.material : "animama-editor-material";
  const textureUuid = `${materialUuid}-texture`;
  const material = createMaterialJson(materialUuid, textureUuid);
  ensureJsonArrayProperty(quarksJson, "materials").push(material);
  ps.material = materialUuid;
  return material;
}

export function resolveParticleVFXPublicAssetPath(
  baseAssetPath: string,
  assetUrl: string,
): string {
  const trimmed = assetUrl.trim();
  const classification = classifyParticleVFXTextureUrl(trimmed);
  if (
    classification === "remote" ||
    classification === "embedded" ||
    classification === "blob" ||
    classification === "unsupported"
  ) {
    return trimmed;
  }
  if (trimmed.startsWith("/")) return trimmed;

  const base = baseAssetPath.startsWith("/")
    ? baseAssetPath
    : `/${baseAssetPath}`;
  const baseParts = base.split("/").slice(0, -1);
  for (const part of trimmed.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (baseParts.length > 1) baseParts.pop();
      continue;
    }
    baseParts.push(part);
  }
  return baseParts.join("/") || "/";
}

export function classifyParticleVFXTextureUrl(
  assetUrl: string,
):
  | "relative"
  | "root-relative"
  | "remote"
  | "embedded"
  | "blob"
  | "unsupported" {
  const trimmed = assetUrl.trim();
  if (!trimmed) return "unsupported";
  if (/^https?:\/\//i.test(trimmed) || /^\/\//.test(trimmed)) {
    return "remote";
  }
  if (/^data:image\//i.test(trimmed)) return "embedded";
  if (/^blob:/i.test(trimmed)) return "blob";
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return "unsupported";
  if (trimmed.startsWith("/")) return "root-relative";
  return "relative";
}

function ensureBillboardGeometry(quarksJson: JsonObject): void {
  const geometries = ensureJsonArrayProperty(quarksJson, "geometries");
  if (
    geometries.some(
      (geometry) => readJsonObject(geometry)?.uuid === BILLBOARD_GEOMETRY_UUID,
    )
  ) {
    return;
  }
  geometries.unshift(createBillboardGeometry());
}

function createBillboardGeometry(): JsonObject {
  return {
    uuid: BILLBOARD_GEOMETRY_UUID,
    type: "PlaneGeometry",
    width: 1,
    height: 1,
    widthSegments: 1,
    heightSegments: 1,
  };
}

function createMaterialJson(
  materialUuid: string,
  textureUuid: string,
  blending: ParticleVFXEditorBlending = "additive",
): JsonObject {
  return {
    uuid: materialUuid,
    type: "MeshBasicMaterial",
    color: 16777215,
    map: textureUuid,
    reflectivity: 1,
    refractionRatio: 0.98,
    blending: blendingToThree(blending),
    side: 2,
    transparent: true,
    opacity: 1,
    alphaTest: 0,
    depthFunc: 3,
    depthTest: true,
    depthWrite: false,
    colorWrite: true,
    stencilWrite: false,
    stencilWriteMask: 255,
    stencilFunc: 519,
    stencilRef: 0,
    stencilFuncMask: 255,
    stencilFail: 7680,
    stencilZFail: 7680,
    stencilZPass: 7680,
  };
}

function blendingToThree(blending: ParticleVFXEditorBlending): number {
  return blending === "normal" ? 1 : 2;
}

function createTextureJson(
  textureUuid: string,
  imageUuid: string,
  fileName: string,
): JsonObject {
  return {
    uuid: textureUuid,
    name: fileName,
    image: imageUuid,
    mapping: 300,
    channel: 0,
    repeat: [1, 1],
    offset: [0, 0],
    center: [0, 0],
    rotation: 0,
    wrap: [1001, 1001],
    format: 1023,
    internalFormat: null,
    type: 1009,
    colorSpace: "",
    minFilter: 1008,
    magFilter: 1006,
    anisotropy: 1,
    flipY: true,
    generateMipmaps: true,
    premultiplyAlpha: false,
    unpackAlignment: 4,
  };
}

/** The built-in texture an image path names exactly (`textures/<file>`). */
function textureIdFromUrl(url: string): string | null {
  return (
    PARTICLE_VFX_EDITOR_TEXTURES.find(
      (textureEntry) => textureEntry.relativeUrl === url,
    )?.id ?? null
  );
}

function makeMaterialSafeId(value: string): string {
  const safe = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || "particle-vfx";
}
