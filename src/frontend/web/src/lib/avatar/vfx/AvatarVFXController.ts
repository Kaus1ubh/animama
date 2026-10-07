"use client";

import * as THREE from "three";

import { loadEffectImage } from "./effect-image";
import {
  rectangleGuidePoints,
  resolveTexturePlacementTransform,
  transformTexturePlacementPoint,
} from "./placement-transform";
import type {
  AvatarVFXPlacementGuides,
  AvatarVFXUvGuide,
} from "./placement-guide-types";

import type { Avatar } from "../Avatar";
import type {
  AvatarFaceTextureAnchorSnapshot,
  AvatarFaceTextureAnchorsSnapshot,
  AvatarFaceTextureFlattenRegionSnapshot,
  AvatarFaceTextureReferenceSize,
} from "./texture-anchor-types";
import type {
  AvatarFaceEyeLandmarkSnapshot,
  AvatarFaceLandmarksSnapshot,
  AvatarFaceLandmarkVector,
} from "./landmark-types";
import {
  EMPTY_RUNTIME_MEDIA_PROVIDER,
  type AnimaRuntimeMediaProvider,
} from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";
import {
  deriveAvatarVFXAnimationPreset,
  evaluateAvatarVFXAnimation,
  resolveAvatarVFXAnimationConfig,
} from "./animation";
import { matchAvatarTargetRole } from "./avatarRuntimeTargeting";
import { resolveAvatarVFXModelProfile } from "./profiles";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";
import type {
  AvatarVFXAnimationPreset,
  AvatarVFXAppearance,
  AvatarVFXAppliedEffectSnapshot,
  AvatarVFXBlend,
  AvatarVFXDeferredAttachmentEntry,
  AvatarVFXApplyMode,
  AvatarVFXCatalogEntry,
  AvatarVFXFaceFlattenSnapshot,
  AvatarVFXFlattenColorSnapshot,
  AvatarVFXFlipbook,
  AvatarEyeHoverVFXEntry,
  AvatarFaceAnchoredVFXEntry,
  AvatarHoverVFXEntry,
  AvatarMouthHoverVFXEntry,
  AvatarVFXHoverPlacement,
  AvatarVFXModelProfile,
  AvatarVFXNormalizedRect,
  AvatarVFXObservationSnapshot,
  AvatarVFXRenderMode,
  AvatarVFXResolvedAnimationConfig,
  AvatarVFXRegion,
  AvatarVFXSnapshot,
  AvatarVFXTargetBindingSnapshot,
  AvatarVFXTargetRole,
  AvatarVFXTargetBindingTextureSlot,
  AvatarVFXSide,
  AvatarTextureVFXEntry,
  AvatarVFXTransform,
  AvatarVFXTransformAxisTriple,
  AvatarVFXTextureSlot,
} from "./types";
import type { AvatarVFXAnimationState } from "./animation";
import {
  getAvatarVFXApplyMode,
  getAvatarVFXRegion,
  getAvatarVFXRenderMode,
  getAvatarVFXTargetRole,
  isAvatarVFXRegionStackable,
  isBoxHoverVFXEntry,
  isEyeHoverVFXEntry,
  isFaceAnchoredVFXEntry,
  isHoverVFXEntry,
  isMouthHoverVFXEntry,
  isTextureVFXEntry,
} from "./types";

type CanvasContext = CanvasRenderingContext2D;
type VFXListener = () => void;

type BindingTextureState = {
  slot: AvatarVFXTextureSlot;
  texture: THREE.Texture;
  width: number;
  height: number;
  canOverlay: boolean;
};

type EffectLayerCanvasState = {
  slot: AvatarVFXTextureSlot;
  image: CanvasImageSource;
  /** Unmirrored art for mirrored placements, when the effect has one. */
  otherImage: CanvasImageSource | null;
  placements: TexturePixelPlacementInstance[];
  width: number;
  height: number;
};

type CompositeTextureSlotState = {
  slot: AvatarVFXTextureSlot;
  canvas: HTMLCanvasElement;
  context: CanvasContext;
  texture: THREE.CanvasTexture;
  staticSegments: StaticCompositeSegmentState[];
  width: number;
  height: number;
  /** Whether the static cache drew the original slot beneath its effects. */
  baseDrawn: boolean;
};

type BindingTextureCompositeState = {
  materialClone: THREE.Material;
  slotStates: Map<AvatarVFXTextureSlot, CompositeTextureSlotState>;
  staticCacheDirty: boolean;
};

type ActiveBindingEffect = {
  appliedEffectId: string;
  effectId: string;
  effectEntry: AvatarVFXCatalogEntry;
  applyMode: AvatarVFXApplyMode | null;
  animationPreset: AvatarVFXAnimationPreset | null;
  animationConfig: AvatarVFXResolvedAnimationConfig;
  renderMode: AvatarVFXRenderMode;
  forcesBlink: boolean;
  layerCanvases: Map<AvatarVFXTextureSlot, EffectLayerCanvasState>;
  hoverGroup: THREE.Group | null;
  hoverInstances: HoverPlaneInstanceState[];
  hoverRuntimeMaterials: THREE.Material[];
  disabledBindingKeys: string[];
  elapsedSec: number;
  /** Redrawn on each animation tick: own motion, or a fade below full intensity. */
  isAnimated: boolean;
  /** The effect's own motion (presets, keyframes or flipbook), without fades. */
  hasOwnMotion: boolean;
  animationState: AvatarVFXAnimationState;
  appliedOrder: number;
  /** Event envelope value (0–1) that multiplies opacity; 1 without a fade. */
  intensity: number;
  /** Pre-tinted copies of the effect's images, built once per image. */
  tintedImages: Map<CanvasImageSource, HTMLCanvasElement>;
};

type BindingState = {
  bindingKey: string;
  targetRole: AvatarVFXTargetRole;
  materialIndex: number | null;
  materialName: string | null;
  objectName: string | null;
  objectType: string;
  object: THREE.Mesh;
  originalVisible: boolean;
  originalMaterial: THREE.Material | THREE.Material[];
  originalMainMaterial: THREE.Material | null;
  textureSlots: BindingTextureState[];
  availableEffectIds: string[];
  autoDisableSources: Set<string>;
  visibleBeforeAutoDisable: boolean | null;
  warning: string | null;
  activeEffects: Map<string, ActiveBindingEffect>;
  textureComposite: BindingTextureCompositeState | null;
};

type Size = {
  width: number;
  height: number;
};

type HoverPlacementInstance = {
  label: string;
  mirrored: boolean;
  position: THREE.Vector3;
  referenceSizeLocal: AvatarFaceTextureReferenceSize | null;
};

type TexturePlacementInstance = {
  label: string;
  mirrorX: boolean;
  /** The effect's own mirrored copy; see `TexturePlacement.effectMirror`. */
  effectMirror?: boolean;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type TexturePixelPlacementInstance = {
  label: string;
  mirrorX: boolean;
  /** The effect's own mirrored copy; see `TexturePlacement.effectMirror`. */
  effectMirror?: boolean;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type StaticCompositeSegmentState = {
  canvas: HTMLCanvasElement;
  context: CanvasContext;
};

type HoverPlaneInstanceState = {
  label: string;
  mesh: THREE.Mesh;
  animatedGroup: THREE.Group;
  planeWidth: number;
  planeHeight: number;
  /** Mirrored placements mirror keyframe offsets as well as static ones. */
  mirrored: boolean;
  material: THREE.MeshBasicMaterial;
  texture: THREE.Texture;
  backdropMaterial: THREE.Material | null;
  backdropBaseOpacity: number;
};

type HoverEffectGroupState = {
  group: THREE.Group;
  instances: HoverPlaneInstanceState[];
  runtimeMaterials: THREE.Material[];
};

type ResolvedFaceFlattenState = {
  status: "unavailable" | "ready";
  faceBindingKey: string | null;
  previewEyes: boolean;
  previewMouth: boolean;
  autoEyes: boolean;
  autoMouth: boolean;
  activeEyes: boolean;
  activeMouth: boolean;
  sampledColor: AvatarVFXFlattenColorSnapshot | null;
  sampledColorsBySlot: Partial<
    Record<AvatarVFXTextureSlot, AvatarVFXFlattenColorSnapshot>
  >;
  warning: string | null;
  shouldRenderEyes: boolean;
  shouldRenderMouth: boolean;
  eyeRegions: AvatarFaceTextureFlattenRegionSnapshot[];
  mouthRegion: AvatarFaceTextureFlattenRegionSnapshot | null;
};

const SUPPORTED_TEXTURE_SLOTS: AvatarVFXTextureSlot[] = [
  "map",
  "shadeMultiplyTexture",
];

const EYE_HOVER_PLANE_HEIGHT = 0.06;
const BOX_HOVER_PLANE_HEIGHT = 0.08;
const EYE_HOVER_SURFACE_LERP = 0.35;
const MOUTH_HOVER_SURFACE_LERP = 0.1;
const HOVER_SKIN_BACKDROP_TEXTURE_SIZE = 256;
const HOVER_SKIN_BACKDROP_WIDTH_SCALE = 1.0;
const HOVER_SKIN_BACKDROP_HEIGHT_SCALE = 0.4;
const HOVER_SKIN_BACKDROP_Z_OFFSET = -0.0001;
const HOVER_RENDER_ORDER = 950;
const EYE_HOVER_FORCE_BLINK_EXPRESSION = "blink";
const VFX_ANIMATION_FRAME_INTERVAL_SEC = 1 / 30;
const FACE_FLATTEN_EDGE_FEATHER_RATIO = 0.4;
const EYE_HOVER_AUTO_DISABLED_ROLES: AvatarVFXTargetRole[] = [
  "eye_highlight",
  "eyeline",
  "eyelash",
];
const HOVER_BACKDROP_STRIPPED_TEXTURE_PROPS = [
  "alphaMap",
  "normalMap",
  "normalTexture",
  "bumpMap",
  "aoMap",
  "emissiveMap",
  "emissiveTexture",
  "matcap",
  "matcapTexture",
  "metalnessMap",
  "roughnessMap",
  "occlusionTexture",
  "outlineWidthMultiplyTexture",
  "rimMultiplyTexture",
  "shadingShiftTexture",
  "uvAnimationMaskTexture",
] as const;

function isMaterialWithTextures(
  value: THREE.Material | null,
): value is THREE.Material & Record<string, unknown> {
  return value instanceof THREE.Material;
}

function hasMaterialUpdate(
  value: THREE.Material | null,
): value is THREE.Material & { update: (delta: number) => void } {
  if (!(value instanceof THREE.Material)) return false;
  const candidate = value as THREE.Material & {
    update?: ((delta: number) => void) | undefined;
  };
  return typeof candidate.update === "function";
}

function isCanvasImageSource(value: unknown): value is CanvasImageSource {
  if (!value) return false;
  if (
    typeof HTMLImageElement !== "undefined" &&
    value instanceof HTMLImageElement
  ) {
    return true;
  }
  if (
    typeof HTMLCanvasElement !== "undefined" &&
    value instanceof HTMLCanvasElement
  ) {
    return true;
  }
  if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) {
    return true;
  }
  if (
    typeof OffscreenCanvas !== "undefined" &&
    value instanceof OffscreenCanvas
  ) {
    return true;
  }
  if (
    typeof HTMLVideoElement !== "undefined" &&
    value instanceof HTMLVideoElement
  ) {
    return true;
  }
  return false;
}

function cloneTransformAxisTriple(
  value: AvatarVFXTransformAxisTriple,
): AvatarVFXTransformAxisTriple {
  return {
    x: value.x,
    y: value.y,
    z: value.z,
  };
}

function cloneEffectTransform(value: AvatarVFXTransform): AvatarVFXTransform {
  return {
    offset: cloneTransformAxisTriple(value.offset),
    scale: cloneTransformAxisTriple(value.scale),
    rotation: cloneTransformAxisTriple(value.rotation),
  };
}

function resolveStaticScaleComponent(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.0001, Math.abs(value));
}

function formatSizeLabel(width: number, height: number): string {
  return `${width}x${height}`;
}

function resolveEffectRenderMode(
  effect: AvatarVFXCatalogEntry,
): AvatarVFXRenderMode {
  return getAvatarVFXRenderMode(effect);
}

function resolveTextureLayout(
  effect: AvatarFaceAnchoredVFXEntry,
): "single" | "span" {
  if (effect.anchor === "mouth") {
    return "single";
  }
  return effect.layout;
}

function resolveTexturePivot(effect: {
  pivot?: AvatarFaceAnchoredVFXEntry["pivot"];
}): NonNullable<AvatarFaceAnchoredVFXEntry["pivot"]> {
  return effect.pivot ?? "center";
}

function isAnchoredFaceTextureEffect(
  effect: AvatarVFXCatalogEntry,
): effect is AvatarFaceAnchoredVFXEntry {
  return isFaceAnchoredVFXEntry(effect);
}

function cloneCatalogEffectEntry(
  effect: AvatarVFXCatalogEntry,
): AvatarVFXCatalogEntry {
  return {
    ...effect,
    transform: cloneEffectTransform(effect.transform),
    animationConfig: effect.animationConfig
      ? {
          ...effect.animationConfig,
          driftPerSecond: effect.animationConfig.driftPerSecond
            ? { ...effect.animationConfig.driftPerSecond }
            : undefined,
        }
      : undefined,
  };
}

function shouldForceBlink(effect: AvatarVFXCatalogEntry): boolean {
  return isEyeHoverVFXEntry(effect) && (effect.forceBlink ?? true);
}

function getAutoDisabledRoles(
  effect: AvatarVFXCatalogEntry,
): AvatarVFXTargetRole[] {
  const roles = new Set(
    "disableTargetRoles" in effect ? (effect.disableTargetRoles ?? []) : [],
  );
  if (isEyeHoverVFXEntry(effect) && (effect.autoDisableEyeMaterials ?? true)) {
    EYE_HOVER_AUTO_DISABLED_ROLES.forEach((role) => roles.add(role));
  }
  return Array.from(roles);
}

function lerpNumber(start: number, end: number, alpha: number): number {
  return start + (end - start) * alpha;
}

function toVector3(value: AvatarFaceLandmarkVector): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z);
}

function lerpVector3(
  start: THREE.Vector3,
  end: THREE.Vector3,
  alpha: number,
): THREE.Vector3 {
  return start.clone().lerp(end, alpha);
}

function midpointVector3(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
  return a.clone().lerp(b, 0.5);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getImageSize(image: CanvasImageSource): Size | null {
  const imageRecord = image as {
    width?: number;
    height?: number;
    videoWidth?: number;
    videoHeight?: number;
    displayWidth?: number;
    displayHeight?: number;
  };
  const width =
    (typeof imageRecord.width === "number" && imageRecord.width > 0
      ? imageRecord.width
      : null) ??
    (typeof imageRecord.videoWidth === "number" && imageRecord.videoWidth > 0
      ? imageRecord.videoWidth
      : null) ??
    (typeof imageRecord.displayWidth === "number" &&
    imageRecord.displayWidth > 0
      ? imageRecord.displayWidth
      : null);
  const height =
    (typeof imageRecord.height === "number" && imageRecord.height > 0
      ? imageRecord.height
      : null) ??
    (typeof imageRecord.videoHeight === "number" && imageRecord.videoHeight > 0
      ? imageRecord.videoHeight
      : null) ??
    (typeof imageRecord.displayHeight === "number" &&
    imageRecord.displayHeight > 0
      ? imageRecord.displayHeight
      : null);
  if (!width || !height) return null;
  return { width, height };
}

function createTextureFromImage(image: CanvasImageSource): THREE.Texture {
  const texture = new THREE.Texture(image as TexImageSource);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((entry) => disposeMaterial(entry));
    return;
  }

  const materialRecord = material as THREE.Material & {
    map?: THREE.Texture | null;
    alphaMap?: THREE.Texture | null;
    shadeMultiplyTexture?: THREE.Texture | null;
  };
  Array.from(
    new Set(
      [
        materialRecord.map,
        materialRecord.alphaMap,
        materialRecord.shadeMultiplyTexture,
      ].filter(
        (value): value is THREE.Texture => value instanceof THREE.Texture,
      ),
    ),
  ).forEach((texture) => texture.dispose());
  material.dispose();
}

function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    const meshObject = object as THREE.Mesh;
    if (meshObject.geometry instanceof THREE.BufferGeometry) {
      meshObject.geometry.dispose();
    }
    if (
      meshObject.material instanceof THREE.Material ||
      Array.isArray(meshObject.material)
    ) {
      disposeMaterial(meshObject.material);
    }
  });
}

