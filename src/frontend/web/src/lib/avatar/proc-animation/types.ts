import type { AvatarAnimationState, EmotionLabel } from "../types";
import type { TalkingHandsSpeechPlanDebugSnapshot } from "./talking-hands-speech-planner";
import type {
  EmotionGroup,
  EmotionIntensity,
  EmotionRuntimeState,
  TrackedEmotion,
} from "@/lib/emotion";
import type {
  SpeechGestureBeat,
  SpeechGestureTimeline,
} from "@/lib/speech/speech-gesture-timeline";
import type { TtsChunkRecord } from "@/lib/speech/tts-chunker";

export type ProceduralAnimationLayerId =
  | "breathing"
  | "sway"
  | "bounce"
  | "headNod"
  | "headSideTilt"
  | "cursorLookAt"
  | "talkingHands"
  | "emotionPosture";

export type BreathingProceduralAnimationParams = {
  enabled: boolean;
  intensity: number;
  bpm: number;
  chest: number;
  spine: number;
  shoulder: number;
  head: number;
  sway: number;
  lag: number;
};

export const DEFAULT_BREATHING_PROCEDURAL_ANIMATION_PARAMS: BreathingProceduralAnimationParams =
  {
    enabled: true,
    intensity: 1,
    bpm: 12,
    chest: 1.6,
    spine: 0.8,
    shoulder: 0.8,
    head: 0.4,
    sway: 0.6,
    lag: 0.35,
  };

export type SwayProceduralAnimationParams = {
  enabled: boolean;
  intensity: number;
  cpm: number;
  idleActiveSec: number;
  idleIntervalSec: number;
  idleEnterBlendSec: number;
  idleExitBlendSec: number;
  sideShift: number;
  torsoLean: number;
  headFollowTilt: number;
  neckFollowTilt: number;
  shoulderDrift: number;
  lag: number;
};

export const DEFAULT_SWAY_PROCEDURAL_ANIMATION_PARAMS: SwayProceduralAnimationParams =
  {
    enabled: true,
    intensity: 0.4,
    cpm: 12,
    idleActiveSec: 10,
    idleIntervalSec: 60,
    idleEnterBlendSec: 2.0,
    idleExitBlendSec: 2.4,
    sideShift: 1.2,
    torsoLean: 2,
    headFollowTilt: 5.0,
    neckFollowTilt: 0.15,
    shoulderDrift: 0.5,
    lag: 0.45,
  };

export type BounceProceduralAnimationParams = {
  enabled: boolean;
  intensity: number;
  bpm: number;
  pauseMinSec: number;
  pauseMaxSec: number;
  bodyLift: number;
  footFlexion: number;
  headNod: number;
  lag: number;
};

export const DEFAULT_BOUNCE_PROCEDURAL_ANIMATION_PARAMS: BounceProceduralAnimationParams =
  {
    enabled: false,
    intensity: 0.5,
    bpm: 30,
    pauseMinSec: 0.0,
    pauseMaxSec: 0.0,
    bodyLift: 2,
    footFlexion: 25,
    headNod: 6,
    lag: 0,
  };

export type HeadNodProceduralAnimationParams = {
  enabled: boolean;
  intensity: number;
  pauseMinSec: number;
  pauseMaxSec: number;
  amplitudeMin: number;
  amplitudeMax: number;
  smallNodMaxCount: number;
  largeNodMaxCount: number;
  upNodChance: number;
  upDownChance: number;
  torsoFollow: number;
  sideTilt: number;
  speed: number;
};

export const DEFAULT_HEAD_NOD_PROCEDURAL_ANIMATION_PARAMS: HeadNodProceduralAnimationParams =
  {
    enabled: false,
    intensity: 1,
    pauseMinSec: 1.2,
    pauseMaxSec: 4.5,
    amplitudeMin: 1.5,
    amplitudeMax: 8,
    smallNodMaxCount: 4,
    largeNodMaxCount: 1,
    upNodChance: 0.25,
    upDownChance: 0.25,
    torsoFollow: 0.25,
    sideTilt: 0.4,
    speed: 1,
  };

