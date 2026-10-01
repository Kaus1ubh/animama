import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

import {
  DEFAULT_EMOTION_POSTURE_PROCEDURAL_ANIMATION_PARAMS,
  SUPPORTED_EMOTION_POSTURE_GROUPS,
  type EmotionPostureDebugSnapshot,
  type EmotionPostureGroup,
  type EmotionPostureLevel,
  type EmotionPosturePresetParams,
  type EmotionPostureProceduralAnimationParams,
  type EmotionPostureResolutionReason,
  type EmotionPostureTarget,
  type ProceduralAnimationBasisOptions,
  type ProceduralAnimationLayer,
  type ProceduralAnimationLayerSnapshot,
  type ProceduralAnimationRuntimeContext,
  isEmotionPostureGroup,
} from "./types";
import {
  type EmotionGroup,
  type EmotionRuntimeState,
  type TrackedEmotion,
} from "@/lib/emotion";
import {
  retargetVrm1AuthoredPositionOffsetToVrm0,
  retargetVrm1AuthoredQuaternionOffsetToVrm0,
} from "../poses/poseRetargeting";

const DEG_TO_RAD = Math.PI / 180;
const TARGET_EPSILON = 0.0001;
const MAX_POSTURE_BLEND_SEC = 5;
const MAX_TARGET_DEG = 30;
const MAX_SHOULDER_LIFT_CM = 10;
const EMOTION_POSTURE_LEVELS = [
  1, 2, 3,
] as const satisfies readonly EmotionPostureLevel[];

const EMOTION_POSTURE_BONE_NAMES = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftShoulder",
  "rightShoulder",
] as const satisfies readonly VRMHumanBoneName[];

type EmotionPostureBoneName = (typeof EMOTION_POSTURE_BONE_NAMES)[number];

const EMOTION_POSTURE_TARGET_KEYS = [
  "hipsPitchDeg",
  "spinePitchDeg",
  "chestPitchDeg",
  "upperChestPitchDeg",
  "neckPitchDeg",
  "headPitchDeg",
  "headYawDeg",
  "headRollDeg",
  "shoulderLiftCm",
] as const satisfies readonly (keyof EmotionPostureTarget)[];

export type EmotionPostureResolution = {
  resolvedGroup: EmotionGroup | "neutral";
  resolvedLevel: 0 | EmotionPostureLevel;
  primaryEmotion: TrackedEmotion | null;
  presetEnabled: boolean;
  reason: EmotionPostureResolutionReason;
  target: EmotionPostureTarget | null;
  postureIntensity: number;
};

