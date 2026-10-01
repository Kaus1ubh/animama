import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

import {
  DEFAULT_HEAD_NOD_PROCEDURAL_ANIMATION_PARAMS,
  type HeadNodProceduralAnimationParams,
  type ProceduralAnimationBasisOptions,
  type ProceduralAnimationLayer,
  type ProceduralAnimationLayerSnapshot,
  type ProceduralAnimationRuntimeContext,
  type ProceduralAnimationTransitionState,
} from "./types";
import { retargetVrm1AuthoredQuaternionOffsetToVrm0 } from "../poses/poseRetargeting";

const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_LAYER_WEIGHT = 1;
const EPSILON = 0.0001;
const HEAD_NOD_DEACTIVATION_MIN_WAIT_SEC = 0.2;
const HEAD_NOD_DEACTIVATION_MAX_WAIT_SEC = 1.5;

const HEAD_NOD_BONE_NAMES = [
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
] as const satisfies readonly VRMHumanBoneName[];

type HeadNodBoneName = (typeof HEAD_NOD_BONE_NAMES)[number];
type SchedulerState = "pause" | "playback";
type NodPattern = "downCenter" | "upCenter" | "upDownCenter" | "microBob";

type NodPoseDeg = {
  pitch: number;
  yaw: number;
  roll: number;
};

type NodSegment = {
  from: NodPoseDeg;
  to: NodPoseDeg;
  durationSec: number;
};

const NEUTRAL_POSE: NodPoseDeg = {
  pitch: 0,
  yaw: 0,
  roll: 0,
};

export class HeadNodProceduralAnimationLayer implements ProceduralAnimationLayer<"headNod"> {
  readonly id = "headNod";

  private _vrm: VRM | null;
  private _params: HeadNodProceduralAnimationParams = {
    ...DEFAULT_HEAD_NOD_PROCEDURAL_ANIMATION_PARAMS,
  };
  private _weight: number = DEFAULT_LAYER_WEIGHT;
  private _bones = new Map<HeadNodBoneName, THREE.Object3D>();
  private _state: SchedulerState = "pause";
  private _pauseRemainingSec: number = 0;
  private _segments: NodSegment[] = [];
  private _segmentIndex: number = 0;
  private _segmentElapsedSec: number = 0;
  private _currentPose: NodPoseDeg = { ...NEUTRAL_POSE };
  private _lastOffsets = new Map<HeadNodBoneName, THREE.Quaternion>();
  private _offsetScratchByBone = new Map<HeadNodBoneName, THREE.Quaternion>();
  private _scratchEuler = new THREE.Euler(0, 0, 0, "XYZ");
  private _scratchOffset = new THREE.Quaternion();
  private _scratchInverseOffset = new THREE.Quaternion();

  /** VRM0 normalized bones face -Z, so VRM1-authored offsets are converted. */
  private readonly _isVrm0: boolean;

  constructor(vrm: VRM, options: ProceduralAnimationBasisOptions = {}) {
    this._vrm = vrm;
    this._isVrm0 = options.isVrm0 === true;
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
    const effectiveIntensity =
      this._params.intensity * this._weight * activationWeight;
    if (effectiveIntensity <= 0) return;

    if (this._state === "pause") {
      if (context.layerDeactivationRequested) return;

      this._ensurePauseScheduled();
      this._pauseRemainingSec -= deltaSec;
      if (this._pauseRemainingSec > 0) return;
      this._startNextGroup();
    }

    if (this._state !== "playback") return;

    this._advancePlayback(deltaSec);
    this._applyPose(this._currentPose, effectiveIntensity);
  }

  getSnapshot(): ProceduralAnimationLayerSnapshot<"headNod"> {
    return {
      id: this.id,
      enabled: this._params.enabled,
      weight: this._weight,
      params: { ...this._params },
      resolvedBones: HEAD_NOD_BONE_NAMES.filter((boneName) =>
        this._bones.has(boneName),
      ),
      missingBones: HEAD_NOD_BONE_NAMES.filter(
        (boneName) => !this._bones.has(boneName),
      ),
    };
  }

  getTransitionState(): ProceduralAnimationTransitionState {
    const remainingPlaybackSec = this._getRemainingPlaybackSec();

    return {
      canDeactivateNow:
        !this._params.enabled ||
        this._params.intensity <= 0 ||
        this._state === "pause",
      maxWaitSec: THREE.MathUtils.clamp(
        remainingPlaybackSec + 0.1,
        HEAD_NOD_DEACTIVATION_MIN_WAIT_SEC,
        HEAD_NOD_DEACTIVATION_MAX_WAIT_SEC,
      ),
    };
  }

