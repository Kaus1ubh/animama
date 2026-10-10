import type { VRMHumanBoneName } from "@pixiv/three-vrm";
import type { TFunction } from "i18next";

import type { ParticleVFXAnchor } from "@/lib/avatar/particle-vfx/types";
import type { HandPreset } from "@/lib/avatar/poses/anatomy/handPresetIds";
import type { AnimaPoseClipMutableLayerId } from "@/lib/avatar/poses/animaPoseClip/clipVocabulary";
import type { AnimaPoseClipEase } from "@/lib/avatar/poses/animaPoseClip/schemaV2";
import { POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID } from "@/stores/pose-creator-store";

/*
 * Display text for Pose vocabulary. Bone, preset, segment, ease and layer IDs
 * and persisted beat labels stay English data; these map them to `pose`
 * catalog keys for display. Parameters are typed `TFunction<"pose">` so the
 * extractor attributes their keys to the `pose` namespace.
 */

/** Title-case an identifier such as `leftUpperArm` for names without a catalog key. */
function identifierLabel(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/** Display name for a VRM humanoid bone ID (`leftUpperArm` → "Left Upper Arm"). */
export function boneLabel(t: TFunction<"pose">, boneName: string): string {
  switch (boneName as VRMHumanBoneName) {
    case "hips":
      return t("bones.names.hips");
    case "spine":
      return t("bones.names.spine");
    case "chest":
      return t("bones.names.chest");
    case "upperChest":
      return t("bones.names.upperChest");
    case "neck":
      return t("bones.names.neck");
    case "head":
      return t("bones.names.head");
    case "leftEye":
      return t("bones.names.leftEye");
    case "rightEye":
      return t("bones.names.rightEye");
    case "jaw":
      return t("bones.names.jaw");
    case "leftUpperLeg":
      return t("bones.names.leftUpperLeg");
    case "leftLowerLeg":
      return t("bones.names.leftLowerLeg");
    case "leftFoot":
      return t("bones.names.leftFoot");
    case "leftToes":
      return t("bones.names.leftToes");
    case "rightUpperLeg":
      return t("bones.names.rightUpperLeg");
    case "rightLowerLeg":
      return t("bones.names.rightLowerLeg");
    case "rightFoot":
      return t("bones.names.rightFoot");
    case "rightToes":
      return t("bones.names.rightToes");
    case "leftShoulder":
      return t("bones.names.leftShoulder");
    case "leftUpperArm":
      return t("bones.names.leftUpperArm");
    case "leftLowerArm":
      return t("bones.names.leftLowerArm");
    case "leftHand":
      return t("bones.names.leftHand");
    case "rightShoulder":
      return t("bones.names.rightShoulder");
    case "rightUpperArm":
      return t("bones.names.rightUpperArm");
    case "rightLowerArm":
      return t("bones.names.rightLowerArm");
    case "rightHand":
      return t("bones.names.rightHand");
    case "leftThumbMetacarpal":
      return t("bones.names.leftThumbMetacarpal");
    case "leftThumbProximal":
      return t("bones.names.leftThumbProximal");
    case "leftThumbDistal":
      return t("bones.names.leftThumbDistal");
    case "leftIndexProximal":
      return t("bones.names.leftIndexProximal");
    case "leftIndexIntermediate":
      return t("bones.names.leftIndexIntermediate");
    case "leftIndexDistal":
      return t("bones.names.leftIndexDistal");
    case "leftMiddleProximal":
      return t("bones.names.leftMiddleProximal");
    case "leftMiddleIntermediate":
      return t("bones.names.leftMiddleIntermediate");
    case "leftMiddleDistal":
      return t("bones.names.leftMiddleDistal");
    case "leftRingProximal":
      return t("bones.names.leftRingProximal");
    case "leftRingIntermediate":
      return t("bones.names.leftRingIntermediate");
    case "leftRingDistal":
      return t("bones.names.leftRingDistal");
    case "leftLittleProximal":
      return t("bones.names.leftLittleProximal");
    case "leftLittleIntermediate":
      return t("bones.names.leftLittleIntermediate");
    case "leftLittleDistal":
      return t("bones.names.leftLittleDistal");
    case "rightThumbMetacarpal":
      return t("bones.names.rightThumbMetacarpal");
    case "rightThumbProximal":
      return t("bones.names.rightThumbProximal");
    case "rightThumbDistal":
      return t("bones.names.rightThumbDistal");
    case "rightIndexProximal":
      return t("bones.names.rightIndexProximal");
    case "rightIndexIntermediate":
      return t("bones.names.rightIndexIntermediate");
    case "rightIndexDistal":
      return t("bones.names.rightIndexDistal");
    case "rightMiddleProximal":
      return t("bones.names.rightMiddleProximal");
    case "rightMiddleIntermediate":
      return t("bones.names.rightMiddleIntermediate");
    case "rightMiddleDistal":
      return t("bones.names.rightMiddleDistal");
    case "rightRingProximal":
      return t("bones.names.rightRingProximal");
    case "rightRingIntermediate":
      return t("bones.names.rightRingIntermediate");
    case "rightRingDistal":
      return t("bones.names.rightRingDistal");
    case "rightLittleProximal":
      return t("bones.names.rightLittleProximal");
    case "rightLittleIntermediate":
      return t("bones.names.rightLittleIntermediate");
    case "rightLittleDistal":
      return t("bones.names.rightLittleDistal");
    default:
      return identifierLabel(boneName);
  }
}

/** Display name for a Hands-tool preset. */
export function handPresetLabel(
  t: TFunction<"pose">,
  preset: HandPreset,
): string {
  switch (preset) {
    case "fist":
      return t("hands.presetNames.fist");
    case "open-spread":
      return t("hands.presetNames.openSpread");
    case "open-together":
      return t("hands.presetNames.openTogether");
    case "relaxed":
      return t("hands.presetNames.relaxed");
    case "point":
      return t("hands.presetNames.point");
    case "peace":
      return t("hands.presetNames.peace");
    case "thumbs-up":
      return t("hands.presetNames.thumbsUp");
    case "cupped":
      return t("hands.presetNames.cupped");
    case "soft-claw":
      return t("hands.presetNames.softClaw");
    case "palm-flat":
      return t("hands.presetNames.palmFlat");
    case "pinch":
      return t("hands.presetNames.pinch");
    case "ok":
      return t("hands.presetNames.ok");
    default: {
      // Every preset needs its own catalog key.
      const unlabelled: never = preset;
      return unlabelled;
    }
  }
}

/** Display name for a Hands-tool segment ID such as `indexDistal` ("Index distal"). */
export function handSegmentLabel(
  t: TFunction<"pose">,
  segmentId: string,
): string {
  switch (segmentId) {
    case "thumbProximal":
      return t("hands.segments.thumbProximal");
    case "thumbDistal":
      return t("hands.segments.thumbDistal");
    case "indexProximal":
      return t("hands.segments.indexProximal");
    case "indexIntermediate":
      return t("hands.segments.indexIntermediate");
    case "indexDistal":
      return t("hands.segments.indexDistal");
    case "middleProximal":
      return t("hands.segments.middleProximal");
    case "middleIntermediate":
      return t("hands.segments.middleIntermediate");
    case "middleDistal":
      return t("hands.segments.middleDistal");
    case "ringProximal":
      return t("hands.segments.ringProximal");
    case "ringIntermediate":
      return t("hands.segments.ringIntermediate");
    case "ringDistal":
      return t("hands.segments.ringDistal");
    case "littleProximal":
      return t("hands.segments.littleProximal");
    case "littleIntermediate":
      return t("hands.segments.littleIntermediate");
    case "littleDistal":
      return t("hands.segments.littleDistal");
    default:
      return identifierLabel(segmentId);
  }
}

/** A segment on one hand, or on both, for example "Left index distal". */
export function sidedHandSegmentLabel(
  t: TFunction<"pose">,
  side: "left" | "right" | "both",
  segmentId: string,
): string {
  const segment = handSegmentLabel(t, segmentId);
  switch (side) {
    case "left":
      return t("hands.segmentOnSide.left", { segment });
    case "right":
      return t("hands.segmentOnSide.right", { segment });
    case "both":
      return t("hands.segmentOnSide.both", { segment });
  }
}

/**
 * Display name for a base pose option. The VRM T-pose is an editor choice;
 * other options are Included Poses, whose names stay as authored.
 */
export function basePoseLabel(
  t: TFunction<"pose">,
  option: { id: string; label: string },
): string {
  return option.id === POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID
    ? t("basePoses.vrmTPose")
    : option.label;
}

/**
 * Display text for a beat label. The creator's default labels are persisted
 * English; labels the owner typed are shown as written.
 */
export function beatLabel(t: TFunction<"pose">, label: string): string {
  switch (label) {
    case "Base":
      return t("beats.base");
    case "Expression":
      return t("beats.expression");
    case "Captured":
      return t("beats.captured");
    case "Beat":
      return t("beats.beat");
    default:
      return label;
  }
}

/** Display name for a beat arrival ease. */
export function easeLabel(
  t: TFunction<"pose">,
  ease: AnimaPoseClipEase,
): string {
  switch (ease) {
    case "smooth":
      return t("clip.eases.smooth");
    case "hold":
      return t("clip.eases.hold");
    case "linear":
      return t("clip.eases.linear");
    case "easeInSine":
      return t("clip.eases.easeInSine");
    case "easeOutSine":
      return t("clip.eases.easeOutSine");
    case "easeInOutSine":
      return t("clip.eases.easeInOutSine");
    case "easeInCubic":
      return t("clip.eases.easeInCubic");
    case "easeOutCubic":
      return t("clip.eases.easeOutCubic");
    case "easeInOutCubic":
      return t("clip.eases.easeInOutCubic");
    case "back":
      return t("clip.eases.back");
    case "elastic":
      return t("clip.eases.elastic");
    case "bounce":
      return t("clip.eases.bounce");
    default: {
      const unlabelled: never = ease;
      return unlabelled;
    }
  }
}

/** Display name for a live procedural layer a Gesture can mute. */
export function mutableLayerLabel(
  t: TFunction<"pose">,
  layer: AnimaPoseClipMutableLayerId,
): string {
  switch (layer) {
    case "breathing":
      return t("clip.layers.breathing");
    case "sway":
      return t("clip.layers.sway");
    case "bounce":
      return t("clip.layers.bounce");
    case "headNod":
      return t("clip.layers.headNod");
    case "headSideTilt":
      return t("clip.layers.headSideTilt");
    case "cursorLookAt":
      return t("clip.layers.cursorLookAt");
    case "emotionPosture":
      return t("clip.layers.emotionPosture");
    default: {
      const unlabelled: never = layer;
      return unlabelled;
    }
  }
}

/** Display name for a Particle Effect anchor: the root, or a humanoid bone. */
export function particleAnchorLabel(
  t: TFunction<"pose">,
  anchor: ParticleVFXAnchor,
): string {
  return anchor === "root" ? t("clip.anchors.root") : boneLabel(t, anchor);
}
