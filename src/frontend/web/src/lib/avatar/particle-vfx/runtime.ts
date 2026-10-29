import type { VRMHumanBoneName } from "@pixiv/three-vrm";
import * as THREE from "three";

import type { Avatar } from "../Avatar";
import {
  bodyHeightFromReference,
  headSized,
  REFERENCE_AVATAR_BODY,
  SPINE_BONES,
  type AvatarProportions,
  type SpineBone,
} from "../avatarProportions";
import {
  HUMANOID_ANCHOR_BONE_CANDIDATES,
  resolveHumanoidAnchorObject,
} from "../humanoidAnchors";
import { isVrm0 } from "../poses/poseRetargeting";
import {
  PARTICLE_VFX_ANCHORS,
  type ParticleVFXAnchor,
  type ParticleVFXResolvedAnchor,
  type ParticleVFXTransform,
  type ParticleVFXTransformAxisTriple,
  type ParticleVFXTransformInput,
} from "./types";

/** The identity transform: no offset or rotation, unit scale. */
export function createDefaultParticleVFXTransform(): ParticleVFXTransform {
  return {
    offset: { x: 0, y: 0, z: 0 },
    depthOffset: 0,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

export function isParticleVFXAnchor(
  value: unknown,
): value is ParticleVFXAnchor {
  return (
    typeof value === "string" &&
    (PARTICLE_VFX_ANCHORS as readonly string[]).includes(value)
  );
}

export function cloneParticleVFXTransform(
  transform: ParticleVFXTransform,
): ParticleVFXTransform {
  return {
    offset: { ...transform.offset },
    depthOffset: transform.depthOffset,
    rotation: { ...transform.rotation },
    scale: { ...transform.scale },
  };
}

export function normalizeParticleVFXTransform(
  value: ParticleVFXTransformInput | null | undefined,
): ParticleVFXTransform {
  return mergeParticleVFXTransform(createDefaultParticleVFXTransform(), value);
}

export function mergeParticleVFXTransform(
  base: ParticleVFXTransform,
  override: ParticleVFXTransformInput | null | undefined,
): ParticleVFXTransform {
  const next = cloneParticleVFXTransform(base);
  if (!override) return next;

  next.offset = mergeAxisTriple(next.offset, override.offset);
  next.rotation = mergeAxisTriple(next.rotation, override.rotation);
  next.scale = mergeAxisTriple(next.scale, override.scale);
  if (
    typeof override.depthOffset === "number" &&
    Number.isFinite(override.depthOffset)
  ) {
    next.depthOffset = override.depthOffset;
  }
  return next;
}

/**
 * The scale a Particle Effect anchored at `anchor` is sized at on an Avatar
 * of `proportions`: its body size against the Included Avatars'
 * (`bodyEffectScale`); on a big-headed Avatar the head's own size at the
 * head, so stars circling the head or a cloud above it stay outside it, and
 * the arm's or leg's measured length at a hand or foot. Exactly 1 on the
 * Included Avatars.
 */
export function particleVFXPlacementScale(
  proportions: AvatarProportions,
  anchor: ParticleVFXAnchor,
): number {
  const { body, bodyScale } = proportions;
  switch (anchor) {
    case "head":
      return headSized(proportions, bodyScale, proportions.headScale);
    case "leftHand":
    case "rightHand":
      return headSized(
        proportions,
        bodyScale,
        body?.armLength
          ? body.armLength / REFERENCE_AVATAR_BODY.armLength
          : bodyScale,
      );
    case "leftFoot":
    case "rightFoot":
      return headSized(
        proportions,
        bodyScale,
        body?.legLength
          ? body.legLength / REFERENCE_AVATAR_BODY.legLength
          : bodyScale,
      );
    default:
      return bodyScale;
  }
}

/**
 * A transform as placed on an Avatar `scale` times the Included Avatars' size
 * ({@link particleVFXPlacementScale}): offsets and scale multiplied, rotation
 * kept. Particle Effects are authored on the Included Avatars, so a small,
 * large or big-headed Avatar gets them in proportion.
 */
export function scaleParticleVFXTransform(
  transform: ParticleVFXTransform,
  scale: number,
): ParticleVFXTransform {
  const next = cloneParticleVFXTransform(transform);
  if (scale === 1) return next;
  for (const axis of ["x", "y", "z"] as const) {
    next.offset[axis] *= scale;
    next.scale[axis] *= scale;
  }
  next.depthOffset *= scale;
  return next;
}

/**
 * Where `anchor` stands on the Included Avatars and on an Avatar of
 * `proportions`, as heights from the head bone (m): the first of its bones
 * the rig has ({@link HUMANOID_ANCHOR_BONE_CANDIDATES}), as the anchor
 * resolves to, at the Included Avatars' landmark for that bone and this
 * rig's rest height of it; `root` stands on the ground. Null for hands and
 * feet, and without measured landmarks.
 */
function particleVFXAnchorHeights(
  proportions: AvatarProportions,
  anchor: ParticleVFXAnchor,
): { reference: number; measured: number } | null {
  const body = proportions.body;
  if (!body) return null;
  if (anchor === "root") {
    return body.heights.ground === undefined
      ? null
      : {
          reference: REFERENCE_AVATAR_BODY.heights.ground,
          measured: body.heights.ground,
        };
  }
  const bones: readonly VRMHumanBoneName[] =
    HUMANOID_ANCHOR_BONE_CANDIDATES[anchor];
  for (const bone of bones) {
    if (bone === "head") return { reference: 0, measured: 0 };
    if (!isSpineBone(bone)) return null;
    const measured = body.spineBones[bone];
    if (measured !== undefined)
      return { reference: REFERENCE_AVATAR_BODY.heights[bone], measured };
  }
  return null;
}

function isSpineBone(bone: VRMHumanBoneName): bone is SpineBone {
  return (SPINE_BONES as readonly string[]).includes(bone);
}

/**
 * The sideways and depth scale at `height` from the Included Avatars' head
 * bone on an Avatar of `proportions`: the torso's measured width over theirs
 * at and below the shoulders, the head's size at and above the head bone,
 * blending between, so points beside the body stay beside it and points
 * beside a big head stay outside it.
 */
function particleVFXSidewaysScale(
  proportions: AvatarProportions,
  height: number,
): number {
  const torsoWidth = proportions.body?.torsoWidth;
  const torso = torsoWidth
    ? torsoWidth / REFERENCE_AVATAR_BODY.torsoWidth
    : proportions.bodyScale;
  const shoulders = REFERENCE_AVATAR_BODY.heights.shoulders;
  if (height <= shoulders) return torso;
  if (height >= 0) return proportions.headScale;
  return THREE.MathUtils.lerp(
    torso,
    proportions.headScale,
    (height - shoulders) / -shoulders,
  );
}

/**
 * Whether Particle Effects anchored at `anchor` are placed through the body's
 * landmarks on an Avatar of `proportions` ({@link placeParticleVFXOffset}):
 * a big head with measured landmarks, at the root, torso or head. Never on
 * the Included Avatars.
 */
export function placesParticleVFXOnBody(
  proportions: AvatarProportions,
  anchor: ParticleVFXAnchor,
): boolean {
  return (
    proportions.bigHead > 0 &&
    particleVFXAnchorHeights(proportions, anchor) !== null
  );
}

/**
 * The offset from `anchor`, in the Avatar frame, that a point authored
 * `offset` from it on the Included Avatars lands at on an Avatar of
 * `proportions`. It is the offset times {@link particleVFXPlacementScale},
 * except where {@link placesParticleVFXOnBody}: there the point keeps its
 * place among the body's landmarks. Its height between two of the Included
 * Avatars' landmarks (`bodyHeightFromReference`) lands the same share of the
 * way between this body's, so a note authored beside the Included Avatars'
 * chest rises beside a chibi's chest, not at its knees; sideways and depth
 * offsets follow {@link particleVFXSidewaysScale}. Blended with the scaled
 * offset by the big-head weight.
 */
export function placeParticleVFXOffset(
  proportions: AvatarProportions,
  anchor: ParticleVFXAnchor,
  offset: ParticleVFXTransformAxisTriple,
): ParticleVFXTransformAxisTriple {
  const scale = particleVFXPlacementScale(proportions, anchor);
  const scaled = {
    x: offset.x * scale,
    y: offset.y * scale,
    z: offset.z * scale,
  };
  const anchorHeights =
    proportions.bigHead > 0
      ? particleVFXAnchorHeights(proportions, anchor)
      : null;
  if (!anchorHeights) return scaled;
  const height = anchorHeights.reference + offset.y;
  const sideways = particleVFXSidewaysScale(proportions, height);
  return {
    x: headSized(proportions, scaled.x, offset.x * sideways),
    y: headSized(
      proportions,
      scaled.y,
      bodyHeightFromReference(proportions, height) - anchorHeights.measured,
    ),
    z: headSized(proportions, scaled.z, offset.z * sideways),
  };
}

/**
 * A transform as placed on an Avatar of `proportions` at `anchor`: scaled by
 * {@link particleVFXPlacementScale}, its offset (with the depth offset folded
 * in) placed by {@link placeParticleVFXOffset} where the body's landmarks
 * place it. Exactly the authored transform on the Included Avatars.
 */
export function placeParticleVFXTransform(
  transform: ParticleVFXTransform,
  proportions: AvatarProportions,
  anchor: ParticleVFXAnchor,
): ParticleVFXTransform {
  const next = scaleParticleVFXTransform(
    transform,
    particleVFXPlacementScale(proportions, anchor),
  );
  if (!placesParticleVFXOnBody(proportions, anchor)) return next;
  next.offset = placeParticleVFXOffset(
    proportions,
    anchor,
    getParticleVFXCombinedOffset(transform),
  );
  next.depthOffset = 0;
  return next;
}

export function getParticleVFXCombinedOffset(
  transform: ParticleVFXTransform,
): ParticleVFXTransformAxisTriple {
  return {
    x: transform.offset.x,
    y: transform.offset.y,
    z: transform.offset.z + transform.depthOffset,
  };
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Particle Effects are placed in the Avatar frame: Avatar scene-local
 * coordinates turned so +Z is the Avatar's forward for every VRM, as in the
 * VRM 1 scenes effects are authored on. three-vrm turns a VRM 0 scene half
 * about Y to face +Z (`VRMUtils.rotateVRM0`), so its scene-local forward is
 * -Z; the Avatar frame undoes that turn.
 */
function particleVFXAvatarFrameTurn(avatar: Pick<Avatar, "vrm">): number {
  return isVrm0(avatar.vrm) ? Math.PI : 0;
}

/** Turn a root under `avatar.scene` so its local space is the Avatar frame. */
export function alignParticleVFXRootToAvatar(
  root: THREE.Object3D,
  avatar: Pick<Avatar, "vrm">,
): void {
  root.rotation.set(0, particleVFXAvatarFrameTurn(avatar), 0);
  root.updateMatrixWorld(true);
}

/** Convert a world point into the Avatar frame, in place. */
export function worldToParticleVFXAvatarFrame(
  avatar: Pick<Avatar, "scene" | "vrm">,
  point: THREE.Vector3,
): THREE.Vector3 {
  const scene = avatar.scene;
  if (!scene) return point;
  scene.worldToLocal(point);
  return point.applyAxisAngle(Y_AXIS, -particleVFXAvatarFrameTurn(avatar));
}

/**
 * Resolve an anchor bone plus the transform's offset in the Avatar frame
 * (see `alignParticleVFXRootToAvatar`).
 */
export function resolveParticleVFXAnchorLocalPosition(args: {
  avatar: Avatar;
  anchor: ParticleVFXAnchor;
  transform?: ParticleVFXTransform;
}): ParticleVFXResolvedAnchor | null {
  const scene = args.avatar.scene;
  if (!scene) return null;

  scene.updateMatrixWorld(true);
  const combinedOffset = getParticleVFXCombinedOffset(
    args.transform ?? normalizeParticleVFXTransform(null),
  );

  if (args.anchor === "root") {
    return {
      requestedAnchor: args.anchor,
      resolvedAnchor: "root",
      boneName: null,
      position: combinedOffset,
      warning: null,
    };
  }

  const resolved = resolveHumanoidAnchorObject(args.avatar, args.anchor);
  if (resolved?.boneName) {
    const boneNode = resolved.object;
    boneNode.updateMatrixWorld(true);
    const localPosition = worldToParticleVFXAvatarFrame(
      args.avatar,
      boneNode.getWorldPosition(new THREE.Vector3()),
    );
    localPosition.add(
      new THREE.Vector3(combinedOffset.x, combinedOffset.y, combinedOffset.z),
    );

    return {
      requestedAnchor: args.anchor,
      resolvedAnchor: args.anchor,
      boneName: resolved.boneName,
      position: vectorToAxisTriple(localPosition),
      warning: resolved.fellBack
        ? `Particle VFX anchor "${args.anchor}" fell back to VRM bone "${resolved.boneName}".`
        : null,
    };
  }

  return {
    requestedAnchor: args.anchor,
    resolvedAnchor: "root",
    boneName: null,
    position: combinedOffset,
    warning: `Particle VFX anchor "${args.anchor}" could not resolve a VRM bone and fell back to root.`,
  };
}

function mergeAxisTriple(
  base: ParticleVFXTransformAxisTriple,
  override: Partial<ParticleVFXTransformAxisTriple> | null | undefined,
): ParticleVFXTransformAxisTriple {
  return {
    x: readFiniteNumber(override?.x, base.x),
    y: readFiniteNumber(override?.y, base.y),
    z: readFiniteNumber(override?.z, base.z),
  };
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function vectorToAxisTriple(
  vector: THREE.Vector3,
): ParticleVFXTransformAxisTriple {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}