const ZERO_TARGET: EmotionPostureTarget = {
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

export class EmotionPostureProceduralAnimationLayer implements ProceduralAnimationLayer<"emotionPosture"> {
  readonly id = "emotionPosture";

  private _vrm: VRM | null;
  private _isVrm0: boolean;
  private _params: EmotionPostureProceduralAnimationParams =
    cloneEmotionPostureParams(
      DEFAULT_EMOTION_POSTURE_PROCEDURAL_ANIMATION_PARAMS,
    );
  private _bones = new Map<EmotionPostureBoneName, THREE.Object3D>();
  private _currentTarget: EmotionPostureTarget = { ...ZERO_TARGET };
  private _lastDebug: EmotionPostureDebugSnapshot =
    createEmotionPostureDebugSnapshot(
      createNeutralResolution("neutral"),
      0,
      ZERO_TARGET,
    );
  private _lastRotOffsets = new Map<EmotionPostureBoneName, THREE.Quaternion>();
  private _lastPosOffsets = new Map<EmotionPostureBoneName, THREE.Vector3>();
  private _rotOffsetCache = new Map<EmotionPostureBoneName, THREE.Quaternion>();
  private _posOffsetCache = new Map<EmotionPostureBoneName, THREE.Vector3>();
  private _scratchEuler = new THREE.Euler(0, 0, 0, "XYZ");
  private _scratchOffset = new THREE.Quaternion();
  private _scratchInverseOffset = new THREE.Quaternion();

  constructor(vrm: VRM, options: ProceduralAnimationBasisOptions = {}) {
    this._vrm = vrm;
    this._isVrm0 = options.isVrm0 === true;
    this._cacheBones();
  }

  clearOffsets(): void {
    this._lastRotOffsets.forEach((offset, boneName) => {
      const bone = this._bones.get(boneName);
      if (!bone) return;

      this._scratchInverseOffset.copy(offset).invert();
      bone.quaternion.multiply(this._scratchInverseOffset);
    });
    this._lastRotOffsets.clear();

    this._lastPosOffsets.forEach((offset, boneName) => {
      const bone = this._bones.get(boneName);
      if (!bone) return;

      bone.position.sub(offset);
    });
    this._lastPosOffsets.clear();
  }

  update(deltaSec: number, context: ProceduralAnimationRuntimeContext): void {
    this.clearOffsets();

    if (!this._vrm || !this._params.enabled) return;

    const activationWeight = sanitizeUnitInterval(
      context.layerActivationWeight,
    );
    const resolution = resolveEmotionPostureTarget(
      this._params,
      context.emotionalState,
    );
    const isActive = isActivePostureResolution(resolution);
    const effectiveIntensity = isActive
      ? resolution.postureIntensity * activationWeight
      : 0;
    const desiredTarget = resolution.target
      ? scaleEmotionPostureTarget(resolution.target, activationWeight)
      : ZERO_TARGET;
    const blendSec = sanitizeBlendSec(
      isActive ? this._params.enterBlendSec : this._params.exitBlendSec,
    );

    this._currentTarget = blendEmotionPostureTarget(
      this._currentTarget,
      desiredTarget,
      deltaSec,
      blendSec,
    );
    this._lastDebug = createEmotionPostureDebugSnapshot(
      resolution,
      effectiveIntensity,
      this._currentTarget,
    );

    if (isEmotionPostureTargetZero(this._currentTarget)) return;

    this._applyRotation("hips", this._currentTarget.hipsPitchDeg, 0, 0);
    this._applyRotation("spine", this._currentTarget.spinePitchDeg, 0, 0);
    this._applyRotation("chest", this._currentTarget.chestPitchDeg, 0, 0);
    this._applyRotation(
      "upperChest",
      this._currentTarget.upperChestPitchDeg,
      0,
      0,
    );
    this._applyRotation("neck", this._currentTarget.neckPitchDeg, 0, 0);
    this._applyRotation(
      "head",
      this._currentTarget.headPitchDeg,
      this._currentTarget.headYawDeg,
      this._currentTarget.headRollDeg,
    );
    const shoulderLift = this._currentTarget.shoulderLiftCm * 0.01;
    this._applyPosition("leftShoulder", 0, shoulderLift, 0);
    this._applyPosition("rightShoulder", 0, shoulderLift, 0);
  }

  getSnapshot(): ProceduralAnimationLayerSnapshot<"emotionPosture"> {
    return {
      id: this.id,
      enabled: this._params.enabled,
      weight: 1,
      params: cloneEmotionPostureParams(this._params),
      resolvedBones: EMOTION_POSTURE_BONE_NAMES.filter((boneName) =>
        this._bones.has(boneName),
      ),
      missingBones: EMOTION_POSTURE_BONE_NAMES.filter(
        (boneName) => !this._bones.has(boneName),
      ),
      emotionPosture: {
        ...this._lastDebug,
        activeTarget: this._lastDebug.activeTarget
          ? { ...this._lastDebug.activeTarget }
          : null,
        currentTarget: { ...this._lastDebug.currentTarget },
      },
    };
  }

  setEnabled(enabled: boolean): void {
    this._params.enabled = enabled;
    if (!enabled) {
      this._resetRuntimeState();
    }
  }

  setWeight(weight: number): void {
    void weight;
  }

  setParams(params: Partial<EmotionPostureProceduralAnimationParams>): void {
    if (typeof params.enabled === "boolean") {
      this._params.enabled = params.enabled;
    }
    if (typeof params.plannerEnabled === "boolean") {
      this._params.plannerEnabled = params.plannerEnabled;
    }
    if (typeof params.debugModeEnabled === "boolean") {
      this._params.debugModeEnabled = params.debugModeEnabled;
    }
    if (isEmotionPostureGroup(params.debugGroup)) {
      this._params.debugGroup = params.debugGroup;
    }
    if (isEmotionPostureLevel(params.debugLevel)) {
      this._params.debugLevel = params.debugLevel;
    }
    this._params.enterBlendSec = sanitizeBlendSec(
      params.enterBlendSec,
      this._params.enterBlendSec,
    );
    this._params.exitBlendSec = sanitizeBlendSec(
      params.exitBlendSec,
      this._params.exitBlendSec,
    );

    if (params.presets) {
      this._params.presets = mergeEmotionPosturePresets(
        this._params.presets,
        params.presets,
      );
    }

    if (!this._params.enabled) {
      this._resetRuntimeState();
    }
  }

  reset(): void {
    this._params = cloneEmotionPostureParams(
      DEFAULT_EMOTION_POSTURE_PROCEDURAL_ANIMATION_PARAMS,
    );
    this._resetRuntimeState();
  }

  dispose(): void {
    this.clearOffsets();
    this._bones.clear();
    this._rotOffsetCache.clear();
    this._posOffsetCache.clear();
    this._vrm = null;
  }

  private _resetRuntimeState(): void {
    this.clearOffsets();
    this._currentTarget = { ...ZERO_TARGET };
    this._lastDebug = createEmotionPostureDebugSnapshot(
      createNeutralResolution("neutral"),
      0,
      ZERO_TARGET,
    );
  }

  private _cacheBones(): void {
    this._bones.clear();
    const humanoid = this._vrm?.humanoid;
    if (!humanoid) return;

    for (const boneName of EMOTION_POSTURE_BONE_NAMES) {
      const bone = humanoid.getNormalizedBoneNode(boneName);
      if (bone) {
        this._bones.set(boneName, bone);
      }
    }
  }

  private _applyRotation(
    boneName: EmotionPostureBoneName,
    xDeg: number,
    yDeg: number,
    zDeg: number,
  ): void {
    const bone = this._bones.get(boneName);
    if (!bone) return;

    this._scratchEuler.set(
      xDeg * DEG_TO_RAD,
      yDeg * DEG_TO_RAD,
      zDeg * DEG_TO_RAD,
      "XYZ",
    );
    this._scratchOffset.setFromEuler(this._scratchEuler);
    if (this._isVrm0) {
      retargetVrm1AuthoredQuaternionOffsetToVrm0(this._scratchOffset);
    }

    const offset = this._getRotOffset(boneName);
    offset.copy(this._scratchOffset);
    bone.quaternion.multiply(offset);
    this._lastRotOffsets.set(boneName, offset);
  }

  private _applyPosition(
    boneName: EmotionPostureBoneName,
    x: number,
    y: number,
    z: number,
  ): void {
    const bone = this._bones.get(boneName);
    if (!bone) return;

    const offset = this._getPosOffset(boneName);
    offset.set(x, y, z);
    if (this._isVrm0) {
      retargetVrm1AuthoredPositionOffsetToVrm0(offset);
    }
    bone.position.add(offset);
    this._lastPosOffsets.set(boneName, offset);
  }

  private _getRotOffset(boneName: EmotionPostureBoneName): THREE.Quaternion {
    let offset = this._rotOffsetCache.get(boneName);
    if (!offset) {
      offset = new THREE.Quaternion();
      this._rotOffsetCache.set(boneName, offset);
    }
    return offset;
  }

  private _getPosOffset(boneName: EmotionPostureBoneName): THREE.Vector3 {
    let offset = this._posOffsetCache.get(boneName);
    if (!offset) {
      offset = new THREE.Vector3();
      this._posOffsetCache.set(boneName, offset);
    }
    return offset;
  }
}

export function resolveEmotionPostureTarget(
  params: EmotionPostureProceduralAnimationParams,
  emotionalState: EmotionRuntimeState,
): EmotionPostureResolution {
  if (params.debugModeEnabled) {
    return resolveEmotionPosturePreset({
      group: params.debugGroup,
      level: params.debugLevel,
      primaryEmotion: null,
      params,
      activeReason: "debugOverride",
    });
  }

  if (!params.plannerEnabled) {
    return createNeutralResolution("plannerDisabled");
  }

  const summary = emotionalState.dominantGroupSummary;
  const group = emotionalState.dominantGroup;
  if (!summary || group === "neutral") {
    return createNeutralResolution("neutral");
  }

  const level = summary.intensity;
  if (level <= 0) {
    return {
      ...createNeutralResolution("levelZero"),
      resolvedGroup: group,
      primaryEmotion: summary.primaryEmotion?.emotion ?? null,
    };
  }

  if (!isEmotionPostureGroup(group)) {
    return {
      ...createNeutralResolution("unsupportedGroup"),
      resolvedGroup: group,
      resolvedLevel: level as EmotionPostureLevel,
      primaryEmotion: summary.primaryEmotion?.emotion ?? null,
    };
  }

  return resolveEmotionPosturePreset({
    group,
    level: level as EmotionPostureLevel,
    primaryEmotion: summary.primaryEmotion?.emotion ?? null,
    params,
    activeReason: "active",
  });
}

function resolveEmotionPosturePreset(args: {
  group: EmotionPostureGroup;
  level: EmotionPostureLevel;
  primaryEmotion: TrackedEmotion | null;
  params: EmotionPostureProceduralAnimationParams;
  activeReason: "active" | "debugOverride";
}): EmotionPostureResolution {
  const preset = args.params.presets[args.group];
  if (!preset) {
    return {
      ...createNeutralResolution("missingPreset"),
      resolvedGroup: args.group,
      resolvedLevel: args.level,
      primaryEmotion: args.primaryEmotion,
    };
  }

  if (!preset.enabled) {
    return {
      ...createNeutralResolution("presetDisabled"),
      resolvedGroup: args.group,
      resolvedLevel: args.level,
      primaryEmotion: args.primaryEmotion,
      presetEnabled: false,
    };
  }

  return {
    resolvedGroup: args.group,
    resolvedLevel: args.level,
    primaryEmotion: args.primaryEmotion,
    presetEnabled: true,
    reason: args.activeReason,
    target: scaleEmotionPostureTarget(
      preset.target,
      sanitizeUnitInterval(preset.intensityByLevel[args.level]),
    ),
    postureIntensity: sanitizeUnitInterval(preset.intensityByLevel[args.level]),
  };
}

function isActivePostureResolution(
  resolution: EmotionPostureResolution,
): boolean {
  return (
    resolution.reason === "active" || resolution.reason === "debugOverride"
  );
}

function createEmotionPostureDebugSnapshot(
  resolution: EmotionPostureResolution,
  effectiveIntensity: number,
  currentTarget: EmotionPostureTarget,
): EmotionPostureDebugSnapshot {
  return {
    resolvedGroup: resolution.resolvedGroup,
    resolvedLevel: resolution.resolvedLevel,
    primaryEmotion: resolution.primaryEmotion,
    levelIntensity: resolution.postureIntensity,
    effectiveIntensity,
    presetEnabled: resolution.presetEnabled,
    reason: resolution.reason,
    activeTarget: resolution.target ? { ...resolution.target } : null,
    currentTarget: { ...currentTarget },
  };
}

function createNeutralResolution(
  reason: EmotionPostureResolutionReason,
): EmotionPostureResolution {
  return {
    resolvedGroup: "neutral",
    resolvedLevel: 0,
    primaryEmotion: null,
    presetEnabled: false,
    reason,
    target: null,
    postureIntensity: 0,
  };
}

function cloneEmotionPostureParams(
  params: EmotionPostureProceduralAnimationParams,
): EmotionPostureProceduralAnimationParams {
  return {
    ...params,
    presets: Object.fromEntries(
      SUPPORTED_EMOTION_POSTURE_GROUPS.map((group) => [
        group,
        cloneEmotionPosturePreset(params.presets[group]),
      ]),
    ) as EmotionPostureProceduralAnimationParams["presets"],
  };
}

function cloneEmotionPosturePreset(
  preset: EmotionPosturePresetParams,
): EmotionPosturePresetParams {
  return {
    enabled: preset.enabled,
    intensityByLevel: cloneEmotionPostureLevelIntensities(
      preset.intensityByLevel,
    ),
    target: cloneEmotionPostureTarget(preset.target),
  };
}

function cloneEmotionPostureLevelIntensities(
  intensities: EmotionPosturePresetParams["intensityByLevel"],
): EmotionPosturePresetParams["intensityByLevel"] {
  return Object.fromEntries(
    EMOTION_POSTURE_LEVELS.map((level) => [
      level,
      sanitizeUnitInterval(intensities[level]),
    ]),
  ) as EmotionPosturePresetParams["intensityByLevel"];
}

function cloneEmotionPostureTarget(
  target: EmotionPostureTarget,
): EmotionPostureTarget {
  return mapEmotionPostureTarget(target, (value, key) =>
    key === "shoulderLiftCm"
      ? sanitizeTargetCm(value)
      : sanitizeTargetDeg(value),
  );
}

function mergeEmotionPosturePresets(
  current: EmotionPostureProceduralAnimationParams["presets"],
  patch: Partial<EmotionPostureProceduralAnimationParams["presets"]>,
): EmotionPostureProceduralAnimationParams["presets"] {
  const next = cloneEmotionPostureParams({
    ...DEFAULT_EMOTION_POSTURE_PROCEDURAL_ANIMATION_PARAMS,
    presets: current,
  }).presets;

  for (const group of SUPPORTED_EMOTION_POSTURE_GROUPS) {
    const presetPatch = patch[group];
    if (!presetPatch) continue;

    next[group] = {
      ...next[group],
      enabled:
        typeof presetPatch.enabled === "boolean"
          ? presetPatch.enabled
          : next[group].enabled,
      intensityByLevel: mergeEmotionPostureLevelIntensities(
        next[group].intensityByLevel,
        presetPatch.intensityByLevel,
      ),
      target: mergeEmotionPostureTarget(next[group].target, presetPatch.target),
    };
  }

  return next;
}

function mergeEmotionPostureLevelIntensities(
  current: EmotionPosturePresetParams["intensityByLevel"],
  patch: Partial<EmotionPosturePresetParams["intensityByLevel"]> | undefined,
): EmotionPosturePresetParams["intensityByLevel"] {
  return Object.fromEntries(
    EMOTION_POSTURE_LEVELS.map((level) => [
      level,
      sanitizeUnitInterval(patch?.[level] ?? current[level]),
    ]),
  ) as EmotionPosturePresetParams["intensityByLevel"];
}

function mergeEmotionPostureTarget(
  current: EmotionPostureTarget,
  patch: Partial<EmotionPostureTarget> | undefined,
): EmotionPostureTarget {
  if (!patch) return cloneEmotionPostureTarget(current);
  return cloneEmotionPostureTarget({
    ...current,
    ...patch,
  });
}

function scaleEmotionPostureTarget(
  target: EmotionPostureTarget,
  scale: number,
): EmotionPostureTarget {
  return mapEmotionPostureTarget(target, (value) => value * scale);
}

function blendEmotionPostureTarget(
  current: EmotionPostureTarget,
  target: EmotionPostureTarget,
  deltaSec: number,
  blendSec: number,
): EmotionPostureTarget {
  if (!Number.isFinite(deltaSec) || deltaSec <= 0) return current;
  const alpha =
    blendSec <= 0 ? 1 : THREE.MathUtils.clamp(deltaSec / blendSec, 0, 1);
  return mapEmotionPostureTarget(current, (value, key) =>
    THREE.MathUtils.lerp(value, target[key], alpha),
  );
}

function isEmotionPostureTargetZero(target: EmotionPostureTarget): boolean {
  return EMOTION_POSTURE_TARGET_KEYS.every(
    (key) => Math.abs(target[key]) <= TARGET_EPSILON,
  );
}

function mapEmotionPostureTarget(
  target: EmotionPostureTarget,
  mapValue: (value: number, key: keyof EmotionPostureTarget) => number,
): EmotionPostureTarget {
  return Object.fromEntries(
    EMOTION_POSTURE_TARGET_KEYS.map((key) => [key, mapValue(target[key], key)]),
  ) as EmotionPostureTarget;
}

function sanitizeUnitInterval(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return THREE.MathUtils.clamp(value, 0, 1);
}

function isEmotionPostureLevel(value: unknown): value is EmotionPostureLevel {
  return value === 1 || value === 2 || value === 3;
}

function sanitizeBlendSec(value: unknown, fallback: number = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return THREE.MathUtils.clamp(value, 0, MAX_POSTURE_BLEND_SEC);
}

function sanitizeTargetDeg(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return THREE.MathUtils.clamp(value, -MAX_TARGET_DEG, MAX_TARGET_DEG);
}

function sanitizeTargetCm(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return THREE.MathUtils.clamp(
    value,
    -MAX_SHOULDER_LIFT_CM,
    MAX_SHOULDER_LIFT_CM,
  );
}
