import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

import {
  DEFAULT_TALKING_HANDS_PROCEDURAL_ANIMATION_PARAMS,
  type ProceduralAnimationLayer,
  type ProceduralAnimationLayerSnapshot,
  type ProceduralAnimationRuntimeContext,
  type ProceduralAnimationTransitionState,
  type TalkingHandsMicroTwistMode,
  type TalkingHandsPlayGroupRequest,
  type TalkingHandsProceduralAnimationParams,
  type TalkingHandsSecondaryMicroTwistAxis,
} from "./types";
import {
  createTalkingHandsSpeechPlan,
  createTalkingHandsSpeechPlanDebugSnapshot,
  type TalkingHandsSpeechPlan,
  type TalkingHandsSpeechChunkDiagnostic,
  type TalkingHandsSpeechChunkSkipReason,
  type TalkingHandsSpeechPlanDebugSnapshot,
  type TalkingHandsSpeechPlanReady,
  type TalkingHandsSpeechPlanSegment,
  type TalkingHandsSpeechSelectedSide,
} from "./talking-hands-speech-planner";
import type {
  SpeechGestureBeat,
  SpeechGestureTimeline,
} from "@/lib/speech/gruut-viseme-keyframes";
import type { TtsChunkRecord } from "@/lib/speech/tts-chunker";

const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_LAYER_WEIGHT = 1;
const EPSILON = 0.0001;
const MICRO_TWIST_HAND_FOLLOW = 0.65;
const MIN_SEGMENT_DURATION_SEC = 0.03;
const FIRST_MICRO_SETTLE_STROKE_RATIO = 0.22;
const FINGER_BONE_LAG_RATIO = 0.45;
const ROLL_AXIS_EPSILON = 0.000001;
const TALKING_HANDS_MIN_GROUP_DURATION_SEC = 0.12;

const TALKING_HANDS_DYNAMIC_BONE_NAMES = [
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftShoulder",
  "rightShoulder",
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
  "leftHand",
  "rightHand",
  "leftThumbMetacarpal",
  "leftThumbProximal",
  "leftThumbDistal",
  "leftIndexProximal",
  "leftIndexIntermediate",
  "leftIndexDistal",
  "leftMiddleProximal",
  "leftMiddleIntermediate",
  "leftMiddleDistal",
  "leftRingProximal",
  "leftRingIntermediate",
  "leftRingDistal",
  "leftLittleProximal",
  "leftLittleIntermediate",
  "leftLittleDistal",
  "rightThumbMetacarpal",
  "rightThumbProximal",
  "rightThumbDistal",
  "rightIndexProximal",
  "rightIndexIntermediate",
  "rightIndexDistal",
  "rightMiddleProximal",
  "rightMiddleIntermediate",
  "rightMiddleDistal",
  "rightRingProximal",
  "rightRingIntermediate",
  "rightRingDistal",
  "rightLittleProximal",
  "rightLittleIntermediate",
  "rightLittleDistal",
] as const satisfies readonly VRMHumanBoneName[];

const TALKING_HANDS_BONE_NAMES = TALKING_HANDS_DYNAMIC_BONE_NAMES;

type TalkingHandsBoneName = (typeof TALKING_HANDS_DYNAMIC_BONE_NAMES)[number];
type Side = "left" | "right";
type SchedulerState = "pause" | "playback";
type GestureMode = "one" | "both";
type SpeechRunSchedulerState = {
  runId: string;
  ordinarySide: Side;
  chunkDiagnostics: Map<string, TalkingHandsSpeechChunkDiagnostic>;
};
type ChunkWindow = {
  startSec: number;
  endSec: number;
};
type ResolvedSpeechTiming = NonNullable<
  ProceduralAnimationRuntimeContext["speechTiming"]
> & {
  utteranceDurationSec: number;
  durationSec: number;
  remainingSec: number;
  gestureTimeline: SpeechGestureTimeline;
};
type FingerName = "index" | "middle" | "ring" | "little";
type FingerValuesDeg = Record<FingerName, number>;
type FingerValuesDegBySide = Record<Side, FingerValuesDeg>;
type NumberBySide = Record<Side, number>;

const ZERO_FINGER_VALUES: FingerValuesDeg = {
  index: 0,
  middle: 0,
  ring: 0,
  little: 0,
};

type MirroredBoneTarget = {
  left: TalkingHandsBoneName;
  right: TalkingHandsBoneName;
  multiplier: number;
  finger?: FingerName;
  microCurlMultiplier?: number;
  unspreadMultiplier?: number;
  microUnspreadMultiplier?: number;
};

const FINGER_PROXIMAL_CURL_TARGETS = [
  {
    left: "leftIndexProximal",
    right: "rightIndexProximal",
    finger: "index",
    multiplier: 1,
    microCurlMultiplier: 1,
  },
  {
    left: "leftMiddleProximal",
    right: "rightMiddleProximal",
    finger: "middle",
    multiplier: 1,
    microCurlMultiplier: 1,
  },
  {
    left: "leftRingProximal",
    right: "rightRingProximal",
    finger: "ring",
    multiplier: 0.95,
    microCurlMultiplier: 0.8,
  },
  {
    left: "leftLittleProximal",
    right: "rightLittleProximal",
    finger: "little",
    multiplier: 0.9,
    microCurlMultiplier: 0.6,
  },
] as const satisfies readonly MirroredBoneTarget[];

const FINGER_INTERMEDIATE_CURL_TARGETS = [
  {
    left: "leftIndexIntermediate",
    right: "rightIndexIntermediate",
    finger: "index",
    multiplier: 1,
    microCurlMultiplier: 1,
  },
  {
    left: "leftMiddleIntermediate",
    right: "rightMiddleIntermediate",
    finger: "middle",
    multiplier: 1,
    microCurlMultiplier: 1,
  },
  {
    left: "leftRingIntermediate",
    right: "rightRingIntermediate",
    finger: "ring",
    multiplier: 0.95,
    microCurlMultiplier: 0.6,
  },
  {
    left: "leftLittleIntermediate",
    right: "rightLittleIntermediate",
    finger: "little",
    multiplier: 0.9,
    microCurlMultiplier: 0.4,
  },
] as const satisfies readonly MirroredBoneTarget[];

const FINGER_DISTAL_CURL_TARGETS = [
  {
    left: "leftIndexDistal",
    right: "rightIndexDistal",
    finger: "index",
    multiplier: 0.75,
    microCurlMultiplier: 1,
  },
  {
    left: "leftMiddleDistal",
    right: "rightMiddleDistal",
    finger: "middle",
    multiplier: 0.75,
    microCurlMultiplier: 1,
  },
  {
    left: "leftRingDistal",
    right: "rightRingDistal",
    finger: "ring",
    multiplier: 0.7,
    microCurlMultiplier: 0.6,
  },
  {
    left: "leftLittleDistal",
    right: "rightLittleDistal",
    finger: "little",
    multiplier: 0.65,
    microCurlMultiplier: 0.4,
  },
] as const satisfies readonly MirroredBoneTarget[];

const THUMB_BASE_CURL_TARGETS = [
  {
    left: "leftThumbMetacarpal",
    right: "rightThumbMetacarpal",
    multiplier: 0.45,
    microCurlMultiplier: 1,
    unspreadMultiplier: 1,
    microUnspreadMultiplier: 1,
  },
] as const satisfies readonly MirroredBoneTarget[];

const THUMB_INTERMEDIATE_CURL_TARGETS = [
  {
    left: "leftThumbProximal",
    right: "rightThumbProximal",
    multiplier: 1,
    microCurlMultiplier: 1,
  },
] as const satisfies readonly MirroredBoneTarget[];

const THUMB_DISTAL_CURL_TARGETS = [
  {
    left: "leftThumbDistal",
    right: "rightThumbDistal",
    multiplier: 0.75,
    microCurlMultiplier: 1,
  },
] as const satisfies readonly MirroredBoneTarget[];

type TalkingHandsGesturePoseDeg = {
  leftElbowBend: number;
  leftElbowSide: number;
  leftShoulderForward: number;
  leftPalmDirection: number;
  leftMicroTwist: number;
  leftSecondaryMicroTwist: number;
  leftMicroFingerUncurl: FingerValuesDeg;
  leftMicroThumbUncurl: number;
  leftMicroThumbUnspread: number;
  leftMicroHandFlex: number;
  leftRestCurlWeight: number;
  leftRestFingerCurlJitter: FingerValuesDeg;
  microHeadNod: number;
  rightElbowBend: number;
  rightElbowSide: number;
  rightShoulderForward: number;
  rightPalmDirection: number;
  rightMicroTwist: number;
  rightSecondaryMicroTwist: number;
  rightMicroFingerUncurl: FingerValuesDeg;
  rightMicroThumbUncurl: number;
  rightMicroThumbUnspread: number;
  rightMicroHandFlex: number;
  rightRestCurlWeight: number;
  rightRestFingerCurlJitter: FingerValuesDeg;
};

type TalkingHandsGestureSegment = {
  from: TalkingHandsGesturePoseDeg;
  to: TalkingHandsGesturePoseDeg;
  durationSec: number;
};

type TalkingHandsLagSteps = {
  arm: number;
  palm: number;
  finger: number;
};

const NEUTRAL_GESTURE_POSE: TalkingHandsGesturePoseDeg = {
  leftElbowBend: 0,
  leftElbowSide: 0,
  leftShoulderForward: 0,
  leftPalmDirection: 0,
  leftMicroTwist: 0,
  leftSecondaryMicroTwist: 0,
  leftMicroFingerUncurl: ZERO_FINGER_VALUES,
  leftMicroThumbUncurl: 0,
  leftMicroThumbUnspread: 0,
  leftMicroHandFlex: 0,
  leftRestCurlWeight: 0,
  leftRestFingerCurlJitter: ZERO_FINGER_VALUES,
  microHeadNod: 0,
  rightElbowBend: 0,
  rightElbowSide: 0,
  rightShoulderForward: 0,
  rightPalmDirection: 0,
  rightMicroTwist: 0,
  rightSecondaryMicroTwist: 0,
  rightMicroFingerUncurl: ZERO_FINGER_VALUES,
  rightMicroThumbUncurl: 0,
  rightMicroThumbUnspread: 0,
  rightMicroHandFlex: 0,
  rightRestCurlWeight: 0,
  rightRestFingerCurlJitter: ZERO_FINGER_VALUES,
};

export class TalkingHandsProceduralAnimationLayer implements ProceduralAnimationLayer<"talkingHands"> {
  readonly id = "talkingHands";

  private _vrm: VRM | null;
  private _params: TalkingHandsProceduralAnimationParams = {
    ...DEFAULT_TALKING_HANDS_PROCEDURAL_ANIMATION_PARAMS,
  };
  private _weight: number = DEFAULT_LAYER_WEIGHT;
  private _bones = new Map<TalkingHandsBoneName, THREE.Object3D>();
  private _state: SchedulerState = "pause";
  private _segments: TalkingHandsGestureSegment[] = [];
  private _segmentIndex: number = 0;
  private _segmentElapsedSec: number = 0;
  private _speechRunScheduler: SpeechRunSchedulerState | null = null;
  private _lastSpeechPlanDebug: TalkingHandsSpeechPlanDebugSnapshot | null =
    null;
  private _currentGesturePose: TalkingHandsGesturePoseDeg = {
    ...NEUTRAL_GESTURE_POSE,
  };
  private _renderedGesturePose: TalkingHandsGesturePoseDeg = {
    ...NEUTRAL_GESTURE_POSE,
  };
  private _lastOffsets = new Map<TalkingHandsBoneName, THREE.Quaternion>();
  private _offsetScratchByBone = new Map<
    TalkingHandsBoneName,
    THREE.Quaternion
  >();
  private _scratchEuler = new THREE.Euler(0, 0, 0, "XYZ");
  private _scratchOffset = new THREE.Quaternion();
  private _scratchTwistOffset = new THREE.Quaternion();
  private _scratchInverseOffset = new THREE.Quaternion();
  private _scratchLowerArmWorldPosition = new THREE.Vector3();
  private _scratchHandWorldPosition = new THREE.Vector3();
  private _scratchRollAxis = new THREE.Vector3();
  private _scratchTargetWorldQuaternion = new THREE.Quaternion();
  private _scratchInverseTargetWorldQuaternion = new THREE.Quaternion();

