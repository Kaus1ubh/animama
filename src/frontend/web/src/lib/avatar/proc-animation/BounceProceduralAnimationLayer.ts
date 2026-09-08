import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

import {
  DEFAULT_BOUNCE_PROCEDURAL_ANIMATION_PARAMS,
  type BounceProceduralAnimationParams,
  type ProceduralAnimationLayer,
  type ProceduralAnimationLayerSnapshot,
  type ProceduralAnimationRuntimeContext,
  type ProceduralAnimationTransitionState,
} from "./types";

const DEG_TO_RAD = Math.PI / 180;
const TAU = Math.PI * 2;
const DEFAULT_LAYER_WEIGHT = 1;
const BOUNCE_DEACTIVATION_EXIT_EPSILON = 0.14;
const BOUNCE_DEACTIVATION_MIN_WAIT_SEC = 0.2;
const BOUNCE_DEACTIVATION_MAX_WAIT_SEC = 1.5;
const BOUNCE_SETTLE_EPSILON = 0.01;
const MIN_BOUNCE_DURATION_SEC = 0.2;

const BOUNCE_BONE_NAMES = [
  "hips",
  "leftFoot",
  "rightFoot",
  "neck",
  "head",
] as const satisfies readonly VRMHumanBoneName[];

type BounceBoneName = (typeof BOUNCE_BONE_NAMES)[number];
type BounceSchedulerState = "pause" | "bounce";

export class BounceProceduralAnimationLayer implements ProceduralAnimationLayer<"bounce"> {
  readonly id = "bounce";

  private _vrm: VRM | null;
  private _params: BounceProceduralAnimationParams = {
    ...DEFAULT_BOUNCE_PROCEDURAL_ANIMATION_PARAMS,
  };
  private _weight: number = DEFAULT_LAYER_WEIGHT;
  private _bones = new Map<BounceBoneName, THREE.Object3D>();
  private _state: BounceSchedulerState = "pause";
  private _pauseRemainingSec: number = 0;
  private _bounceElapsedSec: number = 0;
  private _lift: number = 0;
  private _liftVelocity: number = 0;
  private _lastExitMagnitude: number = 0;
  private _lastRotOffsets = new Map<BounceBoneName, THREE.Quaternion>();
  private _lastPosOffsets = new Map<BounceBoneName, THREE.Vector3>();
  private _rotOffsetScratchByBone = new Map<BounceBoneName, THREE.Quaternion>();
  private _posOffsetScratchByBone = new Map<BounceBoneName, THREE.Vector3>();
  private _scratchEuler = new THREE.Euler(0, 0, 0, "XYZ");
  private _scratchOffset = new THREE.Quaternion();
  private _scratchInverseOffset = new THREE.Quaternion();

  constructor(vrm: VRM) {
    this._vrm = vrm;
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
      if (this._pauseRemainingSec > 0) {
        this._lastExitMagnitude = 0;
        return;
      }
      this._startBounce();
    }

    if (this._state !== "bounce") return;

    const lift = this._advanceBounce(deltaSec);
    if (this._state !== "bounce" || lift <= BOUNCE_SETTLE_EPSILON) return;

    const bodyLift = this._params.bodyLift * 0.01 * effectiveIntensity * lift;
    const footFlexion =
      this._params.footFlexion * DEG_TO_RAD * effectiveIntensity * lift;
    const headNod =
      this._params.headNod * DEG_TO_RAD * effectiveIntensity * lift;

