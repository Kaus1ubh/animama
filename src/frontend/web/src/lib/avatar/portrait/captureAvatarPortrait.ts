import * as THREE from "three";

import type { Avatar } from "@/lib/avatar";

import { resolveAvatarPortraitHappyExpression } from "./expression";
import {
  resolveAvatarPortraitFraming,
  type AvatarPortraitFraming,
  type AvatarPortraitLandmark,
} from "./framing";

export const AVATAR_PORTRAIT_RENDERER_VERSION = 1;
export const AVATAR_PORTRAIT_CAPTURE_PRESET_VERSION = 2;
export const DEFAULT_AVATAR_PORTRAIT_SIZE = 512;

const PORTRAIT_FOV_DEGREES = 35;

export type AvatarPortraitCaptureFailureCode =
  | "aborted"
  | "head_bone_missing"
  | "invalid_size"
  | "encode_failed";

export class AvatarPortraitCaptureError extends Error {
  readonly code: AvatarPortraitCaptureFailureCode;

  constructor(code: AvatarPortraitCaptureFailureCode, message: string) {
    super(message);
    this.name = "AvatarPortraitCaptureError";
    this.code = code;
  }
}

type PortraitRenderTarget = Pick<
  THREE.WebGLRenderTarget,
  "texture" | "dispose"
>;

export type AvatarPortraitCaptureDependencies = {
  createRenderTarget?: (size: number) => PortraitRenderTarget;
  encodePixels?: (
    pixels: Uint8Array,
    size: number,
    signal?: AbortSignal,
  ) => Promise<Blob>;
};

export type CaptureAvatarPortraitInput = {
  avatar: Avatar;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  size?: number;
  signal?: AbortSignal;
  /**
   * `happy` (default) shows the Avatar's happy expression for a profile
   * portrait. `live` keeps the current expression state, so a thumbnail shows
   * what an effect does to the face (for example a forced blink).
   */
  expression?: "happy" | "live";
  dependencies?: AvatarPortraitCaptureDependencies;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AvatarPortraitCaptureError(
      "aborted",
      "Avatar portrait capture was cancelled.",
    );
  }
}

function collectFaceLandmarks(avatar: Avatar): AvatarPortraitLandmark[] {
  const face = avatar.faceLandmarks?.getSnapshot() ?? null;
  const anchors = avatar.faceTextureAnchors?.getSnapshot() ?? null;
  const humanoid = avatar.vrm?.humanoid;
  const boneWorldPosition = (boneName: "leftEye" | "rightEye") =>
    humanoid
      ?.getNormalizedBoneNode(boneName)
      ?.getWorldPosition(new THREE.Vector3()) ?? null;
  const candidates = [
    face?.status === "ready" ? face.eyes.left?.projectedFrontWorld : null,
    face?.status === "ready" ? face.eyes.right?.projectedFrontWorld : null,
    anchors?.status === "ready"
      ? anchors.anchors.mouth.center?.worldPoint
      : null,
    boneWorldPosition("leftEye"),
    boneWorldPosition("rightEye"),
  ];

  return candidates.filter(
    (point): point is AvatarPortraitLandmark =>
      point !== null && point !== undefined,
  );
}

function resolveCaptureFraming(avatar: Avatar): AvatarPortraitFraming {
  const head = avatar.getHeadPosition();
  if (!head) {
    throw new AvatarPortraitCaptureError(
      "head_bone_missing",
      "The Avatar Model has no normalized humanoid head bone.",
    );
  }

  const bounds = avatar.scene
    ? new THREE.Box3().setFromObject(avatar.scene)
    : null;
  return resolveAvatarPortraitFraming({
    head,
    landmarks: collectFaceLandmarks(avatar),
    fovDegrees: PORTRAIT_FOV_DEGREES,
    headTopY:
      bounds && !bounds.isEmpty() && Number.isFinite(bounds.max.y)
        ? bounds.max.y
        : undefined,
  });
}

function createCaptureCamera(
  source: THREE.PerspectiveCamera,
  framing: AvatarPortraitFraming,
): THREE.PerspectiveCamera {
  const camera = source.clone();
  const target = new THREE.Vector3(
    framing.target.x,
    framing.target.y,
    framing.target.z,
  );
  camera.aspect = 1;
  camera.fov = PORTRAIT_FOV_DEGREES;
  camera.near = Math.min(0.01, framing.distance / 10);
  camera.far = Math.max(source.far, framing.distance + 10);
  source.updateMatrixWorld(true);
  const viewDirection = source
    .getWorldDirection(new THREE.Vector3())
    .normalize();
  camera.position
    .copy(target)
    .addScaledVector(viewDirection, -framing.distance);
  camera.up.copy(source.up);
  camera.lookAt(target);
  camera.clearViewOffset();
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function createDefaultRenderTarget(size: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(size, size, {
    depthBuffer: true,
    stencilBuffer: false,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });
}

async function encodePortraitPixels(
  pixels: Uint8Array,
  size: number,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfAborted(signal);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new AvatarPortraitCaptureError(
      "encode_failed",
      "The browser could not create a portrait encoding canvas.",
    );
  }
  context.putImageData(
    new ImageData(new Uint8ClampedArray(pixels), size, size),
    0,
    0,
  );

  let blob: Blob | null = null;
  try {
    blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.9),
    );
    throwIfAborted(signal);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
  if (!blob) {
    throw new AvatarPortraitCaptureError(
      "encode_failed",
      "The browser could not encode the Avatar portrait.",
    );
  }
  return blob;
}