export type HeadSideTiltProceduralAnimationParams = {
  enabled: boolean;
  intensity: number;
  pauseMinSec: number;
  pauseMaxSec: number;
  tiltMin: number;
  tiltMax: number;
  downPitch: number;
  yawAmount: number;
  holdMinSec: number;
  holdMaxSec: number;
  transitionMinSec: number;
  transitionMaxSec: number;
  torsoFollow: number;
  alternateSideChance: number;
  speed: number;
};

export const DEFAULT_HEAD_SIDE_TILT_PROCEDURAL_ANIMATION_PARAMS: HeadSideTiltProceduralAnimationParams =
  {
    enabled: true,
    intensity: 0.8,
    pauseMinSec: 4,
    pauseMaxSec: 10,
    tiltMin: 3,
    tiltMax: 8,
    downPitch: 0,
    yawAmount: 2,
    holdMinSec: 0.0,
    holdMaxSec: 0.2,
    transitionMinSec: 0.5,
    transitionMaxSec: 0.9,
    torsoFollow: 1,
    alternateSideChance: 0.65,
    speed: 0.5,
  };

export type CursorLookAtProceduralAnimationParams = {
  enabled: boolean;
  intensity: number;
  durationMinSec: number;
  durationMaxSec: number;
  pauseMinSec: number;
  pauseMaxSec: number;
  eyeLookAtStrength: number;
  headFollowStrength: number;
  neckFollowStrength: number;
  torsoFollowStrength: number;
  driftAmount: number;
  driftSpeed: number;
};

export type CursorLookAtInputSnapshot = {
  clientX: number;
  clientY: number;
  capturedAtMs?: number;
  isInsideViewport?: boolean;
  source: "desktop-pip" | "dom";
};

export type CursorLookAtInputProvider = () => CursorLookAtInputSnapshot | null;

export const DEFAULT_CURSOR_LOOK_AT_PROCEDURAL_ANIMATION_PARAMS: CursorLookAtProceduralAnimationParams =
  {
    enabled: true,
    intensity: 1,
    durationMinSec: 2,
    durationMaxSec: 6,
    pauseMinSec: 10,
    pauseMaxSec: 20,
    eyeLookAtStrength: 1,
    headFollowStrength: 0.95,
    neckFollowStrength: 0.95,
    torsoFollowStrength: 0.92,
    driftAmount: 0.06,
    driftSpeed: 0.6,
  };

export type TalkingHandsMicroTwistMode =
  | "forearmRoll"
  | "forearmRollWithHandFollow"
  | "handOnly";
export type TalkingHandsSecondaryMicroTwistAxis = "x" | "y" | "z";

export type TalkingHandsProceduralAnimationParams = {
  enabled: boolean;
  intensity: number;
  elbowSideDriftMin: number;
  elbowSideDriftMax: number;
  palmDirectionRange: number;
  shoulderBeat: number;
  shoulderForward: number;
  asymmetry: number;
  pauseMinSec: number;
  pauseMaxSec: number;
  gestureDurationSec: number;
  elbowBendMin: number;
  elbowBendMax: number;
  elbowBendAsymmetry: number;
  microBendCount: number;
  microBendAmount: number;
  microBendPauseChance: number;
  microBendPauseMinSec: number;
  microBendPauseMaxSec: number;
  restThumbCurlOffset: number;
  restThumbMetacarpalCurlOffset: number;
  restThumbProximalCurlOffset: number;
  restThumbDistalCurlOffset: number;
  restThumbSpreadOffset: number;
  restIndexFingerCurlOffset: number;
  restMiddleFingerCurlOffset: number;
  restRingFingerCurlOffset: number;
  restLittleFingerCurlOffset: number;
  restFingerCurlJitter: number;
  microFingerUncurlAmount: number;
  microFingerUncurlVariance: number;
  microThumbUncurlAmount: number;
  microThumbUncurlVariance: number;
  microThumbUnspreadAmount: number;
  microHandFlexAmount: number;
  microHeadNodAmount: number;
  microEntryBlend: number;
  armLagSec: number;
  palmLagSec: number;
  fingerLagSec: number;
  fingerCascadeLag: number;
  microTwistAmount: number;
  microTwistMode: TalkingHandsMicroTwistMode;
  secondaryMicroTwistMin: number;
  secondaryMicroTwistMax: number;
  secondaryMicroTwistAxis: TalkingHandsSecondaryMicroTwistAxis;
  speechGestureEntrySec: number;
  speechGestureEntryGraceSec: number;
  speechGestureReturnSec: number;
  speechBeatMinSpacingSec: number;
  speechBeatPulseAttackSec: number;
  speechBeatPulseReleaseSec: number;
  speechChunkSkipChance: number;
  oneHandChance: number;
  bothHandsChance: number;
  speed: number;
};