  constructor(vrm: VRM) {
    this._vrm = vrm;
    this._cacheBones();
  }

  clearOffsets(): void {
    if (!this._lastOffsets.size) return;

    this._lastOffsets.forEach((offset, boneName) => {
      const bone = this._bones.get(boneName);
      if (!bone) return;

      this._scratchInverseOffset.copy(offset).invert();
      bone.quaternion.multiply(this._scratchInverseOffset);
    });
    this._lastOffsets.clear();
  }

  update(deltaSec: number, context: ProceduralAnimationRuntimeContext): void {
    this.clearOffsets();

    if (!this._vrm || !this._params.enabled) return;

    const activationWeight = sanitizeActivationWeight(
      context.layerActivationWeight,
    );
    const layerIntensity =
      this._params.intensity * this._weight * activationWeight;
    if (layerIntensity <= 0) {
      this._clearPlaybackState();
      this._resetRenderedPose();
      return;
    }

    if (
      this._state === "pause" &&
      !context.layerDeactivationRequested &&
      context.avatarState === "talking"
    ) {
      this._tryStartSpeechGroup(context.speechTiming ?? null);
    }

    if (this._state === "playback") {
      this._advancePlayback(deltaSec);
    }

    this._advanceRenderedPose(deltaSec);
    this._applyPose(this._renderedGesturePose, layerIntensity, deltaSec);
  }

  playGroup(request: TalkingHandsPlayGroupRequest): boolean {
    if (request.source === "speech") {
      return this._playSpeechGroup(request);
    }

    return this._playDebugGroup(request.durationSec ?? null);
  }

  getTransitionState(): ProceduralAnimationTransitionState {
    return {
      canDeactivateNow: this._state !== "playback",
      maxWaitSec: 1.5,
    };
  }

  getSnapshot(): ProceduralAnimationLayerSnapshot<"talkingHands"> {
    return {
      id: this.id,
      enabled: this._params.enabled,
      weight: this._weight,
      params: { ...this._params },
      resolvedBones: TALKING_HANDS_BONE_NAMES.filter((boneName) =>
        this._bones.has(boneName),
      ),
      missingBones: TALKING_HANDS_BONE_NAMES.filter(
        (boneName) => !this._bones.has(boneName),
      ),
      speechPlan: this._lastSpeechPlanDebug,
    };
  }

  setEnabled(enabled: boolean): void {
    const wasEnabled = this._params.enabled;
    this._params.enabled = enabled;

    if (!enabled) {
      this.clearOffsets();
      this._clearPlaybackState();
      this._resetRenderedPose();
      this._speechRunScheduler = null;
      return;
    }

    if (!wasEnabled) {
      this._clearPlaybackState();
      this._resetRenderedPose();
    }
  }

  setWeight(weight: number): void {
    if (!Number.isFinite(weight)) return;

    const wasInactive = this._weight <= 0;
    this._weight = THREE.MathUtils.clamp(weight, 0, 1);

    if (this._weight <= 0) {
      this.clearOffsets();
      this._clearPlaybackState();
      this._resetRenderedPose();
      this._speechRunScheduler = null;
      return;
    }

    if (wasInactive && this._params.enabled) {
      this._clearPlaybackState();
    }
  }

  setParams(params: Partial<TalkingHandsProceduralAnimationParams>): void {
    const wasEnabled = this._params.enabled;
    const wasInactive = this._params.intensity <= 0;

    if (typeof params.enabled === "boolean") {
      this._params.enabled = params.enabled;
    }
    this._params.intensity = sanitizeNonNegativeNumber(
      params.intensity,
      this._params.intensity,
    );
    this._params.elbowSideDriftMin = sanitizeFiniteNumber(
      params.elbowSideDriftMin,
      this._params.elbowSideDriftMin,
    );
    this._params.elbowSideDriftMax = sanitizeFiniteNumber(
      params.elbowSideDriftMax,
      this._params.elbowSideDriftMax,
    );
    this._params.palmDirectionRange = sanitizeNonNegativeNumber(
      params.palmDirectionRange,
      this._params.palmDirectionRange,
    );
    this._params.shoulderBeat = sanitizeFiniteNumber(
      params.shoulderBeat,
      this._params.shoulderBeat,
    );
    this._params.shoulderForward = sanitizeFiniteNumber(
      params.shoulderForward,
      this._params.shoulderForward,
    );
    this._params.asymmetry = sanitizeAsymmetry(
      params.asymmetry,
      this._params.asymmetry,
    );
    this._params.pauseMinSec = sanitizeNonNegativeNumber(
      params.pauseMinSec,
      this._params.pauseMinSec,
    );
    this._params.pauseMaxSec = sanitizeNonNegativeNumber(
      params.pauseMaxSec,
      this._params.pauseMaxSec,
    );
    this._params.gestureDurationSec = sanitizeNonNegativeNumber(
      params.gestureDurationSec,
      this._params.gestureDurationSec,
    );
    this._params.elbowBendMin = sanitizeFiniteNumber(
      params.elbowBendMin,
      this._params.elbowBendMin,
    );
    this._params.elbowBendMax = sanitizeFiniteNumber(
      params.elbowBendMax,
      this._params.elbowBendMax,
    );
    this._params.elbowBendAsymmetry = sanitizeNonNegativeNumber(
      params.elbowBendAsymmetry,
      this._params.elbowBendAsymmetry,
    );
    this._params.microBendCount = sanitizeNonNegativeInteger(
      params.microBendCount,
      this._params.microBendCount,
    );
    this._params.microBendAmount = sanitizeFiniteNumber(
      params.microBendAmount,
      this._params.microBendAmount,
    );
    this._params.microBendPauseChance = sanitizeUnitInterval(
      params.microBendPauseChance,
      this._params.microBendPauseChance,
    );
    this._params.microBendPauseMinSec = sanitizeNonNegativeNumber(
      params.microBendPauseMinSec,
      this._params.microBendPauseMinSec,
    );
    this._params.microBendPauseMaxSec = sanitizeNonNegativeNumber(
      params.microBendPauseMaxSec,
      this._params.microBendPauseMaxSec,
    );
    this._params.restThumbCurlOffset = sanitizeFiniteNumber(
      params.restThumbCurlOffset,
      this._params.restThumbCurlOffset,
    );
    this._params.restThumbMetacarpalCurlOffset = sanitizeFiniteNumber(
      params.restThumbMetacarpalCurlOffset,
      this._params.restThumbMetacarpalCurlOffset,
    );
    this._params.restThumbProximalCurlOffset = sanitizeFiniteNumber(
      params.restThumbProximalCurlOffset,
      this._params.restThumbProximalCurlOffset,
    );
    this._params.restThumbDistalCurlOffset = sanitizeFiniteNumber(
      params.restThumbDistalCurlOffset,
      this._params.restThumbDistalCurlOffset,
    );
    this._params.restThumbSpreadOffset = sanitizeFiniteNumber(
      params.restThumbSpreadOffset,
      this._params.restThumbSpreadOffset,
    );
    this._params.restIndexFingerCurlOffset = sanitizeFiniteNumber(
      params.restIndexFingerCurlOffset,
      this._params.restIndexFingerCurlOffset,
    );
    this._params.restMiddleFingerCurlOffset = sanitizeFiniteNumber(
      params.restMiddleFingerCurlOffset,
      this._params.restMiddleFingerCurlOffset,
    );
    this._params.restRingFingerCurlOffset = sanitizeFiniteNumber(
      params.restRingFingerCurlOffset,
      this._params.restRingFingerCurlOffset,
    );
    this._params.restLittleFingerCurlOffset = sanitizeFiniteNumber(
      params.restLittleFingerCurlOffset,
      this._params.restLittleFingerCurlOffset,
    );
    this._params.restFingerCurlJitter = sanitizeNonNegativeNumber(
      params.restFingerCurlJitter,
      this._params.restFingerCurlJitter,
    );
    this._params.microFingerUncurlAmount = sanitizeFiniteNumber(
      params.microFingerUncurlAmount,
      this._params.microFingerUncurlAmount,
    );
    this._params.microFingerUncurlVariance = sanitizeUnitInterval(
      params.microFingerUncurlVariance,
      this._params.microFingerUncurlVariance,
    );
    this._params.microThumbUncurlAmount = sanitizeFiniteNumber(
      params.microThumbUncurlAmount,
      this._params.microThumbUncurlAmount,
    );
    this._params.microThumbUncurlVariance = sanitizeUnitInterval(
      params.microThumbUncurlVariance,
      this._params.microThumbUncurlVariance,
    );
    this._params.microThumbUnspreadAmount = sanitizeFiniteNumber(
      params.microThumbUnspreadAmount,
      this._params.microThumbUnspreadAmount,
    );
    this._params.microHandFlexAmount = sanitizeFiniteNumber(
      params.microHandFlexAmount,
      this._params.microHandFlexAmount,
    );
    this._params.microHeadNodAmount = sanitizeFiniteNumber(
      params.microHeadNodAmount,
      this._params.microHeadNodAmount,
    );
    this._params.microEntryBlend = sanitizeNonNegativeNumber(
      params.microEntryBlend,
      this._params.microEntryBlend,
    );
    this._params.armLagSec = sanitizeNonNegativeNumber(
      params.armLagSec,
      this._params.armLagSec,
    );
    this._params.palmLagSec = sanitizeNonNegativeNumber(
      params.palmLagSec,
      this._params.palmLagSec,
    );
    this._params.fingerLagSec = sanitizeNonNegativeNumber(
      params.fingerLagSec,
      this._params.fingerLagSec,
    );
    this._params.fingerCascadeLag = sanitizeUnitInterval(
      params.fingerCascadeLag,
      this._params.fingerCascadeLag,
    );
    this._params.microTwistAmount = sanitizeFiniteNumber(
      params.microTwistAmount,
      this._params.microTwistAmount,
    );
    this._params.microTwistMode = sanitizeMicroTwistMode(
      params.microTwistMode,
      this._params.microTwistMode,
    );
    this._params.secondaryMicroTwistMin = sanitizeFiniteNumber(
      params.secondaryMicroTwistMin,
      this._params.secondaryMicroTwistMin,
    );
    this._params.secondaryMicroTwistMax = sanitizeFiniteNumber(
      params.secondaryMicroTwistMax,
      this._params.secondaryMicroTwistMax,
    );
    this._params.secondaryMicroTwistAxis = sanitizeSecondaryMicroTwistAxis(
      params.secondaryMicroTwistAxis,
      this._params.secondaryMicroTwistAxis,
    );
    this._params.speechGestureEntrySec = sanitizeNonNegativeNumber(
      params.speechGestureEntrySec,
      this._params.speechGestureEntrySec,
    );
    this._params.speechGestureEntryGraceSec = sanitizeNonNegativeNumber(
      params.speechGestureEntryGraceSec,
      this._params.speechGestureEntryGraceSec,
    );
    this._params.speechGestureReturnSec = sanitizeNonNegativeNumber(
      params.speechGestureReturnSec,
      this._params.speechGestureReturnSec,
    );
    this._params.speechBeatMinSpacingSec = sanitizeNonNegativeNumber(
      params.speechBeatMinSpacingSec,
      this._params.speechBeatMinSpacingSec,
    );
    this._params.speechBeatPulseAttackSec = sanitizeNonNegativeNumber(
      params.speechBeatPulseAttackSec,
      this._params.speechBeatPulseAttackSec,
    );
    this._params.speechBeatPulseReleaseSec = sanitizeNonNegativeNumber(
      params.speechBeatPulseReleaseSec,
      this._params.speechBeatPulseReleaseSec,
    );
    this._params.speechChunkSkipChance = sanitizeUnitInterval(
      params.speechChunkSkipChance,
      this._params.speechChunkSkipChance,
    );
    this._params.oneHandChance = sanitizeUnitInterval(
      params.oneHandChance,
      this._params.oneHandChance,
    );
    this._params.bothHandsChance = sanitizeUnitInterval(
      params.bothHandsChance,
      this._params.bothHandsChance,
    );
    this._params.speed = sanitizeNonNegativeNumber(
      params.speed,
      this._params.speed,
    );

    if (!this._params.enabled || this._params.intensity <= 0) {
      this.clearOffsets();
      this._clearPlaybackState();
      this._resetRenderedPose();
      this._speechRunScheduler = null;
      return;
    }

    if (!wasEnabled || wasInactive) {
      this._clearPlaybackState();
    }
  }

