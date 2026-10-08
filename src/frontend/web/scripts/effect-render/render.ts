import * as THREE from "three";

import { Avatar } from "@/lib/avatar";
import { applyCanonicalPose } from "@/lib/avatar/motion-authoring/kinematics";
import { BUILT_IN_AVATAR_MOTION_CATALOG } from "@/lib/avatar/motion/AvatarMotionCatalog";
import { captureAvatarPortrait } from "@/lib/avatar/portrait";
import { sampleAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import { getResolvedAvatarPose } from "@/lib/avatar/poses/catalog";
import { applyAvatarVFXEffectById } from "@/lib/avatar/vfx/runtime";
import { EMPTY_RUNTIME_MEDIA_PROVIDER } from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";
import { buildSceneCameraPreset } from "@/ui/main/canvas/sceneCameraPresets";
import { updatePoseCreatorAvatarFrame } from "@/ui/pose-creator/poseCreatorAvatarFrame";

import { createStage, effectEntry, type EffectSource } from "./stage";

/**
 * Headless Avatar Effect renderer (driven by `scripts/effect-render.mjs`).
 *
 * Each request mounts a fresh production `Avatar` per Included Avatar, renders
 * it like the chat canvas (ACES Filmic, sRGB, default scene lights,
 * transparent clear, no stencil buffer), applies one effect (or several
 * together) through the runtime parser and `applyAvatarVFXEffectById`, then
 * advances fixed 60 Hz
 * frames with the Pose Creator ordering (effects → `vrm.update` → particles).
 * Automatic animation stays off, so the result is deterministic.
 */

type ViewName = "front" | "three-quarter" | "face";

type CommonRequest = {
  /** Applied together, in order: one effect, or several to check coexistence. */
  effects: EffectSource[];
  /** VRM expression held at full weight while rendering, or null. */
  expression: string | null;
  /** Gesture clip sampled at each frame's time after applying, or null. */
  clip: unknown;
};

type SheetRequest = CommonRequest & {
  avatars: { id: string; url: string }[];
  /** Ascending seconds after the effect is applied; one sheet row each. */
  times: number[];
  tile: { width: number; height: number };
  views: ViewName[];
};

type ThumbnailRequest = CommonRequest & {
  avatar: { id: string; url: string };
  time: number;
  size: number;
};

type CheckRequest = CommonRequest & {
  avatars: { id: string; url: string }[];
  times: number[];
  tile: { width: number; height: number };
  views: ViewName[];
  /** A pixel differs when any RGBA channel differs by more than this. */
  threshold: number;
  /**
   * What the baseline frames apply: for face effects the same effects with
   * fully transparent images of the same size (face options and cleanup stay,
   * so only the art differs), otherwise nothing.
   */
  baselineEffects: EffectSource[];
};

type AvatarCheck = AvatarDiagnostics & {
  /** Pixels that differ from the same frame without the effect, `[time][view]`. */
  differingPixels: number[][];
};

type AvatarDiagnostics = {
  id: string;
  applied: boolean;
  activeEffectIds: string[];
  warnings: string[];
  missingPoseRefs: string[];
};

const FRAME_SEC = 1 / 60;
/** Frames run before applying so spring bones settle from the load pose. */
const SETTLE_SEC = 1;
const HEADER_PX = 28;
const LABEL_PX = 64;
const PAGE_BACKGROUND = "#f4f3ef";
/**
 * Face view distance in metres: tighter than the chat's Portrait (close)
 * preset (0.8 m) so eye and mouth artwork is legible. Emote hovers far above
 * the head may be cropped here; the front and 3/4 views show them whole.
 */
const FACE_DISTANCE = 0.55;
/** The head bone sits at the skull base; aim this far above it, at the face. */
const FACE_AIM_ABOVE_HEAD_BONE = 0.07;
/** Mid-grey tile backdrop: light and dark artwork both stay readable. */
const TILE_BACKDROP = "#8e9097";

const VIEWS: Record<ViewName, { label: string; angle: number }> = {
  front: { label: "front", angle: 0 },
  // The Avatar's own left is +X, so a negative angle looks from its right.
  "three-quarter": { label: "3/4 right", angle: -Math.PI / 4 },
  face: { label: "face", angle: 0 },
};

const resolvePose = (id: string) => {
  try {
    return getResolvedAvatarPose(id);
  } catch {
    return null;
  }
};

/**
 * One Avatar with one applied effect, advanced in fixed frames from the
 * moment the effect was applied.
 */
class EffectSession {
  readonly avatar: Avatar;
  private readonly clip: unknown;
  private readonly missingPoseRefs = new Set<string>();
  private frame = 0;
  applied = false;

  private constructor(avatar: Avatar, clip: unknown) {
    this.avatar = avatar;
    this.clip = clip;
  }

  static async open(
    url: string,
    camera: THREE.Camera,
    canvas: HTMLCanvasElement,
    request: CommonRequest,
  ): Promise<EffectSession> {
    const avatar = new Avatar(camera, canvas, {
      motionCatalog: BUILT_IN_AVATAR_MOTION_CATALOG,
      mediaCatalog: EMPTY_RUNTIME_MEDIA_PROVIDER,
    });
    try {
      await avatar.load({ filePath: url });
      avatar.setAutomaticAnimationPlaybackEnabled(false);
      avatar.prepareFirstFrame();
      const session = new EffectSession(avatar, request.clip);
      if (request.expression) {
        if (!avatar.getAvailableExpressions().includes(request.expression)) {
          throw new Error(
            `Expression "${request.expression}" is not available; choose one of ${avatar.getAvailableExpressions().join(", ")}.`,
          );
        }
        avatar.setExpression(request.expression, 1);
      }
      for (let index = 0; index < SETTLE_SEC / FRAME_SEC; index += 1) {
        session.poseAt(0);
        updatePoseCreatorAvatarFrame(avatar, FRAME_SEC);
      }
      return session;
    } catch (error) {
      avatar.dispose();
      throw error;
    }
  }

  /** Apply every effect; `applied` is true only when all of them applied. */
  async apply(effects: EffectSource[]): Promise<void> {
    this.applied = effects.length > 0;
    for (const effect of effects) {
      const entry = effectEntry(effect);
      const applied = await applyAvatarVFXEffectById({
        avatar: this.avatar,
        effectId: entry.id,
        effectEntry: entry,
      });
      this.applied &&= applied;
    }
  }

  /** Pose the Avatar from the clip at `time`, as the Gesture creator previews it. */
  private poseAt(time: number): void {
    const vrm = this.avatar.vrm;
    if (!this.clip || !vrm) return;
    const { sample, diagnostics } = sampleAnimaPoseClip(
      this.clip as never,
      time,
      resolvePose,
    );
    diagnostics.missingPoseRefs.forEach((id) => this.missingPoseRefs.add(id));
    applyCanonicalPose(vrm, sample.humanoid ?? {});
    for (const [name, weight] of Object.entries(sample.expressions ?? {})) {
      // Effect-forced and --expression overrides keep precedence.
      if (!this.avatar.hasExpressionOverride(name))
        vrm.expressionManager?.setValue(name, weight);
    }
  }

  /** Advance whole frames until `time` seconds after applying. */
  advanceTo(time: number): void {
    const target = Math.round(time / FRAME_SEC);
    while (this.frame < target) {
      this.frame += 1;
      this.poseAt(this.frame * FRAME_SEC);
      updatePoseCreatorAvatarFrame(this.avatar, FRAME_SEC);
    }
    this.avatar.vrm?.scene.updateMatrixWorld(true);
  }

  diagnostics(id: string): AvatarDiagnostics {
    const snapshot = this.avatar.vfxController?.getSnapshot();
    return {
      id,
      applied: this.applied,
      activeEffectIds: [
        ...(snapshot?.activeEffects ?? []),
        ...(snapshot?.attachmentEffects ?? []),
      ].map((effect) => effect.effectId),
      warnings: snapshot?.warnings ?? ["The Avatar has no effect controller."],
      missingPoseRefs: [...this.missingPoseRefs],
    };
  }
}

type Framing = { position: THREE.Vector3; target: THREE.Vector3; fov: number };

/** Place `camera` for a view: chat Portrait framing, or a face close-up. */
function placeCamera(
  camera: THREE.PerspectiveCamera,
  view: ViewName,
  avatar: Avatar,
  portrait: Framing,
): void {
  camera.fov = portrait.fov;
  if (view === "face") {
    // Follow the current head so a playing Gesture stays framed.
    const face = (avatar.getHeadPosition() ?? portrait.target.clone()).add(
      new THREE.Vector3(0, FACE_AIM_ABOVE_HEAD_BONE, 0),
    );
    camera.position.set(face.x, face.y, face.z + FACE_DISTANCE);
    camera.lookAt(face);
  } else {
    const offset = portrait.position
      .clone()
      .sub(portrait.target)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), VIEWS[view].angle);
    camera.position.copy(portrait.target).add(offset);
    camera.lookAt(portrait.target);
  }
  camera.updateProjectionMatrix();
}