function getTextureSlot(
  material: THREE.Material | null,
  slot: AvatarVFXTextureSlot,
): THREE.Texture | null {
  if (!isMaterialWithTextures(material)) return null;
  const value = material[slot];
  return value instanceof THREE.Texture ? value : null;
}

function setTextureSlot(
  material: THREE.Material | null,
  slot: AvatarVFXTextureSlot,
  texture: THREE.Texture | null,
): void {
  if (!isMaterialWithTextures(material)) return;
  material[slot] = texture;
  material.needsUpdate = true;
}

function updateMaterialRuntime(
  material: THREE.Material | null,
  delta: number,
): void {
  if (!hasMaterialUpdate(material)) return;
  material.update(delta);
}

function getRenderableMainMaterial(object: THREE.Mesh): THREE.Material | null {
  const material = Array.isArray(object.material)
    ? (object.material[0] ?? null)
    : object.material;
  return material instanceof THREE.Material ? material : null;
}

function getTextureImageSource(
  texture: THREE.Texture,
): CanvasImageSource | null {
  const image = texture.image ?? texture.source?.data;
  return isCanvasImageSource(image) ? image : null;
}

function getTextureSize(texture: THREE.Texture): Size | null {
  const image = getTextureImageSource(texture);
  if (!image) return null;
  const imageRecord = image as {
    width?: number;
    height?: number;
    videoWidth?: number;
    videoHeight?: number;
    displayWidth?: number;
    displayHeight?: number;
  };
  const width =
    (typeof imageRecord.width === "number" && imageRecord.width > 0
      ? imageRecord.width
      : null) ??
    (typeof imageRecord.videoWidth === "number" && imageRecord.videoWidth > 0
      ? imageRecord.videoWidth
      : null) ??
    (typeof imageRecord.displayWidth === "number" &&
    imageRecord.displayWidth > 0
      ? imageRecord.displayWidth
      : null);
  const height =
    (typeof imageRecord.height === "number" && imageRecord.height > 0
      ? imageRecord.height
      : null) ??
    (typeof imageRecord.videoHeight === "number" && imageRecord.videoHeight > 0
      ? imageRecord.videoHeight
      : null) ??
    (typeof imageRecord.displayHeight === "number" &&
    imageRecord.displayHeight > 0
      ? imageRecord.displayHeight
      : null);
  if (!width || !height) return null;
  return { width, height };
}

function copyTextureSettings(
  source: THREE.Texture,
  target: THREE.CanvasTexture,
): void {
  target.name = source.name;
  target.colorSpace = source.colorSpace;
  target.flipY = source.flipY;
  target.wrapS = source.wrapS;
  target.wrapT = source.wrapT;
  target.magFilter = source.magFilter;
  target.minFilter = source.minFilter;
  target.anisotropy = source.anisotropy;
  target.generateMipmaps = source.generateMipmaps;
  target.premultiplyAlpha = source.premultiplyAlpha;
  target.unpackAlignment = source.unpackAlignment;
  target.offset.copy(source.offset);
  target.repeat.copy(source.repeat);
  target.center.copy(source.center);
  target.rotation = source.rotation;
  target.matrixAutoUpdate = true;
  target.needsUpdate = true;
  target.updateMatrix();
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context is unavailable.");
  }
  return { canvas, context };
}

function createStaticCompositeSegments(args: {
  width: number;
  height: number;
  count: number;
}): StaticCompositeSegmentState[] {
  return Array.from({ length: args.count }, () => {
    const { canvas, context } = createCanvas(args.width, args.height);
    return {
      canvas,
      context,
    };
  });
}

function toCssColor(args: {
  r: number;
  g: number;
  b: number;
  a: number;
}): string {
  return `rgba(${args.r}, ${args.g}, ${args.b}, ${args.a.toFixed(4)})`;
}

function sampleAverageTextureColor(args: {
  image: CanvasImageSource;
  width: number;
  height: number;
  region: AvatarFaceTextureFlattenRegionSnapshot;
}): AvatarVFXFlattenColorSnapshot | null {
  const regionWidth = Math.max(
    1,
    Math.round(args.width * args.region.referenceSizeUv.width),
  );
  const regionHeight = Math.max(
    1,
    Math.round(args.height * args.region.referenceSizeUv.height),
  );
  const sourceX = clampNumber(
    Math.round(args.region.uv.u * args.width - regionWidth * 0.5),
    0,
    Math.max(0, args.width - regionWidth),
  );
  const sourceY = clampNumber(
    Math.round(args.region.uv.v * args.height - regionHeight * 0.5),
    0,
    Math.max(0, args.height - regionHeight),
  );

  try {
    const { context } = createCanvas(regionWidth, regionHeight);
    context.drawImage(
      args.image,
      sourceX,
      sourceY,
      regionWidth,
      regionHeight,
      0,
      0,
      regionWidth,
      regionHeight,
    );

    const imageData = context.getImageData(0, 0, regionWidth, regionHeight);
    const pixels = imageData.data;
    let totalAlpha = 0;
    let totalR = 0;
    let totalG = 0;
    let totalB = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3] / 255;
      if (alpha <= 0) continue;
      totalAlpha += alpha;
      totalR += pixels[index] * alpha;
      totalG += pixels[index + 1] * alpha;
      totalB += pixels[index + 2] * alpha;
    }

    if (totalAlpha <= 0) {
      return null;
    }

    const r = Math.round(totalR / totalAlpha);
    const g = Math.round(totalG / totalAlpha);
    const b = Math.round(totalB / totalAlpha);
    const a = 1;
    return {
      r,
      g,
      b,
      a,
      cssColor: toCssColor({ r, g, b, a }),
    };
  } catch {
    return null;
  }
}

function drawFeatheredFlattenEllipse(args: {
  context: CanvasContext;
  region: AvatarFaceTextureFlattenRegionSnapshot;
  fillColor: AvatarVFXFlattenColorSnapshot;
  width: number;
  height: number;
}): void {
  const centerX = args.region.uv.u * args.width;
  const centerY = args.region.uv.v * args.height;
  const radiusX = Math.max(
    1,
    args.region.referenceSizeUv.width * args.width * 0.5,
  );
  const radiusY = Math.max(
    1,
    args.region.referenceSizeUv.height * args.height * 0.5,
  );
  const innerStop = clampNumber(1 - FACE_FLATTEN_EDGE_FEATHER_RATIO, 0, 0.98);
  const opaqueColor = args.fillColor.cssColor;
  const transparentColor = toCssColor({
    r: args.fillColor.r,
    g: args.fillColor.g,
    b: args.fillColor.b,
    a: 0,
  });

  args.context.save();
  args.context.translate(centerX, centerY);
  args.context.scale(radiusX, radiusY);
  const gradient = args.context.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, opaqueColor);
  gradient.addColorStop(innerStop, opaqueColor);
  gradient.addColorStop(1, transparentColor);
  args.context.fillStyle = gradient;
  args.context.beginPath();
  args.context.arc(0, 0, 1, 0, Math.PI * 2);
  args.context.fill();
  args.context.restore();
}

function drawHoverSkinBackdropEllipse(args: {
  context: CanvasContext;
  width: number;
  height: number;
  fillColor: AvatarVFXFlattenColorSnapshot;
}): void {
  const centerX = args.width * 0.5;
  const centerY = args.height * 0.5;
  const radiusX = args.width * 0.5;
  const radiusY = args.height * 0.5;
  const innerStop = clampNumber(1 - FACE_FLATTEN_EDGE_FEATHER_RATIO, 0, 0.98);
  const opaqueColor = args.fillColor.cssColor;
  const transparentColor = toCssColor({
    r: args.fillColor.r,
    g: args.fillColor.g,
    b: args.fillColor.b,
    a: 0,
  });

  args.context.save();
  args.context.translate(centerX, centerY);
  args.context.scale(radiusX, radiusY);
  const gradient = args.context.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, opaqueColor);
  gradient.addColorStop(innerStop, opaqueColor);
  gradient.addColorStop(1, transparentColor);
  args.context.fillStyle = gradient;
  args.context.beginPath();
  args.context.arc(0, 0, 1, 0, Math.PI * 2);
  args.context.fill();
  args.context.restore();
}

function createHoverSkinBackdropTexture(args: {
  fillColor: AvatarVFXFlattenColorSnapshot;
  width: number;
  height: number;
  templateTexture: THREE.Texture;
}): THREE.CanvasTexture {
  const { canvas, context } = createCanvas(args.width, args.height);
  drawHoverSkinBackdropEllipse({
    context,
    width: args.width,
    height: args.height,
    fillColor: args.fillColor,
  });

  const texture = new THREE.CanvasTexture(canvas);
  copyTextureSettings(args.templateTexture, texture);
  return texture;
}

function createHoverSkinBackdropMaterial(args: {
  sourceBinding: BindingState;
  fillColor: AvatarVFXFlattenColorSnapshot;
}): THREE.Material | null {
  const sourceMaterial = args.sourceBinding.originalMainMaterial;
  if (!sourceMaterial) {
    return null;
  }

  const sourceSlots = args.sourceBinding.textureSlots.filter(
    (slot) => slot.slot === "map" || slot.slot === "shadeMultiplyTexture",
  );
  const templateSlot =
    sourceSlots.find((slot) => slot.slot === "map") ?? sourceSlots[0] ?? null;
  if (!templateSlot) {
    return null;
  }

  const width = templateSlot.width || HOVER_SKIN_BACKDROP_TEXTURE_SIZE;
  const height = templateSlot.height || HOVER_SKIN_BACKDROP_TEXTURE_SIZE;
  const generatedTexture = createHoverSkinBackdropTexture({
    fillColor: args.fillColor,
    width,
    height,
    templateTexture: templateSlot.texture,
  });

  const materialClone = sourceMaterial.clone();
  const materialRecord = materialClone as THREE.Material &
    Record<string, unknown>;
  materialClone.transparent = true;
  materialClone.depthWrite = false;
  materialClone.side = THREE.DoubleSide;

  HOVER_BACKDROP_STRIPPED_TEXTURE_PROPS.forEach((slot) => {
    if (!(slot in materialRecord)) return;
    materialRecord[slot] = null;
  });
  if (materialRecord.emissive instanceof THREE.Color) {
    materialRecord.emissive.setRGB(0, 0, 0);
  }
  if (typeof materialRecord.emissiveIntensity === "number") {
    materialRecord.emissiveIntensity = 0;
  }
  if (materialRecord.normalScale instanceof THREE.Vector2) {
    materialRecord.normalScale.set(0, 0);
  }
  if (typeof materialRecord.bumpScale === "number") {
    materialRecord.bumpScale = 0;
  }
  if (typeof materialRecord.aoMapIntensity === "number") {
    materialRecord.aoMapIntensity = 0;
  }

  sourceSlots.forEach((slot) => {
    setTextureSlot(materialClone, slot.slot, generatedTexture);
  });
  materialClone.needsUpdate = true;
  return materialClone;
}

function toPixelRect(size: Size, rect: AvatarVFXNormalizedRect) {
  return {
    x: Math.round(size.width * rect.x),
    y: Math.round(size.height * rect.y),
    width: Math.round(size.width * rect.width),
    height: Math.round(size.height * rect.height),
  };
}

function getCombinedRect(
  left: AvatarVFXNormalizedRect,
  right: AvatarVFXNormalizedRect,
): AvatarVFXNormalizedRect {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);
  return {
    x,
    y,
    width: maxX - x,
    height: maxY - y,
  };
}

function toPixelFloatRect(
  size: Size,
  rect: TexturePlacementInstance["rect"],
): TexturePlacementInstance["rect"] {
  return {
    x: size.width * rect.x,
    y: size.height * rect.y,
    width: size.width * rect.width,
    height: size.height * rect.height,
  };
}

function resolveOppositeSide(side: AvatarVFXSide): AvatarVFXSide {
  return side === "left" ? "right" : "left";
}

function resolvePivotFactors(pivot: AvatarFaceAnchoredVFXEntry["pivot"]): {
  x: number;
  y: number;
} {
  switch (pivot ?? "center") {
    case "top-left":
      return { x: 0, y: 0 };
    case "top-center":
      return { x: 0.5, y: 0 };
    case "top-right":
      return { x: 1, y: 0 };
    case "center-left":
      return { x: 0, y: 0.5 };
    case "center-right":
      return { x: 1, y: 0.5 };
    case "bottom-left":
      return { x: 0, y: 1 };
    case "bottom-center":
      return { x: 0.5, y: 1 };
    case "bottom-right":
      return { x: 1, y: 1 };
    case "center":
    default:
      return { x: 0.5, y: 0.5 };
  }
}

function getBilateralTextureAnchor(
  faceTextureAnchors: AvatarFaceTextureAnchorsSnapshot,
  textureAnchor: AvatarFaceAnchoredVFXEntry["anchor"],
  side: AvatarVFXSide,
): AvatarFaceTextureAnchorSnapshot | null {
  if (textureAnchor === "undereye") {
    return faceTextureAnchors.anchors.undereye[side];
  }
  if (textureAnchor === "blush") {
    return faceTextureAnchors.anchors.blush[side];
  }
  return null;
}

function resolveAnchoredTexturePlacementSize(args: {
  referenceSizeUv: AvatarFaceTextureAnchorSnapshot["referenceSizeUv"];
  effect: AvatarFaceAnchoredVFXEntry;
  imageSize: Size | null;
}): Size {
  const scaleX = resolveStaticScaleComponent(args.effect.transform.scale.x);
  const scaleY = resolveStaticScaleComponent(args.effect.transform.scale.y);
  return resolvePlacementSizeFromReferenceSize({
    referenceSize: {
      width: Math.max(0.0001, args.referenceSizeUv.width * scaleX),
      height: Math.max(0.0001, args.referenceSizeUv.height * scaleY),
    },
    imageSize: args.imageSize,
  });
}

function resolvePlacementSizeFromReferenceSize(args: {
  referenceSize: {
    width: number;
    height: number;
  };
  imageSize: Size | null;
}): Size {
  const baseWidth = Math.max(0.0001, args.referenceSize.width);
  const baseHeight = Math.max(0.0001, args.referenceSize.height);
  const imageSize = args.imageSize;
  if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0) {
    return {
      width: baseWidth,
      height: baseHeight,
    };
  }

  const imageAspect = imageSize.width / imageSize.height;
  if (!Number.isFinite(imageAspect) || imageAspect <= 0) {
    return {
      width: baseWidth,
      height: baseHeight,
    };
  }

  const referenceAspect = baseWidth / baseHeight;
  if (!Number.isFinite(referenceAspect) || referenceAspect <= 0) {
    return {
      width: baseWidth,
      height: baseHeight,
    };
  }

  if (imageAspect >= referenceAspect) {
    return {
      width: Math.max(baseWidth, baseHeight * imageAspect),
      height: baseHeight,
    };
  }

  return {
    width: baseWidth,
    height: Math.max(baseHeight, baseWidth / imageAspect),
  };
}

function createAnchoredTexturePlacementRect(args: {
  anchorUv: AvatarFaceTextureAnchorSnapshot["uv"];
  referenceSizeUv: AvatarFaceTextureAnchorSnapshot["referenceSizeUv"];
  effect: AvatarFaceAnchoredVFXEntry;
  imageSize: Size | null;
  mirrorPlacementX?: boolean;
}): TexturePlacementInstance["rect"] {
  const { width, height } = resolveAnchoredTexturePlacementSize(args);
  const pivot = resolvePivotFactors(resolveTexturePivot(args.effect));
  const pivotX = args.mirrorPlacementX ? 1 - pivot.x : pivot.x;
  const offsetX =
    args.effect.transform.offset.x * (args.mirrorPlacementX ? -1 : 1);
  return {
    x: args.anchorUv.u + offsetX - width * pivotX,
    y: args.anchorUv.v + args.effect.transform.offset.y - height * pivot.y,
    width,
    height,
  };
}

