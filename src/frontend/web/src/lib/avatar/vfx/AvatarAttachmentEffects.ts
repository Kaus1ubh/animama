import type { VRMHumanBoneName } from "@pixiv/three-vrm";
import * as THREE from "three";

import type { Avatar } from "../Avatar";
import { resolveHumanoidAnchorObject } from "../humanoidAnchors";
import { avatarScale, CanonicalSkeleton } from "../poses/anatomy/arms";
import {
  deriveAvatarVFXAnimationPreset,
  evaluateAvatarVFXAnimation,
  resolveAvatarVFXAnimationConfig,
  type AvatarVFXAnimationState,
} from "./animation";
import {
  applyFlipbookFrameToTexture,
  configureEffectBlend,
  createTextureFromImage,
  disposeObjectTree,
  isAnimatedEffect,
  resolveArtFrameSize,
  resolveFlipbookFrameUv,
} from "./effectArt";
import {
  createSilhouetteOverlay,
  isSilhouetteSource,
  type SilhouetteMaterialSource,
  type SilhouetteOverlay,
} from "./silhouetteOverlay";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";
import {
  planeImageCorners,
  quadManipulationPlacement,
} from "./manipulationPlacement";
import type { AvatarVFXManipulationFrame } from "./placement-guide-types";
import type {
  AvatarBodyVFXEntry,
  AvatarSilhouetteVFXEntry,
  AvatarStickerVFXEntry,
  AvatarVFXAnimationPreset,
  AvatarVFXAttachmentEffectSnapshot,
  AvatarVFXAttachmentEntry,
  AvatarVFXAttachmentRenderMode,
  AvatarVFXEffectTransform,
  AvatarVFXResolvedAnimationConfig,
} from "./types";

/*
 * Body, sticker and silhouette Avatar Effects. They need no face part, follow
 * the avatar through Gestures, Reactions and idle motion, and coexist with face
 * effects and with each other up to MAX_ACTIVE_ATTACHMENT_EFFECTS.
 *
 * - Body planes are parented to a normalized humanoid bone and face the camera
 *   (or keep the bone's orientation with `facing: "bone"`).
 * - Stickers are camera-facing quads beside the head or body centre, sized and
 *   offset in fractions of the avatar's height; they ignore depth so the
 *   avatar never hides them.
 * - Silhouette overlays are described in `silhouetteOverlay.ts`.
 *
 * Camera-facing planes are oriented in `onBeforeRender`, so every camera that
 * draws the avatar (chat, creator previews, thumbnails) sees them face-on.
 */

/** Body, sticker and silhouette effects active at once; the oldest goes first. */
export const MAX_ACTIVE_ATTACHMENT_EFFECTS = 4;
/** Body planes share the face hover planes' layer. */
export const BODY_RENDER_ORDER = 950;
/** Stickers draw last, without depth, so they stay readable over the avatar. */
export const STICKER_RENDER_ORDER = 960;
/** Used when the avatar has no measurable geometry. */
const FALLBACK_AVATAR_HEIGHT = 1.6;

type PlaneState = {
  /** Removed and disposed with the effect. */
  root: THREE.Object3D;
  /** The point the plane is centred on; billboards read its world position. */
  anchor: THREE.Object3D;
  animatedGroup: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  texture: THREE.Texture;
  /** Plane size in its own units (metres for body, avatar heights for stickers). */
  width: number;
  height: number;
  /**
   * The mesh's world matrix for one camera: billboards are oriented to the
   * camera that draws them, so `matrixWorld` alone is not current between
   * renders. `still` leaves out the effect's own motion. Writes into and
   * returns `target`.
   */
  worldMatrix: (
    camera: THREE.Camera,
    target: THREE.Matrix4,
    still?: boolean,
  ) => THREE.Matrix4;
  /** Sticker offset in avatar heights, read when the sticker is drawn. */
  stickerOffset: { x: number; y: number };
};