function flipRowsInPlace(pixels: Uint8Array, size: number): void {
  const rowLength = size * 4;
  const row = new Uint8Array(rowLength);
  for (let top = 0; top < Math.floor(size / 2); top += 1) {
    const bottom = size - top - 1;
    const topOffset = top * rowLength;
    const bottomOffset = bottom * rowLength;
    row.set(pixels.subarray(topOffset, topOffset + rowLength));
    pixels.copyWithin(topOffset, bottomOffset, bottomOffset + rowLength);
    pixels.set(row, bottomOffset);
  }
}

/** Capture a deterministic square portrait without mutating the live stage. */
export async function captureAvatarPortrait({
  avatar,
  renderer,
  camera,
  scene,
  size = DEFAULT_AVATAR_PORTRAIT_SIZE,
  signal,
  expression = "happy",
  dependencies = {},
}: CaptureAvatarPortraitInput): Promise<Blob> {
  if (!Number.isInteger(size) || size < 64 || size > 2048) {
    throw new AvatarPortraitCaptureError(
      "invalid_size",
      "Avatar portrait size must be an integer between 64 and 2048 pixels.",
    );
  }
  throwIfAborted(signal);

  const renderTarget = (
    dependencies.createRenderTarget ?? createDefaultRenderTarget
  )(size);
  const priorRenderTarget = renderer.getRenderTarget();
  const priorViewport = renderer.getViewport(new THREE.Vector4());
  const priorScissor = renderer.getScissor(new THREE.Vector4());
  const priorScissorTest = renderer.getScissorTest();
  const priorClearColor = renderer.getClearColor(new THREE.Color());
  const priorClearAlpha = renderer.getClearAlpha();
  const priorAutoClear = renderer.autoClear;
  const priorBackground = scene.background;
  const happyExpression =
    expression === "happy"
      ? resolveAvatarPortraitHappyExpression(avatar.getAvailableExpressions())
      : null;
  const hiddenObjects: Array<{ object: THREE.Object3D; visible: boolean }> = [];
  const avatarScene = avatar.scene;
  const isAvatarAncestor = (object: THREE.Object3D): boolean => {
    let current: THREE.Object3D | null = avatarScene;
    while (current) {
      if (current === object) return true;
      current = current.parent;
    }
    return false;
  };
  const isAvatarDescendant = (object: THREE.Object3D): boolean => {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (current === avatarScene) return true;
      current = current.parent;
    }
    return false;
  };

  scene.traverse((object) => {
    if (
      object === scene ||
      isAvatarAncestor(object) ||
      isAvatarDescendant(object)
    ) {
      return;
    }
    if (object.visible) {
      hiddenObjects.push({ object, visible: object.visible });
      object.visible = false;
    }
  });

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.15);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
  keyLight.position.set(2.5, 3.5, 3);
  const fillLight = new THREE.DirectionalLight(0xcde7ff, 0.65);
  fillLight.position.set(-2, 1.5, 2);
  scene.add(ambientLight, keyLight, fillLight);

  let pixels: Uint8Array;
  try {
    const capture = () => {
      throwIfAborted(signal);
      const framing = resolveCaptureFraming(avatar);
      const captureCamera = createCaptureCamera(camera, framing);
      const pixelRatio = Math.max(1, renderer.getPixelRatio());
      const logicalTargetSize = size / pixelRatio;
      scene.background = null;
      renderer.setRenderTarget(renderTarget as THREE.WebGLRenderTarget);
      // WebGLRenderer scales setViewport/setScissor by its live canvas DPR.
      // The render target is already expressed in physical pixels, so divide
      // here to avoid capturing only one quadrant on Retina displays.
      renderer.setViewport(0, 0, logicalTargetSize, logicalTargetSize);
      renderer.setScissor(0, 0, logicalTargetSize, logicalTargetSize);
      renderer.setScissorTest(false);
      // Keep the generated face composable over every UI theme/surface.
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = true;
      renderer.clear(true, true, true);
      renderer.render(scene, captureCamera);

      const output = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(
        renderTarget as THREE.WebGLRenderTarget,
        0,
        0,
        size,
        size,
        output,
      );
      flipRowsInPlace(output, size);
      return output;
    };
    pixels = avatar.runWithPortraitCaptureState(happyExpression, capture, {
      keepLiveExpressions: expression === "live",
    });
  } finally {
    scene.remove(ambientLight, keyLight, fillLight);
    for (const { object, visible } of hiddenObjects) object.visible = visible;
    scene.background = priorBackground;
    renderer.setRenderTarget(priorRenderTarget);
    renderer.setViewport(priorViewport);
    renderer.setScissor(priorScissor);
    renderer.setScissorTest(priorScissorTest);
    renderer.setClearColor(priorClearColor, priorClearAlpha);
    renderer.autoClear = priorAutoClear;
    renderTarget.dispose();
  }

  throwIfAborted(signal);
  return (dependencies.encodePixels ?? encodePortraitPixels)(
    pixels,
    size,
    signal,
  );
}