  reset(): void {
    this.clearOffsets();
    this._params = { ...DEFAULT_TALKING_HANDS_PROCEDURAL_ANIMATION_PARAMS };
    this._weight = DEFAULT_LAYER_WEIGHT;
    this._speechRunScheduler = null;
    this._lastSpeechPlanDebug = null;
    this._clearPlaybackState();
    this._resetRenderedPose();
  }

  dispose(): void {
    this.clearOffsets();
    this._bones.clear();
    this._lastOffsets.clear();
    this._offsetScratchByBone.clear();
    this._speechRunScheduler = null;
    this._lastSpeechPlanDebug = null;
    this._clearPlaybackState();
    this._resetRenderedPose();
    this._vrm = null;
  }

  private _cacheBones(): void {
    if (!this._vrm) return;

    for (const boneName of TALKING_HANDS_BONE_NAMES) {
      const bone = this._vrm.humanoid.getNormalizedBoneNode(boneName);
      if (bone) {
        this._bones.set(boneName, bone);
      }
    }
  }

  private _tryStartSpeechGroup(
    timing: ProceduralAnimationRuntimeContext["speechTiming"] | null,
  ): void {
    const resolvedTiming = resolveSpeechTimingForChunkScheduling(timing);
    if (!resolvedTiming) return;
    if (resolvedTiming.ttsChunks.length === 0) return;

    const run = this._ensureSpeechRunScheduler(resolvedTiming.runId);
    this._syncPendingChunkDiagnostics(run, resolvedTiming.ttsChunks);
    this._refreshSpeechPlanDebugChunks();

    for (const chunk of [...resolvedTiming.ttsChunks].sort(
      (left, right) => left.index - right.index,
    )) {
      const existing = run.chunkDiagnostics.get(chunk.chunkId);
      if (existing?.status !== "pending") continue;

      const outcome = this._createSpeechChunkPlan({
        timing: resolvedTiming,
        run,
        chunk,
      });

      if (outcome.status === "waiting") return;

      run.chunkDiagnostics.set(chunk.chunkId, outcome.diagnostic);

      if (outcome.status === "skipped") {
        this._ensureSpeechPlanDebugForSkippedChunk(resolvedTiming);
        continue;
      }

      this._recordSpeechPlanDebug(outcome.plan);
      this._playSpeechPlan(outcome.plan, outcome.selectedSide);
      return;
    }
  }

  private _ensureSpeechRunScheduler(runId: string): SpeechRunSchedulerState {
    if (this._speechRunScheduler?.runId === runId) {
      return this._speechRunScheduler;
    }

    this._speechRunScheduler = {
      runId,
      ordinarySide: randomSide(),
      chunkDiagnostics: new Map(),
    };
    return this._speechRunScheduler;
  }

  private _syncPendingChunkDiagnostics(
    run: SpeechRunSchedulerState,
    chunks: readonly TtsChunkRecord[],
  ): void {
    for (const chunk of chunks) {
      if (run.chunkDiagnostics.has(chunk.chunkId)) continue;
      run.chunkDiagnostics.set(chunk.chunkId, {
        ...createBaseChunkDiagnostic(chunk),
        status: "pending",
        beatCount: 0,
        selectedBeats: [],
        skippedBeats: [],
        pulseApexes: [],
      });
    }
  }

  private _createSpeechChunkPlan({
    timing,
    run,
    chunk,
  }: {
    timing: ResolvedSpeechTiming;
    run: SpeechRunSchedulerState;
    chunk: TtsChunkRecord;
  }):
    | { status: "waiting" }
    | {
        status: "skipped";
        diagnostic: TalkingHandsSpeechChunkDiagnostic;
      }
    | {
        status: "ready";
        plan: TalkingHandsSpeechPlanReady;
        diagnostic: TalkingHandsSpeechChunkDiagnostic;
        selectedSide: TalkingHandsSpeechSelectedSide;
      } {
    const timeline = timing.gestureTimeline;
    if (!timeline) {
      return {
        status: "skipped",
        diagnostic: this._createSkippedChunkDiagnostic(
          chunk,
          "missing_beat_timeline",
          [],
        ),
      };
    }

    const chunkBeats = this._getChunkBeats(timeline, chunk);
    if (chunkBeats.length === 0) {
      return {
        status: "skipped",
        diagnostic: this._createSkippedChunkDiagnostic(
          chunk,
          "no_primary_beats",
          [],
        ),
      };
    }

    const sortedBeats = [...chunkBeats].sort(compareSpeechGestureBeatsByTime);
    const gestureEntrySec = Math.max(0, this._params.speechGestureEntrySec);
    const gestureEntryGraceSec = Math.max(
      0,
      this._params.speechGestureEntryGraceSec,
    );
    const minimumEntryLeadSec = Math.max(
      0,
      gestureEntrySec - gestureEntryGraceSec,
    );
    const firstUsableBeat = sortedBeats.find(
      (beat) => beat.timeSec >= timing.elapsedSec + minimumEntryLeadSec,
    );
    if (!firstUsableBeat) {
      const plan = this._createPlanForChunk(
        timing,
        chunk,
        timeline,
        chunkBeats,
      );
      return {
        status: "skipped",
        diagnostic: this._createChunkDiagnosticFromPlan({
          chunk,
          status: "skipped",
          skipReason: "no_usable_beats",
          plan,
          beatCount: chunkBeats.length,
        }),
      };
    }

    const earliestStartSec = firstUsableBeat.timeSec - gestureEntrySec;
    if (timing.elapsedSec + EPSILON < earliestStartSec) {
      return { status: "waiting" };
    }

    const selectedSide: TalkingHandsSpeechSelectedSide = chunk.isExclamation
      ? "both"
      : run.ordinarySide;
    if (
      !chunk.isExclamation &&
      Math.random() <
        THREE.MathUtils.clamp(this._params.speechChunkSkipChance, 0, 1)
    ) {
      return {
        status: "skipped",
        diagnostic: this._createSkippedChunkDiagnostic(
          chunk,
          "random_skip",
          chunkBeats,
          selectedSide,
        ),
      };
    }

    const plan = this._createPlanForChunk(
      timing,
      chunk,
      timeline,
      chunkBeats,
      selectedSide,
    );
    if (plan.status !== "ready") {
      return {
        status: "skipped",
        diagnostic: this._createChunkDiagnosticFromPlan({
          chunk,
          status: "skipped",
          skipReason:
            plan.reason === "no_usable_beats"
              ? "no_usable_beats"
              : "planner_skipped",
          plan,
          selectedSide,
          beatCount: chunkBeats.length,
        }),
      };
    }

    return {
      status: "ready",
      plan,
      selectedSide,
      diagnostic: this._createChunkDiagnosticFromPlan({
        chunk,
        status: "played",
        plan,
        selectedSide,
        beatCount: chunkBeats.length,
      }),
    };
  }

  private _createPlanForChunk(
    timing: ResolvedSpeechTiming,
    chunk: TtsChunkRecord,
    timeline: SpeechGestureTimeline,
    beats: readonly SpeechGestureBeat[],
    selectedSide: TalkingHandsSpeechSelectedSide | null = null,
  ): TalkingHandsSpeechPlan {
    const window = resolveChunkWindow(timeline, chunk, beats);
    return createTalkingHandsSpeechPlan({
      runId: timing.runId,
      elapsedSec: timing.elapsedSec,
      utteranceDurationSec: timing.utteranceDurationSec,
      scope: "chunk",
      windowEndSec: window?.endSec ?? timing.utteranceDurationSec,
      selectedSide,
      remainingSec: timing.remainingSec,
      beats,
      params: this._params,
    });
  }

  private _getChunkBeats(
    timeline: SpeechGestureTimeline,
    chunk: TtsChunkRecord,
  ): SpeechGestureBeat[] {
    return timeline.beats.filter(
      (beat) =>
        beat.wordIndex >= chunk.wordStartIndex &&
        beat.wordIndex < chunk.wordEndIndex,
    );
  }

  private _createSkippedChunkDiagnostic(
    chunk: TtsChunkRecord,
    skipReason: TalkingHandsSpeechChunkSkipReason,
    beats: readonly SpeechGestureBeat[],
    selectedSide?: TalkingHandsSpeechSelectedSide,
  ): TalkingHandsSpeechChunkDiagnostic {
    return {
      ...createBaseChunkDiagnostic(chunk),
      status: "skipped",
      skipReason,
      selectedSide,
      beatCount: beats.length,
      selectedBeats: [],
      skippedBeats: [],
      pulseApexes: [],
    };
  }

  private _createChunkDiagnosticFromPlan({
    chunk,
    status,
    skipReason,
    plan,
    selectedSide,
    beatCount,
  }: {
    chunk: TtsChunkRecord;
    status: "played" | "skipped";
    skipReason?: TalkingHandsSpeechChunkSkipReason;
    plan: TalkingHandsSpeechPlan;
    selectedSide?: TalkingHandsSpeechSelectedSide | null;
    beatCount: number;
  }): TalkingHandsSpeechChunkDiagnostic {
    return {
      ...createBaseChunkDiagnostic(chunk),
      status,
      skipReason,
      selectedSide: selectedSide ?? undefined,
      beatCount,
      selectedBeats: plan.diagnostics.selectedBeats,
      skippedBeats: plan.diagnostics.skippedBeats,
      pulseApexes: plan.diagnostics.pulseApexes,
    };
  }

  private _getSpeechChunkDiagnostics(): TalkingHandsSpeechChunkDiagnostic[] {
    return Array.from(
      this._speechRunScheduler?.chunkDiagnostics.values() ?? [],
    ).sort((left, right) => left.index - right.index);
  }

  private _resolveGroupTargetDurationSec(): number {
    const speed = Math.max(0.05, this._params.speed);
    return Math.max(
      TALKING_HANDS_MIN_GROUP_DURATION_SEC,
      this._params.gestureDurationSec / speed,
    );
  }

  private _playDebugGroup(durationSec: number | null): boolean {
    const resolvedDurationSec = sanitizePositiveDuration(
      durationSec,
      this._resolveGroupTargetDurationSec(),
    );
    return this._playSegments(this._buildGestureGroup(resolvedDurationSec));
  }

  private _playSpeechGroup(
    request: Extract<TalkingHandsPlayGroupRequest, { source: "speech" }>,
  ): boolean {
    const elapsedSec = Math.max(0, request.elapsedSec);
    const durationSec = Math.max(0, request.durationSec);
    const plan = createTalkingHandsSpeechPlan({
      runId: request.runId,
      elapsedSec,
      utteranceDurationSec: durationSec,
      scope: request.scope,
      windowEndSec: request.windowEndSec,
      selectedSide: request.selectedSide,
      remainingSec: Math.max(0, durationSec - elapsedSec),
      beats: request.beats,
      params: this._params,
    });
    this._recordSpeechPlanDebug(plan);
    if (plan.status !== "ready") return false;
    return this._playSpeechPlan(plan, request.selectedSide ?? null);
  }

  private _recordSpeechPlanDebug(plan: TalkingHandsSpeechPlan): void {
    this._lastSpeechPlanDebug = createTalkingHandsSpeechPlanDebugSnapshot(
      plan,
      this._getSpeechChunkDiagnostics(),
    );
  }

  private _refreshSpeechPlanDebugChunks(): void {
    if (!this._lastSpeechPlanDebug) return;
    this._lastSpeechPlanDebug = {
      ...this._lastSpeechPlanDebug,
      chunks: this._getSpeechChunkDiagnostics(),
    };
  }