function resolveAnchoredTexturePlacementInstances(args: {
  effect: AvatarFaceAnchoredVFXEntry;
  faceTextureAnchors: AvatarFaceTextureAnchorsSnapshot;
  imageSize: Size | null;
}): {
  instances: TexturePlacementInstance[];
  warning?: string;
} {
  const { effect, faceTextureAnchors } = args;
  if (faceTextureAnchors.status !== "ready") {
    return {
      instances: [],
      warning:
        faceTextureAnchors.warnings[0] ??
        "Face texture anchors are unavailable for anchored decals.",
    };
  }

  const textureAnchor = effect.anchor;

  if (textureAnchor === "mouth") {
    const mouthAnchor = faceTextureAnchors.anchors.mouth.center;
    if (!mouthAnchor) {
      return {
        instances: [],
        warning: "No mouth texture anchor was resolved for the active avatar.",
      };
    }
    return {
      instances: [
        {
          label: "mouth",
          mirrorX: false,
          rect: createAnchoredTexturePlacementRect({
            anchorUv: mouthAnchor.uv,
            referenceSizeUv: mouthAnchor.referenceSizeUv,
            effect,
            imageSize: args.imageSize,
          }),
        },
      ],
    };
  }

  const leftAnchor = getBilateralTextureAnchor(
    faceTextureAnchors,
    textureAnchor,
    "left",
  );
  const rightAnchor = getBilateralTextureAnchor(
    faceTextureAnchors,
    textureAnchor,
    "right",
  );
  if (!leftAnchor || !rightAnchor) {
    return {
      instances: [],
      warning: `Both ${textureAnchor} anchors are required for the active avatar.`,
    };
  }

  if (resolveTextureLayout(effect) === "span") {
    const centerUv = {
      u: (leftAnchor.uv.u + rightAnchor.uv.u) * 0.5,
      v: (leftAnchor.uv.v + rightAnchor.uv.v) * 0.5,
    };
    return {
      instances: [
        {
          label: textureAnchor,
          mirrorX: false,
          rect: createAnchoredTexturePlacementRect({
            anchorUv: centerUv,
            referenceSizeUv: {
              width:
                Math.abs(leftAnchor.uv.u - rightAnchor.uv.u) +
                (leftAnchor.referenceSizeUv.width +
                  rightAnchor.referenceSizeUv.width) *
                  0.5,
              height: Math.max(
                leftAnchor.referenceSizeUv.height,
                rightAnchor.referenceSizeUv.height,
              ),
            },
            effect,
            imageSize: args.imageSize,
          }),
        },
      ],
    };
  }

  if (resolveTextureLayout(effect) !== "single") {
    return { instances: [] };
  }

  if (!("side" in effect) || !effect.side) {
    return {
      instances: [],
      warning: `Single ${textureAnchor} decals require a side.`,
    };
  }

  const primarySide = effect.side;
  const oppositeSide = resolveOppositeSide(primarySide);
  const primaryAnchor = primarySide === "left" ? leftAnchor : rightAnchor;
  const oppositeAnchor = oppositeSide === "left" ? leftAnchor : rightAnchor;

  const instances: TexturePlacementInstance[] = [
    {
      label: primarySide,
      mirrorX: false,
      rect: createAnchoredTexturePlacementRect({
        anchorUv: primaryAnchor.uv,
        referenceSizeUv: primaryAnchor.referenceSizeUv,
        effect,
        imageSize: args.imageSize,
      }),
    },
  ];

  if (effect.requiresMirror) {
    instances.push({
      label: oppositeSide,
      mirrorX: true,
      effectMirror: true,
      rect: createAnchoredTexturePlacementRect({
        anchorUv: oppositeAnchor.uv,
        referenceSizeUv: oppositeAnchor.referenceSizeUv,
        effect,
        imageSize: args.imageSize,
        mirrorPlacementX: true,
      }),
    });
  }

  return { instances };
}

function resolveTextureEffectPlacements(args: {
  image: CanvasImageSource;
  effect: AvatarVFXCatalogEntry;
  size: Size;
  profile: AvatarVFXModelProfile;
  faceTextureAnchors: AvatarFaceTextureAnchorsSnapshot | null;
}): {
  placements: TexturePixelPlacementInstance[];
  warning?: string;
} {
  const { image, effect, size, profile, faceTextureAnchors } = args;

  if (isTextureVFXEntry(effect) && effect.targetRole === "eye_iris") {
    const eyeLayout = profile.eyeLayout;
    if (!eyeLayout) return { placements: [] };
    const leftRect = toPixelRect(size, eyeLayout.left);
    const rightRect = toPixelRect(size, eyeLayout.right);

    if (effect.assetShape === "single_eye") {
      if (effect.side) {
        const primaryRect = effect.side === "left" ? leftRect : rightRect;
        const oppositeRect = effect.side === "left" ? rightRect : leftRect;
        const placements: TexturePixelPlacementInstance[] = [
          {
            label: effect.side,
            mirrorX: false,
            rect: primaryRect,
          },
        ];
        if (effect.requiresMirror) {
          placements.push({
            label: effect.side === "left" ? "right" : "left",
            mirrorX: true,
            effectMirror: true,
            rect: oppositeRect,
          });
        }
        return { placements };
      }

      return {
        placements: [
          {
            label: "left",
            mirrorX: false,
            rect: leftRect,
          },
          {
            label: "right",
            mirrorX: eyeLayout.mirrorRight,
            rect: rightRect,
          },
        ],
      };
    }

    const combinedRect = toPixelRect(
      size,
      getCombinedRect(eyeLayout.left, eyeLayout.right),
    );
    return {
      placements: [
        {
          label: "both",
          mirrorX: false,
          rect: combinedRect,
        },
      ],
    };
  }

  if (isAnchoredFaceTextureEffect(effect)) {
    if (!faceTextureAnchors) {
      return {
        placements: [],
        warning: "Face texture anchors are unavailable for anchored decals.",
      };
    }
    // Flipbook decals are sized from one frame, not the whole sheet.
    const imageSize = resolveArtFrameSize(image, effect.flipbook);
    const resolved = resolveAnchoredTexturePlacementInstances({
      effect,
      faceTextureAnchors,
      imageSize,
    });
    if (resolved.instances.length === 0) {
      return {
        placements: [],
        warning: resolved.warning,
      };
    }
    return {
      placements: resolved.instances.map((instance) => ({
        label: instance.label,
        mirrorX: instance.mirrorX,
        ...(instance.effectMirror ? { effectMirror: true } : {}),
        rect: toPixelFloatRect(size, instance.rect),
      })),
    };
  }

  if (!isTextureVFXEntry(effect)) {
    return { placements: [] };
  }

  const faceRect = profile.faceLayout?.rect;
  if (!faceRect) return { placements: [] };
  return {
    placements: [
      {
        label: "face",
        mirrorX: false,
        rect: toPixelRect(size, faceRect),
      },
    ],
  };
}

const DEFAULT_APPEARANCE: AvatarVFXAppearance = {
  opacity: 1,
  tint: null,
  blend: "normal",
};

function resolveAppearance(effect: AvatarVFXCatalogEntry): AvatarVFXAppearance {
  return effect.appearance ?? DEFAULT_APPEARANCE;
}

