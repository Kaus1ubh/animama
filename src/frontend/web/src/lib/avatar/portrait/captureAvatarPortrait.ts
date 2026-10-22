import * as THREE from "three";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import type { Avatar } from "@/lib/avatar";
import { applyChatCanvasGrade } from "@/lib/avatar/enhanced-rendering/backdropGlow";
import {
  applyAvatarToneMapping,
  isEnhancedRenderingEnabled,
} from "@/lib/avatar/enhanced-rendering/enhancedRendering";
import { avatarSceneLights } from "@/ui/main/canvas/sceneCameraPresets";

import { resolveAvatarPortraitHappyExpression } from "./expression";
import {
  resolveAvatarPortraitFraming,
  type AvatarPortraitFraming,
  type AvatarPortraitLandmark,
} from "./framing";

/**
 * 2: the chat canvas's colour pipeline (4x MSAA, its tone mapping and sRGB
 * output, and the enhanced canvas grade). 1 rendered linear colour without
 * tone mapping or antialiasing.
 */
export const AVATAR_PORTRAIT_RENDERER_VERSION = 2;
/** 3: the chat canvas's scene lights. 2 used three portrait-only lights. */
export const AVATAR_PORTRAIT_CAPTURE_PRESET_VERSION = 3;
/**
 * The portrait Save endpoint admits exactly this size and stores it at half
 * (512): the 2x supersample keeps the thin screen-space outlines continuous.
 */
export const DEFAULT_AVATAR_PORTRAIT_SIZE = 1024;

const PORTRAIT_FOV_DEGREES = 35;
/** Matches the chat canvas's `antialias: true` default framebuffer. */
const PORTRAIT_MSAA_SAMPLES = 4;

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

/**
 * `scene` receives the linear, antialiased Avatar render; `output` the
 * tone-mapped sRGB pixels that are read back.
 */
export type PortraitRenderTargetRole = "scene" | "output";