type ActiveAttachment = {
  appliedEffectId: string;
  effectId: string;
  entry: AvatarVFXAttachmentEntry;
  renderMode: AvatarVFXAttachmentRenderMode;
  target: string;
  appliedOrder: number;
  animationConfig: AvatarVFXResolvedAnimationConfig;
  animationPreset: AvatarVFXAnimationPreset | null;
  animationState: AvatarVFXAnimationState;
  /** Presets, keyframes, flipbook frames or silhouette scroll. */
  hasOwnMotion: boolean;
  elapsedSec: number;
  /** Event envelope (0–1) multiplying opacity. */
  intensity: number;
  plane: PlaneState | null;
  silhouette: SilhouetteOverlay | null;
};

/** What `apply` built, or why nothing was built. */
export type AttachmentApplyResult =
  | { ok: true; evicted: AvatarVFXAttachmentEffectSnapshot[] }
  | { ok: false; warning: string };

const scratchPosition = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchMatrix = new THREE.Matrix4();
const scratchRight = new THREE.Vector3();
const scratchUp = new THREE.Vector3();
const scratchHead = new THREE.Vector3();

/**
 * The avatar's standing height in its scene's units, from the meshes' bind
 * pose bounds. Measured once at load; stickers and silhouette tiles scale by
 * it so they keep a readable size on any model.
 */
export function measureAvatarHeight(scene: THREE.Object3D | null): number {
  if (!scene) return FALLBACK_AVATAR_HEIGHT;
  scene.updateMatrixWorld(true);
  const toScene = scene.matrixWorld.clone().invert();
  const bounds = new THREE.Box3();
  const box = new THREE.Box3();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const geometryBounds = mesh.geometry.boundingBox;
    if (!geometryBounds || geometryBounds.isEmpty()) return;
    box
      .copy(geometryBounds)
      .applyMatrix4(scratchMatrix.multiplyMatrices(toScene, mesh.matrixWorld));
    bounds.union(box);
  });
  const height = bounds.isEmpty() ? 0 : bounds.max.y - bounds.min.y;
  return Number.isFinite(height) && height > 0.1
    ? height
    : FALLBACK_AVATAR_HEIGHT;
}

/**
 * Sizes (`avatarScale`: rest head-bone height above the feet over 1.25 m, the
 * measure contacts scale by) within which body effects keep their authored
 * metres: the Included Avatars' (Annie 1.012, Andrew 1.094), widened by 10%
 * each way. A smaller or larger model scales them by its size over the nearer
 * edge, so they grow continuously past the band (R9). Head height rather than
 * bounding height, so hair, ears and hats do not count.
 */
export const BODY_EFFECT_SCALE_BAND = { min: 0.91, max: 1.2 } as const;

/** The scale body effects take on a model whose `avatarScale` is `size`. */
export function bodyEffectScale(size: number): number {
  if (size < BODY_EFFECT_SCALE_BAND.min)
    return size / BODY_EFFECT_SCALE_BAND.min;
  if (size > BODY_EFFECT_SCALE_BAND.max)
    return size / BODY_EFFECT_SCALE_BAND.max;
  return 1;
}

/**
 * `bodyEffectScale` for a loaded Avatar; 1 without hips, head or feet, or
 * with no positive head height.
 */
function avatarBodyEffectScale(avatar: Avatar): number {
  const vrm = avatar.vrm;
  const has = (bone: VRMHumanBoneName) =>
    Boolean(vrm?.humanoid.getNormalizedBoneNode(bone));
  if (!vrm || !has("hips") || !has("head") || !has("leftFoot")) return 1;
  const size = avatarScale(new CanonicalSkeleton(vrm));
  // A malformed rig (head at or below the feet) keeps the authored size.
  return Number.isFinite(size) && size > 0 ? bodyEffectScale(size) : 1;
}

/**
 * Yaw from a normalized bone's frame to the avatar's front frame. Normalized
 * bones keep the model's axes: VRM 1 faces +Z, VRM 0 faces −Z.
 */