  private _ensureSpeechPlanDebugForSkippedChunk(
    timing: ResolvedSpeechTiming,
  ): void {
    if (this._lastSpeechPlanDebug?.diagnostics.runId === timing.runId) {
      this._refreshSpeechPlanDebugChunks();
      return;
    }

    const plan = createTalkingHandsSpeechPlan({
      runId: timing.runId,
      elapsedSec: timing.elapsedSec,
      utteranceDurationSec: timing.utteranceDurationSec,
      scope: "chunk",
      windowEndSec: timing.utteranceDurationSec,
      remainingSec: timing.remainingSec,
      beats: [],
      params: this._params,
    });
    this._recordSpeechPlanDebug(plan);
  }

  private _playSpeechPlan(
    plan: TalkingHandsSpeechPlanReady,
    selectedSide?: TalkingHandsSpeechSelectedSide | null,
  ): boolean {
    return this._playSegments(
      this._buildSpeechGestureGroup(plan, selectedSide),
    );
  }

  private _playSegments(segments: TalkingHandsGestureSegment[]): boolean {
    if (!segments.length) {
      this._clearPlaybackState();
      return false;
    }

    this._segments = segments;
    this._segmentIndex = 0;
    this._segmentElapsedSec = 0;
    this._currentGesturePose = { ...NEUTRAL_GESTURE_POSE };
    this._state = "playback";
    return true;
  }

  private _buildSpeechGestureGroup(
    plan: TalkingHandsSpeechPlanReady,
    selectedSide?: TalkingHandsSpeechSelectedSide | null,
  ): TalkingHandsGestureSegment[] {
    if (plan.segments.length === 0 || this._params.speed <= 0) return [];

    const [elbowMin, elbowMax] = sortedPair(
      this._params.elbowBendMin,
      this._params.elbowBendMax,
    );
    const sideDrift = this._createSideDrift();
    const shoulderForward = this._createShoulderForward();
    const palmDirection = this._createPalmDirection();
    const elbowBend = randomRange(elbowMin, elbowMax);
    const mode = selectedSide ?? this._pickGestureMode();
    const activeSides: Side[] =
      mode === "both"
        ? ["left", "right"]
        : [mode === "left" || mode === "right" ? mode : randomSide()];
    const restFingerCurlJitter = this._createRestFingerCurlJitter(activeSides);
    const elbowBends = this._createElbowBends(
      activeSides,
      elbowBend,
      elbowMin,
      elbowMax,
    );
    const gesturePose = createGesturePose(
      activeSides,
      elbowBends,
      sideDrift,
      shoulderForward,
      palmDirection,
      restFingerCurlJitter,
    );

    const segments: TalkingHandsGestureSegment[] = [];
    let previousPose: TalkingHandsGesturePoseDeg = {
      ...NEUTRAL_GESTURE_POSE,
    };

    const addSegment = (
      to: TalkingHandsGesturePoseDeg,
      duration: number,
    ): void => {
      if (duration < MIN_SEGMENT_DURATION_SEC) {
        previousPose = { ...to };
        return;
      }
      const segment: TalkingHandsGestureSegment = {
        from: { ...previousPose },
        to: { ...to },
        durationSec: duration,
      };
      segments.push(segment);
      previousPose = { ...to };
    };

    plan.segments.forEach((segment) => {
      addSegment(
        this._resolveSpeechPlanPose(segment, gesturePose, activeSides),
        segment.durationSec,
      );
    });
    return segments;
  }

  private _resolveSpeechPlanPose(
    segment: TalkingHandsSpeechPlanSegment,
    gesturePose: TalkingHandsGesturePoseDeg,
    activeSides: readonly Side[],
  ): TalkingHandsGesturePoseDeg {
    if (segment.kind === "neutral") return { ...NEUTRAL_GESTURE_POSE };
    if (segment.kind === "base") return gesturePose;

    const pulseScale = segment.pulseScale;
    return offsetGesturePose(
      gesturePose,
      activeSides,
      this._params.microBendAmount * pulseScale,
      scaleFingerValuesBySide(
        this._createMicroFingerUncurl(activeSides),
        pulseScale,
      ),
      scaleNumberBySide(this._createMicroThumbUncurl(activeSides), pulseScale),
      this._params.microThumbUnspreadAmount * pulseScale,
      this._createMicroHandFlex() * pulseScale,
      this._params.microHeadNodAmount * pulseScale,
      this._params.microTwistAmount * pulseScale,
      this._createSecondaryMicroTwist() * pulseScale,
    );
  }

  private _buildGestureGroup(
    durationSec: number,
  ): TalkingHandsGestureSegment[] {
    const [elbowMin, elbowMax] = sortedPair(
      this._params.elbowBendMin,
      this._params.elbowBendMax,
    );
    if (this._params.speed <= 0) return [];

    const sideDrift = this._createSideDrift();
    const shoulderForward = this._createShoulderForward();
    const palmDirection = this._createPalmDirection();
    const elbowBend = randomRange(elbowMin, elbowMax);
    const microCount = Math.max(0, Math.round(this._params.microBendCount));
    const mode = this._pickGestureMode();
    const segments: TalkingHandsGestureSegment[] = [];
    let previousPose: TalkingHandsGesturePoseDeg = {
      ...NEUTRAL_GESTURE_POSE,
    };

    const addSegment = (
      to: TalkingHandsGesturePoseDeg,
      duration: number,
    ): void => {
      const segment: TalkingHandsGestureSegment = {
        from: { ...previousPose },
        to: { ...to },
        durationSec: Math.max(MIN_SEGMENT_DURATION_SEC, duration),
      };
      segments.push(segment);
      previousPose = { ...to };
    };

    const activeSides: Side[] =
      mode === "both" ? ["left", "right"] : [randomSide()];
    const restFingerCurlJitter = this._createRestFingerCurlJitter(activeSides);
    const elbowBends = this._createElbowBends(
      activeSides,
      elbowBend,
      elbowMin,
      elbowMax,
    );
    const gesturePose = createGesturePose(
      activeSides,
      elbowBends,
      sideDrift,
      shoulderForward,
      palmDirection,
      restFingerCurlJitter,
    );
    const strokeDurationSec = durationSec * 0.28;
    const returnDurationSec = durationSec * 0.28;
    const middleDurationSec = Math.max(
      MIN_SEGMENT_DURATION_SEC,
      durationSec - strokeDurationSec - returnDurationSec,
    );
    let firstMicroSettleDurationSec = 0;

    const hasMicroMotion = this._hasMicroMotion(microCount);
    if (hasMicroMotion) {
      const firstPulsePose = offsetGesturePose(
        gesturePose,
        activeSides,
        this._params.microBendAmount,
        this._createMicroFingerUncurl(activeSides),
        this._createMicroThumbUncurl(activeSides),
        this._params.microThumbUnspreadAmount,
        this._createMicroHandFlex(),
        this._params.microHeadNodAmount,
        this._params.microTwistAmount,
        this._createSecondaryMicroTwist(),
      );
      firstMicroSettleDurationSec = this._createFirstMicroSettleDuration(
        strokeDurationSec,
        middleDurationSec,
        microCount,
      );

      addSegment(firstPulsePose, strokeDurationSec);
    } else {
      addSegment(gesturePose, strokeDurationSec);
    }
    this._appendMicroSegments({
      addSegment,
      basePose: gesturePose,
      activeSides,
      microCount,
      totalDurationSec: middleDurationSec,
      startsAtPulse: hasMicroMotion,
      firstSettleDurationSec: firstMicroSettleDurationSec,
    });
    addSegment({ ...NEUTRAL_GESTURE_POSE }, returnDurationSec);

    return fitGestureSegmentsToMaxDuration(segments, durationSec);
  }

  private _appendMicroSegments({
    addSegment,
    basePose,
    activeSides,
    microCount,
    totalDurationSec,
    startsAtPulse,
    firstSettleDurationSec,
  }: {
    addSegment: (to: TalkingHandsGesturePoseDeg, durationSec: number) => void;
    basePose: TalkingHandsGesturePoseDeg;
    activeSides: Side[];
    microCount: number;
    totalDurationSec: number;
    startsAtPulse: boolean;
    firstSettleDurationSec: number;
  }): void {
    if (!this._hasMicroMotion(microCount)) {
      addSegment(basePose, totalDurationSec);
      return;
    }

    if (startsAtPulse) {
      const settleDurationSec = THREE.MathUtils.clamp(
        firstSettleDurationSec,
        MIN_SEGMENT_DURATION_SEC,
        Math.max(MIN_SEGMENT_DURATION_SEC, totalDurationSec),
      );
      addSegment(basePose, settleDurationSec);

      const remainingPulseCount = microCount - 1;
      const remainingDurationSec = Math.max(
        0,
        totalDurationSec - settleDurationSec,
      );
      if (remainingPulseCount <= 0) {
        addMicroPauseSegment(addSegment, basePose, remainingDurationSec);
        return;
      }

      const pauseDurations = this._createMicroPauseDurations(
        remainingPulseCount,
        remainingDurationSec,
        remainingPulseCount * 2,
      );
      const pauseDurationTotalSec = pauseDurations.reduce(
        (total, durationSec) => total + durationSec,
        0,
      );
      const stepDurationSec =
        (remainingDurationSec - pauseDurationTotalSec) /
        (remainingPulseCount * 2);
      for (let index = 1; index < microCount; index += 1) {
        addMicroPauseSegment(addSegment, basePose, pauseDurations[index - 1]);
        const pulsePose = offsetGesturePose(
          basePose,
          activeSides,
          this._params.microBendAmount,
          this._createMicroFingerUncurl(activeSides),
          this._createMicroThumbUncurl(activeSides),
          this._params.microThumbUnspreadAmount,
          this._createMicroHandFlex(),
          this._params.microHeadNodAmount,
          this._params.microTwistAmount,
          this._createSecondaryMicroTwist(),
        );
        addSegment(pulsePose, stepDurationSec);
        addSegment(basePose, stepDurationSec);
      }
      return;
    }

    const pauseDurations = this._createMicroPauseDurations(
      microCount - 1,
      totalDurationSec,
      microCount * 2,
    );
    const pauseDurationTotalSec = pauseDurations.reduce(
      (total, durationSec) => total + durationSec,
      0,
    );
    const stepDurationSec =
      (totalDurationSec - pauseDurationTotalSec) / (microCount * 2);
    for (let index = 0; index < microCount; index += 1) {
      const pulsePose = offsetGesturePose(
        basePose,
        activeSides,
        this._params.microBendAmount,
        this._createMicroFingerUncurl(activeSides),
        this._createMicroThumbUncurl(activeSides),
        this._params.microThumbUnspreadAmount,
        this._createMicroHandFlex(),
        this._params.microHeadNodAmount,
        this._params.microTwistAmount,
        this._createSecondaryMicroTwist(),
      );
      addSegment(pulsePose, stepDurationSec);
      addSegment(basePose, stepDurationSec);
      addMicroPauseSegment(addSegment, basePose, pauseDurations[index]);
    }
  }

  private _createFirstMicroSettleDuration(
    strokeDurationSec: number,
    totalDurationSec: number,
    microCount: number,
  ): number {
    const requestedSettleDurationSec =
      strokeDurationSec *
      FIRST_MICRO_SETTLE_STROKE_RATIO *
      Math.max(0.05, this._params.microEntryBlend);
    const remainingPulseCount = Math.max(0, microCount - 1);
    const minimumRemainingDurationSec =
      remainingPulseCount * 2 * MIN_SEGMENT_DURATION_SEC;
    const maxSettleDurationSec = Math.max(
      MIN_SEGMENT_DURATION_SEC,
      totalDurationSec - minimumRemainingDurationSec,
    );

    return THREE.MathUtils.clamp(
      requestedSettleDurationSec,
      MIN_SEGMENT_DURATION_SEC,
      maxSettleDurationSec,
    );
  }