  setEnabled(enabled: boolean): void {
    const wasEnabled = this._params.enabled;
    this._params.enabled = enabled;

    if (!enabled) {
      this.clearOffsets();
      this._clearPlaybackState();
      return;
    }

    if (!wasEnabled) {
      this._resetScheduler();
    }
  }

  setWeight(weight: number): void {
    if (!Number.isFinite(weight)) return;

    const wasInactive = this._weight <= 0;
    this._weight = THREE.MathUtils.clamp(weight, 0, 1);

    if (this._weight <= 0) {
      this.clearOffsets();
      this._clearPlaybackState();
      return;
    }

    if (wasInactive && this._params.enabled) {
      this._resetScheduler();
    }
  }

  setParams(params: Partial<HeadNodProceduralAnimationParams>): void {
    const wasEnabled = this._params.enabled;
    const wasInactive = this._params.intensity <= 0;

    if (typeof params.enabled === "boolean") {
      this._params.enabled = params.enabled;
    }
    this._params.intensity = sanitizeNonNegativeNumber(
      params.intensity,
      this._params.intensity,
    );
    this._params.pauseMinSec = sanitizeNonNegativeNumber(
      params.pauseMinSec,
      this._params.pauseMinSec,
    );
    this._params.pauseMaxSec = sanitizeNonNegativeNumber(
      params.pauseMaxSec,
      this._params.pauseMaxSec,
    );
    this._params.amplitudeMin = sanitizeNonNegativeNumber(
      params.amplitudeMin,
      this._params.amplitudeMin,
    );
    this._params.amplitudeMax = sanitizeNonNegativeNumber(
      params.amplitudeMax,
      this._params.amplitudeMax,
    );
    this._params.smallNodMaxCount = sanitizePositiveInteger(
      params.smallNodMaxCount,
      this._params.smallNodMaxCount,
    );
    this._params.largeNodMaxCount = sanitizePositiveInteger(
      params.largeNodMaxCount,
      this._params.largeNodMaxCount,
    );
    this._params.upNodChance = sanitizeUnitInterval(
      params.upNodChance,
      this._params.upNodChance,
    );
    this._params.upDownChance = sanitizeUnitInterval(
      params.upDownChance,
      this._params.upDownChance,
    );
    this._params.torsoFollow = sanitizeUnitInterval(
      params.torsoFollow,
      this._params.torsoFollow,
    );
    this._params.sideTilt = sanitizeNonNegativeNumber(
      params.sideTilt,
      this._params.sideTilt,
    );
    this._params.speed = sanitizePositiveNumber(
      params.speed,
      this._params.speed,
    );

    if (!this._params.enabled || this._params.intensity <= 0) {
      this.clearOffsets();
      this._clearPlaybackState();
      return;
    }

    if (!wasEnabled || wasInactive) {
      this._resetScheduler();
    }
  }

  reset(): void {
    this.clearOffsets();
    this._params = { ...DEFAULT_HEAD_NOD_PROCEDURAL_ANIMATION_PARAMS };
    this._weight = DEFAULT_LAYER_WEIGHT;
    this._clearPlaybackState();
  }

  dispose(): void {
    this.clearOffsets();
    this._bones.clear();
    this._lastOffsets.clear();
    this._offsetScratchByBone.clear();
    this._clearPlaybackState();
    this._vrm = null;
  }

  private _cacheBones(): void {
    if (!this._vrm) return;

    for (const boneName of HEAD_NOD_BONE_NAMES) {
      const bone = this._vrm.humanoid.getNormalizedBoneNode(boneName);
      if (bone) {
        this._bones.set(boneName, bone);
      }
    }
  }

  private _ensurePauseScheduled(): void {
    if (this._pauseRemainingSec > 0) return;
    this._scheduleNextPause();
  }

  private _scheduleNextPause(): void {
    const [pauseMin, pauseMax] = sortedPair(
      this._params.pauseMinSec,
      this._params.pauseMaxSec,
    );
    this._state = "pause";
    this._pauseRemainingSec = randomRange(pauseMin, pauseMax);
  }

  private _startNextGroup(): void {
    const segments = this._buildNodGroup();
    if (!segments.length) {
      this._clearPlaybackState();
      this._scheduleNextPause();
      return;
    }

    this._segments = segments;
    this._segmentIndex = 0;
    this._segmentElapsedSec = 0;
    this._currentPose = { ...NEUTRAL_POSE };
    this._state = "playback";
  }