export const DEFAULT_TALKING_HANDS_PROCEDURAL_ANIMATION_PARAMS: TalkingHandsProceduralAnimationParams =
  {
    enabled: false,
    intensity: 1,
    elbowSideDriftMin: -10,
    elbowSideDriftMax: 30,
    palmDirectionRange: 30,
    shoulderBeat: -20,
    shoulderForward: 0,
    asymmetry: 0.02,
    pauseMinSec: 0.3,
    pauseMaxSec: 0.4,
    gestureDurationSec: 2.0,
    elbowBendMin: 30,
    elbowBendMax: 81,
    elbowBendAsymmetry: 12,
    microBendCount: 8,
    microBendAmount: 10,
    microBendPauseChance: 0.35,
    microBendPauseMinSec: 0.04,
    microBendPauseMaxSec: 0.2,
    restThumbCurlOffset: -5,
    restThumbMetacarpalCurlOffset: 0,
    restThumbProximalCurlOffset: 0,
    restThumbDistalCurlOffset: 0,
    restThumbSpreadOffset: 0,
    restIndexFingerCurlOffset: 15,
    restMiddleFingerCurlOffset: 20,
    restRingFingerCurlOffset: 20,
    restLittleFingerCurlOffset: 25,
    restFingerCurlJitter: 4,
    microFingerUncurlAmount: 35,
    microFingerUncurlVariance: 0.35,
    microThumbUncurlAmount: -15,
    microThumbUncurlVariance: 0.15,
    microThumbUnspreadAmount: 15,
    microHandFlexAmount: 6,
    microHeadNodAmount: 2,
    microEntryBlend: 2.5,
    armLagSec: 0.04,
    palmLagSec: 0.1,
    fingerLagSec: 0.14,
    fingerCascadeLag: 0.5,
    microTwistAmount: 15,
    microTwistMode: "forearmRoll",
    secondaryMicroTwistMin: -12,
    secondaryMicroTwistMax: 12,
    secondaryMicroTwistAxis: "z",
    speechGestureEntrySec: 0.56,
    speechGestureEntryGraceSec: 0.08,
    speechGestureReturnSec: 0.56,
    speechBeatMinSpacingSec: 0.4,
    speechBeatPulseAttackSec: 0.4,
    speechBeatPulseReleaseSec: 0.4,
    speechChunkSkipChance: 0.3,
    oneHandChance: 0.55,
    bothHandsChance: 0.3,
    speed: 1.0,
  };

export type EmotionPostureLevel = Exclude<EmotionIntensity, 0>;
export const SUPPORTED_EMOTION_POSTURE_GROUPS = [
  "gloom",
  "revulsion",
  "rejection",
] as const satisfies readonly EmotionGroup[];
export type EmotionPostureGroup =
  (typeof SUPPORTED_EMOTION_POSTURE_GROUPS)[number];

const EMOTION_POSTURE_GROUP_SET = new Set<EmotionGroup>(
  SUPPORTED_EMOTION_POSTURE_GROUPS,
);

export function isEmotionPostureGroup(
  value: unknown,
): value is EmotionPostureGroup {
  return (
    typeof value === "string" &&
    EMOTION_POSTURE_GROUP_SET.has(value as EmotionGroup)
  );
}

export type EmotionPostureTarget = {
  hipsPitchDeg: number;
  spinePitchDeg: number;
  chestPitchDeg: number;
  upperChestPitchDeg: number;
  neckPitchDeg: number;
  headPitchDeg: number;
  headYawDeg: number;
  headRollDeg: number;
  shoulderLiftCm: number;
};