/** The chat's Portrait camera preset for the Avatar at rest. */
function portraitFraming(avatar: Avatar): Framing {
  const { position, orbitTarget, fov } = buildSceneCameraPreset("portrait", {
    avatar,
  }).settings;
  return {
    position: new THREE.Vector3(position.x, position.y, position.z),
    target: new THREE.Vector3(orbitTarget.x, orbitTarget.y, orbitTarget.z),
    fov,
  };
}

async function renderSheet(
  request: SheetRequest,
): Promise<{ dataUrl: string; avatars: AvatarDiagnostics[] }> {
  const { width, height } = request.tile;
  const { renderer, scene, camera } = createStage(width, height);
  const columns = request.avatars.length * request.views.length;
  const sheet = document.createElement("canvas");
  sheet.width = LABEL_PX + columns * width;
  sheet.height = HEADER_PX + request.times.length * height;
  const context = sheet.getContext("2d")!;
  context.fillStyle = PAGE_BACKGROUND;
  context.fillRect(0, 0, sheet.width, sheet.height);
  context.font = "13px sans-serif";
  const label = (text: string, x: number, y: number) => {
    context.fillStyle = "#222";
    context.fillText(text, x, y);
  };
  request.times.forEach((time, row) =>
    label(`${time.toFixed(2)}s`, 8, HEADER_PX + row * height + 18),
  );

  const diagnostics: AvatarDiagnostics[] = [];
  try {
    for (const [avatarIndex, avatarSource] of request.avatars.entries()) {
      const session = await EffectSession.open(
        avatarSource.url,
        camera,
        renderer.domElement,
        request,
      );
      const { avatar } = session;
      try {
        scene.add(avatar.scene!);
        const framing = portraitFraming(avatar);
        await session.apply(request.effects);
        request.views.forEach((view, viewIndex) =>
          label(
            `${avatarSource.id.replace("AvatarSample_", "")} · ${VIEWS[view].label}`,
            LABEL_PX +
              (avatarIndex * request.views.length + viewIndex) * width +
              6,
            18,
          ),
        );
        request.times.forEach((time, row) => {
          session.advanceTo(time);
          request.views.forEach((view, viewIndex) => {
            placeCamera(camera, view, avatar, framing);
            renderer.render(scene, camera);
            const x =
              LABEL_PX +
              (avatarIndex * request.views.length + viewIndex) * width;
            const y = HEADER_PX + row * height;
            context.fillStyle = TILE_BACKDROP;
            context.fillRect(x, y, width, height);
            context.drawImage(renderer.domElement, x, y);
          });
        });
        diagnostics.push(session.diagnostics(avatarSource.id));
      } finally {
        if (avatar.scene) scene.remove(avatar.scene);
        avatar.dispose();
      }
    }
  } finally {
    renderer.dispose();
  }
  return { dataUrl: sheet.toDataURL("image/png"), avatars: diagnostics };
}