  private _buildNodGroup(): NodSegment[] {
    const [amplitudeMin, amplitudeMax] = sortedPair(
      this._params.amplitudeMin,
      this._params.amplitudeMax,
    );
    if (amplitudeMax <= 0) return [];

    const amplitudeRand = Math.random();
    const amplitudeDeg =
      amplitudeMin +
      (amplitudeMax - amplitudeMin) * amplitudeRand * amplitudeRand;
    const amplitudeT =
      amplitudeMax > amplitudeMin
        ? THREE.MathUtils.clamp(
            (amplitudeDeg - amplitudeMin) / (amplitudeMax - amplitudeMin),
            0,
            1,
          )
        : 0;
    const smallMax = Math.max(1, Math.round(this._params.smallNodMaxCount));
    const largeMax = Math.max(1, Math.round(this._params.largeNodMaxCount));
    const maxCount = Math.max(
      1,
      Math.round(THREE.MathUtils.lerp(smallMax, largeMax, amplitudeT)),
    );
    const nodCount = randomInt(1, maxCount);
    const useMicroBob = nodCount > 2 && amplitudeT < 0.5;
    const speed = Math.max(0.05, this._params.speed);
    const strokeDurationSec = Math.max(
      0.05,
      (0.12 + amplitudeDeg * 0.035) / speed,
    );
    const groupRollDeg = randomSigned() * this._params.sideTilt;
    const groupYawDeg = randomSigned() * this._params.sideTilt * 0.35;
    const segments: NodSegment[] = [];
    let previousPose: NodPoseDeg = { ...NEUTRAL_POSE };

    const addSegment = (to: NodPoseDeg, durationSec: number) => {
      const segment: NodSegment = {
        from: { ...previousPose },
        to: { ...to },
        durationSec: Math.max(0.03, durationSec),
      };
      segments.push(segment);
      previousPose = { ...to };
    };

    for (let index = 0; index < nodCount; index += 1) {
      const pattern = useMicroBob ? "microBob" : this._pickPattern();
      const scale = useMicroBob
        ? randomRange(0.45, 0.75)
        : randomRange(0.85, 1.05);
      const amplitude = amplitudeDeg * scale;
      const roll = groupRollDeg * scale;
      const yaw = groupYawDeg * scale;

      this._appendPatternSegments({
        addSegment,
        pattern,
        amplitude,
        yaw,
        roll,
        strokeDurationSec: useMicroBob
          ? strokeDurationSec * 0.75
          : strokeDurationSec,
      });

      if (index < nodCount - 1) {
        addSegment({ ...NEUTRAL_POSE }, randomRange(0.05, 0.18));
      }
    }

    return segments;
  }

  private _appendPatternSegments({
    addSegment,
    pattern,
    amplitude,
    yaw,
    roll,
    strokeDurationSec,
  }: {
    addSegment: (to: NodPoseDeg, durationSec: number) => void;
    pattern: NodPattern;
    amplitude: number;
    yaw: number;
    roll: number;
    strokeDurationSec: number;
  }): void {
    switch (pattern) {
      case "upCenter":
        addSegment({ pitch: amplitude, yaw, roll }, strokeDurationSec);
        addSegment({ ...NEUTRAL_POSE }, strokeDurationSec * 0.85);
        return;
      case "upDownCenter":
        addSegment(
          { pitch: amplitude * 0.65, yaw: yaw * 0.75, roll: roll * 0.75 },
          strokeDurationSec * 0.85,
        );
        addSegment({ pitch: -amplitude, yaw, roll }, strokeDurationSec * 1.05);
        addSegment({ ...NEUTRAL_POSE }, strokeDurationSec * 0.9);
        return;
      case "microBob":
      case "downCenter":
      default:
        addSegment({ pitch: -amplitude, yaw, roll }, strokeDurationSec);
        addSegment({ ...NEUTRAL_POSE }, strokeDurationSec * 0.85);
        return;
    }
  }