export type EmotionPostureLevelIntensities = Record<
  EmotionPostureLevel,
  number
>;

export type EmotionPosturePresetParams = {
  enabled: boolean;
  intensityByLevel: EmotionPostureLevelIntensities;
  target: EmotionPostureTarget;
};

export type EmotionPosturePresetMap = Record<
  EmotionPostureGroup,
  EmotionPosturePresetParams
>;

export type EmotionPostureProceduralAnimationParams = {
  enabled: boolean;
  plannerEnabled: boolean;
  debugModeEnabled: boolean;
  debugGroup: EmotionPostureGroup;
  debugLevel: EmotionPostureLevel;
  enterBlendSec: number;
  exitBlendSec: number;
  presets: EmotionPosturePresetMap;
};

export type EmotionPostureResolutionReason =
  | "active"
  | "neutral"
  | "levelZero"
  | "plannerDisabled"
  | "debugOverride"
  | "presetDisabled"
  | "unsupportedGroup"
  | "missingPreset";

export type EmotionPostureDebugSnapshot = {
  resolvedGroup: EmotionGroup | "neutral";
  resolvedLevel: EmotionIntensity;
  primaryEmotion: TrackedEmotion | null;
  levelIntensity: number;
  effectiveIntensity: number;
  presetEnabled: boolean;
  reason: EmotionPostureResolutionReason;
  activeTarget: EmotionPostureTarget | null;
  currentTarget: EmotionPostureTarget;
};

const ZERO_EMOTION_POSTURE_TARGET: EmotionPostureTarget = {
  hipsPitchDeg: 0,
  spinePitchDeg: 0,
  chestPitchDeg: 0,
  upperChestPitchDeg: 0,
  neckPitchDeg: 0,
  headPitchDeg: 0,
  headYawDeg: 0,
  headRollDeg: 0,
  shoulderLiftCm: 0,
};

function buildGloomEmotionPostureLevelIntensities(): EmotionPostureLevelIntensities {
  return {
    1: 0.3,
    2: 0.5,
    3: 0.7,
  };
}

function buildRevulsionEmotionPostureLevelIntensities(): EmotionPostureLevelIntensities {
  return {
    1: 0.15,
    2: 0.3,
    3: 0.45,
  };
}

function buildRejectionEmotionPostureLevelIntensities(): EmotionPostureLevelIntensities {
  return {
    1: 0.2,
    2: 0.3,
    3: 0.4,
  };
}

export const DEFAULT_EMOTION_POSTURE_PROCEDURAL_ANIMATION_PARAMS: EmotionPostureProceduralAnimationParams =
  {
    enabled: false,
    plannerEnabled: true,
    debugModeEnabled: false,
    debugGroup: "gloom",
    debugLevel: 3,
    enterBlendSec: 0.7,
    exitBlendSec: 0.9,
    presets: {
      gloom: {
        enabled: true,
        intensityByLevel: buildGloomEmotionPostureLevelIntensities(),
        target: {
          hipsPitchDeg: 2,
          spinePitchDeg: 4,
          chestPitchDeg: 7,
          upperChestPitchDeg: 8,
          neckPitchDeg: 6,
          headPitchDeg: 12,
          headYawDeg: 0,
          headRollDeg: 0,
          shoulderLiftCm: -2.5,
        },
      },
      revulsion: {
        enabled: true,
        intensityByLevel: buildRevulsionEmotionPostureLevelIntensities(),
        target: {
          ...ZERO_EMOTION_POSTURE_TARGET,
          hipsPitchDeg: -6,
          spinePitchDeg: -8,
          chestPitchDeg: -8,
          upperChestPitchDeg: -6,
          neckPitchDeg: 6,
          headPitchDeg: 9,
          headYawDeg: -18,
          headRollDeg: 7,
          shoulderLiftCm: 3.5,
        },
      },
      rejection: {
        enabled: true,
        intensityByLevel: buildRejectionEmotionPostureLevelIntensities(),
        target: {
          ...ZERO_EMOTION_POSTURE_TARGET,
          hipsPitchDeg: 6,
          spinePitchDeg: 9,
          chestPitchDeg: 9,
          upperChestPitchDeg: 7,
          neckPitchDeg: 4,
          headPitchDeg: 8,
          shoulderLiftCm: 3,
        },
      },
    },
  };

