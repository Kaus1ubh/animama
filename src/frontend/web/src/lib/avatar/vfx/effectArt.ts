import * as THREE from "three";

import type {
  AvatarVFXBlend,
  AvatarVFXFlipbook,
  AvatarVFXKeyframes,
  AvatarVFXResolvedAnimationConfig,
} from "./types";

/*
 * Art helpers shared by face hover planes, body and sticker planes and
 * silhouette overlays: image sizing, textures, flipbook frames, blend modes,
 * animation detection and disposal of the objects an effect owns.
 */

export type ArtSize = {
  width: number;
  height: number;
};

export function getImageSize(image: CanvasImageSource): ArtSize | null {
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

/** An sRGB, clamped, unmipmapped texture of decoded effect art. */
export function createTextureFromImage(
  image: CanvasImageSource,
): THREE.Texture {
  const texture = new THREE.Texture(image as TexImageSource);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/** The size of one flipbook cell, or the whole image without a flipbook. */
export function resolveArtFrameSize(
  image: CanvasImageSource,
  flipbook: AvatarVFXFlipbook | undefined,
): ArtSize | null {
  const size = getImageSize(image);
  if (!size || !flipbook) return size;
  return {
    width: size.width / Math.max(1, flipbook.columns),
    height: size.height / Math.max(1, flipbook.rows),
  };
}

/**
 * The UV rectangle (offset and repeat) of one flipbook frame in an uploaded
 * texture. Textures are flipped on upload, so row 0 (top of the image) is at
 * v = 1. Without a flipbook the whole texture is the frame.
 */
export function resolveFlipbookFrameUv(
  flipbook: AvatarVFXFlipbook | undefined,
  frame: number,
): { offsetX: number; offsetY: number; repeatX: number; repeatY: number } {
  if (!flipbook) return { offsetX: 0, offsetY: 0, repeatX: 1, repeatY: 1 };
  const columns = Math.max(1, flipbook.columns);
  const rows = Math.max(1, flipbook.rows);
  return {
    offsetX: (frame % columns) / columns,
    offsetY: 1 - (Math.floor(frame / columns) + 1) / rows,
    repeatX: 1 / columns,
    repeatY: 1 / rows,
  };
}

/** Point a flipbook texture at one frame without re-uploading it. */
export function applyFlipbookFrameToTexture(
  texture: THREE.Texture,
  flipbook: AvatarVFXFlipbook | undefined,
  frame: number,
): void {
  if (!flipbook) return;
  const uv = resolveFlipbookFrameUv(flipbook, frame);
  texture.repeat.set(uv.repeatX, uv.repeatY);
  texture.offset.set(uv.offsetX, uv.offsetY);
}

/**
 * Configure a plane or overlay material's blend mode. Multiply uses
 * premultiplied output so transparent pixels leave the scene unchanged:
 * dst × (src·a + 1 − a).
 */
export function configureEffectBlend(
  material: THREE.Material,
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

export function hasAnimatedVFXConfig(
  config: AvatarVFXResolvedAnimationConfig,
): boolean {
  return config.pulseEnabled || config.spinEnabled || config.driftEnabled;
}

/** Whether an effect changes over its own timeline and needs the 30 FPS tick. */
export function isAnimatedEffect(
  effect: { keyframes?: AvatarVFXKeyframes; flipbook?: AvatarVFXFlipbook },
  config: AvatarVFXResolvedAnimationConfig,
): boolean {
  return (
    hasAnimatedVFXConfig(config) ||
    Boolean(effect.keyframes) ||
    (effect.flipbook?.frames ?? 1) > 1
  );
}

export function disposeMaterial(
  material: THREE.Material | THREE.Material[],
): void {
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

/** Dispose every geometry, material and material texture under `root`. */
export function disposeObjectTree(root: THREE.Object3D): void {
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
