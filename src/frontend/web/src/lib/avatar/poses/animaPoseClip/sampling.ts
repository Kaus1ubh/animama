import type {
  VRMHumanBoneName,
  VRMPose,
  VRMPoseTransform,
} from "@pixiv/three-vrm";
import { MathUtils } from "three";

import { cloneVRMPose, isVRMHumanBoneName } from "../animaPose";
import { parseAnyAnimaPoseClip } from "./anyClip";
import { easeProgress, interpolateSamples } from "./interpolation";
import { getAnimaPoseClipSampleTime } from "./playback";
import {
  ANIMA_POSE_CLIP_EPSILON,
  DEFAULT_ANIMA_POSE_CLIP_TRANSITION,
  isAnimaPoseClipRef,
  sanitizePoseSnapshot,
  type AnimaPoseClip,
  type AnimaPoseClipKeyframe,
  type AnimaPoseClipPose,
  type AnimaPoseClipPoseResolver,
  type AnimaPoseClipSample,
  type AnimaPoseClipSampleDiagnostics,
  type AnimaPoseClipSampleResult,
  type QuaternionTuple,
  type ResolvedAnimaPoseClipTransition,
  type VectorTuple,
} from "./schema";

export function sampleAnimaPoseClip(
  clip: AnimaPoseClip,
  timeSec: number,
  resolvePoseRef: AnimaPoseClipPoseResolver = () => null,
): AnimaPoseClipSampleResult {
  // Parsed once per clip object; see parseAnyAnimaPoseClip.
  const sanitizedClip = parseAnyAnimaPoseClip(clip) as AnimaPoseClip;
  const diagnostics: AnimaPoseClipSampleDiagnostics = {
    missingPoseRefs: [],
  };
  const sampledTime = sampleClipTime(sanitizedClip, timeSec);
  const keyframes = sanitizedClip.poseKeyframes;

  // Effect-only clips own event timing, with no body or expression sample.
  if (keyframes.length === 0) return { sample: {}, diagnostics };

  if (keyframes.length === 1 || sampledTime <= keyframes[0].time) {
    return {
      sample: resolveKeyframeSample(
        sanitizedClip,
        keyframes[0],
        resolvePoseRef,
        diagnostics,
      ),
      diagnostics,
    };
  }

  const lastKeyframe = keyframes[keyframes.length - 1];
  if (sampledTime >= lastKeyframe.time) {
    return {
      sample: resolveKeyframeSample(
        sanitizedClip,
        lastKeyframe,
        resolvePoseRef,
        diagnostics,
      ),
      diagnostics,
    };
  }

  const nextKeyframeIndex = keyframes.findIndex(
    (keyframe) => keyframe.time >= sampledTime,
  );
  const nextKeyframe = keyframes[nextKeyframeIndex];
  const previousKeyframe = keyframes[nextKeyframeIndex - 1];
  const segmentDuration = nextKeyframe.time - previousKeyframe.time;
  const segmentProgress =
    segmentDuration > ANIMA_POSE_CLIP_EPSILON
      ? MathUtils.clamp(
          (sampledTime - previousKeyframe.time) / segmentDuration,
          0,
          1,
        )
      : 1;
  const transition = resolveTransition(sanitizedClip, nextKeyframe);
  const eased = easeProgress(segmentProgress, transition.easing);

  return {
    sample: interpolateSamples(
      resolveKeyframeSample(
        sanitizedClip,
        previousKeyframe,
        resolvePoseRef,
        diagnostics,
      ),
      resolveKeyframeSample(
        sanitizedClip,
        nextKeyframe,
        resolvePoseRef,
        diagnostics,
      ),
      segmentProgress,
      eased,
      transition,
    ),
    diagnostics,
  };
}

function sampleClipTime(clip: AnimaPoseClip, timeSec: number): number {
  return getAnimaPoseClipSampleTime(clip, timeSec);
}

function resolveKeyframeSample(
  clip: AnimaPoseClip,
  keyframe: AnimaPoseClipKeyframe,
  resolvePoseRef: AnimaPoseClipPoseResolver,
  diagnostics: AnimaPoseClipSampleDiagnostics,
): AnimaPoseClipSample {
  const baseSample = clip.basePose
    ? resolveExternalPoseSample(clip.basePose, resolvePoseRef, diagnostics)
    : {};
  const localSample = resolveClipPoseSample(
    clip.poses[keyframe.pose],
    resolvePoseRef,
    diagnostics,
  );
  return mergeSamples(baseSample, localSample);
}