export type ProceduralAnimationLayerParamsById = {
  breathing: BreathingProceduralAnimationParams;
  sway: SwayProceduralAnimationParams;
  bounce: BounceProceduralAnimationParams;
  headNod: HeadNodProceduralAnimationParams;
  headSideTilt: HeadSideTiltProceduralAnimationParams;
  cursorLookAt: CursorLookAtProceduralAnimationParams;
  talkingHands: TalkingHandsProceduralAnimationParams;
  emotionPosture: EmotionPostureProceduralAnimationParams;
};

export type ProceduralSpeechTimingContext =
  | {
      runId: string;
      elapsedSec: number;
      utteranceDurationSec: number;
      durationSec: number;
      remainingSec: number;
      durationKnown: true;
      gestureTimeline: SpeechGestureTimeline | null;
      ttsChunks: readonly TtsChunkRecord[];
    }
  | {
      runId: string;
      elapsedSec: number;
      utteranceDurationSec: number | null;
      durationSec: number | null;
      remainingSec: number | null;
      durationKnown: false;
      gestureTimeline: SpeechGestureTimeline | null;
      ttsChunks: readonly TtsChunkRecord[];
    };

export type ProceduralAnimationRuntimeContext = {
  avatarState: AvatarAnimationState;
  emotionLabel: EmotionLabel;
  emotionalState: EmotionRuntimeState;
  globalRestPoseActive: boolean;
  speechTiming?: ProceduralSpeechTimingContext | null;
  layerActivationWeight?: number;
  layerDeactivationRequested?: boolean;
};

export type TalkingHandsPlayGroupRequest =
  | {
      source: "debug";
      durationSec?: number | null;
    }
  | {
      source: "speech";
      runId: string;
      elapsedSec: number;
      durationSec: number;
      scope?: "utterance" | "chunk";
      windowEndSec?: number | null;
      selectedSide?: "left" | "right" | "both" | null;
      beats: readonly SpeechGestureBeat[];
    };

export type ProceduralAnimationTransitionState = {
  canDeactivateNow: boolean;
  maxWaitSec: number;
};

export type ProceduralAnimationLayerSnapshot<
  TId extends ProceduralAnimationLayerId = ProceduralAnimationLayerId,
> = {
  id: TId;
  enabled: boolean;
  weight: number;
  params: ProceduralAnimationLayerParamsById[TId];
  resolvedBones: string[];
  missingBones: string[];
  speechPlan?: TId extends "talkingHands"
    ? TalkingHandsSpeechPlanDebugSnapshot | null
    : never;
  emotionPosture?: TId extends "emotionPosture"
    ? EmotionPostureDebugSnapshot
    : never;
};

export type ProceduralAnimationSnapshot = {
  ready: boolean;
  disposed: boolean;
  elapsedSec: number;
  maxDeltaSec: number;
  layers: ProceduralAnimationLayerSnapshot[];
};

/**
 * Construction options shared by procedural layers that write authored bone
 * offsets. Offsets are authored in the VRM1 normalized basis; VRM0 layers
 * convert them before applying.
 */
export type ProceduralAnimationBasisOptions = {
  isVrm0?: boolean;
};

export type ProceduralAnimationLayer<
  TId extends ProceduralAnimationLayerId = ProceduralAnimationLayerId,
> = {
  id: TId;
  clearOffsets: () => void;
  update: (
    deltaSec: number,
    context: ProceduralAnimationRuntimeContext,
  ) => void;
  playGroup?: (request: TalkingHandsPlayGroupRequest) => boolean;
  getSnapshot: () => ProceduralAnimationLayerSnapshot<TId>;
  getTransitionState?: () => ProceduralAnimationTransitionState;
  setEnabled: (enabled: boolean) => void;
  setWeight: (weight: number) => void;
  setParams: (params: Partial<ProceduralAnimationLayerParamsById[TId]>) => void;
  reset: () => void;
  dispose: () => void;
};