function frontYaw(avatar: Pick<Avatar, "vrm">): number {
  return avatar.vrm?.meta?.metaVersion === "0" ? Math.PI : 0;
}

/**
 * A camera-facing world matrix for `plane.mesh`: centred on `position`,
 * scaled by `scale`, then the animated (unless `still`) and static transforms.
 */
function billboard(
  plane: Pick<PlaneState, "animatedGroup" | "mesh">,
  camera: THREE.Camera,
  position: THREE.Vector3,
  scale: number,
  target: THREE.Matrix4,
  still = false,
): THREE.Matrix4 {
  camera.getWorldQuaternion(scratchQuaternion);
  scratchScale.setScalar(scale);
  plane.mesh.updateMatrix();
  target.compose(position, scratchQuaternion, scratchScale);
  if (!still) target.multiply(plane.animatedGroup.matrix);
  return target.multiply(plane.mesh.matrix);
}

const scratchCornerMatrix = new THREE.Matrix4();

function createPlane(args: {
  entry: AvatarBodyVFXEntry | AvatarStickerVFXEntry;
  art: CanvasImageSource;
  height: number;
  renderOrder: number;
  depthTest: boolean;
}): Omit<
  PlaneState,
  "root" | "anchor" | "worldMatrix" | "stickerOffset"
> | null {
  const { entry } = args;
  const frame = resolveArtFrameSize(args.art, entry.flipbook);
  if (!frame) return null;
  const height = args.height;
  const width = height * (frame.width / Math.max(1, frame.height));
  const texture = createTextureFromImage(args.art);
  applyFlipbookFrameToTexture(texture, entry.flipbook, 0);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: args.depthTest,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    opacity: entry.appearance.opacity,
  });
  material.forceSinglePass = true;
  if (entry.appearance.tint) material.color.set(entry.appearance.tint);
  configureEffectBlend(material, entry.appearance.blend);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.name = `AvatarAttachmentVFX:${entry.id}`;
  mesh.rotation.z = entry.rotation;
  mesh.renderOrder = args.renderOrder;
  mesh.frustumCulled = false;
  const animatedGroup = new THREE.Group();
  animatedGroup.add(mesh);
  return { animatedGroup, mesh, material, texture, width, height };
}