  private _createMicroPauseDurations(
    gapCount: number,
    totalDurationSec: number,
    motionSegmentCount: number,
  ): number[] {
    if (gapCount <= 0 || this._params.microBendPauseChance <= 0) return [];

    const [pauseMinSec, pauseMaxSec] = sortedPair(
      this._params.microBendPauseMinSec,
      this._params.microBendPauseMaxSec,
    );
    if (pauseMaxSec <= 0) return [];

    const pauseDurations = Array.from({ length: gapCount }, () => {
      const durationSec =
        Math.random() < this._params.microBendPauseChance
          ? randomRange(pauseMinSec, pauseMaxSec)
          : 0;
      return durationSec >= MIN_SEGMENT_DURATION_SEC ? durationSec : 0;
    });
    const requestedPauseDurationSec = pauseDurations.reduce(
      (total, durationSec) => total + durationSec,
      0,
    );
    if (requestedPauseDurationSec <= EPSILON) return pauseDurations;

    const maxPauseDurationSec = Math.max(
      0,
      totalDurationSec - motionSegmentCount * MIN_SEGMENT_DURATION_SEC,
    );
    if (maxPauseDurationSec <= EPSILON) return pauseDurations.map(() => 0);
    if (requestedPauseDurationSec <= maxPauseDurationSec) return pauseDurations;

    const scale = maxPauseDurationSec / requestedPauseDurationSec;
    return pauseDurations.map((durationSec) => {
      const scaledDurationSec = durationSec * scale;
      return scaledDurationSec >= MIN_SEGMENT_DURATION_SEC
        ? scaledDurationSec
        : 0;
    });
  }

  private _hasMicroMotion(microCount: number): boolean {
    return (
      microCount > 0 &&
      (this._params.microBendAmount !== 0 ||
        this._params.microFingerUncurlAmount !== 0 ||
        this._params.microThumbUncurlAmount !== 0 ||
        this._params.microThumbUnspreadAmount !== 0 ||
        this._params.microHandFlexAmount !== 0 ||
        this._params.microHeadNodAmount !== 0 ||
        this._params.microTwistAmount !== 0 ||
        this._params.secondaryMicroTwistMin !== 0 ||
        this._params.secondaryMicroTwistMax !== 0)
    );
  }

  private _pickGestureMode(): GestureMode {
    const oneHandChance = THREE.MathUtils.clamp(
      this._params.oneHandChance,
      0,
      1,
    );
    const bothHandsChance = THREE.MathUtils.clamp(
      this._params.bothHandsChance,
      0,
      1,
    );
    const total = oneHandChance + bothHandsChance;

    if (total <= 0) return "both";

    const roll = Math.random() * total;
    if (roll < oneHandChance) return "one";
    return "both";
  }

  private _createSideDrift(): SideDriftBySide {
    const [driftMin, driftMax] = sortedPair(
      this._params.elbowSideDriftMin,
      this._params.elbowSideDriftMax,
    );
    if (Math.abs(driftMin) <= EPSILON && Math.abs(driftMax) <= EPSILON) {
      return {
        left: 0,
        right: 0,
      };
    }

    const signedMagnitude = randomRange(driftMin, driftMax);
    return {
      left: signedMagnitude,
      right: signedMagnitude,
    };
  }

  private _createElbowBends(
    activeSides: readonly Side[],
    elbowBend: number,
    elbowMin: number,
    elbowMax: number,
  ): ElbowBendBySide {
    if (!activeSides.includes("left") || !activeSides.includes("right")) {
      return {
        left: activeSides.includes("left") ? elbowBend : 0,
        right: activeSides.includes("right") ? elbowBend : 0,
      };
    }

    const maxDifference = Math.max(0, this._params.elbowBendAsymmetry);
    if (maxDifference <= EPSILON) {
      return {
        left: elbowBend,
        right: elbowBend,
      };
    }

    const signedDifference = randomRange(-maxDifference, maxDifference);
    const halfDifference = signedDifference / 2;
    return {
      left: THREE.MathUtils.clamp(
        elbowBend + halfDifference,
        elbowMin,
        elbowMax,
      ),
      right: THREE.MathUtils.clamp(
        elbowBend - halfDifference,
        elbowMin,
        elbowMax,
      ),
    };
  }

  private _createShoulderForward(): number {
    const maxForward = Math.abs(this._params.shoulderForward);
    if (maxForward <= 0) return 0;

    return randomRange(0, maxForward) * Math.sign(this._params.shoulderForward);
  }

  private _createPalmDirection(): number {
    const range = Math.max(0, this._params.palmDirectionRange);
    if (range <= EPSILON) return 0;

    return randomRange(-range, range);
  }

  private _createSecondaryMicroTwist(): number {
    const [twistMin, twistMax] = sortedPair(
      this._params.secondaryMicroTwistMin,
      this._params.secondaryMicroTwistMax,
    );
    if (Math.abs(twistMin) <= EPSILON && Math.abs(twistMax) <= EPSILON) {
      return 0;
    }

    return randomRange(twistMin, twistMax);
  }

  private _createRestFingerCurlJitter(
    activeSides: readonly Side[],
  ): FingerValuesDegBySide {
    const amount = Math.max(0, this._params.restFingerCurlJitter);
    if (amount <= EPSILON) return createFingerValuesBySide();

    return mapActiveSidesToFingerValues(activeSides, () =>
      randomRange(-amount, amount),
    );
  }

  private _createMicroFingerUncurl(
    activeSides: readonly Side[],
  ): FingerValuesDegBySide {
    const amount = this._params.microFingerUncurlAmount;
    if (Math.abs(amount) <= EPSILON) return createFingerValuesBySide();

    return mapActiveSidesToFingerValues(
      activeSides,
      () =>
        amount *
        randomRange(
          1 - this._params.microFingerUncurlVariance,
          1 + this._params.microFingerUncurlVariance,
        ),
    );
  }

  private _createMicroThumbUncurl(activeSides: readonly Side[]): NumberBySide {
    const amount =
      this._params.microFingerUncurlAmount +
      this._params.microThumbUncurlAmount;
    if (Math.abs(amount) <= EPSILON) return createNumberBySide();

    return mapActiveSidesToNumbers(
      activeSides,
      () =>
        amount *
        randomRange(
          1 - this._params.microThumbUncurlVariance,
          1 + this._params.microThumbUncurlVariance,
        ),
    );
  }

  private _createMicroHandFlex(): number {
    const maxFlex = this._params.microHandFlexAmount;
    if (Math.abs(maxFlex) <= EPSILON) return 0;

    return maxFlex > 0 ? randomRange(0, maxFlex) : randomRange(maxFlex, 0);
  }

  private _advancePlayback(deltaSec: number): void {
    let remainingSec = Math.max(0, deltaSec);

    while (this._state === "playback") {
      const segment = this._segments[this._segmentIndex];
      if (!segment) {
        this._finishGroup();
        return;
      }

      const durationSec = Math.max(EPSILON, segment.durationSec);
      const timeLeftSec = durationSec - this._segmentElapsedSec;
      const stepSec = Math.min(remainingSec, Math.max(0, timeLeftSec));
      this._segmentElapsedSec += stepSec;
      remainingSec -= stepSec;

      const t = THREE.MathUtils.clamp(
        this._segmentElapsedSec / durationSec,
        0,
        1,
      );
      this._currentGesturePose = interpolateGesturePose(
        segment.from,
        segment.to,
        smootherstep(t),
      );

      if (this._segmentElapsedSec < durationSec - EPSILON) {
        return;
      }

      this._currentGesturePose = { ...segment.to };
      this._segmentIndex += 1;
      this._segmentElapsedSec = 0;

      if (remainingSec <= EPSILON) {
        return;
      }
    }
  }

  private _advanceRenderedPose(deltaSec: number): void {
    const steps: TalkingHandsLagSteps = {
      arm: dampStep(deltaSec, this._params.armLagSec),
      palm: dampStep(deltaSec, this._params.palmLagSec),
      finger: dampStep(deltaSec, this._params.fingerLagSec),
    };

    this._renderedGesturePose = dampGesturePose(
      this._renderedGesturePose,
      this._currentGesturePose,
      steps,
    );
  }

  private _finishGroup(): void {
    this._clearPlaybackState();
  }

  private _clearPlaybackState(): void {
    this._state = "pause";
    this._segments = [];
    this._segmentIndex = 0;
    this._segmentElapsedSec = 0;
    this._currentGesturePose = { ...NEUTRAL_GESTURE_POSE };
  }

  private _resetRenderedPose(): void {
    this._renderedGesturePose = { ...NEUTRAL_GESTURE_POSE };
    this._offsetScratchByBone.clear();
  }

  private _applyPose(
    gesturePose: TalkingHandsGesturePoseDeg,
    gestureIntensity: number,
    deltaSec: number,
  ): void {
    this._applyMicroHeadNodPose(gesturePose.microHeadNod, gestureIntensity);
    this._applySidePose(
      "left",
      gesturePose.leftElbowBend,
      gesturePose.leftElbowSide,
      gesturePose.leftShoulderForward,
      gesturePose.leftPalmDirection,
      gesturePose.leftMicroTwist,
      gesturePose.leftSecondaryMicroTwist,
      gesturePose.leftMicroFingerUncurl,
      gesturePose.leftMicroThumbUncurl,
      gesturePose.leftMicroThumbUnspread,
      gesturePose.leftMicroHandFlex,
      gesturePose.leftRestCurlWeight,
      gesturePose.leftRestFingerCurlJitter,
      gestureIntensity,
      deltaSec,
    );
    this._applySidePose(
      "right",
      gesturePose.rightElbowBend,
      gesturePose.rightElbowSide,
      gesturePose.rightShoulderForward,
      gesturePose.rightPalmDirection,
      gesturePose.rightMicroTwist,
      gesturePose.rightSecondaryMicroTwist,
      gesturePose.rightMicroFingerUncurl,
      gesturePose.rightMicroThumbUncurl,
      gesturePose.rightMicroThumbUnspread,
      gesturePose.rightMicroHandFlex,
      gesturePose.rightRestCurlWeight,
      gesturePose.rightRestFingerCurlJitter,
      gestureIntensity,
      deltaSec,
    );
  }