/**
 * `effects check`: parse each effect like the runtime, then render every
 * Avatar at each time and view twice, against `baselineEffects` and with the
 * real effects, and count the pixels the effects' art changes. Rendering is deterministic (fixed frames, no
 * automatic animation), so unchanged pixels match exactly.
 */
async function checkEffect(
  request: CheckRequest,
): Promise<{ parseError: string | null; avatars: AvatarCheck[] }> {
  try {
    request.effects.forEach((effect) => effectEntry(effect));
  } catch (error) {
    const field = (error as { field?: unknown }).field;
    const message = error instanceof Error ? error.message : String(error);
    return {
      parseError: typeof field === "string" ? `${field}: ${message}` : message,
      avatars: [],
    };
  }
  const { width, height } = request.tile;
  const { renderer, scene, camera } = createStage(width, height);
  const reader = document.createElement("canvas");
  reader.width = width;
  reader.height = height;
  const context = reader.getContext("2d", { willReadFrequently: true })!;
  // Read frames over the opaque tile backdrop, as contact sheets show them:
  // over a transparent canvas, faint art beside the Avatar would read back
  // at nearly full colour and count as visible.
  const capture = (): Uint8ClampedArray => {
    context.fillStyle = TILE_BACKDROP;
    context.fillRect(0, 0, width, height);
    context.drawImage(renderer.domElement, 0, 0);
    return context.getImageData(0, 0, width, height).data;
  };
  const close = (session: EffectSession) => {
    if (session.avatar.scene) scene.remove(session.avatar.scene);
    session.avatar.dispose();
  };
  /** Frames as `[time][view]` for one Avatar with the given effects applied. */
  const renderFrames = async (
    url: string,
    effects: EffectSource[],
  ): Promise<{ frames: Uint8ClampedArray[][]; session: EffectSession }> => {
    const session = await EffectSession.open(
      url,
      camera,
      renderer.domElement,
      request,
    );
    try {
      const { avatar } = session;
      scene.add(avatar.scene!);
      const framing = portraitFraming(avatar);
      await session.apply(effects);
      const frames = request.times.map((time) => {
        session.advanceTo(time);
        return request.views.map((view) => {
          placeCamera(camera, view, avatar, framing);
          renderer.render(scene, camera);
          return capture();
        });
      });
      return { frames, session };
    } catch (error) {
      close(session);
      throw error;
    }
  };
  const avatars: AvatarCheck[] = [];
  try {
    for (const source of request.avatars) {
      const baseline = await renderFrames(source.url, request.baselineEffects);
      close(baseline.session);
      const applied = await renderFrames(source.url, request.effects);
      try {
        const differingPixels = applied.frames.map((views, time) =>
          views.map((pixels, view) => {
            const before = baseline.frames[time]![view]!;
            let count = 0;
            for (let offset = 0; offset < pixels.length; offset += 4) {
              for (let channel = 0; channel < 4; channel += 1)
                if (
                  Math.abs(
                    pixels[offset + channel]! - before[offset + channel]!,
                  ) > request.threshold
                ) {
                  count += 1;
                  break;
                }
            }
            return count;
          }),
        );
        avatars.push({
          ...applied.session.diagnostics(source.id),
          differingPixels,
        });
      } finally {
        close(applied.session);
      }
    }
  } finally {
    renderer.dispose();
  }
  return { parseError: null, avatars };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Library thumbnail: the portrait capture's head framing, live expression. */
async function renderThumbnail(
  request: ThumbnailRequest,
): Promise<{ dataUrl: string; avatars: AvatarDiagnostics[] }> {
  const { renderer, scene, camera } = createStage(request.size, request.size);
  let session: EffectSession | null = null;
  try {
    session = await EffectSession.open(
      request.avatar.url,
      camera,
      renderer.domElement,
      request,
    );
    const { avatar } = session;
    scene.add(avatar.scene!);
    const framing = portraitFraming(avatar);
    await session.apply(request.effects);
    session.advanceTo(request.time);
    // The capture keeps only the view direction of this front camera.
    placeCamera(camera, "front", avatar, framing);
    const blob = await captureAvatarPortrait({
      avatar,
      renderer,
      camera,
      scene,
      size: request.size,
      expression: "live",
    });
    return {
      dataUrl: await blobToDataUrl(blob),
      avatars: [session.diagnostics(request.avatar.id)],
    };
  } finally {
    const avatar = session?.avatar;
    if (avatar?.scene) scene.remove(avatar.scene);
    avatar?.dispose();
    renderer.dispose();
  }
}

declare global {
  interface Window {
    renderEffectSheet: typeof renderSheet;
    renderEffectThumbnail: typeof renderThumbnail;
    checkEffect: typeof checkEffect;
    effectRendererReady: boolean;
  }
}

window.renderEffectSheet = renderSheet;
window.renderEffectThumbnail = renderThumbnail;
window.checkEffect = checkEffect;
window.effectRendererReady = true;