/** Appearance opacity × keyframe opacity × event envelope, clamped to 0–1. */
function resolveEffectiveOpacity(args: {
  effect: AvatarVFXCatalogEntry;
  animationState: AvatarVFXAnimationState;
  intensity: number;
}): number {
  const value =
    resolveAppearance(args.effect).opacity *
    args.animationState.opacity *
    args.intensity;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

function compositeOperationForBlend(
  blend: AvatarVFXBlend,
): GlobalCompositeOperation {
  if (blend === "additive") return "lighter";
  if (blend === "multiply") return "multiply";
  return "source-over";
}

/** Multiply an image by a tint colour while keeping its alpha. */
function createTintedImage(
  image: CanvasImageSource,
  tint: string,
): HTMLCanvasElement | null {
  const size = getImageSize(image);
  if (!size) return null;
  let created: ReturnType<typeof createCanvas>;
  try {
    created = createCanvas(size.width, size.height);
  } catch {
    return null;
  }
  const { canvas, context } = created;
  context.drawImage(image, 0, 0, size.width, size.height);
  context.globalCompositeOperation = "multiply";
  context.fillStyle = tint;
  context.fillRect(0, 0, size.width, size.height);
  context.globalCompositeOperation = "destination-in";
  context.drawImage(image, 0, 0, size.width, size.height);
  return canvas;
}

/** The size of one flipbook cell, or the whole image without a flipbook. */
function resolveArtFrameSize(
  image: CanvasImageSource,
  flipbook: AvatarVFXFlipbook | undefined,
): Size | null {
  const size = getImageSize(image);
  if (!size || !flipbook) return size;
  return {
    width: size.width / Math.max(1, flipbook.columns),
    height: size.height / Math.max(1, flipbook.rows),
  };
}

/** Source rectangle of one flipbook frame, left to right then top to bottom. */
function resolveFlipbookSourceRect(
  image: CanvasImageSource,
  flipbook: AvatarVFXFlipbook | undefined,
  frame: number,
): { x: number; y: number; width: number; height: number } | null {
  const size = getImageSize(image);
  if (!size) return null;
  if (!flipbook) return { x: 0, y: 0, ...size };
  const columns = Math.max(1, flipbook.columns);
  const width = size.width / columns;
  const height = size.height / Math.max(1, flipbook.rows);
  return {
    x: (frame % columns) * width,
    y: Math.floor(frame / columns) * height,
    width,
    height,
  };
}

/** Point a flipbook texture at one frame without re-uploading it. */
function applyFlipbookFrameToTexture(
  texture: THREE.Texture,
  flipbook: AvatarVFXFlipbook | undefined,
  frame: number,
): void {
  if (!flipbook) return;
  const columns = Math.max(1, flipbook.columns);
  const rows = Math.max(1, flipbook.rows);
  texture.repeat.set(1 / columns, 1 / rows);
  // Textures are flipped on upload, so row 0 (top of the image) is at v = 1.
  texture.offset.set(
    (frame % columns) / columns,
    1 - (Math.floor(frame / columns) + 1) / rows,
  );
}

/**
 * Configure a hover plane's blend mode. Multiply uses premultiplied output so
 * transparent pixels leave the scene unchanged: dst × (src·a + 1 − a).
 */
function configureHoverMaterialBlend(
  material: THREE.MeshBasicMaterial,
  blend: AvatarVFXBlend,
): void {
  if (blend === "additive") {
    material.blending = THREE.AdditiveBlending;
    return;
  }
  if (blend === "multiply") {
    material.premultipliedAlpha = true;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.DstColorFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.ZeroFactor;
    material.blendDstAlpha = THREE.OneFactor;
    return;
  }
  material.blending = THREE.NormalBlending;
}

function applyHoverInstanceOpacity(
  instance: HoverPlaneInstanceState,
  opacity: number,
  baseOpacity: number,
): void {
  instance.material.opacity = baseOpacity * opacity;
  // The skin backdrop fades with its art so a fade never leaves a bare patch.
  if (instance.backdropMaterial) {
    instance.backdropMaterial.opacity =
      instance.backdropBaseOpacity * baseOpacity * opacity;
  }
}

function applyAnimationToHoverInstances(args: {
  instances: HoverPlaneInstanceState[];
  animationState: AvatarVFXAnimationState;
  effect: AvatarVFXCatalogEntry;
  intensity: number;
}) {
  const { instances, animationState } = args;
  const scale = Math.max(0.0001, animationState.scale);
  const opacity = animationState.opacity * args.intensity;
  const baseOpacity = resolveAppearance(args.effect).opacity;

  instances.forEach((instance) => {
    const mirrorSign = instance.mirrored ? -1 : 1;
    instance.animatedGroup.position.set(
      animationState.driftX * instance.planeWidth +
        animationState.offsetX * mirrorSign,
      animationState.driftY * instance.planeHeight + animationState.offsetY,
      0,
    );
    instance.animatedGroup.rotation.z = animationState.rotationRadians;
    instance.animatedGroup.scale.setScalar(scale);
    applyHoverInstanceOpacity(instance, opacity, baseOpacity);
    applyFlipbookFrameToTexture(
      instance.texture,
      args.effect.flipbook,
      animationState.frame,
    );
  });
}

function hasAnimatedVFXConfig(
  config: AvatarVFXResolvedAnimationConfig,
): boolean {
  return config.pulseEnabled || config.spinEnabled || config.driftEnabled;
}

/** Whether an effect changes over its own timeline and needs the 30 FPS tick. */
function isAnimatedEffect(
  effect: AvatarVFXCatalogEntry,
  config: AvatarVFXResolvedAnimationConfig,
): boolean {
  return (
    hasAnimatedVFXConfig(config) ||
    Boolean(effect.keyframes) ||
    (effect.flipbook?.frames ?? 1) > 1
  );
}

function getTextureEffectKindOrder(effect: AvatarVFXCatalogEntry): number {
  return isAnchoredFaceTextureEffect(effect) ? 1 : 0;
}

function drawCompositedLayerCanvas(args: {
  context: CanvasContext;
  layerState: EffectLayerCanvasState;
  effect: AvatarVFXCatalogEntry;
  size: Size;
  animationState: AvatarVFXAnimationState;
  opacity: number;
  tinted: (image: CanvasImageSource) => CanvasImageSource;
}) {
  const { context, layerState, effect, size, animationState } = args;
  if (args.opacity <= 0) return;
  const appearance = resolveAppearance(effect);
  context.save();
  context.globalAlpha = args.opacity;
  context.globalCompositeOperation = compositeOperationForBlend(
    appearance.blend,
  );
  layerState.placements.forEach((placement) => {
    // The effect's mirrored copy draws its own art, unmirrored, when it has one.
    const useOtherImage =
      placement.effectMirror === true && layerState.otherImage !== null;
    const image = args.tinted(
      useOtherImage ? layerState.otherImage! : layerState.image,
    );
    const source = effect.flipbook
      ? resolveFlipbookSourceRect(
          useOtherImage ? layerState.otherImage! : layerState.image,
          effect.flipbook,
          animationState.frame,
        )
      : null;
    if (effect.flipbook && !source) return;
    // Unflipped, but still the mirrored copy: its offsets stay mirrored.
    const transform = resolveTexturePlacementTransform(
      useOtherImage ? { ...placement, mirrorX: false } : placement,
      effect,
      size,
      animationState,
    );

    context.save();
    context.translate(transform.x, transform.y);
    // Texture decals rotate in their 2D surface; spin adds to the authored angle.
    context.rotate(transform.rotation);
    context.scale(transform.scaleX, transform.scaleY);
    if (source) {
      // Flipbooks draw one frame through a source rectangle.
      context.drawImage(
        image,
        source.x,
        source.y,
        source.width,
        source.height,
        -placement.rect.width * 0.5,
        -placement.rect.height * 0.5,
        placement.rect.width,
        placement.rect.height,
      );
    } else {
      context.drawImage(
        image,
        -placement.rect.width * 0.5,
        -placement.rect.height * 0.5,
        placement.rect.width,
        placement.rect.height,
      );
    }
    context.restore();
  });
  context.restore();
}

function getTextureSlotSnapshots(
  slots: BindingTextureState[],
): AvatarVFXTargetBindingTextureSlot[] {
  return slots.map((slot) => ({
    slot: slot.slot,
    width: slot.width,
    height: slot.height,
    sizeLabel: formatSizeLabel(slot.width, slot.height),
    canOverlay: slot.canOverlay,
  }));
}

function resolveEyeHoverPosition(
  eye: AvatarFaceEyeLandmarkSnapshot,
): THREE.Vector3 {
  return lerpVector3(
    toVector3(eye.centerLocal),
    toVector3(eye.projectedFrontLocal),
    EYE_HOVER_SURFACE_LERP,
  );
}

function resolveMouthHoverPosition(args: {
  faceLandmarks: AvatarFaceLandmarksSnapshot;
  mouthAnchor: AvatarFaceTextureAnchorSnapshot;
}): THREE.Vector3 | null {
  const frontZ = args.faceLandmarks.frontZLocal;
  if (frontZ === null) {
    return null;
  }

  const localPoint = toVector3(args.mouthAnchor.localPoint);
  return lerpVector3(
    localPoint,
    new THREE.Vector3(localPoint.x, localPoint.y, frontZ),
    MOUTH_HOVER_SURFACE_LERP,
  );
}

function resolveAvatarLeftRightEdges(
  faceLandmarks: AvatarFaceLandmarksSnapshot,
): { leftX: number; rightX: number } | null {
  const faceBounds = faceLandmarks.faceBoundsLocal;
  const leftEye = faceLandmarks.eyes.left;
  if (!faceBounds || !leftEye) return null;

  const distanceToMin = Math.abs(
    leftEye.projectedFrontLocal.x - faceBounds.min.x,
  );
  const distanceToMax = Math.abs(
    leftEye.projectedFrontLocal.x - faceBounds.max.x,
  );
  if (distanceToMin <= distanceToMax) {
    return {
      leftX: faceBounds.min.x,
      rightX: faceBounds.max.x,
    };
  }
  return {
    leftX: faceBounds.max.x,
    rightX: faceBounds.min.x,
  };
}

function resolveBoxHoverPosition(args: {
  faceLandmarks: AvatarFaceLandmarksSnapshot;
  placement: AvatarVFXHoverPlacement;
}): THREE.Vector3 | null {
  const { faceLandmarks, placement } = args;
  const faceBounds = faceLandmarks.faceBoundsLocal;
  const leftEye = faceLandmarks.eyes.left;
  const rightEye = faceLandmarks.eyes.right;
  const frontZ = faceLandmarks.boxHoverFrontZLocal ?? faceLandmarks.frontZLocal;
  if (!faceBounds || !leftEye || !rightEye || frontZ === null) {
    return null;
  }

  const leftEyeSurface = toVector3(leftEye.projectedFrontLocal);
  const rightEyeSurface = toVector3(rightEye.projectedFrontLocal);
  const eyeMid = midpointVector3(leftEyeSurface, rightEyeSurface);
  const eyeLineY = eyeMid.y;
  const topY = faceBounds.max.y;
  const foreheadY = lerpNumber(eyeLineY, topY, 0.4);
  const topRowY = lerpNumber(eyeLineY, topY, 0.75);
  const edgeColumns = resolveAvatarLeftRightEdges(faceLandmarks);
  if (!edgeColumns) return null;

  const edgeX = (alpha: number) =>
    lerpNumber(edgeColumns.leftX, edgeColumns.rightX, alpha);

  switch (placement) {
    case "forehead-left":
      return new THREE.Vector3(leftEyeSurface.x, foreheadY, frontZ);
    case "forehead-middle":
      return new THREE.Vector3(eyeMid.x, foreheadY, frontZ);
    case "forehead-right":
      return new THREE.Vector3(rightEyeSurface.x, foreheadY, frontZ);
    case "top-left":
      return new THREE.Vector3(leftEyeSurface.x, topRowY, frontZ);
    case "top-middle":
      return new THREE.Vector3(eyeMid.x, topRowY, frontZ);
    case "top-right":
      return new THREE.Vector3(rightEyeSurface.x, topRowY, frontZ);
    case "top-edge-left-corner":
      return new THREE.Vector3(edgeColumns.leftX, topY, frontZ);
    case "top-edge-left":
      return new THREE.Vector3(edgeX(0.25), topY, frontZ);
    case "top-edge-middle":
      return new THREE.Vector3(edgeX(0.5), topY, frontZ);
    case "top-edge-right":
      return new THREE.Vector3(edgeX(0.75), topY, frontZ);
    case "top-edge-right-corner":
      return new THREE.Vector3(edgeColumns.rightX, topY, frontZ);
    default:
      return null;
  }
}

function applyHoverPlacementOffset(
  position: THREE.Vector3,
  offset: AvatarVFXTransform["offset"],
): THREE.Vector3 {
  return position.clone().add(new THREE.Vector3(offset.x, offset.y, offset.z));
}

function resolveHoverPlacementInstances(args: {
  effect: AvatarHoverVFXEntry;
  faceLandmarks: AvatarFaceLandmarksSnapshot;
  faceTextureAnchors: AvatarFaceTextureAnchorsSnapshot | null;
}): HoverPlacementInstance[] | null {
  const { effect, faceLandmarks, faceTextureAnchors } = args;
  if (isEyeHoverVFXEntry(effect)) {
    const leftEye = faceLandmarks.eyes.left;
    const rightEye = faceLandmarks.eyes.right;
    if (!leftEye || !rightEye) return null;

    const leftHover = resolveEyeHoverPosition(leftEye);
    const rightHover = resolveEyeHoverPosition(rightEye);
    const side = effect.side ?? "right";
    if (effect.requiresMirror) {
      const primaryPosition = side === "left" ? leftHover : rightHover;
      const oppositePosition = side === "left" ? rightHover : leftHover;
      const primaryLabel = side;
      const oppositeLabel = resolveOppositeSide(side);
      return [
        {
          label: primaryLabel,
          mirrored: false,
          position: applyHoverPlacementOffset(
            primaryPosition,
            effect.transform.offset,
          ),
          referenceSizeLocal: null,
        },
        {
          label: oppositeLabel,
          mirrored: true,
          // The mirrored eye mirrors its lateral offset (avatar-effect/2).
          position: applyHoverPlacementOffset(oppositePosition, {
            ...effect.transform.offset,
            x: -effect.transform.offset.x,
          }),
          referenceSizeLocal: null,
        },
      ];
    }

    if (effect.side) {
      const singlePosition = side === "left" ? leftHover : rightHover;
      return [
        {
          label: side,
          mirrored: false,
          position: applyHoverPlacementOffset(
            singlePosition,
            effect.transform.offset,
          ),
          referenceSizeLocal: null,
        },
      ];
    }

    return [
      {
        label: "center",
        mirrored: false,
        position: applyHoverPlacementOffset(
          midpointVector3(leftHover, rightHover),
          effect.transform.offset,
        ),
        referenceSizeLocal: null,
      },
    ];
  }

  if (isMouthHoverVFXEntry(effect)) {
    if (!faceTextureAnchors || faceTextureAnchors.status !== "ready") {
      return null;
    }
    const mouthAnchor = faceTextureAnchors.anchors.mouth.center;
    if (!mouthAnchor) {
      return null;
    }
    const position = resolveMouthHoverPosition({
      faceLandmarks,
      mouthAnchor,
    });
    if (!position) {
      return null;
    }
    return [
      {
        label: "mouth",
        mirrored: false,
        position: applyHoverPlacementOffset(position, effect.transform.offset),
        referenceSizeLocal: mouthAnchor.referenceSizeLocal,
      },
    ];
  }

  if (isBoxHoverVFXEntry(effect)) {
    const position = resolveBoxHoverPosition({
      faceLandmarks,
      placement: effect.placement,
    });
    if (!position) return null;
    return [
      {
        label: effect.placement,
        mirrored: false,
        position: applyHoverPlacementOffset(position, effect.transform.offset),
        referenceSizeLocal: null,
      },
    ];
  }

  return null;
}

function resolveHoverFacingRotationY(
  faceLandmarks: AvatarFaceLandmarksSnapshot,
): number {
  const faceBounds = faceLandmarks.faceBoundsLocal;
  const frontZ = faceLandmarks.frontZLocal;
  if (!faceBounds || frontZ === null) return 0;
  const distanceToMin = Math.abs(frontZ - faceBounds.min.z);
  const distanceToMax = Math.abs(frontZ - faceBounds.max.z);
  return distanceToMin <= distanceToMax ? Math.PI : 0;
}

function hasHoverSkinBackdrop(
  effect: AvatarHoverVFXEntry,
): effect is AvatarEyeHoverVFXEntry | AvatarMouthHoverVFXEntry {
  return (
    (isEyeHoverVFXEntry(effect) || isMouthHoverVFXEntry(effect)) &&
    Boolean(effect.skinBackdrop)
  );
}

/** Name guide instances in authoring terms; side labels always use the avatar's perspective. */
function placementGuideLabel(
  effect: AvatarVFXCatalogEntry,
  label: string,
): string {
  if (isEyeHoverVFXEntry(effect)) return `Eye ${label}`;
  if (
    isMouthHoverVFXEntry(effect) ||
    (isFaceAnchoredVFXEntry(effect) && effect.anchor === "mouth")
  )
    return "Mouth";
  if (isFaceAnchoredVFXEntry(effect)) {
    const name = effect.anchor === "undereye" ? "Under-eye" : "Blush";
    return `${name} ${effect.layout === "span" ? "span" : label}`;
  }
  if (isTextureVFXEntry(effect))
    return effect.targetRole === "eye_iris" ? `Iris ${label}` : "Face";
  const name = label.replaceAll("-", " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export class AvatarVFXController {
  private readonly _avatar: Avatar;
  private readonly _sourceUrl: string | null;
  private readonly _sourceKey: string | null;
  private readonly _profile: AvatarVFXModelProfile;
  private readonly _catalogProvider: AnimaRuntimeMediaProvider;
  private readonly _catalog: readonly AvatarVFXCatalogEntry[];

  private _bindings = new Map<string, BindingState>();
  private _listeners = new Set<VFXListener>();
  private _warnings: string[] = [];
  private _snapshot: AvatarVFXSnapshot;
  private _observationSnapshot: AvatarVFXObservationSnapshot;
  private _isDisposed = false;
  private _applyTokens = new Map<string, number>();
  private _nextAppliedOrder = 0;
  private _animationFrameAccumulatorSec = 0;
  private _flattenPreviewEyes = false;
  private _flattenPreviewMouth = false;
  private _cachedFaceFlattenState: ResolvedFaceFlattenState | null = null;
  /** Envelope values received while an effect's apply is still in flight. */
  private _pendingIntensities = new Map<string, number>();

  constructor(
    avatar: Avatar,
    catalogProvider: AnimaRuntimeMediaProvider = EMPTY_RUNTIME_MEDIA_PROVIDER,
  ) {
    this._avatar = avatar;
    this._catalogProvider = catalogProvider;
    this._catalog = catalogProvider.listAvatarVFX();
    this._sourceUrl = avatar.sourceUrl;
    this._sourceKey = avatar.sourceKey;
    this._profile = resolveAvatarVFXModelProfile({
      sourceKey: this._sourceKey,
      sourceUrl: this._sourceUrl,
    });
    this._rebuildBindings();
    this._snapshot = this._createSnapshot();
    this._observationSnapshot = this._createObservationSnapshot();
  }

  getSnapshot(): AvatarVFXSnapshot {
    return this._snapshot;
  }

  /** Return only the stable fields needed to observe active playback. */
  getObservationSnapshot(): AvatarVFXObservationSnapshot {
    return this._observationSnapshot;
  }

  /**
   * Read a creator's selected placement without applying effects or loading images.
   * Borrowed anchors/surfaces belong to the Avatar. Call while guides are visible;
   * artwork comes from the rendered mesh or the compositor's current animation state.
   */
  getPlacementGuides(
    effect: AvatarVFXCatalogEntry,
    appliedId: string,
  ): AvatarVFXPlacementGuides {
    const result: AvatarVFXPlacementGuides = {
      anchor: null,
      faceBounds: null,
      spatial: [],
      surfaces: [],
      messages: [],
      active: false,
    };
    if (this._isDisposed) return result;

    const landmarks = this._avatar.getFaceLandmarksSnapshot();
    const anchors = this._avatar.getFaceTextureAnchorsSnapshot();
    result.anchor = this._avatar.faceLandmarks?.getAnchorObject() ?? null;
    const activeBindings = Array.from(this._bindings.values()).filter(
      (binding) => binding.activeEffects.has(appliedId),
    );
    result.active = activeBindings.length > 0;
    const selected = activeBindings.length
      ? activeBindings
      : [this._resolveAutoBindingForEffect(effect)].filter(
          (binding): binding is BindingState => binding !== null,
        );
    if (!selected.length)
      result.messages.push(
        "No compatible material target is available on this avatar.",
      );
    else if (isTextureVFXEntry(effect)) {
      const targets = Array.from(
        new Set(
          selected.map(
            (binding) => binding.materialName ?? "Selected material",
          ),
        ),
      );
      result.messages.push(`Target: ${targets.join(", ")}.`);
    }

    const referenceUv: AvatarVFXUvGuide[] = [];
    if (isHoverVFXEntry(effect)) {
      if (!result.anchor || landmarks?.status !== "ready") {
        result.messages.push("Face landmarks are unavailable on this avatar.");
      } else {
        const references = resolveHoverPlacementInstances({
          effect: {
            ...effect,
            transform: { ...effect.transform, offset: { x: 0, y: 0, z: 0 } },
          },
          faceLandmarks: landmarks,
          faceTextureAnchors: anchors,
        });
        if (!references?.length)
          result.messages.push(
            "The selected hover anchor is unavailable on this avatar.",
          );
        if (isBoxHoverVFXEntry(effect))
          result.faceBounds = landmarks.faceBoundsLocal;
        result.anchor.updateWorldMatrix(true, false);
        const inverseAnchor = result.anchor.matrixWorld.clone().invert();
        for (const reference of references ?? []) {
          const instance = activeBindings
            .flatMap(
              (binding) =>
                binding.activeEffects.get(appliedId)?.hoverInstances ?? [],
            )
            .find((candidate) => candidate.label === reference.label);
          const artwork: AvatarFaceLandmarkVector[] = [];
          if (instance) {
            // Use the real mesh vertices through its authored, animated and facing transforms.
            instance.mesh.updateWorldMatrix(true, false);
            const matrix = inverseAnchor
              .clone()
              .multiply(instance.mesh.matrixWorld);
            const positions = instance.mesh.geometry.getAttribute("position");
            for (const index of [0, 1, 3, 2]) {
              const point = new THREE.Vector3()
                .fromBufferAttribute(positions, index)
                .applyMatrix4(matrix);
              artwork.push({ x: point.x, y: point.y, z: point.z });
            }
          }
          // Mouth placement adds hover clearance; retain the original anchor so
          // the reference-to-artwork connector also explains that depth.
          const referencePoint = isMouthHoverVFXEntry(effect)
            ? (anchors?.anchors.mouth.center?.localPoint ?? reference.position)
            : reference.position;
          result.spatial.push({
            label: placementGuideLabel(effect, reference.label),
            reference: {
              x: referencePoint.x,
              y: referencePoint.y,
              z: referencePoint.z,
            },
            source: isMouthHoverVFXEntry(effect)
              ? (anchors?.anchors.mouth.center?.source ?? "fallback")
              : "geometric",
            artwork,
          });
        }
      }
    } else if (isFaceAnchoredVFXEntry(effect)) {
      if (anchors?.status !== "ready") {
        result.messages.push(
          "Face texture anchors are unavailable on this avatar.",
        );
      } else {
        const resolved = resolveAnchoredTexturePlacementInstances({
          effect,
          faceTextureAnchors: anchors,
          imageSize: null,
        });
        if (resolved.warning) result.messages.push(resolved.warning);
        for (const placement of resolved.instances) {
          let reference: AvatarFaceTextureAnchorSnapshot | null;
          if (effect.anchor === "mouth") {
            reference = anchors.anchors.mouth.center;
          } else if (effect.layout === "span") {
            const left = getBilateralTextureAnchor(
              anchors,
              effect.anchor,
              "left",
            );
            const right = getBilateralTextureAnchor(
              anchors,
              effect.anchor,
              "right",
            );
            reference =
              left && right
                ? {
                    ...left,
                    side: null,
                    source:
                      left.source === "fallback" || right.source === "fallback"
                        ? "fallback"
                        : left.source,
                    localPoint: {
                      x: (left.localPoint.x + right.localPoint.x) / 2,
                      y: (left.localPoint.y + right.localPoint.y) / 2,
                      z: (left.localPoint.z + right.localPoint.z) / 2,
                    },
                    uv: {
                      u: (left.uv.u + right.uv.u) / 2,
                      v: (left.uv.v + right.uv.v) / 2,
                    },
                    referenceSizeUv: {
                      width:
                        Math.abs(left.uv.u - right.uv.u) +
                        (left.referenceSizeUv.width +
                          right.referenceSizeUv.width) /
                          2,
                      height: Math.max(
                        left.referenceSizeUv.height,
                        right.referenceSizeUv.height,
                      ),
                    },
                  }
                : null;
          } else {
            reference = getBilateralTextureAnchor(
              anchors,
              effect.anchor,
              placement.label as AvatarVFXSide,
            );
          }
          if (!reference) continue;
          result.spatial.push({
            label: placementGuideLabel(effect, placement.label),
            reference: reference.localPoint,
            source: reference.source,
            artwork: [],
          });
          referenceUv.push({
            label: placementGuideLabel(effect, placement.label),
            kind: "reference",
            shape: "polygon",
            source: reference.source,
            pivot: { x: reference.uv.u, y: reference.uv.v },
            points: rectangleGuidePoints({
              x: reference.uv.u - reference.referenceSizeUv.width / 2,
              y: reference.uv.v - reference.referenceSizeUv.height / 2,
              ...reference.referenceSizeUv,
            }),
          });
        }
      }
    }

    if (result.spatial.some((reference) => reference.source === "fallback")) {
      result.messages.push(
        "This placement uses an estimated anchor for this avatar.",
      );
    }
    if (result.spatial.length && !result.anchor) {
      result.messages.push(
        "The avatar's live face anchor is unavailable for spatial guides.",
      );
    }
    if (isBoxHoverVFXEntry(effect)) return result;

    // Hover artwork lives in 3D; only its related face-flatten coverage has a UV view.
    const uvBindings = isHoverVFXEntry(effect)
      ? [this._resolveFaceFlattenBinding()].filter(
          (binding): binding is BindingState => binding !== null,
        )
      : selected;
    for (const binding of uvBindings) {
      const active = binding.activeEffects.get(appliedId);
      for (const slot of binding.textureSlots) {
        const composite = binding.textureComposite?.slotStates.get(slot.slot);
        const surface =
          composite?.canvas ?? getTextureImageSource(slot.texture);
        if (!surface) continue;
        const guides = [...referenceUv];
        if (active) {
          const layer = active.layerCanvases.get(slot.slot);
          for (const placement of layer?.placements ?? []) {
            const transform = resolveTexturePlacementTransform(
              placement,
              active.effectEntry,
              slot,
              active.animationState,
            );
            const width = placement.rect.width;
            const height = placement.rect.height;
            const pivot = isFaceAnchoredVFXEntry(active.effectEntry)
              ? resolvePivotFactors(active.effectEntry.pivot)
              : { x: 0.5, y: 0.5 };
            guides.push({
              label: placementGuideLabel(active.effectEntry, placement.label),
              kind: "artwork",
              shape: "polygon",
              points: rectangleGuidePoints({
                x: -width / 2,
                y: -height / 2,
                width,
                height,
              }).map((point) =>
                transformTexturePlacementPoint(point, transform, slot),
              ),
              pivot: transformTexturePlacementPoint(
                { x: (pivot.x - 0.5) * width, y: (pivot.y - 0.5) * height },
                transform,
                slot,
              ),
            });
          }
        }
        if (isTextureVFXEntry(effect)) {
          const references = resolveTextureEffectPlacements({
            image: surface,
            effect,
            size: slot,
            profile: this._profile,
            faceTextureAnchors: anchors,
          });
          for (const placement of references.placements) {
            guides.push({
              label: placementGuideLabel(effect, placement.label),
              kind: "reference",
              shape: "polygon",
              points: rectangleGuidePoints(placement.rect).map((point) => ({
                x: point.x / slot.width,
                y: point.y / slot.height,
              })),
            });
          }
        }

        const flatten = this._cachedFaceFlattenState;
        const hasFlatten =
          flatten?.faceBindingKey === binding.bindingKey &&
          Boolean(flatten.sampledColorsBySlot[slot.slot]) &&
          result.active;
        const regions: AvatarFaceTextureFlattenRegionSnapshot[] = [];
        if (
          hasFlatten &&
          isEyeHoverVFXEntry(effect) &&
          flatten.shouldRenderEyes
        ) {
          regions.push(...flatten.eyeRegions);
        }
        if (
          hasFlatten &&
          (isMouthHoverVFXEntry(effect) ||
            (isFaceAnchoredVFXEntry(effect) && effect.anchor === "mouth")) &&
          flatten.shouldRenderMouth &&
          flatten.mouthRegion
        ) {
          regions.push(flatten.mouthRegion);
        }
        if (regions.length && anchors?.flatten.sample.center)
          regions.push(anchors.flatten.sample.center);
        for (const region of regions) {
          guides.push({
            label:
              region.region === "sample"
                ? "Skin sample"
                : `Flatten ${region.region}${region.side ? ` ${region.side}` : ""}`,
            kind: region.region === "sample" ? "sample" : "flatten",
            shape: region.region === "sample" ? "polygon" : "ellipse",
            source: region.source,
            points: rectangleGuidePoints({
              x: region.uv.u - region.referenceSizeUv.width / 2,
              y: region.uv.v - region.referenceSizeUv.height / 2,
              ...region.referenceSizeUv,
            }),
          });
        }
        if (isHoverVFXEntry(effect) && !guides.length) continue;
        result.surfaces.push({
          key: `${binding.bindingKey}:${slot.slot}`,
          materialName: binding.materialName ?? "Selected material",
          slot: slot.slot,
          image: surface,
          width: slot.width,
          height: slot.height,
          guides,
        });
      }
    }
    result.surfaces.sort(
      (a, b) => Number(b.slot === "map") - Number(a.slot === "map"),
    );
    if (
      result.surfaces.some((surface) =>
        surface.guides.some(
          (guide) =>
            (guide.kind === "flatten" || guide.kind === "sample") &&
            guide.source === "fallback",
        ),
      )
    ) {
      result.messages.push(
        "Flatten coverage uses an estimated region for this avatar.",
      );
    }
    if (!isHoverVFXEntry(effect) && !result.surfaces.length)
      result.messages.push(
        "The selected material has no readable texture surface.",
      );
    return result;
  }

  setFaceFlattenPreview(args: {
    previewEyes?: boolean;
    previewMouth?: boolean;
  }): void {
    if (this._isDisposed) return;

    let didChange = false;
    if (
      typeof args.previewEyes === "boolean" &&
      args.previewEyes !== this._flattenPreviewEyes
    ) {
      this._flattenPreviewEyes = args.previewEyes;
      didChange = true;
    }
    if (
      typeof args.previewMouth === "boolean" &&
      args.previewMouth !== this._flattenPreviewMouth
    ) {
      this._flattenPreviewMouth = args.previewMouth;
      didChange = true;
    }
    if (!didChange) {
      return;
    }

    this._cachedFaceFlattenState = null;
    this._refreshFaceFlattenComposite();
    this._emit();
  }

  subscribe(listener: VFXListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /**
   * Run one apply and drop an envelope value held for it when the apply fails,
   * unless a newer apply or removal of the same ID has taken over.
   */
  private async _applyTracked(
    appliedEffectId: string,
    run: () => Promise<void>,
  ): Promise<void> {
    const before = this._applyTokens.get(appliedEffectId) ?? 0;
    try {
      await run();
    } finally {
      const after = this._applyTokens.get(appliedEffectId) ?? 0;
      const active = Array.from(this._bindings.values()).some((binding) =>
        binding.activeEffects.has(appliedEffectId),
      );
      if (after <= before + 1 && !active) {
        this._pendingIntensities.delete(appliedEffectId);
      }
    }
  }

  async applyHoverVFX(args: {
    effectId: string;
    effectEntry?: AvatarHoverVFXEntry;
    logicalEffectId?: string;
  }): Promise<void> {
    await this._applyTracked(args.effectId, () => this._applyHoverVFXNow(args));
  }

  private async _applyHoverVFXNow(args: {
    effectId: string;
    effectEntry?: AvatarHoverVFXEntry;
    logicalEffectId?: string;
  }): Promise<void> {
    const effect = this._resolveEffectSource(args.effectId, args.effectEntry);
    if (!effect) {
      this._pushWarning(`Unknown VFX effect "${args.effectId}".`);
      return;
    }
    if (!isHoverVFXEntry(effect)) {
      this._pushWarning(`Effect "${effect.label}" is not a hover VFX.`);
      return;
    }
    await this._applyHoverEffect(effect, undefined, args.logicalEffectId);
  }

  async applyFaceAnchoredVFX(args: {
    effectId: string;
    effectEntry?: AvatarFaceAnchoredVFXEntry;
    logicalEffectId?: string;
  }): Promise<void> {
    await this._applyTracked(args.effectId, () =>
      this._applyFaceAnchoredVFXNow(args),
    );
  }

  private async _applyFaceAnchoredVFXNow(args: {
    effectId: string;
    effectEntry?: AvatarFaceAnchoredVFXEntry;
    logicalEffectId?: string;
  }): Promise<void> {
    const effect = this._resolveEffectSource(args.effectId, args.effectEntry);
    if (!effect) {
      this._pushWarning(`Unknown VFX effect "${args.effectId}".`);
      return;
    }
    if (!isFaceAnchoredVFXEntry(effect)) {
      this._pushWarning(`Effect "${effect.label}" is not a face-anchored VFX.`);
      return;
    }
    await this._applyFaceAnchoredEffect(
      effect,
      undefined,
      args.logicalEffectId,
    );
  }

  async applyTextureVFX(args: {
    effectId: string;
    applyMode?: AvatarVFXApplyMode;
    effectEntry?: AvatarTextureVFXEntry;
    logicalEffectId?: string;
  }): Promise<void> {
    await this._applyTracked(args.effectId, () =>
      this._applyTextureVFXNow(args),
    );
  }

  private async _applyTextureVFXNow(args: {
    effectId: string;
    applyMode?: AvatarVFXApplyMode;
    effectEntry?: AvatarTextureVFXEntry;
    logicalEffectId?: string;
  }): Promise<void> {
    const effect = this._resolveEffectSource(args.effectId, args.effectEntry);
    if (!effect) {
      this._pushWarning(`Unknown VFX effect "${args.effectId}".`);
      return;
    }
    if (!isTextureVFXEntry(effect)) {
      this._pushWarning(`Effect "${effect.label}" is not a texture VFX.`);
      return;
    }
    await this._applyTextureEffect(
      effect,
      args.applyMode,
      undefined,
      args.logicalEffectId,
    );
  }

  async applyEffect(args: {
    bindingKey: string;
    effectId: string;
    applyMode?: AvatarVFXApplyMode;
    effectEntry?: AvatarVFXCatalogEntry;
    logicalEffectId?: string;
  }): Promise<void> {
    await this._applyTracked(args.effectId, () => this._applyEffectNow(args));
  }

  private async _applyEffectNow(args: {
    bindingKey: string;
    effectId: string;
    applyMode?: AvatarVFXApplyMode;
    effectEntry?: AvatarVFXCatalogEntry;
    logicalEffectId?: string;
  }): Promise<void> {
    const effectSource = this._resolveEffectSource(
      args.effectId,
      args.effectEntry,
    );
    if (!effectSource) {
      this._pushWarning(`Unknown VFX effect "${args.effectId}".`);
      return;
    }
    const binding = this._bindings.get(args.bindingKey);
    if (!binding) {
      this._pushWarning(`Unknown VFX target "${args.bindingKey}".`);
      return;
    }

    const effect = cloneCatalogEffectEntry({
      ...effectSource,
      id: args.effectId,
    });

    if (isHoverVFXEntry(effect)) {
      await this._applyHoverEffect(effect, binding, args.logicalEffectId);
      return;
    }
    if (isFaceAnchoredVFXEntry(effect)) {
      await this._applyFaceAnchoredEffect(
        effect,
        binding,
        args.logicalEffectId,
      );
      return;
    }
    await this._applyTextureEffect(
      effect,
      args.applyMode,
      binding,
      args.logicalEffectId,
    );
  }

  /**
   * Record that a valid effect uses an attachment without a renderer yet
   * (body, sticker or silhouette). Nothing is applied.
   */
  reportUnsupportedAttachment(effect: AvatarVFXDeferredAttachmentEntry): void {
    if (this._isDisposed) return;
    this._pushWarning(
      `Avatar Effect "${effect.label}" uses a ${effect.attachmentKind} attachment, which is not yet supported.`,
    );
  }

  /**
   * Set an applied effect's event envelope (0–1), which multiplies its
   * opacity. A value for an effect that is still loading is held and used when
   * the apply finishes. Composite effects redraw on the next animation tick.
   */
  setEffectIntensity(appliedEffectId: string, value: number): void {
    if (this._isDisposed) return;
    const intensity = Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : 1;
    for (const binding of this._bindings.values()) {
      const active = binding.activeEffects.get(appliedEffectId);
      if (!active) continue;
      if (active.intensity === intensity) return;
      active.intensity = intensity;
      if (active.renderMode === "hover_plane") {
        applyAnimationToHoverInstances({
          instances: active.hoverInstances,
          animationState: active.animationState,
          effect: active.effectEntry,
          intensity,
        });
        return;
      }
      // A fading composite joins the animated layers so each tick redraws it;
      // at a steady full intensity it returns to the static cache.
      const animated = active.hasOwnMotion || intensity !== 1;
      if (active.isAnimated !== animated) {
        active.isAnimated = animated;
        this._markTextureCompositeStaticDirty(binding);
        this._redrawBindingTextureComposite(binding);
      }
      return;
    }
    this._pendingIntensities.set(appliedEffectId, intensity);
  }

  removeEffect(appliedEffectId: string): void {
    if (this._isDisposed) return;
    this._pendingIntensities.delete(appliedEffectId);
    // Invalidate an in-flight image load as well as any already-applied layer.
    this._applyTokens.set(
      appliedEffectId,
      (this._applyTokens.get(appliedEffectId) ?? 0) + 1,
    );
    this._removeAppliedEffect(appliedEffectId);
  }

  clearAllEffects(): void {
    if (this._isDisposed) return;
    this._bindings.forEach((binding) => {
      this._restoreBinding(binding);
    });
    this._syncForcedBlinkExpression();
    this._emit();
  }

  update(delta: number): void {
    if (this._isDisposed || !Number.isFinite(delta) || delta <= 0) return;

    this._animationFrameAccumulatorSec += delta;
    const shouldAdvanceAnimationFrame =
      this._animationFrameAccumulatorSec >= VFX_ANIMATION_FRAME_INTERVAL_SEC;
    if (shouldAdvanceAnimationFrame) {
      this._animationFrameAccumulatorSec =
        this._animationFrameAccumulatorSec % VFX_ANIMATION_FRAME_INTERVAL_SEC;
    }

    this._bindings.forEach((binding) => {
      let shouldRedrawTextureComposite = false;

      binding.activeEffects.forEach((activeEffect) => {
        if (activeEffect.isAnimated) {
          activeEffect.elapsedSec += delta;
        }

        activeEffect.hoverRuntimeMaterials.forEach((material) => {
          updateMaterialRuntime(material, delta);
        });

        if (!shouldAdvanceAnimationFrame || !activeEffect.isAnimated) {
          return;
        }

        activeEffect.animationState = evaluateAvatarVFXAnimation({
          elapsedSec: activeEffect.elapsedSec,
          config: activeEffect.animationConfig,
          keyframes: activeEffect.effectEntry.keyframes,
          flipbook: activeEffect.effectEntry.flipbook,
        });

        if (activeEffect.renderMode === "texture") {
          shouldRedrawTextureComposite = true;
          return;
        }

        applyAnimationToHoverInstances({
          instances: activeEffect.hoverInstances,
          animationState: activeEffect.animationState,
          effect: activeEffect.effectEntry,
          intensity: activeEffect.intensity,
        });
      });

      if (shouldRedrawTextureComposite) {
        this._redrawBindingTextureComposite(binding);
      }

      if (binding.textureComposite) {
        updateMaterialRuntime(binding.textureComposite.materialClone, delta);
      }
    });
  }

  dispose(): void {
    if (this._isDisposed) return;
    this.clearAllEffects();
    this._listeners.clear();
    this._bindings.clear();
    this._applyTokens.clear();
    this._pendingIntensities.clear();
    this._nextAppliedOrder = 0;
    this._warnings = [];
    this._snapshot = this._createSnapshot();
    this._observationSnapshot = this._createObservationSnapshot();
    this._isDisposed = true;
  }

  private _resolveEffectSource(
    effectId: string,
    effectEntry?: AvatarVFXCatalogEntry,
  ): AvatarVFXCatalogEntry | null {
    const catalogEffect = this._catalogProvider.resolveAvatarVFX(effectId);
    return effectEntry ?? catalogEffect ?? null;
  }

  private async _applyHoverEffect(
    effect: AvatarHoverVFXEntry,
    bindingOverride?: BindingState,
    logicalEffectId = effect.id,
  ): Promise<void> {
    const binding =
      bindingOverride ?? this._resolveAutoBindingForEffect(effect) ?? null;
    if (!binding) {
      this._pushWarning(
        `No compatible target was resolved for "${effect.label}".`,
      );
      return;
    }

    await this._applyResolvedEffectToBinding({
      binding,
      effect,
      applyMode: null,
      logicalEffectId,
    });
  }

  private async _applyFaceAnchoredEffect(
    effect: AvatarFaceAnchoredVFXEntry,
    bindingOverride?: BindingState,
    logicalEffectId = effect.id,
  ): Promise<void> {
    const binding =
      bindingOverride ?? this._resolveAutoBindingForEffect(effect) ?? null;
    if (!binding) {
      this._pushWarning(
        `No compatible target was resolved for "${effect.label}".`,
      );
      return;
    }

    await this._applyResolvedEffectToBinding({
      binding,
      effect,
      applyMode: "overlay",
      logicalEffectId,
    });
  }

  private async _applyTextureEffect(
    effect: AvatarTextureVFXEntry,
    applyModeOverride?: AvatarVFXApplyMode,
    bindingOverride?: BindingState,
    logicalEffectId = effect.id,
  ): Promise<void> {
    const binding =
      bindingOverride ??
      this._resolveAutoBindingForEffect(effect, applyModeOverride) ??
      null;
    if (!binding) {
      this._pushWarning(
        `No compatible target was resolved for "${effect.label}".`,
      );
      return;
    }

    await this._applyResolvedEffectToBinding({
      binding,
      effect,
      applyMode: applyModeOverride ?? effect.applyMode,
      logicalEffectId,
    });
  }

  private async _applyResolvedEffectToBinding(args: {
    binding: BindingState;
    effect: AvatarVFXCatalogEntry;
    applyMode: AvatarVFXApplyMode | null;
    logicalEffectId: string;
  }): Promise<void> {
    if (this._isDisposed) return;

    const { binding, effect, applyMode, logicalEffectId } = args;
    if (isAnchoredFaceTextureEffect(effect) && applyMode !== "overlay") {
      binding.warning = `Anchored face decals require overlay mode.`;
      this._pushWarning(
        `Anchored face decals require overlay mode for "${effect.label}".`,
      );
      return;
    }

    const effectTargetRole = getAvatarVFXTargetRole(effect);
    if (effectTargetRole !== binding.targetRole) {
      binding.warning = `Effect "${effect.label}" does not target ${binding.targetRole}.`;
      this._pushWarning(
        `Effect "${effect.label}" is not compatible with ${binding.targetRole}.`,
      );
      return;
    }

    const renderMode = resolveEffectRenderMode(effect);
    const isAnchoredTextureEffect = isAnchoredFaceTextureEffect(effect);
    const requiresFaceTextureAnchors =
      isAnchoredTextureEffect || isMouthHoverVFXEntry(effect);
    const faceTextureAnchors = requiresFaceTextureAnchors
      ? this._avatar.getFaceTextureAnchorsSnapshot()
      : null;
    if (
      requiresFaceTextureAnchors &&
      faceTextureAnchors?.status === "ready" &&
      faceTextureAnchors.faceBindingKey &&
      faceTextureAnchors.faceBindingKey !== binding.bindingKey
    ) {
      binding.warning = isAnchoredTextureEffect
        ? `Anchored face decals require the resolved face skin binding.`
        : `Mouth hover effects require the resolved face skin binding.`;
      this._pushWarning(
        isAnchoredTextureEffect
          ? `Anchored face decals require the resolved face skin binding for "${effect.label}".`
          : `Mouth hover effects require the resolved face skin binding for "${effect.label}".`,
      );
      return;
    }

    const animationPreset = deriveAvatarVFXAnimationPreset(
      effect.animationConfig,
    );
    const animationConfig = resolveAvatarVFXAnimationConfig(
      effect.animationConfig,
    );
    const isAnimated = isAnimatedEffect(effect, animationConfig);
    const initialAnimationState = evaluateAvatarVFXAnimation({
      elapsedSec: 0,
      config: animationConfig,
      keyframes: effect.keyframes,
      flipbook: effect.flipbook,
    });

    const appliedEffectId = effect.id;
    const effectRegion = getAvatarVFXRegion(effect);
    const token = (this._applyTokens.get(appliedEffectId) ?? 0) + 1;
    this._applyTokens.set(appliedEffectId, token);

    let effectImage: CanvasImageSource;
    let otherImage: CanvasImageSource | null = null;
    try {
      [effectImage, otherImage] = await Promise.all([
        loadEffectImage(effect.assetPath),
        effect.otherEyeAssetPath
          ? loadEffectImage(effect.otherEyeAssetPath)
          : Promise.resolve(null),
      ]);
    } catch (error) {
      if (this._applyTokens.get(appliedEffectId) !== token) return;
      binding.warning = error instanceof Error ? error.message : String(error);
      this._pushWarning(binding.warning);
      return;
    }

    if (this._isDisposed || this._applyTokens.get(appliedEffectId) !== token) {
      return;
    }

    if (renderMode === "hover_plane") {
      if (!isHoverVFXEntry(effect)) {
        binding.warning = `Effect "${effect.label}" is not a hover VFX.`;
        this._pushWarning(binding.warning);
        return;
      }
      const hoverEffectState = this._createHoverEffectGroup({
        binding,
        effect,
        effectImage,
        otherImage,
      });
      if (!hoverEffectState) {
        binding.warning =
          binding.warning ??
          `Unable to resolve hover placement for "${effect.label}".`;
        this._pushWarning(binding.warning);
        return;
      }

      if (isAvatarVFXRegionStackable(effectRegion)) {
        this._removeAppliedEffect(appliedEffectId, { emit: false });
      } else {
        this._removeAppliedEffectsInRegion(effectRegion, { emit: false });
      }
      const disabledBindingKeys = this._applyAutoDisabledBindings(
        appliedEffectId,
        binding,
        getAutoDisabledRoles(effect),
      );
      const forcesBlink = shouldForceBlink(effect);
      binding.activeEffects.set(appliedEffectId, {
        appliedEffectId,
        effectId: logicalEffectId,
        effectEntry: effect,
        applyMode,
        animationPreset,
        animationConfig,
        renderMode,
        forcesBlink,
        layerCanvases: new Map(),
        hoverGroup: hoverEffectState.group,
        hoverInstances: hoverEffectState.instances,
        hoverRuntimeMaterials: hoverEffectState.runtimeMaterials,
        disabledBindingKeys,
        elapsedSec: 0,
        isAnimated,
        hasOwnMotion: isAnimated,
        animationState: initialAnimationState,
        appliedOrder: ++this._nextAppliedOrder,
        intensity: this._takePendingIntensity(appliedEffectId),
        tintedImages: new Map(),
      });
      this._cachedFaceFlattenState = null;
      applyAnimationToHoverInstances({
        instances: hoverEffectState.instances,
        animationState: initialAnimationState,
        effect,
        intensity: binding.activeEffects.get(appliedEffectId)?.intensity ?? 1,
      });
      binding.warning = null;
      if (isEyeHoverVFXEntry(effect) || isMouthHoverVFXEntry(effect)) {
        this._refreshFaceFlattenComposite();
      }
      this._syncForcedBlinkExpression();
      this._emit();
      return;
    }

    if (!applyMode) {
      binding.warning = `Effect "${effect.label}" does not define a texture apply mode.`;
      this._pushWarning(binding.warning);
      return;
    }

    const builtLayerCanvases = this._buildTextureLayerCanvases({
      binding,
      effect,
      applyMode,
      effectImage,
      otherImage,
      faceTextureAnchors,
    });
    if (builtLayerCanvases.layerCanvases.size === 0) {
      binding.warning =
        builtLayerCanvases.warning ??
        `No compatible ${applyMode} texture slots were available.`;
      this._pushWarning(binding.warning);
      return;
    }

    if (isAvatarVFXRegionStackable(effectRegion)) {
      this._removeAppliedEffect(appliedEffectId, { emit: false });
    } else {
      this._removeAppliedEffectsInRegion(effectRegion, { emit: false });
    }
    this._markTextureCompositeStaticDirty(binding);
    const disabledBindingKeys = this._applyAutoDisabledBindings(
      appliedEffectId,
      binding,
      getAutoDisabledRoles(effect),
    );
    const forcesBlink = shouldForceBlink(effect);
    binding.activeEffects.set(appliedEffectId, {
      appliedEffectId,
      effectId: logicalEffectId,
      effectEntry: effect,
      applyMode,
      animationPreset,
      animationConfig,
      renderMode,
      forcesBlink,
      layerCanvases: builtLayerCanvases.layerCanvases,
      hoverGroup: null,
      hoverInstances: [],
      hoverRuntimeMaterials: [],
      disabledBindingKeys,
      elapsedSec: 0,
      isAnimated,
      hasOwnMotion: isAnimated,
      animationState: initialAnimationState,
      appliedOrder: ++this._nextAppliedOrder,
      intensity: this._takePendingIntensity(appliedEffectId),
      tintedImages: new Map(),
    });
    this._cachedFaceFlattenState = null;
    const appliedEffect = binding.activeEffects.get(appliedEffectId);
    if (appliedEffect && appliedEffect.intensity !== 1) {
      // A fade already in progress redraws on each animation tick.
      appliedEffect.isAnimated = true;
    }

    const redrawSucceeded = this._redrawBindingTextureComposite(binding);
    if (!redrawSucceeded) {
      this._removeAppliedEffect(appliedEffectId, { emit: false });
      binding.warning =
        binding.warning ??
        `Unable to composite texture VFX for "${binding.materialName ?? binding.bindingKey}".`;
      this._pushWarning(binding.warning);
      return;
    }

    binding.warning = null;
    this._syncForcedBlinkExpression();
    this._emit();
  }

  private _buildTextureLayerCanvases(args: {
    binding: BindingState;
    effect: AvatarVFXCatalogEntry;
    applyMode: AvatarVFXApplyMode;
    effectImage: CanvasImageSource;
    otherImage: CanvasImageSource | null;
    faceTextureAnchors: AvatarFaceTextureAnchorsSnapshot | null;
  }): {
    layerCanvases: Map<AvatarVFXTextureSlot, EffectLayerCanvasState>;
    warning: string | null;
  } {
    const layerCanvases = new Map<
      AvatarVFXTextureSlot,
      EffectLayerCanvasState
    >();
    let textureDrawWarning: string | null = null;

    args.binding.textureSlots.forEach((slotState) => {
      if (args.applyMode === "overlay" && !slotState.canOverlay) {
        return;
      }

      const drawResult = resolveTextureEffectPlacements({
        image: args.effectImage,
        effect: args.effect,
        size: { width: slotState.width, height: slotState.height },
        profile: this._profile,
        faceTextureAnchors: args.faceTextureAnchors,
      });
      if (drawResult.placements.length === 0) {
        textureDrawWarning = textureDrawWarning ?? drawResult.warning ?? null;
        return;
      }

      layerCanvases.set(slotState.slot, {
        slot: slotState.slot,
        image: args.effectImage,
        otherImage: args.otherImage,
        placements: drawResult.placements,
        width: slotState.width,
        height: slotState.height,
      });
    });

    return {
      layerCanvases,
      warning: textureDrawWarning,
    };
  }

  private _resolveAutoBindingForEffect(
    effect: AvatarVFXCatalogEntry,
    applyModeOverride?: AvatarVFXApplyMode,
  ): BindingState | null {
    const applyMode = applyModeOverride ?? getAvatarVFXApplyMode(effect);

    if (isFaceAnchoredVFXEntry(effect)) {
      const anchors = this._avatar.getFaceTextureAnchorsSnapshot();
      if (anchors?.status === "ready" && anchors.faceBindingKey) {
        return this._bindings.get(anchors.faceBindingKey) ?? null;
      }
    }

    if (isMouthHoverVFXEntry(effect)) {
      const anchors = this._avatar.getFaceTextureAnchorsSnapshot();
      if (anchors?.status === "ready" && anchors.faceBindingKey) {
        return this._bindings.get(anchors.faceBindingKey) ?? null;
      }
      return null;
    }

    if (isBoxHoverVFXEntry(effect)) {
      const faceLandmarks = this._avatar.getFaceLandmarksSnapshot();
      if (faceLandmarks?.status === "ready" && faceLandmarks.faceBindingKey) {
        return this._bindings.get(faceLandmarks.faceBindingKey) ?? null;
      }
    }

    if (getAvatarVFXTargetRole(effect) === "face_skin") {
      const anchors = this._avatar.getFaceTextureAnchorsSnapshot();
      if (anchors?.status === "ready" && anchors.faceBindingKey) {
        return this._bindings.get(anchors.faceBindingKey) ?? null;
      }
      const faceLandmarks = this._avatar.getFaceLandmarksSnapshot();
      if (faceLandmarks?.status === "ready" && faceLandmarks.faceBindingKey) {
        return this._bindings.get(faceLandmarks.faceBindingKey) ?? null;
      }
    }

    return (
      Array.from(this._bindings.values()).find((binding) => {
        if (binding.targetRole !== getAvatarVFXTargetRole(effect)) {
          return false;
        }
        if (applyMode === "overlay") {
          return binding.textureSlots.some((slot) => slot.canOverlay);
        }
        if (applyMode === "replace") {
          return binding.textureSlots.length > 0;
        }
        return true;
      }) ?? null
    );
  }

  private _resolveFaceFlattenBinding(): BindingState | null {
    const anchors = this._avatar.getFaceTextureAnchorsSnapshot();
    if (anchors?.status === "ready" && anchors.faceBindingKey) {
      return this._bindings.get(anchors.faceBindingKey) ?? null;
    }
    const faceLandmarks = this._avatar.getFaceLandmarksSnapshot();
    if (faceLandmarks?.status === "ready" && faceLandmarks.faceBindingKey) {
      return this._bindings.get(faceLandmarks.faceBindingKey) ?? null;
    }
    return (
      Array.from(this._bindings.values()).find(
        (binding) => binding.targetRole === "face_skin",
      ) ?? null
    );
  }

  private _hasAutoFaceFlattenEyes(): boolean {
    return Array.from(this._bindings.values()).some((binding) =>
      Array.from(binding.activeEffects.values()).some(
        ({ effectEntry }) =>
          isEyeHoverVFXEntry(effectEntry) && (effectEntry.faceCleanup ?? true),
      ),
    );
  }

  private _hasAutoFaceFlattenMouth(): boolean {
    return Array.from(this._bindings.values()).some((binding) =>
      Array.from(binding.activeEffects.values()).some(
        ({ effectEntry }) =>
          ((isFaceAnchoredVFXEntry(effectEntry) &&
            effectEntry.anchor === "mouth") ||
            isMouthHoverVFXEntry(effectEntry)) &&
          (effectEntry.faceCleanup ?? true),
      ),
    );
  }

  private _resolveFaceFlattenState(
    binding: BindingState | null,
  ): ResolvedFaceFlattenState {
    const previewEyes = this._flattenPreviewEyes;
    const previewMouth = this._flattenPreviewMouth;
    const autoEyes = this._hasAutoFaceFlattenEyes();
    const autoMouth = this._hasAutoFaceFlattenMouth();
    const activeEyes = previewEyes || autoEyes;
    const activeMouth = previewMouth || autoMouth;

    if (!binding || binding.targetRole !== "face_skin") {
      return {
        status: "unavailable",
        faceBindingKey: binding?.bindingKey ?? null,
        previewEyes,
        previewMouth,
        autoEyes,
        autoMouth,
        activeEyes,
        activeMouth,
        sampledColor: null,
        sampledColorsBySlot: {},
        warning: "No face skin binding is available for flatten preview.",
        shouldRenderEyes: false,
        shouldRenderMouth: false,
        eyeRegions: [],
        mouthRegion: null,
      };
    }

    const anchors = this._avatar.getFaceTextureAnchorsSnapshot();
    if (!anchors || anchors.status !== "ready") {
      return {
        status: "unavailable",
        faceBindingKey: binding.bindingKey,
        previewEyes,
        previewMouth,
        autoEyes,
        autoMouth,
        activeEyes,
        activeMouth,
        sampledColor: null,
        sampledColorsBySlot: {},
        warning:
          anchors?.warnings[0] ??
          "Face texture anchors are unavailable for flatten preview.",
        shouldRenderEyes: false,
        shouldRenderMouth: false,
        eyeRegions: [],
        mouthRegion: null,
      };
    }

    if (
      anchors.faceBindingKey &&
      anchors.faceBindingKey !== binding.bindingKey
    ) {
      return {
        status: "unavailable",
        faceBindingKey: anchors.faceBindingKey,
        previewEyes,
        previewMouth,
        autoEyes,
        autoMouth,
        activeEyes,
        activeMouth,
        sampledColor: null,
        sampledColorsBySlot: {},
        warning:
          "Flatten preview requires the resolved face texture anchor binding.",
        shouldRenderEyes: false,
        shouldRenderMouth: false,
        eyeRegions: [],
        mouthRegion: null,
      };
    }

    const flattenTargetSlots = binding.textureSlots.filter(
      (slot) => slot.slot === "map" || slot.slot === "shadeMultiplyTexture",
    );
    if (flattenTargetSlots.length === 0) {
      return {
        status: "unavailable",
        faceBindingKey: binding.bindingKey,
        previewEyes,
        previewMouth,
        autoEyes,
        autoMouth,
        activeEyes,
        activeMouth,
        sampledColor: null,
        sampledColorsBySlot: {},
        warning:
          "The resolved face skin binding does not expose a supported flatten texture slot.",
        shouldRenderEyes: false,
        shouldRenderMouth: false,
        eyeRegions: [],
        mouthRegion: null,
      };
    }

    const sampleRegion = anchors.flatten.sample.center;
    const eyeRegions = [
      anchors.flatten.eyes.left,
      anchors.flatten.eyes.right,
    ].filter(
      (region): region is AvatarFaceTextureFlattenRegionSnapshot =>
        region !== null,
    );
    const mouthRegion = anchors.flatten.mouth.center;
    const sampledColorsBySlot: Partial<
      Record<AvatarVFXTextureSlot, AvatarVFXFlattenColorSnapshot>
    > = {};

    if (sampleRegion) {
      flattenTargetSlots.forEach((slot) => {
        const source = getTextureImageSource(slot.texture);
        if (!source) {
          return;
        }
        const sampledColor = sampleAverageTextureColor({
          image: source,
          width: slot.width,
          height: slot.height,
          region: sampleRegion,
        });
        if (!sampledColor) {
          return;
        }
        sampledColorsBySlot[slot.slot] = sampledColor;
      });
    }

    const sampledColor =
      sampledColorsBySlot.map ??
      sampledColorsBySlot.shadeMultiplyTexture ??
      null;

    let warning: string | null = null;
    if (!sampleRegion) {
      warning = "No flatten sample region was resolved on the face texture.";
    } else if (!sampledColor) {
      warning =
        "Unable to sample a face flatten color from the available face texture slots.";
    }

    return {
      status: "ready",
      faceBindingKey: binding.bindingKey,
      previewEyes,
      previewMouth,
      autoEyes,
      autoMouth,
      activeEyes,
      activeMouth,
      sampledColor,
      sampledColorsBySlot,
      warning,
      shouldRenderEyes: activeEyes && eyeRegions.length > 0,
      shouldRenderMouth: activeMouth && Boolean(mouthRegion),
      eyeRegions,
      mouthRegion,
    };
  }

  private _getCachedFaceFlattenState(
    binding: BindingState | null,
  ): ResolvedFaceFlattenState {
    if (
      this._cachedFaceFlattenState &&
      this._cachedFaceFlattenState.faceBindingKey ===
        (binding?.bindingKey ?? null)
    ) {
      return this._cachedFaceFlattenState;
    }
    const nextState = this._resolveFaceFlattenState(binding);
    this._cachedFaceFlattenState = nextState;
    return nextState;
  }

  private _refreshFaceFlattenComposite(): void {
    this._cachedFaceFlattenState = null;
    const faceBinding = this._resolveFaceFlattenBinding();
    if (!faceBinding) {
      return;
    }
    this._markTextureCompositeStaticDirty(faceBinding);
    this._redrawBindingTextureComposite(faceBinding);
  }

  private _rebuildBindings() {
    const runtimeResult = buildRuntimePrimitiveBindings(this._avatar);
    this._warnings = [...runtimeResult.warnings];
    this._cachedFaceFlattenState = null;
    this._bindings.clear();

    runtimeResult.entries.forEach((entry) => {
      const mainMaterial = getRenderableMainMaterial(entry.object);
      const targetRole = matchAvatarTargetRole(
        entry.materialName,
        this._profile,
      );
      if (!mainMaterial || !targetRole) return;

      const textureSlots: BindingTextureState[] = [];
      SUPPORTED_TEXTURE_SLOTS.forEach((slot) => {
        const texture = getTextureSlot(mainMaterial, slot);
        if (!texture) return;
        const size = getTextureSize(texture);
        if (!size) return;
        textureSlots.push({
          slot,
          texture,
          width: size.width,
          height: size.height,
          canOverlay: Boolean(getTextureImageSource(texture)),
        });
      });

      const availableEffectIds = this._catalog
        .filter((effect) => getAvatarVFXTargetRole(effect) === targetRole)
        .map((effect) => effect.id);

      // Creator effects arrive after discovery and may suppress any recognized
      // role, including untextured lines or lashes absent from the mounted catalog.
      this._bindings.set(entry.bindingKey, {
        bindingKey: entry.bindingKey,
        targetRole,
        materialIndex: entry.materialIndex,
        materialName: entry.materialName,
        objectName: entry.objectName,
        objectType: entry.objectType,
        object: entry.object,
        originalVisible: entry.originalVisible,
        originalMaterial: entry.object.material,
        originalMainMaterial: mainMaterial,
        textureSlots,
        availableEffectIds,
        autoDisableSources: new Set<string>(),
        visibleBeforeAutoDisable: null,
        warning: null,
        activeEffects: new Map(),
        textureComposite: null,
      });
    });
  }

  private _getSortedActiveEffects(
    binding: BindingState,
  ): ActiveBindingEffect[] {
    return Array.from(binding.activeEffects.values()).sort(
      (left, right) => left.appliedOrder - right.appliedOrder,
    );
  }

  private _getSortedTextureEffects(
    binding: BindingState,
  ): ActiveBindingEffect[] {
    return this._getSortedActiveEffects(binding)
      .filter((effect) => effect.renderMode === "texture")
      .sort((left, right) => {
        const kindOrderDiff =
          getTextureEffectKindOrder(left.effectEntry) -
          getTextureEffectKindOrder(right.effectEntry);
        if (kindOrderDiff !== 0) {
          return kindOrderDiff;
        }
        return left.appliedOrder - right.appliedOrder;
      });
  }

  private _ensureTextureCompositeState(
    binding: BindingState,
    materialClone: THREE.Material,
  ): BindingTextureCompositeState {
    if (binding.textureComposite?.materialClone === materialClone) {
      return binding.textureComposite;
    }
    if (binding.textureComposite) {
      this._disposeTextureCompositeState(binding);
    }
    const nextState: BindingTextureCompositeState = {
      materialClone,
      slotStates: new Map(),
      staticCacheDirty: true,
    };
    binding.textureComposite = nextState;
    return nextState;
  }

  private _markTextureCompositeStaticDirty(binding: BindingState): void {
    if (!binding.textureComposite) {
      return;
    }
    binding.textureComposite.staticCacheDirty = true;
  }

  private _ensureCompositeSlotState(args: {
    binding: BindingState;
    slotState: BindingTextureState;
    materialClone: THREE.Material;
  }): CompositeTextureSlotState {
    const compositeState = this._ensureTextureCompositeState(
      args.binding,
      args.materialClone,
    );
    const existing = compositeState.slotStates.get(args.slotState.slot) ?? null;
    if (
      existing &&
      existing.width === args.slotState.width &&
      existing.height === args.slotState.height
    ) {
      return existing;
    }
    if (existing) {
      existing.texture.dispose();
      compositeState.slotStates.delete(args.slotState.slot);
    }

    const { canvas, context } = createCanvas(
      args.slotState.width,
      args.slotState.height,
    );
    const texture = new THREE.CanvasTexture(canvas);
    copyTextureSettings(args.slotState.texture, texture);
    const nextState: CompositeTextureSlotState = {
      slot: args.slotState.slot,
      canvas,
      context,
      texture,
      staticSegments: [],
      width: args.slotState.width,
      height: args.slotState.height,
      baseDrawn: false,
    };
    compositeState.slotStates.set(args.slotState.slot, nextState);
    return nextState;
  }

  private _ensureStaticCompositeSegments(args: {
    compositeSlotState: CompositeTextureSlotState;
    width: number;
    height: number;
    count: number;
  }): StaticCompositeSegmentState[] {
    const { compositeSlotState, width, height, count } = args;
    const segments = compositeSlotState.staticSegments;
    const canReuse =
      segments.length === count &&
      compositeSlotState.width === width &&
      compositeSlotState.height === height;
    if (canReuse) {
      return segments;
    }

    const nextSegments = createStaticCompositeSegments({
      width,
      height,
      count,
    });
    compositeSlotState.staticSegments = nextSegments;
    return nextSegments;
  }

  private _disposeTextureCompositeState(binding: BindingState): void {
    const compositeState = binding.textureComposite;
    if (!compositeState) {
      return;
    }

    compositeState.slotStates.forEach((slotState) => {
      slotState.texture.dispose();
    });
    binding.textureSlots.forEach((slotState) => {
      setTextureSlot(
        compositeState.materialClone,
        slotState.slot,
        slotState.texture,
      );
    });
    binding.object.material = binding.originalMaterial;
    compositeState.materialClone.dispose();
    binding.textureComposite = null;
  }

  private _redrawBindingTextureComposite(binding: BindingState): boolean {
    const textureEffects = this._getSortedTextureEffects(binding);
    const flattenState = this._getCachedFaceFlattenState(binding);
    const shouldRenderFlatten =
      flattenState.shouldRenderEyes || flattenState.shouldRenderMouth;
    if (textureEffects.length === 0 && !shouldRenderFlatten) {
      this._disposeTextureCompositeState(binding);
      return true;
    }

    const materialClone = this._ensureOverrideMaterial(binding);
    if (!materialClone) {
      binding.warning = `Unable to clone material for "${binding.materialName ?? binding.bindingKey}".`;
      return false;
    }
    const compositeState = this._ensureTextureCompositeState(
      binding,
      materialClone,
    );
    const activeSlots = new Set<AvatarVFXTextureSlot>();

    binding.textureSlots.forEach((slotState) => {
      const slotEffects = textureEffects.filter((effect) =>
        effect.layerCanvases.has(slotState.slot),
      );
      // A replacement below full opacity shows the original slot beneath it.
      const shouldDrawBaseTexture =
        slotEffects.length === 0 ||
        slotEffects.every(
          (effect) =>
            effect.applyMode === "overlay" ||
            this._resolveActiveEffectOpacity(effect) < 1,
        );
      const flattenColorForSlot =
        flattenState.sampledColorsBySlot[slotState.slot] ?? null;
      const shouldApplyFlattenToSlot =
        shouldRenderFlatten &&
        flattenColorForSlot !== null &&
        (slotState.slot === "map" ||
          slotState.slot === "shadeMultiplyTexture") &&
        shouldDrawBaseTexture;

      if (slotEffects.length === 0 && !shouldApplyFlattenToSlot) {
        const existingSlot =
          compositeState.slotStates.get(slotState.slot) ?? null;
        if (existingSlot) {
          existingSlot.texture.dispose();
          compositeState.slotStates.delete(slotState.slot);
        }
        setTextureSlot(materialClone, slotState.slot, slotState.texture);
        return;
      }

      const compositeSlotState = this._ensureCompositeSlotState({
        binding,
        slotState,
        materialClone,
      });
      activeSlots.add(slotState.slot);

      const animatedEffects = slotEffects.filter((effect) => effect.isAnimated);
      const shouldRebuildStaticCache =
        compositeState.staticCacheDirty ||
        compositeSlotState.baseDrawn !== shouldDrawBaseTexture;
      compositeSlotState.baseDrawn = shouldDrawBaseTexture;
      if (shouldRebuildStaticCache) {
        const staticSegments = this._ensureStaticCompositeSegments({
          compositeSlotState,
          width: slotState.width,
          height: slotState.height,
          count: animatedEffects.length + 1,
        });

        staticSegments.forEach((segment) => {
          segment.context.clearRect(0, 0, slotState.width, slotState.height);
        });

        if (shouldDrawBaseTexture) {
          const originalSource = getTextureImageSource(slotState.texture);
          if (originalSource) {
            staticSegments[0]?.context.drawImage(
              originalSource,
              0,
              0,
              slotState.width,
              slotState.height,
            );
          }
        }

        if (shouldApplyFlattenToSlot && staticSegments[0]) {
          if (flattenState.shouldRenderEyes) {
            flattenState.eyeRegions.forEach((region) => {
              if (!flattenColorForSlot) return;
              drawFeatheredFlattenEllipse({
                context: staticSegments[0].context,
                region,
                fillColor: flattenColorForSlot,
                width: slotState.width,
                height: slotState.height,
              });
            });
          }
          if (
            flattenState.shouldRenderMouth &&
            flattenState.mouthRegion &&
            flattenColorForSlot
          ) {
            drawFeatheredFlattenEllipse({
              context: staticSegments[0].context,
              region: flattenState.mouthRegion,
              fillColor: flattenColorForSlot,
              width: slotState.width,
              height: slotState.height,
            });
          }
        }

        let staticSegmentIndex = 0;
        slotEffects.forEach((effect) => {
          if (effect.isAnimated) {
            staticSegmentIndex += 1;
            return;
          }
          const layerState = effect.layerCanvases.get(slotState.slot);
          if (!layerState) {
            return;
          }
          const segment = staticSegments[staticSegmentIndex];
          if (!segment) {
            return;
          }
          drawCompositedLayerCanvas({
            context: segment.context,
            layerState,
            effect: effect.effectEntry,
            size: {
              width: slotState.width,
              height: slotState.height,
            },
            animationState: effect.animationState,
            opacity: this._resolveActiveEffectOpacity(effect),
            tinted: (image) => this._tintedEffectImage(effect, image),
          });
        });
      }

      if (!shouldRebuildStaticCache && animatedEffects.length === 0) {
        return;
      }

      compositeSlotState.context.clearRect(
        0,
        0,
        slotState.width,
        slotState.height,
      );
      const staticSegments = this._ensureStaticCompositeSegments({
        compositeSlotState,
        width: slotState.width,
        height: slotState.height,
        count: animatedEffects.length + 1,
      });
      staticSegments.forEach((segment, index) => {
        compositeSlotState.context.drawImage(
          segment.canvas,
          0,
          0,
          slotState.width,
          slotState.height,
        );
        const animatedEffect = animatedEffects[index];
        if (!animatedEffect) {
          return;
        }
        const layerState = animatedEffect.layerCanvases.get(slotState.slot);
        if (!layerState) {
          return;
        }
        drawCompositedLayerCanvas({
          context: compositeSlotState.context,
          layerState,
          effect: animatedEffect.effectEntry,
          size: {
            width: slotState.width,
            height: slotState.height,
          },
          animationState: animatedEffect.animationState,
          opacity: this._resolveActiveEffectOpacity(animatedEffect),
          tinted: (image) => this._tintedEffectImage(animatedEffect, image),
        });
      });

      compositeSlotState.texture.needsUpdate = true;
      setTextureSlot(materialClone, slotState.slot, compositeSlotState.texture);
    });

    Array.from(compositeState.slotStates.keys()).forEach((slot) => {
      if (activeSlots.has(slot)) {
        return;
      }
      const existingSlot = compositeState.slotStates.get(slot);
      if (!existingSlot) {
        return;
      }
      existingSlot.texture.dispose();
      compositeState.slotStates.delete(slot);
    });

    materialClone.needsUpdate = true;
    compositeState.staticCacheDirty = false;
    return activeSlots.size > 0;
  }

  private _resolveActiveEffectOpacity(effect: ActiveBindingEffect): number {
    return resolveEffectiveOpacity({
      effect: effect.effectEntry,
      animationState: effect.animationState,
      intensity: effect.intensity,
    });
  }

  /** Return the effect's image tinted by its appearance, cached per image. */
  private _tintedEffectImage(
    effect: ActiveBindingEffect,
    image: CanvasImageSource,
  ): CanvasImageSource {
    const tint = resolveAppearance(effect.effectEntry).tint;
    if (!tint) return image;
    const cached = effect.tintedImages.get(image);
    if (cached) return cached;
    const tinted = createTintedImage(image, tint);
    if (!tinted) return image;
    effect.tintedImages.set(image, tinted);
    return tinted;
  }

  /** Consume an envelope value set before the effect finished applying. */
  private _takePendingIntensity(appliedEffectId: string): number {
    const pending = this._pendingIntensities.get(appliedEffectId);
    this._pendingIntensities.delete(appliedEffectId);
    return pending ?? 1;
  }

  private _ensureOverrideMaterial(
    binding: BindingState,
  ): THREE.Material | null {
    if (binding.textureComposite?.materialClone) {
      return binding.textureComposite.materialClone;
    }

    const originalMainMaterial = binding.originalMainMaterial;
    if (!originalMainMaterial) return null;

    const materialClone = originalMainMaterial.clone();
    if (Array.isArray(binding.originalMaterial)) {
      const nextMaterial = [...binding.originalMaterial];
      nextMaterial[0] = materialClone;
      binding.object.material = nextMaterial;
    } else {
      binding.object.material = materialClone;
    }
    materialClone.needsUpdate = true;
    return materialClone;
  }

  private _restoreBinding(binding: BindingState) {
    const activeEffectIds = Array.from(binding.activeEffects.keys());
    activeEffectIds.forEach((appliedEffectId) => {
      this._removeAppliedEffect(appliedEffectId, { emit: false });
    });
    binding.warning = null;
  }

  private _removeAppliedEffect(
    appliedEffectId: string,
    options?: { emit?: boolean },
  ): boolean {
    if (!appliedEffectId) {
      return false;
    }

    for (const binding of this._bindings.values()) {
      const activeEffect = binding.activeEffects.get(appliedEffectId) ?? null;
      if (!activeEffect) {
        continue;
      }

      this._releaseActiveEffectResources(binding, activeEffect);
      binding.activeEffects.delete(appliedEffectId);
      this._cachedFaceFlattenState = null;

      if (
        activeEffect.renderMode === "texture" ||
        binding.textureComposite !== null
      ) {
        this._markTextureCompositeStaticDirty(binding);
        this._redrawBindingTextureComposite(binding);
      }
      if (
        isEyeHoverVFXEntry(activeEffect.effectEntry) ||
        isMouthHoverVFXEntry(activeEffect.effectEntry)
      ) {
        this._refreshFaceFlattenComposite();
      }

      this._syncForcedBlinkExpression();
      if (options?.emit !== false) {
        this._emit();
      }
      return true;
    }

    return false;
  }

  private _removeAppliedEffectsInRegion(
    region: AvatarVFXRegion,
    options?: { emit?: boolean },
  ): number {
    const appliedEffectIds = new Set<string>();

    for (const binding of this._bindings.values()) {
      for (const activeEffect of binding.activeEffects.values()) {
        if (getAvatarVFXRegion(activeEffect.effectEntry) !== region) {
          continue;
        }
        appliedEffectIds.add(activeEffect.appliedEffectId);
      }
    }

    let removedCount = 0;
    for (const appliedEffectId of appliedEffectIds) {
      if (this._removeAppliedEffect(appliedEffectId, { emit: false })) {
        removedCount += 1;
      }
    }

    if (removedCount > 0 && options?.emit !== false) {
      this._emit();
    }

    return removedCount;
  }

  private _releaseActiveEffectResources(
    binding: BindingState,
    activeEffect: ActiveBindingEffect,
  ): void {
    this._releaseAutoDisabledBindings(activeEffect);
    if (activeEffect.hoverGroup) {
      activeEffect.hoverGroup.removeFromParent();
      disposeObjectTree(activeEffect.hoverGroup);
    }
    if (
      binding.activeEffects.size === 1 &&
      activeEffect.renderMode === "texture"
    ) {
      this._disposeTextureCompositeState(binding);
    }
  }

  private _syncForcedBlinkExpression(): void {
    const shouldForceBlink = Array.from(this._bindings.values()).some(
      (binding) =>
        Array.from(binding.activeEffects.values()).some(
          (effect) => effect.forcesBlink,
        ),
    );
    if (shouldForceBlink) {
      this._avatar.setExpression(EYE_HOVER_FORCE_BLINK_EXPRESSION, 1);
      return;
    }
    this._avatar.clearExpressionOverride(EYE_HOVER_FORCE_BLINK_EXPRESSION);
  }

  private _applyAutoDisabledBindings(
    sourceEffectId: string,
    sourceBinding: BindingState,
    disableTargetRoles: AvatarVFXTargetRole[],
  ): string[] {
    if (disableTargetRoles.length === 0) return [];

    const disabledBindingKeys: string[] = [];
    this._bindings.forEach((binding) => {
      if (binding.bindingKey === sourceBinding.bindingKey) return;
      if (!disableTargetRoles.includes(binding.targetRole)) return;
      if (binding.autoDisableSources.size === 0) {
        binding.visibleBeforeAutoDisable = binding.object.visible;
      }
      binding.autoDisableSources.add(sourceEffectId);
      binding.object.visible = false;
      disabledBindingKeys.push(binding.bindingKey);
    });
    return disabledBindingKeys;
  }

  private _releaseAutoDisabledBindings(
    activeEffect: ActiveBindingEffect,
  ): void {
    const disabledBindingKeys = activeEffect.disabledBindingKeys;
    disabledBindingKeys.forEach((bindingKey) => {
      const binding = this._bindings.get(bindingKey);
      if (!binding) return;
      binding.autoDisableSources.delete(activeEffect.appliedEffectId);
      if (binding.autoDisableSources.size > 0) return;
      binding.object.visible =
        binding.visibleBeforeAutoDisable ?? binding.originalVisible;
      binding.visibleBeforeAutoDisable = null;
    });
  }

  private _createHoverEffectGroup(args: {
    binding: BindingState;
    effect: AvatarHoverVFXEntry;
    effectImage: CanvasImageSource;
    otherImage: CanvasImageSource | null;
  }): HoverEffectGroupState | null {
    const { binding, effect, effectImage, otherImage } = args;
    const faceLandmarks = this._avatar.getFaceLandmarksSnapshot();
    const faceTextureAnchors = this._avatar.getFaceTextureAnchorsSnapshot();
    const anchorObject = this._avatar.faceLandmarks?.getAnchorObject() ?? null;
    if (!faceLandmarks || faceLandmarks.status !== "ready" || !anchorObject) {
      binding.warning =
        "Face landmarks are unavailable for hover-plane VFX placement.";
      return null;
    }

    if (isEyeHoverVFXEntry(effect) && binding.targetRole !== "eye_iris") {
      binding.warning = `Effect "${effect.label}" requires an eye iris target.`;
      return null;
    }
    if (isBoxHoverVFXEntry(effect) && binding.targetRole !== "face_skin") {
      binding.warning = `Effect "${effect.label}" requires a face skin target.`;
      return null;
    }
    if (isMouthHoverVFXEntry(effect) && binding.targetRole !== "face_skin") {
      binding.warning = `Effect "${effect.label}" requires a face skin target.`;
      return null;
    }
    if (isMouthHoverVFXEntry(effect)) {
      if (!faceTextureAnchors || faceTextureAnchors.status !== "ready") {
        binding.warning =
          faceTextureAnchors?.warnings[0] ??
          "Face texture anchors are unavailable for mouth hover placement.";
        return null;
      }
      if (
        faceTextureAnchors.faceBindingKey &&
        faceTextureAnchors.faceBindingKey !== binding.bindingKey
      ) {
        binding.warning = `Effect "${effect.label}" requires the resolved face skin binding.`;
        return null;
      }
      if (!faceTextureAnchors.anchors.mouth.center) {
        binding.warning = `Effect "${effect.label}" requires a resolved mouth anchor.`;
        return null;
      }
    }

    const placements = resolveHoverPlacementInstances({
      effect,
      faceLandmarks,
      faceTextureAnchors,
    });
    if (!placements || placements.length === 0) {
      binding.warning = `Effect "${effect.label}" did not resolve any hover placements.`;
      return null;
    }

    // A flipbook plane takes its aspect from one frame, not the whole sheet.
    const imageSize = resolveArtFrameSize(effectImage, effect.flipbook);
    if (!imageSize) {
      binding.warning = `Effect "${effect.label}" has no readable image size.`;
      return null;
    }

    const staticScaleX = resolveStaticScaleComponent(effect.transform.scale.x);
    const staticScaleY = resolveStaticScaleComponent(effect.transform.scale.y);
    const staticScaleZ = resolveStaticScaleComponent(effect.transform.scale.z);
    const hoverBackdropSourceBinding = hasHoverSkinBackdrop(effect)
      ? this._resolveFaceFlattenBinding()
      : null;
    const hoverSkinBackdropColor = hoverBackdropSourceBinding
      ? this._getCachedFaceFlattenState(hoverBackdropSourceBinding).sampledColor
      : null;
    if (hasHoverSkinBackdrop(effect) && !hoverSkinBackdropColor) {
      this._pushWarning(
        `Unable to sample a face skin color for hover backdrop on "${effect.label}".`,
      );
    }
    const resolvedPlacements = placements
      .map((placement) => {
        if (isEyeHoverVFXEntry(effect)) {
          const planeHeight = EYE_HOVER_PLANE_HEIGHT;
          return {
            placement,
            planeSize: {
              width:
                planeHeight * (imageSize.width / Math.max(1, imageSize.height)),
              height: planeHeight,
            },
          };
        }
        if (isBoxHoverVFXEntry(effect)) {
          const planeHeight = BOX_HOVER_PLANE_HEIGHT;
          return {
            placement,
            planeSize: {
              width:
                planeHeight * (imageSize.width / Math.max(1, imageSize.height)),
              height: planeHeight,
            },
          };
        }
        if (!placement.referenceSizeLocal) {
          return null;
        }
        return {
          placement,
          planeSize: resolvePlacementSizeFromReferenceSize({
            referenceSize: placement.referenceSizeLocal,
            imageSize,
          }),
        };
      })
      .filter(
        (
          value,
        ): value is {
          placement: HoverPlacementInstance;
          planeSize: Size;
        } => value !== null,
      );
    if (resolvedPlacements.length !== placements.length) {
      binding.warning = `Effect "${effect.label}" did not resolve any hover plane size.`;
      return null;
    }

    const appearance = resolveAppearance(effect);
    const texture = createTextureFromImage(effectImage);
    const otherTexture = otherImage ? createTextureFromImage(otherImage) : null;
    for (const value of [texture, otherTexture]) {
      if (value) applyFlipbookFrameToTexture(value, effect.flipbook, 0);
    }
    const facingRotationY = resolveHoverFacingRotationY(faceLandmarks);

    const group = new THREE.Group();
    group.name = `AvatarHoverVFX:${effect.id}`;
    group.renderOrder = HOVER_RENDER_ORDER;
    group.frustumCulled = false;
    const instances: HoverPlaneInstanceState[] = [];
    const runtimeMaterials: THREE.Material[] = [];

    resolvedPlacements.forEach(({ placement, planeSize }) => {
      const geometry = new THREE.PlaneGeometry(
        planeSize.width,
        planeSize.height,
      );
      // The mirrored eye uses its own art, unmirrored, when the effect has one.
      const usesOtherArt = placement.mirrored && otherTexture !== null;
      const placementTexture = usesOtherArt ? otherTexture : texture;
      const mirrorScale = placement.mirrored && !usesOtherArt ? -1 : 1;
      const material = new THREE.MeshBasicMaterial({
        map: placementTexture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        opacity: appearance.opacity,
      });
      if (appearance.tint) material.color.set(appearance.tint);
      configureHoverMaterialBlend(material, appearance.blend);
      const placementRoot = new THREE.Group();
      placementRoot.name = `${effect.id}:${placement.label}:anchor`;
      placementRoot.position.copy(placement.position);
      placementRoot.rotation.y = facingRotationY;
      placementRoot.renderOrder = HOVER_RENDER_ORDER;
      placementRoot.frustumCulled = false;

      const animatedGroup = new THREE.Group();
      animatedGroup.name = `${effect.id}:${placement.label}:animated`;
      animatedGroup.renderOrder = HOVER_RENDER_ORDER;
      animatedGroup.frustumCulled = false;

      // Rotate the image and its backdrop together without animation overwriting it.
      const staticGroup = new THREE.Group();
      staticGroup.rotation.set(
        effect.transform.rotation.x,
        effect.transform.rotation.y,
        effect.transform.rotation.z,
      );
      animatedGroup.add(staticGroup);

      let backdropMaterialForFade: THREE.Material | null = null;
      if (hoverSkinBackdropColor && hoverBackdropSourceBinding) {
        const backdropGeometry = new THREE.PlaneGeometry(
          planeSize.width * HOVER_SKIN_BACKDROP_WIDTH_SCALE,
          planeSize.height * HOVER_SKIN_BACKDROP_HEIGHT_SCALE,
        );
        const backdropMaterial = createHoverSkinBackdropMaterial({
          sourceBinding: hoverBackdropSourceBinding,
          fillColor: hoverSkinBackdropColor,
        });
        if (backdropMaterial) {
          const backdropMesh = new THREE.Mesh(
            backdropGeometry,
            backdropMaterial,
          );
          backdropMesh.name = `${effect.id}:${placement.label}:backdrop`;
          backdropMesh.position.z = HOVER_SKIN_BACKDROP_Z_OFFSET;
          backdropMesh.scale.set(
            (placement.mirrored ? -1 : 1) * staticScaleX,
            staticScaleY,
            staticScaleZ,
          );
          backdropMesh.renderOrder = HOVER_RENDER_ORDER - 1;
          backdropMesh.frustumCulled = false;
          staticGroup.add(backdropMesh);
          runtimeMaterials.push(backdropMaterial);
          backdropMaterialForFade = backdropMaterial;
        }
      }

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${effect.id}:${placement.label}`;
      mesh.scale.set(mirrorScale * staticScaleX, staticScaleY, staticScaleZ);
      mesh.renderOrder = HOVER_RENDER_ORDER;
      mesh.frustumCulled = false;
      staticGroup.add(mesh);
      placementRoot.add(animatedGroup);
      group.add(placementRoot);
      instances.push({
        label: placement.label,
        mesh,
        animatedGroup,
        planeWidth: planeSize.width * staticScaleX,
        planeHeight: planeSize.height * staticScaleY,
        mirrored: placement.mirrored,
        material,
        texture: placementTexture,
        backdropMaterial: backdropMaterialForFade,
        backdropBaseOpacity: backdropMaterialForFade?.opacity ?? 1,
      });
      if (backdropMaterialForFade) {
        backdropMaterialForFade.opacity *= appearance.opacity;
      }
    });

    if (
      otherTexture &&
      !instances.some((value) => value.texture === otherTexture)
    ) {
      otherTexture.dispose();
    }
    anchorObject.add(group);
    binding.warning = null;
    return {
      group,
      instances,
      runtimeMaterials,
    };
  }

  private _createSnapshot(): AvatarVFXSnapshot {
    const flatten = this._createFlattenSnapshot();
    const targetBindings: AvatarVFXTargetBindingSnapshot[] = Array.from(
      this._bindings.values(),
    )
      .map((binding) => {
        const activeEffects = this._getSortedActiveEffects(binding);
        const topEffect =
          activeEffects.length > 0
            ? (activeEffects[activeEffects.length - 1] ?? null)
            : null;
        return {
          bindingKey: binding.bindingKey,
          targetRole: binding.targetRole,
          materialIndex: binding.materialIndex,
          materialName: binding.materialName,
          objectName: binding.objectName,
          objectType: binding.objectType,
          textureSlots: getTextureSlotSnapshots(binding.textureSlots),
          availableEffectIds: binding.availableEffectIds,
          activeEffectId: topEffect?.effectId ?? null,
          activeEffectIds: activeEffects.map((effect) => effect.effectId),
          activeEffectCount: activeEffects.length,
          activeAnimationPreset: topEffect?.animationPreset ?? null,
          activeApplyMode: topEffect?.applyMode ?? null,
          warning: binding.warning,
        };
      })
      .sort((a, b) => {
        if (a.targetRole !== b.targetRole) {
          return a.targetRole.localeCompare(b.targetRole);
        }
        return (a.materialName ?? "").localeCompare(b.materialName ?? "");
      });

    const activeEffects: AvatarVFXAppliedEffectSnapshot[] = Array.from(
      this._bindings.values(),
    ).flatMap((binding) =>
      this._getSortedActiveEffects(binding).map((activeEffect) => {
        const resolvedEffect = cloneCatalogEffectEntry(
          activeEffect.effectEntry,
        );
        return {
          appliedEffectId: activeEffect.appliedEffectId,
          bindingKey: binding.bindingKey,
          targetRole: binding.targetRole,
          materialName: binding.materialName,
          effectId: activeEffect.effectId,
          effectLabel: resolvedEffect.label,
          renderMode: activeEffect.renderMode,
          animationPreset: activeEffect.animationPreset,
          applyMode:
            activeEffect.applyMode ?? getAvatarVFXApplyMode(resolvedEffect),
          effect: resolvedEffect,
          transform: cloneEffectTransform(resolvedEffect.transform),
          animationConfig: activeEffect.animationConfig,
        };
      }),
    );

    return {
      catalog: [...this._catalog],
      targetBindings,
      activeEffects,
      flatten,
      warnings: [...this._warnings],
    };
  }

  private _createObservationSnapshot(): AvatarVFXObservationSnapshot {
    return {
      activeEffects: Array.from(this._bindings.values()).flatMap((binding) =>
        this._getSortedActiveEffects(binding).map((effect) => ({
          effectId: effect.effectId,
          targetRole: binding.targetRole,
          animationPreset: effect.animationPreset,
          renderMode: effect.renderMode,
        })),
      ),
      warningCount: this._warnings.length,
    };
  }

  private _createFlattenSnapshot(): AvatarVFXFaceFlattenSnapshot {
    const state = this._getCachedFaceFlattenState(
      this._resolveFaceFlattenBinding(),
    );
    return {
      status: state.status,
      faceBindingKey: state.faceBindingKey,
      previewEyes: state.previewEyes,
      previewMouth: state.previewMouth,
      autoEyes: state.autoEyes,
      autoMouth: state.autoMouth,
      activeEyes: state.activeEyes,
      activeMouth: state.activeMouth,
      sampledColor: state.sampledColor,
      warning: state.warning,
    };
  }

  private _pushWarning(message: string) {
    this._warnings = Array.from(
      new Set(
        [...this._warnings, message]
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    );
    this._emit();
  }

  private _emit() {
    this._snapshot = this._createSnapshot();
    this._observationSnapshot = this._createObservationSnapshot();
    if (this._isDisposed) return;
    this._listeners.forEach((listener) => {
      listener();
    });
  }
}