  private _applySidePose(
    side: Side,
    gestureElbowBendDeg: number,
    gestureElbowSideDeg: number,
    gestureShoulderForwardDeg: number,
    gesturePalmDirectionDeg: number,
    gestureMicroTwistDeg: number,
    gestureSecondaryMicroTwistDeg: number,
    gestureMicroFingerUncurlDeg: FingerValuesDeg,
    gestureMicroThumbUncurlDeg: number,
    gestureMicroThumbUnspreadDeg: number,
    gestureMicroHandFlexDeg: number,
    gestureRestCurlWeight: number,
    gestureRestFingerCurlJitterDeg: FingerValuesDeg,
    gestureIntensity: number,
    deltaSec: number,
  ): void {
    const sideSign = side === "left" ? 1 : -1;
    const mirrorSign = side === "left" ? -1 : 1;
    const sideMultiplier =
      side === "left" ? 1 + this._params.asymmetry : 1 - this._params.asymmetry;
    const gestureSideIntensity = gestureIntensity * sideMultiplier;
    const gestureElbowBend =
      gestureElbowBendDeg * DEG_TO_RAD * gestureSideIntensity;
    const elbowBend = -gestureElbowBend * sideSign;
    const elbowSideDrift =
      gestureElbowSideDeg * DEG_TO_RAD * gestureIntensity * mirrorSign;
    const bendMagnitude = Math.abs(gestureElbowBendDeg);
    const shoulderBeatT = THREE.MathUtils.clamp(bendMagnitude / 120, 0, 1);
    const shoulderBeat =
      this._params.shoulderBeat *
      DEG_TO_RAD *
      gestureSideIntensity *
      shoulderBeatT *
      mirrorSign;
    const shoulderForward =
      gestureShoulderForwardDeg * DEG_TO_RAD * gestureSideIntensity;
    const palmDirection =
      gesturePalmDirectionDeg *
      DEG_TO_RAD *
      gestureSideIntensity *
      (side === "left" ? -1 : 1);
    const microTwistSign = side === "left" ? -1 : 1;
    const microTwist =
      gestureMicroTwistDeg * DEG_TO_RAD * gestureSideIntensity * microTwistSign;
    const lowerArmMicroTwist =
      this._params.microTwistMode === "handOnly" ? 0 : microTwist;
    const handMicroTwist = resolveHandMicroTwist(
      microTwist,
      this._params.microTwistMode,
    );
    const secondaryMicroTwistSign = side === "left" ? -1 : 1;
    const secondaryMicroTwist =
      gestureSecondaryMicroTwistDeg *
      DEG_TO_RAD *
      gestureSideIntensity *
      secondaryMicroTwistSign;
    const secondaryMicroTwistAxis = this._params.secondaryMicroTwistAxis;
    const microFingerUncurlScale =
      DEG_TO_RAD * gestureSideIntensity * -mirrorSign;
    const microThumbUncurl =
      gestureMicroThumbUncurlDeg *
      DEG_TO_RAD *
      gestureSideIntensity *
      -mirrorSign;
    const linkedThumbSpreadRelease =
      averageFingerValues(gestureMicroFingerUncurlDeg) *
      DEG_TO_RAD *
      gestureSideIntensity *
      -sideSign;
    const microThumbUnspread =
      gestureMicroThumbUnspreadDeg *
      DEG_TO_RAD *
      gestureSideIntensity *
      sideSign;
    const microHandFlex =
      gestureMicroHandFlexDeg * DEG_TO_RAD * gestureSideIntensity * mirrorSign;
    const restFingerCurlScale =
      DEG_TO_RAD * gestureSideIntensity * mirrorSign * gestureRestCurlWeight;
    const restThumbSpread =
      this._params.restThumbSpreadOffset *
      DEG_TO_RAD *
      gestureSideIntensity *
      -sideSign *
      gestureRestCurlWeight;

    this._applyOffset(`${side}Shoulder`, 0, 0, shoulderBeat * 0.35);
    this._applyOffset(`${side}UpperArm`, shoulderForward, 0, 0);
    this._applyForearmOffset(
      side,
      `${side}LowerArm`,
      axisComponent(secondaryMicroTwistAxis, "x", secondaryMicroTwist),
      elbowBend +
        axisComponent(secondaryMicroTwistAxis, "y", secondaryMicroTwist),
      elbowSideDrift +
        axisComponent(secondaryMicroTwistAxis, "z", secondaryMicroTwist),
      lowerArmMicroTwist + palmDirection,
    );
    this._applyForearmOffset(
      side,
      `${side}Hand`,
      0,
      0,
      microHandFlex,
      handMicroTwist + palmDirection * MICRO_TWIST_HAND_FOLLOW,
    );
    this._applyFingerPose(
      side,
      restFingerCurlScale,
      gestureRestFingerCurlJitterDeg,
      gestureMicroFingerUncurlDeg,
      microFingerUncurlScale,
      restThumbSpread,
      microThumbUncurl,
      linkedThumbSpreadRelease,
      microThumbUnspread,
      deltaSec,
    );
  }

  private _applyMicroHeadNodPose(
    microHeadNodDeg: number,
    gestureIntensity: number,
  ): void {
    if (Math.abs(microHeadNodDeg) <= EPSILON) return;

    const pitch = -microHeadNodDeg * DEG_TO_RAD * gestureIntensity;

    this._applyOffset("spine", pitch * 0.006, 0, 0);
    this._applyOffset("chest", pitch * 0.012, 0, 0);
    this._applyOffset("upperChest", pitch * 0.024, 0, 0);
    this._applyOffset("neck", pitch * 0.45, 0, 0);
    this._applyOffset("head", pitch, 0, 0);
  }

  private _applyFingerPose(
    side: Side,
    restFingerCurlScale: number,
    restFingerCurlJitterDeg: FingerValuesDeg,
    microFingerUncurlDeg: FingerValuesDeg,
    microFingerUncurlScale: number,
    restThumbSpread: number,
    microThumbUncurl: number,
    linkedThumbSpreadRelease: number,
    microThumbUnspread: number,
    deltaSec: number,
  ): void {
    const boneLagSec = this._params.fingerLagSec * FINGER_BONE_LAG_RATIO;

    for (const target of FINGER_PROXIMAL_CURL_TARGETS) {
      const boneName = target[side];
      const restFingerCurl =
        getRestFingerCurlOffset(this._params, target.finger) +
        getFingerValue(restFingerCurlJitterDeg, target.finger);
      const microFingerUncurl =
        getFingerValue(microFingerUncurlDeg, target.finger) *
        microFingerUncurlScale;
      const fingerCascadeLag = resolveFingerCascadeLag(
        this._params.fingerCascadeLag,
        target.finger,
      );
      this._applyOffset(
        boneName,
        0,
        0,
        restFingerCurl * restFingerCurlScale * target.multiplier +
          microFingerUncurl * (target.microCurlMultiplier ?? 0),
        boneLagSec * 0.65 * fingerCascadeLag,
        deltaSec,
      );
    }

    for (const target of FINGER_INTERMEDIATE_CURL_TARGETS) {
      const boneName = target[side];
      const restFingerCurl =
        getRestFingerCurlOffset(this._params, target.finger) +
        getFingerValue(restFingerCurlJitterDeg, target.finger);
      const microFingerUncurl =
        getFingerValue(microFingerUncurlDeg, target.finger) *
        microFingerUncurlScale;
      const fingerCascadeLag = resolveFingerCascadeLag(
        this._params.fingerCascadeLag,
        target.finger,
      );
      this._applyOffset(
        boneName,
        0,
        0,
        restFingerCurl * restFingerCurlScale * target.multiplier +
          microFingerUncurl * (target.microCurlMultiplier ?? 0),
        boneLagSec * fingerCascadeLag,
        deltaSec,
      );
    }

    for (const target of FINGER_DISTAL_CURL_TARGETS) {
      const boneName = target[side];
      const restFingerCurl =
        getRestFingerCurlOffset(this._params, target.finger) +
        getFingerValue(restFingerCurlJitterDeg, target.finger);
      const microFingerUncurl =
        getFingerValue(microFingerUncurlDeg, target.finger) *
        microFingerUncurlScale;
      const fingerCascadeLag = resolveFingerCascadeLag(
        this._params.fingerCascadeLag,
        target.finger,
      );
      this._applyOffset(
        boneName,
        0,
        0,
        restFingerCurl * restFingerCurlScale * target.multiplier +
          microFingerUncurl * (target.microCurlMultiplier ?? 0),
        boneLagSec * 1.25 * fingerCascadeLag,
        deltaSec,
      );
    }

    for (const target of THUMB_BASE_CURL_TARGETS) {
      const boneName = target[side];
      const restThumbCurl =
        (this._params.restThumbCurlOffset * target.multiplier +
          this._params.restThumbMetacarpalCurlOffset) *
        restFingerCurlScale;
      const thumbMicroCurl =
        microThumbUncurl * (target.microCurlMultiplier ?? 0);
      const thumbSpread =
        restThumbSpread * (target.unspreadMultiplier ?? 0) +
        (linkedThumbSpreadRelease + microThumbUnspread) *
          (target.microUnspreadMultiplier ?? 0);
      this._applyOffset(
        boneName,
        0,
        thumbSpread,
        restThumbCurl + thumbMicroCurl,
        boneLagSec * 0.75,
        deltaSec,
      );
    }

    for (const target of THUMB_INTERMEDIATE_CURL_TARGETS) {
      const boneName = target[side];
      const restThumbCurl =
        (this._params.restThumbCurlOffset * target.multiplier +
          this._params.restThumbProximalCurlOffset) *
        restFingerCurlScale;
      const thumbMicroCurl =
        microThumbUncurl * (target.microCurlMultiplier ?? 0);
      this._applyOffset(
        boneName,
        0,
        0,
        restThumbCurl + thumbMicroCurl,
        boneLagSec,
        deltaSec,
      );
    }

    for (const target of THUMB_DISTAL_CURL_TARGETS) {
      const boneName = target[side];
      const restThumbCurl =
        (this._params.restThumbCurlOffset * target.multiplier +
          this._params.restThumbDistalCurlOffset) *
        restFingerCurlScale;
      const thumbMicroCurl =
        microThumbUncurl * (target.microCurlMultiplier ?? 0);
      this._applyOffset(
        boneName,
        0,
        0,
        restThumbCurl + thumbMicroCurl,
        boneLagSec * 1.2,
        deltaSec,
      );
    }
  }

  private _applyOffset(
    boneName: TalkingHandsBoneName,
    x: number,
    y: number,
    z: number,
    lagSec = 0,
    deltaSec = 0,
  ): void {
    this._applyOffsetWithAxisAngle(
      boneName,
      x,
      y,
      z,
      null,
      0,
      lagSec,
      deltaSec,
    );
  }

  private _applyForearmOffset(
    side: Side,
    boneName: TalkingHandsBoneName,
    x: number,
    y: number,
    z: number,
    twistAngle: number,
    lagSec = 0,
    deltaSec = 0,
  ): void {
    const rollAxis =
      Math.abs(twistAngle) > EPSILON
        ? this._resolveForearmRollAxis(side, boneName)
        : null;
    this._applyOffsetWithAxisAngle(
      boneName,
      x,
      y,
      z,
      rollAxis,
      twistAngle,
      lagSec,
      deltaSec,
    );
  }

  private _applyOffsetWithAxisAngle(
    boneName: TalkingHandsBoneName,
    x: number,
    y: number,
    z: number,
    axis: THREE.Vector3 | null,
    angle: number,
    lagSec: number,
    deltaSec: number,
  ): void {
    const bone = this._bones.get(boneName);
    if (!bone) return;

    this._scratchEuler.set(x, y, z, "XYZ");
    this._scratchOffset.setFromEuler(this._scratchEuler);
    if (axis && Math.abs(angle) > EPSILON) {
      this._scratchTwistOffset.setFromAxisAngle(axis, angle);
      this._scratchOffset.multiply(this._scratchTwistOffset);
    }

    const offset = this._getOffsetScratch(boneName);
    if (lagSec > EPSILON) {
      offset.slerp(this._scratchOffset, dampStep(deltaSec, lagSec));
    } else {
      offset.copy(this._scratchOffset);
    }
    bone.quaternion.multiply(offset);
    this._lastOffsets.set(boneName, offset);
  }

  private _resolveForearmRollAxis(
    side: Side,
    targetBoneName: TalkingHandsBoneName,
  ): THREE.Vector3 | null {
    const lowerArm = this._bones.get(`${side}LowerArm`);
    const hand = this._bones.get(`${side}Hand`);
    const targetBone = this._bones.get(targetBoneName);
    if (!lowerArm || !hand || !targetBone) return null;

    lowerArm.getWorldPosition(this._scratchLowerArmWorldPosition);
    hand.getWorldPosition(this._scratchHandWorldPosition);
    this._scratchRollAxis.subVectors(
      this._scratchHandWorldPosition,
      this._scratchLowerArmWorldPosition,
    );
    if (this._scratchRollAxis.lengthSq() <= ROLL_AXIS_EPSILON) {
      return null;
    }

    this._scratchRollAxis.normalize();
    targetBone.getWorldQuaternion(this._scratchTargetWorldQuaternion);
    this._scratchInverseTargetWorldQuaternion
      .copy(this._scratchTargetWorldQuaternion)
      .invert();
    this._scratchRollAxis
      .applyQuaternion(this._scratchInverseTargetWorldQuaternion)
      .normalize();
    return this._scratchRollAxis;
  }

  private _getOffsetScratch(boneName: TalkingHandsBoneName): THREE.Quaternion {
    const existing = this._offsetScratchByBone.get(boneName);
    if (existing) return existing;

    const offset = new THREE.Quaternion();
    this._offsetScratchByBone.set(boneName, offset);
    return offset;
  }
}