/** Move, turn, scale and fade a plane for one animation state. */
function applyPlaneAnimation(
  plane: PlaneState,
  entry: AvatarBodyVFXEntry | AvatarStickerVFXEntry,
  state: AvatarVFXAnimationState,
  intensity: number,
): void {
  plane.animatedGroup.position.set(
    state.driftX * plane.width + state.offsetX,
    state.driftY * plane.height + state.offsetY,
    0,
  );
  plane.animatedGroup.rotation.z = state.rotationRadians;
  plane.animatedGroup.scale.setScalar(Math.max(0.0001, state.scale));
  plane.animatedGroup.updateMatrix();
  plane.material.opacity = clampUnit(
    entry.appearance.opacity * state.opacity * intensity,
  );
  applyFlipbookFrameToTexture(plane.texture, entry.flipbook, state.frame);
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

function renderModeFor(
  entry: AvatarVFXAttachmentEntry,
): AvatarVFXAttachmentRenderMode {
  if (entry.kind === "body") return "body_plane";
  if (entry.kind === "sticker") return "sticker_plane";
  return "silhouette_overlay";
}

/**
 * Owns the active body, sticker and silhouette effects of one Avatar. The
 * controller loads art, guards applies with its tokens and reports
 * diagnostics; this class builds, animates and disposes the scene objects.
 */
export class AvatarAttachmentEffects {
  private readonly _avatar: Avatar;
  private readonly _active = new Map<string, ActiveAttachment>();
  private readonly _avatarHeight: number;
  private readonly _bodyScale: number;
  private readonly _materialOf: SilhouetteMaterialSource | undefined;
  private _nextOrder = 0;

  /**
   * `materialOf` returns a primitive's own material even while a face effect
   * has swapped in a composite clone, so overlays never hold textures that
   * the face effect owns.
   */
  constructor(
    avatar: Avatar,
    options: { materialOf?: SilhouetteMaterialSource } = {},
  ) {
    this._avatar = avatar;
    this._avatarHeight = measureAvatarHeight(avatar.scene);
    this._bodyScale = avatarBodyEffectScale(avatar);
    this._materialOf = options.materialOf;
  }

  /** The height stickers and silhouette tiles scale by, in scene units. */
  get avatarHeight(): number {
    return this._avatarHeight;
  }

  has(appliedEffectId: string): boolean {
    return this._active.has(appliedEffectId);
  }

  get size(): number {
    return this._active.size;
  }

  /**
   * Build and show one effect with its decoded art. A previous instance of
   * the same applied ID is replaced; beyond the cap the oldest others are
   * removed and returned so the caller can report them.
   */
  apply(args: {
    appliedEffectId: string;
    effectId: string;
    entry: AvatarVFXAttachmentEntry;
    art: CanvasImageSource;
    intensity: number;
  }): AttachmentApplyResult {
    const { entry } = args;
    const animationConfig = resolveAvatarVFXAnimationConfig(
      entry.animationConfig,
    );
    const animationState = evaluateAvatarVFXAnimation({
      elapsedSec: 0,
      config: animationConfig,
      keyframes: entry.keyframes,
      flipbook: entry.flipbook,
    });
    const built = this._build(entry, args.art);
    if ("warning" in built) return { ok: false, warning: built.warning };

    this.remove(args.appliedEffectId);
    const active: ActiveAttachment = {
      appliedEffectId: args.appliedEffectId,
      effectId: args.effectId,
      entry,
      renderMode: renderModeFor(entry),
      target: built.target,
      appliedOrder: ++this._nextOrder,
      animationConfig,
      animationPreset: deriveAvatarVFXAnimationPreset(entry.animationConfig),
      animationState,
      hasOwnMotion:
        isAnimatedEffect(entry, animationConfig) ||
        (entry.kind === "silhouette" &&
          (entry.scroll.x !== 0 || entry.scroll.y !== 0)),
      elapsedSec: 0,
      intensity: args.intensity,
      plane: built.plane,
      silhouette: built.silhouette,
    };
    this._active.set(args.appliedEffectId, active);
    this._applyState(active);

    const evicted: AvatarVFXAttachmentEffectSnapshot[] = [];
    while (this._active.size > MAX_ACTIVE_ATTACHMENT_EFFECTS) {
      const oldest = Array.from(this._active.values()).reduce((a, b) =>
        a.appliedOrder <= b.appliedOrder ? a : b,
      );
      evicted.push(this._snapshotOf(oldest));
      this.remove(oldest.appliedEffectId);
    }
    return { ok: true, evicted };
  }

  /** Remove one effect and dispose everything it owns. */
  remove(appliedEffectId: string): boolean {
    const active = this._active.get(appliedEffectId);
    if (!active) return false;
    this._active.delete(appliedEffectId);
    if (active.plane) {
      active.plane.root.removeFromParent();
      disposeObjectTree(active.plane.root);
    }
    active.silhouette?.dispose();
    return true;
  }

  clear(): void {
    for (const appliedEffectId of Array.from(this._active.keys())) {
      this.remove(appliedEffectId);
    }
  }

  /** Set an event envelope value; false when the effect is not active. */
  setIntensity(appliedEffectId: string, intensity: number): boolean {
    const active = this._active.get(appliedEffectId);
    if (!active) return false;
    if (active.intensity !== intensity) {
      active.intensity = intensity;
      this._applyState(active);
    }
    return true;
  }

  /**
   * Move, resize or turn a body or sticker effect in place, keeping its art,
   * material and motion clock. False when the effect is not active or the
   * transform is for another attachment.
   */
  updateTransform(
    appliedEffectId: string,
    transform: AvatarVFXEffectTransform,
  ): boolean {
    const active = this._active.get(appliedEffectId);
    const plane = active?.plane;
    if (!active || !plane) return false;
    const entry = active.entry;
    if (transform.kind === "body" && entry.kind === "body") {
      active.entry = {
        ...entry,
        offset: { ...transform.offset },
        size: transform.size,
        rotation: transform.rotation,
      };
      plane.anchor.position.set(
        transform.offset.x,
        transform.offset.y,
        transform.offset.z,
      );
    } else if (transform.kind === "sticker" && entry.kind === "sticker") {
      active.entry = {
        ...entry,
        offset: { ...transform.offset },
        size: transform.size,
        rotation: transform.rotation,
      };
      plane.stickerOffset.x = transform.offset.x;
      plane.stickerOffset.y = transform.offset.y;
    } else {
      return false;
    }
    plane.mesh.rotation.z = transform.rotation;
    const height = Math.max(0.0001, transform.size);
    if (height !== plane.height) {
      const width = height * (plane.width / Math.max(0.0001, plane.height));
      plane.mesh.geometry.dispose();
      plane.mesh.geometry = new THREE.PlaneGeometry(width, height);
      plane.width = width;
      plane.height = height;
    }
    plane.mesh.updateMatrix();
    this._applyState(active);
    return true;
  }

  /**
   * The drawn corners of a body or sticker effect for `camera`, with the
   * frame its offset is measured in. Null for silhouettes and inactive IDs.
   */
  manipulationFrame(
    appliedEffectId: string,
    camera: THREE.Camera,
  ): AvatarVFXManipulationFrame | null {
    const active = this._active.get(appliedEffectId);
    const plane = active?.plane;
    if (!active || !plane || active.entry.kind === "silhouette") return null;
    // The authored placement, without the effect's own motion.
    const matrix = plane.worldMatrix(camera, scratchCornerMatrix, true);
    const placement = quadManipulationPlacement({
      label: active.entry.kind,
      mirrored: false,
      corners: planeImageCorners(plane.mesh.geometry, matrix),
      // A positive in-plane turn moves +x toward +y (up), away from the image's y.
      rotationSense: -1,
    });
    if (active.entry.kind === "body") {
      plane.root.updateWorldMatrix(true, false);
      return {
        attachment: "body",
        placements: [placement],
        offsetSpace: plane.root.matrixWorld.clone(),
        surface: null,
        unitLength: null,
      };
    }
    const scene = this._avatar.scene;
    scratchScale.setFromMatrixScale(
      scene?.matrixWorld ?? scratchCornerMatrix.identity(),
    );
    return {
      attachment: "sticker",
      placements: [placement],
      offsetSpace: null,
      surface: null,
      unitLength: this._avatarHeight * scratchScale.y,
    };
  }

  /**
   * Advance own motion. `advanceFrame` is the controller's 30 FPS tick, so
   * flipbook frames and motion change at the same rate as face effects.
   */
  update(delta: number, advanceFrame: boolean): void {
    for (const active of this._active.values()) {
      if (!active.hasOwnMotion) continue;
      active.elapsedSec += delta;
      if (!advanceFrame) continue;
      active.animationState = evaluateAvatarVFXAnimation({
        elapsedSec: active.elapsedSec,
        config: active.animationConfig,
        keyframes: active.entry.keyframes,
        flipbook: active.entry.flipbook,
      });
      this._applyState(active);
    }
  }

  /** Active effects, oldest first. */
  snapshot(): AvatarVFXAttachmentEffectSnapshot[] {
    return Array.from(this._active.values())
      .sort((left, right) => left.appliedOrder - right.appliedOrder)
      .map((active) => this._snapshotOf(active));
  }

  private _snapshotOf(
    active: ActiveAttachment,
  ): AvatarVFXAttachmentEffectSnapshot {
    return {
      appliedEffectId: active.appliedEffectId,
      effectId: active.effectId,
      effectLabel: active.entry.label,
      attachmentKind: active.entry.kind,
      renderMode: active.renderMode,
      animationPreset: active.animationPreset,
      target: active.target,
    };
  }

  private _applyState(active: ActiveAttachment): void {
    const { entry, animationState: state } = active;
    if (active.plane && entry.kind !== "silhouette") {
      applyPlaneAnimation(active.plane, entry, state, active.intensity);
    }
    if (active.silhouette && entry.kind === "silhouette") {
      active.silhouette.setPatternState({
        offsetX:
          entry.scroll.x * active.elapsedSec + state.driftX + state.offsetX,
        offsetY:
          entry.scroll.y * active.elapsedSec + state.driftY + state.offsetY,
        rotation: state.rotationRadians,
        scale: state.scale,
        opacity: clampUnit(
          entry.appearance.opacity * state.opacity * active.intensity,
        ),
        frame: resolveFlipbookFrameUv(entry.flipbook, state.frame),
      });
    }
  }

  private _build(
    entry: AvatarVFXAttachmentEntry,
    art: CanvasImageSource,
  ):
    | {
        target: string;
        plane: PlaneState | null;
        silhouette: SilhouetteOverlay | null;
      }
    | { warning: string } {
    const scene = this._avatar.scene;
    if (!scene) return { warning: "The avatar is not loaded." };
    if (entry.kind === "body") return this._buildBody(entry, art);
    if (entry.kind === "sticker") return this._buildSticker(entry, art);
    return this._buildSilhouette(entry, art);
  }

  private _buildBody(entry: AvatarBodyVFXEntry, art: CanvasImageSource) {
    const resolved = resolveHumanoidAnchorObject(this._avatar, entry.bone);
    if (!resolved) return { warning: "The avatar is not loaded." };
    const plane = createPlane({
      entry,
      art,
      height: entry.size,
      renderOrder: BODY_RENDER_ORDER,
      depthTest: true,
    });
    if (!plane)
      return { warning: `Effect "${entry.label}" has no readable image size.` };
    // Bone frame turned to face the avatar's front on both VRM versions.
    const root = new THREE.Group();
    root.name = `AvatarBodyVFX:${entry.id}`;
    root.rotation.y = frontYaw(this._avatar);
    // Size and offset alike, outside the Included Avatars' size band.
    root.scale.setScalar(this._bodyScale);
    const anchor = new THREE.Group();
    anchor.position.set(entry.offset.x, entry.offset.y, entry.offset.z);
    root.add(anchor);
    anchor.add(plane.animatedGroup);
    const facesCamera = entry.facing === "camera";
    const state: PlaneState = {
      ...plane,
      root,
      anchor,
      stickerOffset: { x: 0, y: 0 },
      worldMatrix: (camera, target, still = false) => {
        anchor.updateWorldMatrix(true, false);
        if (!facesCamera) {
          plane.mesh.updateMatrix();
          target.copy(anchor.matrixWorld);
          if (!still) target.multiply(plane.animatedGroup.matrix);
          return target.multiply(plane.mesh.matrix);
        }
        scratchPosition.setFromMatrixPosition(anchor.matrixWorld);
        scratchScale.setFromMatrixScale(anchor.matrixWorld);
        return billboard(
          plane,
          camera,
          scratchPosition,
          scratchScale.y,
          target,
          still,
        );
      },
    };
    if (facesCamera) {
      // World matrices are current here: the renderer updated the scene.
      plane.mesh.onBeforeRender = (_renderer, _scene, camera) => {
        scratchPosition.setFromMatrixPosition(anchor.matrixWorld);
        scratchScale.setFromMatrixScale(anchor.matrixWorld);
        billboard(
          plane,
          camera,
          scratchPosition,
          scratchScale.y,
          plane.mesh.matrixWorld,
        );
      };
    }
    resolved.object.add(root);
    return {
      target: resolved.boneName
        ? resolved.fellBack
          ? `${entry.bone}→${resolved.boneName}`
          : resolved.boneName
        : "root",
      plane: state,
      silhouette: null,
    };
  }

  /** World position of a sticker's root: the head, or between hips and head. */
  private _stickerRoot(
    around: AvatarStickerVFXEntry["around"],
    target: THREE.Vector3,
  ): THREE.Vector3 {
    const head = resolveHumanoidAnchorObject(this._avatar, "head");
    if (head) target.setFromMatrixPosition(head.object.matrixWorld);
    if (around === "body") {
      const hips = resolveHumanoidAnchorObject(this._avatar, "hips");
      if (hips) {
        scratchHead.setFromMatrixPosition(hips.object.matrixWorld);
        target.add(scratchHead).multiplyScalar(0.5);
      }
    }
    return target;
  }

  private _buildSticker(entry: AvatarStickerVFXEntry, art: CanvasImageSource) {
    const scene = this._avatar.scene!;
    // Geometry and keyframe offsets are in avatar heights; the billboard
    // scales them to world units.
    const plane = createPlane({
      entry,
      art,
      height: entry.size,
      renderOrder: STICKER_RENDER_ORDER,
      depthTest: false,
    });
    if (!plane)
      return { warning: `Effect "${entry.label}" has no readable image size.` };
    const root = new THREE.Group();
    root.name = `AvatarStickerVFX:${entry.id}`;
    root.add(plane.animatedGroup);
    const stickerOffset = { ...entry.offset };
    const worldMatrix = (
      camera: THREE.Camera,
      target: THREE.Matrix4,
      still = false,
    ) => {
      scratchScale.setFromMatrixScale(scene.matrixWorld);
      const height = this._avatarHeight * scratchScale.y;
      camera.getWorldQuaternion(scratchQuaternion);
      scratchRight.set(1, 0, 0).applyQuaternion(scratchQuaternion);
      scratchUp.set(0, 1, 0).applyQuaternion(scratchQuaternion);
      this._stickerRoot(entry.around, scratchPosition)
        .addScaledVector(scratchRight, stickerOffset.x * height)
        .addScaledVector(scratchUp, stickerOffset.y * height);
      return billboard(plane, camera, scratchPosition, height, target, still);
    };
    const state: PlaneState = {
      ...plane,
      root,
      anchor: root,
      stickerOffset,
      worldMatrix,
    };
    plane.mesh.onBeforeRender = (_renderer, _scene, camera) => {
      worldMatrix(camera, plane.mesh.matrixWorld);
    };
    scene.add(root);
    return { target: entry.around, plane: state, silhouette: null };
  }

  private _buildSilhouette(
    entry: AvatarSilhouetteVFXEntry,
    art: CanvasImageSource,
  ) {
    const scene = this._avatar.scene!;
    const sources = buildRuntimePrimitiveBindings(this._avatar)
      .entries.map((binding) => binding.object)
      .filter(
        (object): object is THREE.Mesh =>
          object instanceof THREE.Mesh &&
          isSilhouetteSource(object, this._materialOf),
      );
    if (!sources.length)
      return {
        warning: `Effect "${entry.label}" found no avatar surfaces to overlay.`,
      };
    const hips = resolveHumanoidAnchorObject(this._avatar, "hips");
    const anchor = new THREE.Vector3();
    const silhouette = createSilhouetteOverlay({
      sources,
      materialOf: this._materialOf,
      art,
      entry,
      frame: () => {
        anchor.setFromMatrixPosition((hips?.object ?? scene).matrixWorld);
        scratchScale.setFromMatrixScale(scene.matrixWorld);
        return { anchor, height: this._avatarHeight * scratchScale.y };
      },
    });
    return {
      target: `${silhouette.meshes.length} primitives`,
      plane: null,
      silhouette,
    };
  }
}
