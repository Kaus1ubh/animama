import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

import {
  DEFAULT_HEAD_SIDE_TILT_PROCEDURAL_ANIMATION_PARAMS,
  type HeadSideTiltProceduralAnimationParams,
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
const MIN_SEGMENT_DURATION_SEC = 0.03;
const HEAD_SIDE_TILT_DEACTIVATION_MIN_WAIT_SEC = 0.2;
const HEAD_SIDE_TILT_DEACTIVATION_MAX_WAIT_SEC = 1.5;
const NECK_FOLLOW_PITCH = 0.2;
const NECK_FOLLOW_YAW = 0.2;
const NECK_FOLLOW_ROLL = 0.25;

const HEAD_SIDE_TILT_BONE_NAMES = [
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
] as const satisfies readonly VRMHumanBoneName[];

type HeadSideTiltBoneName = (typeof HEAD_SIDE_TILT_BONE_NAMES)[number];
type SchedulerState = "pause" | "playback";
type TiltSide = -1 | 1;

type HeadSideTiltPoseDeg = {
  pitch: number;
  yaw: number;
  roll: number;
};

type HeadSideTiltSegment = {
  from: HeadSideTiltPoseDeg;
  to: HeadSideTiltPoseDeg;
  durationSec: number;
};

const NEUTRAL_POSE: HeadSideTiltPoseDeg = {
  pitch: 0,
  yaw: 0,
  roll: 0,
};

export class HeadSideTiltProceduralAnimationLayer implements ProceduralAnimationLayer<"headSideTilt"> {
  readonly id = "headSideTilt";

  private _vrm: VRM | null;
  private _params: HeadSideTiltProceduralAnimationParams = {
    ...DEFAULT_HEAD_SIDE_TILT_PROCEDURAL_ANIMATION_PARAMS,
  };
  private _weight: number = DEFAULT_LAYER_WEIGHT;
  private _bones = new Map<HeadSideTiltBoneName, THREE.Object3D>();
  private _state: SchedulerState = "pause";
  private _pauseRemainingSec: number = 0;
  private _segments: HeadSideTiltSegment[] = [];
  private _segmentIndex: number = 0;
  private _segmentElapsedSec: number = 0;
  private _currentPose: HeadSideTiltPoseDeg = { ...NEUTRAL_POSE };
  private _lastSide: TiltSide | null = null;
  private _lastOffsets = new Map<HeadSideTiltBoneName, THREE.Quaternion>();
  private _offsetScratchByBone = new Map<
    HeadSideTiltBoneName,
    THREE.Quaternion
  >();
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

  getSnapshot(): ProceduralAnimationLayerSnapshot<"headSideTilt"> {
    return {
      id: this.id,
      enabled: this._params.enabled,
      weight: this._weight,
      params: { ...this._params },
      resolvedBones: HEAD_SIDE_TILT_BONE_NAMES.filter((boneName) =>
        this._bones.has(boneName),
      ),
      missingBones: HEAD_SIDE_TILT_BONE_NAMES.filter(
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
        HEAD_SIDE_TILT_DEACTIVATION_MIN_WAIT_SEC,
        HEAD_SIDE_TILT_DEACTIVATION_MAX_WAIT_SEC,
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

  setParams(params: Partial<HeadSideTiltProceduralAnimationParams>): void {
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
    this._params.tiltMin = sanitizeNonNegativeNumber(
      params.tiltMin,
      this._params.tiltMin,
    );
    this._params.tiltMax = sanitizeNonNegativeNumber(
      params.tiltMax,
      this._params.tiltMax,
    );
    this._params.downPitch = sanitizeFiniteNumber(
      params.downPitch,
      this._params.downPitch,
    );
    this._params.yawAmount = sanitizeFiniteNumber(
      params.yawAmount,
      this._params.yawAmount,
    );
    this._params.holdMinSec = sanitizeNonNegativeNumber(
      params.holdMinSec,
      this._params.holdMinSec,
    );
    this._params.holdMaxSec = sanitizeNonNegativeNumber(
      params.holdMaxSec,
      this._params.holdMaxSec,
    );
    this._params.transitionMinSec = sanitizeNonNegativeNumber(
      params.transitionMinSec,
      this._params.transitionMinSec,
    );
    this._params.transitionMaxSec = sanitizeNonNegativeNumber(
      params.transitionMaxSec,
      this._params.transitionMaxSec,
    );
    this._params.torsoFollow = sanitizeUnitInterval(
      params.torsoFollow,
      this._params.torsoFollow,
    );
    this._params.alternateSideChance = sanitizeUnitInterval(
      params.alternateSideChance,
      this._params.alternateSideChance,
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
    this._params = { ...DEFAULT_HEAD_SIDE_TILT_PROCEDURAL_ANIMATION_PARAMS };
    this._weight = DEFAULT_LAYER_WEIGHT;
    this._lastSide = null;
    this._clearPlaybackState();
  }

  dispose(): void {
    this.clearOffsets();
    this._bones.clear();
    this._lastOffsets.clear();
    this._offsetScratchByBone.clear();
    this._lastSide = null;
    this._clearPlaybackState();
    this._vrm = null;
  }

  private _cacheBones(): void {
    if (!this._vrm) return;

    for (const boneName of HEAD_SIDE_TILT_BONE_NAMES) {
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
    const segments = this._buildTiltGroup();
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

  private _buildTiltGroup(): HeadSideTiltSegment[] {
    const [tiltMin, tiltMax] = sortedPair(
      this._params.tiltMin,
      this._params.tiltMax,
    );
    if (tiltMax <= 0) return [];

    const tiltRand = Math.random();
    const tiltDeg = tiltMin + (tiltMax - tiltMin) * tiltRand * tiltRand;
    const tiltT =
      tiltMax > tiltMin
        ? THREE.MathUtils.clamp((tiltDeg - tiltMin) / (tiltMax - tiltMin), 0, 1)
        : 1;
    const side = this._pickSide();
    const speed = Math.max(0.05, this._params.speed);
    const [transitionMin, transitionMax] = sortedPair(
      this._params.transitionMinSec,
      this._params.transitionMaxSec,
    );
    const [holdMin, holdMax] = sortedPair(
      this._params.holdMinSec,
      this._params.holdMaxSec,
    );
    const enterDurationSec =
      Math.max(
        MIN_SEGMENT_DURATION_SEC,
        randomRange(transitionMin, transitionMax),
      ) / speed;
    const returnDurationSec =
      Math.max(
        MIN_SEGMENT_DURATION_SEC,
        randomRange(transitionMin, transitionMax),
      ) / speed;
    const holdDurationSec = Math.max(0, randomRange(holdMin, holdMax)) / speed;
    const downPitchScale = THREE.MathUtils.lerp(0.45, 1, tiltT);
    const tiltedPose: HeadSideTiltPoseDeg = {
      pitch: -this._params.downPitch * downPitchScale,
      yaw: this._params.yawAmount * side,
      roll: tiltDeg * side,
    };

    this._lastSide = side;

    const segments: HeadSideTiltSegment[] = [
      {
        from: { ...NEUTRAL_POSE },
        to: tiltedPose,
        durationSec: enterDurationSec,
      },
    ];
    if (holdDurationSec > EPSILON) {
      segments.push({
        from: tiltedPose,
        to: tiltedPose,
        durationSec: holdDurationSec,
      });
    }
    segments.push({
      from: tiltedPose,
      to: { ...NEUTRAL_POSE },
      durationSec: returnDurationSec,
    });
    return segments;
  }

  private _pickSide(): TiltSide {
    if (
      this._lastSide !== null &&
      Math.random() < this._params.alternateSideChance
    ) {
      return this._lastSide === 1 ? -1 : 1;
    }
    return Math.random() < 0.5 ? -1 : 1;
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

  private _applyPose(
    pose: HeadSideTiltPoseDeg,
    effectiveIntensity: number,
  ): void {
    const pitch = pose.pitch * DEG_TO_RAD * effectiveIntensity;
    const yaw = pose.yaw * DEG_TO_RAD * effectiveIntensity;
    const roll = pose.roll * DEG_TO_RAD * effectiveIntensity;
    const torsoFollow = THREE.MathUtils.clamp(this._params.torsoFollow, 0, 1);
    const neckPitch = pitch * NECK_FOLLOW_PITCH;
    const neckYaw = yaw * NECK_FOLLOW_YAW;
    const neckRoll = roll * NECK_FOLLOW_ROLL;

    this._applyOffset("spine", 0, 0, roll * torsoFollow * 0.03);
    this._applyOffset(
      "chest",
      pitch * torsoFollow * 0.04,
      yaw * torsoFollow * 0.06,
      roll * torsoFollow * 0.09,
    );
    this._applyOffset(
      "upperChest",
      pitch * torsoFollow * 0.08,
      yaw * torsoFollow * 0.12,
      roll * torsoFollow * 0.18,
    );
    this._applyOffset("neck", neckPitch, neckYaw, neckRoll);
    this._applyOffset(
      "head",
      pitch - neckPitch,
      yaw - neckYaw,
      roll - neckRoll,
    );
  }

  private _applyOffset(
    boneName: HeadSideTiltBoneName,
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

  private _getOffsetScratch(boneName: HeadSideTiltBoneName): THREE.Quaternion {
    const existing = this._offsetScratchByBone.get(boneName);
    if (existing) return existing;

    const offset = new THREE.Quaternion();
    this._offsetScratchByBone.set(boneName, offset);
    return offset;
  }
}

function interpolatePose(
  from: HeadSideTiltPoseDeg,
  to: HeadSideTiltPoseDeg,
  t: number,
): HeadSideTiltPoseDeg {
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

function sanitizeFiniteNumber(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
}

function sanitizePositiveNumber(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0.05, value);
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