  private _pickPattern(): NodPattern {
    const upChance = THREE.MathUtils.clamp(this._params.upNodChance, 0, 1);
    const upDownChance = THREE.MathUtils.clamp(this._params.upDownChance, 0, 1);
    const roll = Math.random();
    if (roll < upChance) return "upCenter";
    if (roll < upChance + upDownChance) return "upDownCenter";
    return "downCenter";
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
      this._currentPose = interpolatePose(
        segment.from,
        segment.to,
        smoothstep(t),
      );

      if (this._segmentElapsedSec < durationSec - EPSILON) {
        return;
      }

      this._currentPose = { ...segment.to };
      this._segmentIndex += 1;
      this._segmentElapsedSec = 0;

      if (remainingSec <= EPSILON) {
        return;
      }
    }
  }

  private _finishGroup(): void {
    this._clearPlaybackState();
    this._scheduleNextPause();
  }

  private _clearPlaybackState(): void {
    this._state = "pause";
    this._pauseRemainingSec = 0;
    this._segments = [];
    this._segmentIndex = 0;
    this._segmentElapsedSec = 0;
    this._currentPose = { ...NEUTRAL_POSE };
  }

  private _resetScheduler(): void {
    this._clearPlaybackState();
    this._scheduleNextPause();
  }

  private _getRemainingPlaybackSec(): number {
    if (this._state !== "playback") return 0;

    let remainingSec = 0;
    for (
      let index = this._segmentIndex;
      index < this._segments.length;
      index += 1
    ) {
      const segment = this._segments[index];
      if (!segment) continue;

      if (index === this._segmentIndex) {
        remainingSec += Math.max(
          0,
          segment.durationSec - this._segmentElapsedSec,
        );
        continue;
      }

      remainingSec += segment.durationSec;
    }
    return remainingSec;
  }

  private _applyPose(pose: NodPoseDeg, effectiveIntensity: number): void {
    const pitch = pose.pitch * DEG_TO_RAD * effectiveIntensity;
    const yaw = pose.yaw * DEG_TO_RAD * effectiveIntensity;
    const roll = pose.roll * DEG_TO_RAD * effectiveIntensity;
    const torsoFollow = THREE.MathUtils.clamp(this._params.torsoFollow, 0, 1);

    this._applyOffset("spine", pitch * torsoFollow * 0.03, 0, 0);
    this._applyOffset(
      "chest",
      pitch * torsoFollow * 0.06,
      yaw * torsoFollow * 0.06,
      roll * torsoFollow * 0.1,
    );
    this._applyOffset(
      "upperChest",
      pitch * torsoFollow * 0.12,
      yaw * torsoFollow * 0.12,
      roll * torsoFollow * 0.2,
    );
    this._applyOffset("neck", pitch * 0.45, yaw * 0.35, roll * 0.45);
    this._applyOffset("head", pitch, yaw, roll);
  }

  private _applyOffset(
    boneName: HeadNodBoneName,
    x: number,
    y: number,
    z: number,
  ): void {
    const bone = this._bones.get(boneName);
    if (!bone) return;

    this._scratchEuler.set(x, y, z, "XYZ");
    this._scratchOffset.setFromEuler(this._scratchEuler);
    if (this._isVrm0) {
      retargetVrm1AuthoredQuaternionOffsetToVrm0(this._scratchOffset);
    }

    const offset = this._getOffsetScratch(boneName);
    offset.copy(this._scratchOffset);
    bone.quaternion.multiply(offset);
    this._lastOffsets.set(boneName, offset);
  }

  private _getOffsetScratch(boneName: HeadNodBoneName): THREE.Quaternion {
    const existing = this._offsetScratchByBone.get(boneName);
    if (existing) return existing;

    const offset = new THREE.Quaternion();
    this._offsetScratchByBone.set(boneName, offset);
    return offset;
  }
}

function interpolatePose(
  from: NodPoseDeg,
  to: NodPoseDeg,
  t: number,
): NodPoseDeg {
  return {
    pitch: THREE.MathUtils.lerp(from.pitch, to.pitch, t),
    yaw: THREE.MathUtils.lerp(from.yaw, to.yaw, t),
    roll: THREE.MathUtils.lerp(from.roll, to.roll, t),
  };
}

function smoothstep(t: number): number {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function randomRange(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  const lower = Math.ceil(min);
  const upper = Math.floor(max);
  if (upper <= lower) return lower;
  return lower + Math.floor(Math.random() * (upper - lower + 1));
}

function randomSigned(): number {
  return Math.random() * 2 - 1;
}

function sortedPair(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function sanitizeNonNegativeNumber(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

function sanitizePositiveNumber(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0.05, value);
}

function sanitizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.round(value));
}

function sanitizeUnitInterval(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return THREE.MathUtils.clamp(value, 0, 1);
}

function sanitizeActivationWeight(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return THREE.MathUtils.clamp(value, 0, 1);
}