export type AvatarPortraitCaptureDependencies = {
  createRenderTarget?: (
    size: number,
    role: PortraitRenderTargetRole,
    floatColor: boolean,
  ) => PortraitRenderTarget;
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
  /**
   * Camera distance relative to the head framing (default 1). A larger value
   * keeps the same target and shows more around the head, for example art
   * on the chest or beside the head in an effect thumbnail.
   */
  framingScale?: number;
  /**
   * Lowers the camera target by this share of the captured view height
   * (0 to 0.5, default 0), so a widened framing can centre the body below
   * the head, for example art at the hips in an effect thumbnail.
   */
  framingDrop?: number;
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
  framingScale: number,
  framingDrop: number,
): THREE.PerspectiveCamera {
  const distance = framing.distance * framingScale;
  const viewHeight =
    2 * distance * Math.tan((PORTRAIT_FOV_DEGREES * Math.PI) / 360);
  const camera = source.clone();
  const target = new THREE.Vector3(
    framing.target.x,
    framing.target.y - framingDrop * viewHeight,
    framing.target.z,
  );
  camera.aspect = 1;
  camera.fov = PORTRAIT_FOV_DEGREES;
  camera.near = Math.min(0.01, distance / 10);
  camera.far = Math.max(source.far, distance + 10);
  source.updateMatrixWorld(true);
  const viewDirection = source
    .getWorldDirection(new THREE.Vector3())
    .normalize();
  camera.position.copy(target).addScaledVector(viewDirection, -distance);
  camera.up.copy(source.up);
  camera.lookAt(target);
  camera.clearViewOffset();
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

/**
 * The scene target keeps linear half-float colour where the GPU can render
 * to it, so tone mapping in the output pass does not band in the shadows;
 * otherwise 8-bit. The output target holds the 8-bit sRGB pixels that are
 * read back.
 */
function createDefaultRenderTarget(
  size: number,
  role: PortraitRenderTargetRole,
  floatColor: boolean,
): THREE.WebGLRenderTarget {
  return role === "scene"
    ? new THREE.WebGLRenderTarget(size, size, {
        depthBuffer: true,
        stencilBuffer: false,
        format: THREE.RGBAFormat,
        type: floatColor ? THREE.HalfFloatType : THREE.UnsignedByteType,
        samples: PORTRAIT_MSAA_SAMPLES,
      })
    : new THREE.WebGLRenderTarget(size, size, {
        depthBuffer: false,
        stencilBuffer: false,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
      });
}

const OUTPUT_SAMPLE = "gl_FragColor = texture2D( tDiffuse, vUv );";

/**
 * Three's output pass, but it first divides colour by alpha. Blending over the
 * transparent clear and the MSAA resolve leave premultiplied colour in the
 * scene target; tone mapping and sRGB encoding need straight colour, and so
 * does the straight-alpha image that is encoded. Without this, antialiased
 * edges and translucent parts come out darker than on the chat canvas.
 */
export function createStraightAlphaOutputPass(): OutputPass {
  const pass = new OutputPass();
  const shader = pass.material.fragmentShader;
  if (!shader.includes(OUTPUT_SAMPLE)) {
    throw new Error(
      "three's OutputShader no longer samples tDiffuse as expected.",
    );
  }
  pass.material.fragmentShader = shader.replace(
    OUTPUT_SAMPLE,
    `${OUTPUT_SAMPLE}\n\t\t\tif ( gl_FragColor.a > 0.0 ) gl_FragColor.rgb /= gl_FragColor.a;`,
  );
  return pass;
}

/** True when the renderer can render into a half-float colour target. */
function canRenderFloatColor(renderer: THREE.WebGLRenderer): boolean {
  const extensions = renderer.extensions;
  return Boolean(
    extensions?.has("EXT_color_buffer_float") ||
    extensions?.has("EXT_color_buffer_half_float"),
  );
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

/** The chat canvas's lights for the classic or enhanced look. */
function createChatLights(enhanced: boolean): THREE.Light[] {
  const { ambientIntensity, directional } = avatarSceneLights(enhanced);
  return [
    new THREE.AmbientLight(0xffffff, ambientIntensity),
    ...directional.map((light) => {
      const directionalLight = new THREE.DirectionalLight(
        new THREE.Color(light.color ?? "#ffffff"),
        light.intensity,
      );
      directionalLight.position.set(...light.position);
      return directionalLight;
    }),
  ];
}

/**
 * Capture a deterministic square portrait without mutating the live stage.
 * It is lit, tone mapped and graded like the chat canvas for the current
 * enhanced-rendering setting (which also chose the Avatar's materials when it
 * loaded); the background stays transparent and gets no backdrop glow.
 */
export async function captureAvatarPortrait({
  avatar,
  renderer,
  camera,
  scene,
  size = DEFAULT_AVATAR_PORTRAIT_SIZE,
  signal,
  expression = "happy",
  framingScale = 1,
  framingDrop = 0,
  dependencies = {},
}: CaptureAvatarPortraitInput): Promise<Blob> {
  if (!Number.isInteger(size) || size < 64 || size > 2048) {
    throw new AvatarPortraitCaptureError(
      "invalid_size",
      "Avatar portrait size must be an integer between 64 and 2048 pixels.",
    );
  }
  if (!(framingScale >= 1 && framingScale <= 4)) {
    throw new AvatarPortraitCaptureError(
      "invalid_size",
      "Avatar portrait framing scale must be between 1 and 4.",
    );
  }
  if (!(framingDrop >= 0 && framingDrop <= 0.5)) {
    throw new AvatarPortraitCaptureError(
      "invalid_size",
      "Avatar portrait framing drop must be between 0 and 0.5.",
    );
  }
  throwIfAborted(signal);

  // Created first: its guard throws if a three.js upgrade changes the output shader.
  const outputPass = createStraightAlphaOutputPass();
  const createRenderTarget =
    dependencies.createRenderTarget ?? createDefaultRenderTarget;
  const floatColor = canRenderFloatColor(renderer);
  const sceneTarget = createRenderTarget(size, "scene", floatColor);
  const outputTarget = createRenderTarget(size, "output", floatColor);
  const enhanced = isEnhancedRenderingEnabled();
  const priorRenderTarget = renderer.getRenderTarget();
  const priorViewport = renderer.getViewport(new THREE.Vector4());
  const priorScissor = renderer.getScissor(new THREE.Vector4());
  const priorScissorTest = renderer.getScissorTest();
  const priorClearColor = renderer.getClearColor(new THREE.Color());
  const priorClearAlpha = renderer.getClearAlpha();
  const priorAutoClear = renderer.autoClear;
  const priorToneMapping = renderer.toneMapping;
  const priorToneMappingExposure = renderer.toneMappingExposure;
  const priorOutputColorSpace = renderer.outputColorSpace;
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

  // The live lights are hidden with the rest of the stage; these repeat the
  // chat canvas's lights so the portrait does not depend on the host canvas.
  const lights = createChatLights(enhanced);
  scene.add(...lights);

  let pixels: Uint8Array;
  try {
    const capture = () => {
      throwIfAborted(signal);
      const framing = resolveCaptureFraming(avatar);
      const captureCamera = createCaptureCamera(
        camera,
        framing,
        framingScale,
        framingDrop,
      );
      const pixelRatio = Math.max(1, renderer.getPixelRatio());
      const logicalTargetSize = size / pixelRatio;
      scene.background = null;
      // Materials render linear colour into a render target; the output pass
      // applies the chat canvas's tone mapping and sRGB encoding after MSAA.
      applyAvatarToneMapping(renderer, enhanced);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setRenderTarget(sceneTarget as THREE.WebGLRenderTarget);
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
      outputPass.render(
        renderer,
        outputTarget as THREE.WebGLRenderTarget,
        sceneTarget as THREE.WebGLRenderTarget,
        0,
        false,
      );

      const output = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(
        outputTarget as THREE.WebGLRenderTarget,
        0,
        0,
        size,
        size,
        output,
      );
      flipRowsInPlace(output, size);
      // The chat canvas's CSS grade, applied to the read-back sRGB pixels.
      if (enhanced) applyChatCanvasGrade(output);
      return output;
    };
    pixels = avatar.runWithPortraitCaptureState(happyExpression, capture, {
      keepLiveExpressions: expression === "live",
    });
  } finally {
    scene.remove(...lights);
    for (const { object, visible } of hiddenObjects) object.visible = visible;
    scene.background = priorBackground;
    renderer.setRenderTarget(priorRenderTarget);
    renderer.setViewport(priorViewport);
    renderer.setScissor(priorScissor);
    renderer.setScissorTest(priorScissorTest);
    renderer.setClearColor(priorClearColor, priorClearAlpha);
    renderer.autoClear = priorAutoClear;
    renderer.toneMapping = priorToneMapping;
    renderer.toneMappingExposure = priorToneMappingExposure;
    renderer.outputColorSpace = priorOutputColorSpace;
    outputPass.dispose();
    sceneTarget.dispose();
    outputTarget.dispose();
  }

  throwIfAborted(signal);
  return (dependencies.encodePixels ?? encodePortraitPixels)(
    pixels,
    size,
    signal,
  );
}