function createGesturePose(
  activeSides: readonly Side[],
  elbowBends: ElbowBendBySide,
  sideDrift: SideDriftBySide,
  shoulderForward: number,
  palmDirection: number,
  restFingerCurlJitter: FingerValuesDegBySide,
): TalkingHandsGesturePoseDeg {
  return {
    leftElbowBend: activeSides.includes("left") ? elbowBends.left : 0,
    leftElbowSide: activeSides.includes("left") ? sideDrift.left : 0,
    leftShoulderForward: activeSides.includes("left") ? shoulderForward : 0,
    leftPalmDirection: activeSides.includes("left") ? palmDirection : 0,
    leftMicroTwist: 0,
    leftSecondaryMicroTwist: 0,
    leftMicroFingerUncurl: ZERO_FINGER_VALUES,
    leftMicroThumbUncurl: 0,
    leftMicroThumbUnspread: 0,
    leftMicroHandFlex: 0,
    leftRestCurlWeight: activeSides.includes("left") ? 1 : 0,
    leftRestFingerCurlJitter: activeSides.includes("left")
      ? restFingerCurlJitter.left
      : ZERO_FINGER_VALUES,
    microHeadNod: 0,
    rightElbowBend: activeSides.includes("right") ? elbowBends.right : 0,
    rightElbowSide: activeSides.includes("right") ? sideDrift.right : 0,
    rightShoulderForward: activeSides.includes("right") ? shoulderForward : 0,
    rightPalmDirection: activeSides.includes("right") ? palmDirection : 0,
    rightMicroTwist: 0,
    rightSecondaryMicroTwist: 0,
    rightMicroFingerUncurl: ZERO_FINGER_VALUES,
    rightMicroThumbUncurl: 0,
    rightMicroThumbUnspread: 0,
    rightMicroHandFlex: 0,
    rightRestCurlWeight: activeSides.includes("right") ? 1 : 0,
    rightRestFingerCurlJitter: activeSides.includes("right")
      ? restFingerCurlJitter.right
      : ZERO_FINGER_VALUES,
  };
}

function offsetGesturePose(
  pose: TalkingHandsGesturePoseDeg,
  activeSides: readonly Side[],
  elbowBendOffset: number,
  microFingerUncurlOffset: FingerValuesDegBySide,
  microThumbUncurlOffset: NumberBySide,
  microThumbUnspreadOffset: number,
  microHandFlexOffset: number,
  microHeadNodOffset: number,
  microTwistOffset: number,
  secondaryMicroTwistOffset: number,
): TalkingHandsGesturePoseDeg {
  return {
    leftElbowBend: activeSides.includes("left")
      ? pose.leftElbowBend + elbowBendOffset
      : pose.leftElbowBend,
    leftElbowSide: pose.leftElbowSide,
    leftShoulderForward: pose.leftShoulderForward,
    leftPalmDirection: pose.leftPalmDirection,
    leftMicroTwist: activeSides.includes("left")
      ? pose.leftMicroTwist + microTwistOffset
      : pose.leftMicroTwist,
    leftSecondaryMicroTwist: activeSides.includes("left")
      ? pose.leftSecondaryMicroTwist + secondaryMicroTwistOffset
      : pose.leftSecondaryMicroTwist,
    leftMicroFingerUncurl: activeSides.includes("left")
      ? addFingerValues(
          pose.leftMicroFingerUncurl,
          microFingerUncurlOffset.left,
        )
      : pose.leftMicroFingerUncurl,
    leftMicroThumbUncurl: activeSides.includes("left")
      ? pose.leftMicroThumbUncurl + microThumbUncurlOffset.left
      : pose.leftMicroThumbUncurl,
    leftMicroThumbUnspread: activeSides.includes("left")
      ? pose.leftMicroThumbUnspread + microThumbUnspreadOffset
      : pose.leftMicroThumbUnspread,
    leftMicroHandFlex: activeSides.includes("left")
      ? pose.leftMicroHandFlex + microHandFlexOffset
      : pose.leftMicroHandFlex,
    leftRestCurlWeight: pose.leftRestCurlWeight,
    leftRestFingerCurlJitter: pose.leftRestFingerCurlJitter,
    microHeadNod:
      activeSides.length > 0
        ? pose.microHeadNod + microHeadNodOffset
        : pose.microHeadNod,
    rightElbowBend: activeSides.includes("right")
      ? pose.rightElbowBend + elbowBendOffset
      : pose.rightElbowBend,
    rightElbowSide: pose.rightElbowSide,
    rightShoulderForward: pose.rightShoulderForward,
    rightPalmDirection: pose.rightPalmDirection,
    rightMicroTwist: activeSides.includes("right")
      ? pose.rightMicroTwist + microTwistOffset
      : pose.rightMicroTwist,
    rightSecondaryMicroTwist: activeSides.includes("right")
      ? pose.rightSecondaryMicroTwist + secondaryMicroTwistOffset
      : pose.rightSecondaryMicroTwist,
    rightMicroFingerUncurl: activeSides.includes("right")
      ? addFingerValues(
          pose.rightMicroFingerUncurl,
          microFingerUncurlOffset.right,
        )
      : pose.rightMicroFingerUncurl,
    rightMicroThumbUncurl: activeSides.includes("right")
      ? pose.rightMicroThumbUncurl + microThumbUncurlOffset.right
      : pose.rightMicroThumbUncurl,
    rightMicroThumbUnspread: activeSides.includes("right")
      ? pose.rightMicroThumbUnspread + microThumbUnspreadOffset
      : pose.rightMicroThumbUnspread,
    rightMicroHandFlex: activeSides.includes("right")
      ? pose.rightMicroHandFlex + microHandFlexOffset
      : pose.rightMicroHandFlex,
    rightRestCurlWeight: pose.rightRestCurlWeight,
    rightRestFingerCurlJitter: pose.rightRestFingerCurlJitter,
  };
}

function interpolateGesturePose(
  from: TalkingHandsGesturePoseDeg,
  to: TalkingHandsGesturePoseDeg,
  t: number,
): TalkingHandsGesturePoseDeg {
  return {
    leftElbowBend: THREE.MathUtils.lerp(
      from.leftElbowBend,
      to.leftElbowBend,
      t,
    ),
    leftElbowSide: THREE.MathUtils.lerp(
      from.leftElbowSide,
      to.leftElbowSide,
      t,
    ),
    leftShoulderForward: THREE.MathUtils.lerp(
      from.leftShoulderForward,
      to.leftShoulderForward,
      t,
    ),
    leftPalmDirection: THREE.MathUtils.lerp(
      from.leftPalmDirection,
      to.leftPalmDirection,
      t,
    ),
    leftMicroTwist: THREE.MathUtils.lerp(
      from.leftMicroTwist,
      to.leftMicroTwist,
      t,
    ),
    leftSecondaryMicroTwist: THREE.MathUtils.lerp(
      from.leftSecondaryMicroTwist,
      to.leftSecondaryMicroTwist,
      t,
    ),
    leftMicroFingerUncurl: lerpFingerValues(
      from.leftMicroFingerUncurl,
      to.leftMicroFingerUncurl,
      t,
    ),
    leftMicroThumbUncurl: THREE.MathUtils.lerp(
      from.leftMicroThumbUncurl,
      to.leftMicroThumbUncurl,
      t,
    ),
    leftMicroThumbUnspread: THREE.MathUtils.lerp(
      from.leftMicroThumbUnspread,
      to.leftMicroThumbUnspread,
      t,
    ),
    leftMicroHandFlex: THREE.MathUtils.lerp(
      from.leftMicroHandFlex,
      to.leftMicroHandFlex,
      t,
    ),
    leftRestCurlWeight: THREE.MathUtils.lerp(
      from.leftRestCurlWeight,
      to.leftRestCurlWeight,
      t,
    ),
    leftRestFingerCurlJitter: lerpFingerValues(
      from.leftRestFingerCurlJitter,
      to.leftRestFingerCurlJitter,
      t,
    ),
    microHeadNod: THREE.MathUtils.lerp(from.microHeadNod, to.microHeadNod, t),
    rightElbowBend: THREE.MathUtils.lerp(
      from.rightElbowBend,
      to.rightElbowBend,
      t,
    ),
    rightElbowSide: THREE.MathUtils.lerp(
      from.rightElbowSide,
      to.rightElbowSide,
      t,
    ),
    rightShoulderForward: THREE.MathUtils.lerp(
      from.rightShoulderForward,
      to.rightShoulderForward,
      t,
    ),
    rightPalmDirection: THREE.MathUtils.lerp(
      from.rightPalmDirection,
      to.rightPalmDirection,
      t,
    ),
    rightMicroTwist: THREE.MathUtils.lerp(
      from.rightMicroTwist,
      to.rightMicroTwist,
      t,
    ),
    rightSecondaryMicroTwist: THREE.MathUtils.lerp(
      from.rightSecondaryMicroTwist,
      to.rightSecondaryMicroTwist,
      t,
    ),
    rightMicroFingerUncurl: lerpFingerValues(
      from.rightMicroFingerUncurl,
      to.rightMicroFingerUncurl,
      t,
    ),
    rightMicroThumbUncurl: THREE.MathUtils.lerp(
      from.rightMicroThumbUncurl,
      to.rightMicroThumbUncurl,
      t,
    ),
    rightMicroThumbUnspread: THREE.MathUtils.lerp(
      from.rightMicroThumbUnspread,
      to.rightMicroThumbUnspread,
      t,
    ),
    rightMicroHandFlex: THREE.MathUtils.lerp(
      from.rightMicroHandFlex,
      to.rightMicroHandFlex,
      t,
    ),
    rightRestCurlWeight: THREE.MathUtils.lerp(
      from.rightRestCurlWeight,
      to.rightRestCurlWeight,
      t,
    ),
    rightRestFingerCurlJitter: lerpFingerValues(
      from.rightRestFingerCurlJitter,
      to.rightRestFingerCurlJitter,
      t,
    ),
  };
}

type SideDriftBySide = {
  left: number;
  right: number;
};

type ElbowBendBySide = {
  left: number;
  right: number;
};

function axisComponent(
  selectedAxis: TalkingHandsSecondaryMicroTwistAxis,
  targetAxis: TalkingHandsSecondaryMicroTwistAxis,
  value: number,
): number {
  return selectedAxis === targetAxis ? value : 0;
}

function addMicroPauseSegment(
  addSegment: (to: TalkingHandsGesturePoseDeg, durationSec: number) => void,
  basePose: TalkingHandsGesturePoseDeg,
  durationSec: number | undefined,
): void {
  if (!durationSec || durationSec < MIN_SEGMENT_DURATION_SEC) return;
  addSegment(basePose, durationSec);
}

function fitGestureSegmentsToMaxDuration(
  segments: TalkingHandsGestureSegment[],
  maxDurationSec: number | null | undefined,
): TalkingHandsGestureSegment[] {
  if (
    maxDurationSec == null ||
    !Number.isFinite(maxDurationSec) ||
    maxDurationSec <= 0
  ) {
    return segments;
  }

  const totalDurationSec = segments.reduce(
    (total, segment) => total + Math.max(0, segment.durationSec),
    0,
  );
  if (totalDurationSec <= maxDurationSec) return segments;

  const scale = maxDurationSec / totalDurationSec;
  return segments.map((segment) => ({
    ...segment,
    durationSec: Math.max(EPSILON, segment.durationSec * scale),
  }));
}

function resolveHandMicroTwist(
  microTwist: number,
  mode: TalkingHandsMicroTwistMode,
): number {
  if (mode === "handOnly") return microTwist;
  if (mode === "forearmRollWithHandFollow") {
    return microTwist * MICRO_TWIST_HAND_FOLLOW;
  }
  return 0;
}

function getRestFingerCurlOffset(
  params: TalkingHandsProceduralAnimationParams,
  finger: FingerName | undefined,
): number {
  switch (finger) {
    case "index":
      return params.restIndexFingerCurlOffset;
    case "middle":
      return params.restMiddleFingerCurlOffset;
    case "ring":
      return params.restRingFingerCurlOffset;
    case "little":
      return params.restLittleFingerCurlOffset;
    default:
      return 0;
  }
}

function getFingerValue(
  values: FingerValuesDeg,
  finger: FingerName | undefined,
): number {
  return finger ? values[finger] : 0;
}