function resolveTransition(
  clip: AnimaPoseClip,
  destinationKeyframe: AnimaPoseClipKeyframe,
): ResolvedAnimaPoseClipTransition {
  const clipTransition = clip.defaultTransition;
  const keyframeTransition = destinationKeyframe.transition;

  return {
    easing:
      keyframeTransition?.easing ??
      clipTransition?.easing ??
      DEFAULT_ANIMA_POSE_CLIP_TRANSITION.easing,
    interpolation: {
      humanoidRotation:
        keyframeTransition?.interpolation?.humanoidRotation ??
        clipTransition?.interpolation?.humanoidRotation ??
        DEFAULT_ANIMA_POSE_CLIP_TRANSITION.interpolation.humanoidRotation,
      humanoidPosition:
        keyframeTransition?.interpolation?.humanoidPosition ??
        clipTransition?.interpolation?.humanoidPosition ??
        DEFAULT_ANIMA_POSE_CLIP_TRANSITION.interpolation.humanoidPosition,
      expression:
        keyframeTransition?.interpolation?.expression ??
        clipTransition?.interpolation?.expression ??
        DEFAULT_ANIMA_POSE_CLIP_TRANSITION.interpolation.expression,
    },
  };
}

function resolveClipPoseSample(
  pose: AnimaPoseClipPose,
  resolvePoseRef: AnimaPoseClipPoseResolver,
  diagnostics: AnimaPoseClipSampleDiagnostics,
): AnimaPoseClipSample {
  if (isAnimaPoseClipRef(pose)) {
    return resolveExternalPoseSample(pose.ref, resolvePoseRef, diagnostics);
  }
  return cloneSample(pose);
}

function resolveExternalPoseSample(
  poseId: string,
  resolvePoseRef: AnimaPoseClipPoseResolver,
  diagnostics: AnimaPoseClipSampleDiagnostics,
): AnimaPoseClipSample {
  const resolvedPose = resolvePoseRef(poseId);
  const snapshot = resolvedPose
    ? sanitizePoseSnapshot(resolvedPose, poseId, false)
    : null;
  if (!snapshot) {
    addMissingPoseRef(diagnostics, poseId);
    return {};
  }
  return snapshot;
}

function mergeSamples(
  baseSample: AnimaPoseClipSample,
  overlaySample: AnimaPoseClipSample,
): AnimaPoseClipSample {
  const mergedHumanoid = mergeHumanoidPoses(
    baseSample.humanoid,
    overlaySample.humanoid,
  );
  const mergedExpressions = mergeExpressionWeights(
    baseSample.expressions,
    overlaySample.expressions,
  );

  return {
    ...(mergedHumanoid ? { humanoid: mergedHumanoid } : {}),
    ...(mergedExpressions ? { expressions: mergedExpressions } : {}),
  };
}

function mergeHumanoidPoses(
  basePose: VRMPose | undefined,
  overlayPose: VRMPose | undefined,
): VRMPose | undefined {
  if (!basePose && !overlayPose) return undefined;

  const pose: VRMPose = basePose ? cloneVRMPose(basePose) : {};
  for (const boneName of getPoseBoneNames(overlayPose)) {
    const overlayTransform = overlayPose?.[boneName];
    if (!overlayTransform) continue;

    const baseTransform = pose[boneName];
    pose[boneName] = mergePoseTransform(baseTransform, overlayTransform);
  }

  return Object.keys(pose).length > 0 ? pose : undefined;
}

function getPoseBoneNames(pose: VRMPose | undefined): VRMHumanBoneName[] {
  return Object.keys(pose ?? {}).filter(isVRMHumanBoneName);
}

function mergePoseTransform(
  baseTransform: VRMPoseTransform | undefined,
  overlayTransform: VRMPoseTransform,
): VRMPoseTransform {
  return {
    ...(baseTransform?.position
      ? { position: [...baseTransform.position] as VectorTuple }
      : {}),
    ...(baseTransform?.rotation
      ? { rotation: [...baseTransform.rotation] as QuaternionTuple }
      : {}),
    ...(overlayTransform.position
      ? { position: [...overlayTransform.position] as VectorTuple }
      : {}),
    ...(overlayTransform.rotation
      ? { rotation: [...overlayTransform.rotation] as QuaternionTuple }
      : {}),
  };
}

function mergeExpressionWeights(
  baseExpressions: Record<string, number> | undefined,
  overlayExpressions: Record<string, number> | undefined,
): Record<string, number> | undefined {
  const expressions = {
    ...(baseExpressions ?? {}),
    ...(overlayExpressions ?? {}),
  };
  return Object.keys(expressions).length > 0 ? expressions : undefined;
}

function cloneSample(sample: AnimaPoseClipSample): AnimaPoseClipSample {
  return {
    ...(sample.humanoid ? { humanoid: cloneVRMPose(sample.humanoid) } : {}),
    ...(sample.expressions ? { expressions: { ...sample.expressions } } : {}),
  };
}

function addMissingPoseRef(
  diagnostics: AnimaPoseClipSampleDiagnostics,
  poseId: string,
): void {
  if (!diagnostics.missingPoseRefs.includes(poseId)) {
    diagnostics.missingPoseRefs.push(poseId);
  }
}