    this._applyPosition("hips", 0, bodyLift, 0);
    this._applyRotation("leftFoot", footFlexion, 0, 0);
    this._applyRotation("rightFoot", footFlexion, 0, 0);
    this._applyRotation("neck", -headNod * 0.35, 0, 0);
    this._applyRotation("head", -headNod, 0, 0);
  }

  getSnapshot(): ProceduralAnimationLayerSnapshot<"bounce"> {
    return {
      id: this.id,
      enabled: this._params.enabled,
      weight: this._weight,
      params: { ...this._params },
      resolvedBones: BOUNCE_BONE_NAMES.filter((boneName) =>
        this._bones.has(boneName),
      ),
      missingBones: BOUNCE_BONE_NAMES.filter(
        (boneName) => !this._bones.has(boneName),
      ),
    };
  }

  getTransitionState(): ProceduralAnimationTransitionState {
    const remainingBounceSec = this._getRemainingBounceSec();

    return {
      canDeactivateNow:
        !this._params.enabled ||
        this._params.intensity <= 0 ||
        this._state === "pause" ||
        this._lastExitMagnitude <= BOUNCE_DEACTIVATION_EXIT_EPSILON,
      maxWaitSec: THREE.MathUtils.clamp(
        remainingBounceSec + 0.1,
        BOUNCE_DEACTIVATION_MIN_WAIT_SEC,
        BOUNCE_DEACTIVATION_MAX_WAIT_SEC,
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

    this._weight = THREE.MathUtils.clamp(weight, 0, 1);
    if (this._weight <= 0) {
      this.clearOffsets();
      this._clearPlaybackState();
    }
  }

  setParams(params: Partial<BounceProceduralAnimationParams>): void {
    if (typeof params.enabled === "boolean") {
      this._params.enabled = params.enabled;
    }
    this._params.intensity = sanitizeNonNegativeNumber(
      params.intensity,
      this._params.intensity,
    );
    this._params.bpm = sanitizeNonNegativeNumber(params.bpm, this._params.bpm);
    this._params.pauseMinSec = sanitizeNonNegativeNumber(
      params.pauseMinSec,
      this._params.pauseMinSec,
    );
    this._params.pauseMaxSec = sanitizeNonNegativeNumber(
      params.pauseMaxSec,
      this._params.pauseMaxSec,
    );
    this._params.bodyLift = sanitizeNonNegativeNumber(
      params.bodyLift,
      this._params.bodyLift,
    );
    this._params.footFlexion = sanitizeNonNegativeNumber(
      params.footFlexion,
      this._params.footFlexion,
    );
    this._params.headNod = sanitizeNonNegativeNumber(
      params.headNod,
      this._params.headNod,
    );
    this._params.lag = sanitizeLag(params.lag, this._params.lag);

    if (!this._params.enabled || this._params.intensity <= 0) {
      this.clearOffsets();
      this._clearPlaybackState();
    }
  }

  reset(): void {
    this.clearOffsets();
    this._params = { ...DEFAULT_BOUNCE_PROCEDURAL_ANIMATION_PARAMS };
    this._weight = DEFAULT_LAYER_WEIGHT;
    this._clearPlaybackState();
  }

  dispose(): void {
    this.clearOffsets();
    this._bones.clear();
    this._lastRotOffsets.clear();
    this._lastPosOffsets.clear();
    this._rotOffsetScratchByBone.clear();
    this._posOffsetScratchByBone.clear();
    this._clearPlaybackState();
    this._vrm = null;
  }

  private _cacheBones(): void {
    if (!this._vrm) return;

    for (const boneName of BOUNCE_BONE_NAMES) {
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

  private _startBounce(): void {
    this._state = "bounce";
    this._pauseRemainingSec = 0;
    this._bounceElapsedSec = 0;
    this._lift = 0;
    this._liftVelocity = 0;
    this._lastExitMagnitude = 0;
  }

  private _advanceBounce(deltaSec: number): number {
    const lag = THREE.MathUtils.clamp(this._params.lag, 0, 1);
    const stiffness = THREE.MathUtils.lerp(42, 10, lag);
    const damping = THREE.MathUtils.lerp(15, 5, lag);
    const bounceDurationSec = this._getBounceDurationSec();

    this._bounceElapsedSec += Math.max(0, deltaSec);

    const progress = THREE.MathUtils.clamp(
      this._bounceElapsedSec / bounceDurationSec,
      0,
      1,
    );
    const phase = progress * TAU;
    const rawLift = 0.5 - 0.5 * Math.cos(phase);
    const accent = Math.sin(phase * 2) * 0.08;
    const targetLift = THREE.MathUtils.clamp(rawLift + accent, 0, 1.1);

    this._liftVelocity += (targetLift - this._lift) * stiffness * deltaSec;
    this._liftVelocity *= Math.exp(-damping * deltaSec);
    this._lift += this._liftVelocity * deltaSec;

    const lift = THREE.MathUtils.clamp(this._lift, 0, 1.15);
    this._lastExitMagnitude = lift / 1.15;
    if (
      this._bounceElapsedSec >= bounceDurationSec &&
      lift <= BOUNCE_SETTLE_EPSILON &&
      Math.abs(this._liftVelocity) <= BOUNCE_SETTLE_EPSILON
    ) {
      this._finishBounce();
      return 0;
    }

    return lift;
  }

  private _finishBounce(): void {
    this._clearPlaybackState();
    this._scheduleNextPause();
  }

  private _clearPlaybackState(): void {
    this._state = "pause";
    this._pauseRemainingSec = 0;
    this._bounceElapsedSec = 0;
    this._lift = 0;
    this._liftVelocity = 0;
    this._lastExitMagnitude = 0;
  }

  private _resetScheduler(): void {
    this._clearPlaybackState();
    this._scheduleNextPause();
  }

  private _getRemainingBounceSec(): number {
    if (this._state !== "bounce") return 0;
    return Math.max(0, this._getBounceDurationSec() - this._bounceElapsedSec);
  }

  private _getBounceDurationSec(): number {
    if (this._params.bpm <= 0) return MIN_BOUNCE_DURATION_SEC;
    return Math.max(MIN_BOUNCE_DURATION_SEC, 60 / this._params.bpm);
  }

  private _applyRotation(
    boneName: BounceBoneName,
    x: number,
    y: number,
    z: number,
  ): void {
    const bone = this._bones.get(boneName);
    if (!bone) return;

    this._scratchEuler.set(x, y, z, "XYZ");
    this._scratchOffset.setFromEuler(this._scratchEuler);

    const offset = this._getRotOffsetScratch(boneName);
    offset.copy(this._scratchOffset);
    bone.quaternion.multiply(offset);
    this._lastRotOffsets.set(boneName, offset);
  }

  private _applyPosition(
    boneName: BounceBoneName,
    x: number,
    y: number,
    z: number,
  ): void {
    const bone = this._bones.get(boneName);
    if (!bone) return;

    const offset = this._getPosOffsetScratch(boneName);
    offset.set(x, y, z);
    bone.position.add(offset);
    this._lastPosOffsets.set(boneName, offset);
  }

  private _getRotOffsetScratch(boneName: BounceBoneName): THREE.Quaternion {
    const existing = this._rotOffsetScratchByBone.get(boneName);
    if (existing) return existing;

    const offset = new THREE.Quaternion();
    this._rotOffsetScratchByBone.set(boneName, offset);
    return offset;
  }

  private _getPosOffsetScratch(boneName: BounceBoneName): THREE.Vector3 {
    const existing = this._posOffsetScratchByBone.get(boneName);
    if (existing) return existing;

    const offset = new THREE.Vector3();
    this._posOffsetScratchByBone.set(boneName, offset);
    return offset;
  }
}

function sanitizeNonNegativeNumber(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

function sanitizeLag(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return THREE.MathUtils.clamp(value, 0, 1);
}

function randomRange(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.random() * (max - min);
}

function sortedPair(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function sanitizeActivationWeight(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return THREE.MathUtils.clamp(value, 0, 1);
}