function addFingerValues(
  a: FingerValuesDeg,
  b: FingerValuesDeg,
): FingerValuesDeg {
  return {
    index: a.index + b.index,
    middle: a.middle + b.middle,
    ring: a.ring + b.ring,
    little: a.little + b.little,
  };
}

function scaleFingerValues(
  values: FingerValuesDeg,
  scale: number,
): FingerValuesDeg {
  return {
    index: values.index * scale,
    middle: values.middle * scale,
    ring: values.ring * scale,
    little: values.little * scale,
  };
}

function scaleFingerValuesBySide(
  values: FingerValuesDegBySide,
  scale: number,
): FingerValuesDegBySide {
  return {
    left: scaleFingerValues(values.left, scale),
    right: scaleFingerValues(values.right, scale),
  };
}

function scaleNumberBySide(values: NumberBySide, scale: number): NumberBySide {
  return {
    left: values.left * scale,
    right: values.right * scale,
  };
}

function lerpFingerValues(
  from: FingerValuesDeg,
  to: FingerValuesDeg,
  t: number,
): FingerValuesDeg {
  return {
    index: THREE.MathUtils.lerp(from.index, to.index, t),
    middle: THREE.MathUtils.lerp(from.middle, to.middle, t),
    ring: THREE.MathUtils.lerp(from.ring, to.ring, t),
    little: THREE.MathUtils.lerp(from.little, to.little, t),
  };
}

function dampFingerValues(
  current: FingerValuesDeg,
  target: FingerValuesDeg,
  step: number,
): FingerValuesDeg {
  return lerpFingerValues(current, target, step);
}

function averageFingerValues(values: FingerValuesDeg): number {
  return (values.index + values.middle + values.ring + values.little) / 4;
}

function createFingerValues(
  valueFactory: (finger: FingerName) => number = () => 0,
): FingerValuesDeg {
  return {
    index: valueFactory("index"),
    middle: valueFactory("middle"),
    ring: valueFactory("ring"),
    little: valueFactory("little"),
  };
}

function createFingerValuesBySide(): FingerValuesDegBySide {
  return {
    left: createFingerValues(),
    right: createFingerValues(),
  };
}

function createNumberBySide(): NumberBySide {
  return {
    left: 0,
    right: 0,
  };
}

function mapActiveSidesToFingerValues(
  activeSides: readonly Side[],
  valueFactory: (side: Side, finger: FingerName) => number,
): FingerValuesDegBySide {
  return {
    left: activeSides.includes("left")
      ? createFingerValues((finger) => valueFactory("left", finger))
      : createFingerValues(),
    right: activeSides.includes("right")
      ? createFingerValues((finger) => valueFactory("right", finger))
      : createFingerValues(),
  };
}

function mapActiveSidesToNumbers(
  activeSides: readonly Side[],
  valueFactory: (side: Side) => number,
): NumberBySide {
  return {
    left: activeSides.includes("left") ? valueFactory("left") : 0,
    right: activeSides.includes("right") ? valueFactory("right") : 0,
  };
}

function resolveFingerCascadeLag(
  cascade: number,
  finger: FingerName | undefined,
): number {
  const clampedCascade = THREE.MathUtils.clamp(cascade, 0, 1);
  switch (finger) {
    case "index":
      return THREE.MathUtils.lerp(1, 0.72, clampedCascade);
    case "middle":
      return 1;
    case "ring":
      return THREE.MathUtils.lerp(1, 1.18, clampedCascade);
    case "little":
      return THREE.MathUtils.lerp(1, 1.34, clampedCascade);
    default:
      return 1;
  }
}

function dampGesturePose(
  current: TalkingHandsGesturePoseDeg,
  target: TalkingHandsGesturePoseDeg,
  steps: TalkingHandsLagSteps,
): TalkingHandsGesturePoseDeg {
  return {
    leftElbowBend: dampNumber(
      current.leftElbowBend,
      target.leftElbowBend,
      steps.arm,
    ),
    leftElbowSide: dampNumber(
      current.leftElbowSide,
      target.leftElbowSide,
      steps.arm,
    ),
    leftShoulderForward: dampNumber(
      current.leftShoulderForward,
      target.leftShoulderForward,
      steps.arm,
    ),
    leftPalmDirection: dampNumber(
      current.leftPalmDirection,
      target.leftPalmDirection,
      steps.palm,
    ),
    leftMicroTwist: dampNumber(
      current.leftMicroTwist,
      target.leftMicroTwist,
      steps.palm,
    ),
    leftSecondaryMicroTwist: dampNumber(
      current.leftSecondaryMicroTwist,
      target.leftSecondaryMicroTwist,
      steps.palm,
    ),
    leftMicroFingerUncurl: dampFingerValues(
      current.leftMicroFingerUncurl,
      target.leftMicroFingerUncurl,
      steps.finger,
    ),
    leftMicroThumbUncurl: dampNumber(
      current.leftMicroThumbUncurl,
      target.leftMicroThumbUncurl,
      steps.finger,
    ),
    leftMicroThumbUnspread: dampNumber(
      current.leftMicroThumbUnspread,
      target.leftMicroThumbUnspread,
      steps.finger,
    ),
    leftMicroHandFlex: target.leftMicroHandFlex,
    leftRestCurlWeight: dampNumber(
      current.leftRestCurlWeight,
      target.leftRestCurlWeight,
      steps.finger,
    ),
    leftRestFingerCurlJitter: dampFingerValues(
      current.leftRestFingerCurlJitter,
      target.leftRestFingerCurlJitter,
      steps.arm,
    ),
    microHeadNod: dampNumber(
      current.microHeadNod,
      target.microHeadNod,
      steps.arm,
    ),
    rightElbowBend: dampNumber(
      current.rightElbowBend,
      target.rightElbowBend,
      steps.arm,
    ),
    rightElbowSide: dampNumber(
      current.rightElbowSide,
      target.rightElbowSide,
      steps.arm,
    ),
    rightShoulderForward: dampNumber(
      current.rightShoulderForward,
      target.rightShoulderForward,
      steps.arm,
    ),
    rightPalmDirection: dampNumber(
      current.rightPalmDirection,
      target.rightPalmDirection,
      steps.palm,
    ),
    rightMicroTwist: dampNumber(
      current.rightMicroTwist,
      target.rightMicroTwist,
      steps.palm,
    ),
    rightSecondaryMicroTwist: dampNumber(
      current.rightSecondaryMicroTwist,
      target.rightSecondaryMicroTwist,
      steps.palm,
    ),
    rightMicroFingerUncurl: dampFingerValues(
      current.rightMicroFingerUncurl,
      target.rightMicroFingerUncurl,
      steps.finger,
    ),
    rightMicroThumbUncurl: dampNumber(
      current.rightMicroThumbUncurl,
      target.rightMicroThumbUncurl,
      steps.finger,
    ),
    rightMicroThumbUnspread: dampNumber(
      current.rightMicroThumbUnspread,
      target.rightMicroThumbUnspread,
      steps.finger,
    ),
    rightMicroHandFlex: target.rightMicroHandFlex,
    rightRestCurlWeight: dampNumber(
      current.rightRestCurlWeight,
      target.rightRestCurlWeight,
      steps.finger,
    ),
    rightRestFingerCurlJitter: dampFingerValues(
      current.rightRestFingerCurlJitter,
      target.rightRestFingerCurlJitter,
      steps.arm,
    ),
  };
}

function dampNumber(current: number, target: number, step: number): number {
  return THREE.MathUtils.lerp(current, target, step);
}

function dampStep(deltaSec: number, lagSec: number): number {
  if (lagSec <= EPSILON) return 1;
  return 1 - Math.exp(-Math.max(0, deltaSec) / lagSec);
}

function smootherstep(t: number): number {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
}

function randomSide(): Side {
  return Math.random() < 0.5 ? "left" : "right";
}

function compareSpeechGestureBeatsByTime(
  left: SpeechGestureBeat,
  right: SpeechGestureBeat,
): number {
  return (
    left.timeSec - right.timeSec ||
    left.wordIndex - right.wordIndex ||
    left.phonemeIndex - right.phonemeIndex
  );
}

function createBaseChunkDiagnostic(
  chunk: TtsChunkRecord,
): Omit<
  TalkingHandsSpeechChunkDiagnostic,
  "status" | "beatCount" | "selectedBeats" | "skippedBeats" | "pulseApexes"
> {
  return {
    runId: chunk.runId,
    chunkId: chunk.chunkId,
    index: chunk.index,
    preview: formatChunkPreview(chunk.text),
    boundaryType: chunk.boundaryType,
    isExclamation: chunk.isExclamation,
    wordStartIndex: chunk.wordStartIndex,
    wordEndIndex: chunk.wordEndIndex,
  };
}

function formatChunkPreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 72) return normalized;
  return `${normalized.slice(0, 69)}...`;
}

function resolveSpeechTimingForChunkScheduling(
  timing: ProceduralAnimationRuntimeContext["speechTiming"] | null | undefined,
): ResolvedSpeechTiming | null {
  if (!timing?.gestureTimeline) return null;
  if (
    typeof timing.utteranceDurationSec !== "number" ||
    !Number.isFinite(timing.utteranceDurationSec) ||
    timing.utteranceDurationSec <= 0
  ) {
    return null;
  }
  if (
    typeof timing.durationSec !== "number" ||
    !Number.isFinite(timing.durationSec) ||
    timing.durationSec <= 0
  ) {
    return null;
  }
  if (
    typeof timing.remainingSec !== "number" ||
    !Number.isFinite(timing.remainingSec)
  ) {
    return null;
  }

  return {
    ...timing,
    utteranceDurationSec: timing.utteranceDurationSec,
    durationSec: timing.durationSec,
    remainingSec: Math.max(0, timing.remainingSec),
    gestureTimeline: timing.gestureTimeline,
  };
}

function resolveChunkWindow(
  timeline: SpeechGestureTimeline,
  chunk: TtsChunkRecord,
  beats: readonly SpeechGestureBeat[],
): ChunkWindow | null {
  const wordTimings = timeline.wordTimings.filter(
    (word) =>
      word.wordIndex >= chunk.wordStartIndex &&
      word.wordIndex < chunk.wordEndIndex,
  );
  if (wordTimings.length > 0) {
    return {
      startSec: Math.min(...wordTimings.map((word) => word.startSec)),
      endSec: Math.max(...wordTimings.map((word) => word.endSec)),
    };
  }

  if (beats.length === 0) return null;
  return {
    startSec: Math.min(...beats.map((beat) => beat.timeSec)),
    endSec: Math.max(...beats.map((beat) => beat.timeSec)),
  };
}

function randomRange(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.random() * (max - min);
}

function sortedPair(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function sanitizeFiniteNumber(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
}

function sanitizeNonNegativeNumber(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

function sanitizePositiveDuration(
  value: number | null | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return Math.max(TALKING_HANDS_MIN_GROUP_DURATION_SEC, fallback);
  }
  return Math.max(TALKING_HANDS_MIN_GROUP_DURATION_SEC, value);
}

function sanitizeNonNegativeInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

function sanitizeUnitInterval(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return THREE.MathUtils.clamp(value, 0, 1);
}

function sanitizeAsymmetry(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return THREE.MathUtils.clamp(value, 0, 0.5);
}

function sanitizeActivationWeight(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return THREE.MathUtils.clamp(value, 0, 1);
}

function sanitizeMicroTwistMode(
  value: TalkingHandsMicroTwistMode | undefined,
  fallback: TalkingHandsMicroTwistMode,
): TalkingHandsMicroTwistMode {
  return value === "forearmRoll" ||
    value === "forearmRollWithHandFollow" ||
    value === "handOnly"
    ? value
    : fallback;
}

function sanitizeSecondaryMicroTwistAxis(
  value: TalkingHandsSecondaryMicroTwistAxis | undefined,
  fallback: TalkingHandsSecondaryMicroTwistAxis,
): TalkingHandsSecondaryMicroTwistAxis {
  return value === "x" || value === "y" || value === "z" ? value : fallback;
}
