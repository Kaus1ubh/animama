import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

import {
  DEFAULT_SWAY_PROCEDURAL_ANIMATION_PARAMS,
  type ProceduralAnimationLayer,
  type ProceduralAnimationLayerSnapshot,
  type ProceduralAnimationRuntimeContext,
  type ProceduralAnimationTransitionState,
  type SwayProceduralAnimationParams,
} from "./types";

const DEG_TO_RAD = Math.PI / 180;
const TAU = Math.PI * 2;
const DEFAULT_LAYER_WEIGHT = 1;
const SWAY_DEACTIVATION_WAVE_EPSILON = 0.08;
const SWAY_DEACTIVATION_MIN_WAIT_SEC = 0.25;
const SWAY_DEACTIVATION_MAX_WAIT_SEC = 2.25;
const SWAY_STATE_ACTIVATION_EPSILON = 0.0001;
const SWAY_IDLE_GATE_REST_EPSILON = 0.08;
const SWAY_IDLE_GATE_EXIT_EXTREMA_MIN_WAVE = 0.45;
const SWAY_IDLE_GATE_MIN_WAIT_SEC = 0.25;
const SWAY_IDLE_GATE_MAX_WAIT_SEC = 3;
const SWAY_IDLE_GATE_REST_MIN_VELOCITY_EPSILON = 0.35;
const SWAY_IDLE_GATE_REST_MAX_VELOCITY_EPSILON = 1.6;
const SWAY_IDLE_GATE_EXTREMA_MIN_VELOCITY_EPSILON = 0.12;
const SWAY_IDLE_GATE_EXTREMA_MAX_VELOCITY_EPSILON = 0.45;

const SWAY_BONE_NAMES = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftShoulder",
  "rightShoulder",
] as const satisfies readonly VRMHumanBoneName[];

type SwayBoneName = (typeof SWAY_BONE_NAMES)[number];
type SwayIdleGateState =
  | "inactive"
  | "waitingToStart"
  | "active"
  | "waitingToStop";

export class SwayProceduralAnimationLayer implements ProceduralAnimationLayer<"sway"> {
  readonly id = "sway";

  private _vrm: VRM | null;
  private _params: SwayProceduralAnimationParams = {
    ...DEFAULT_SWAY_PROCEDURAL_ANIMATION_PARAMS,
  };
  private _weight: number = DEFAULT_LAYER_WEIGHT;
  private _bones = new Map<SwayBoneName, THREE.Object3D>();
  private _idleCycleElapsedSec: number = 0;
  private _idleGateState: SwayIdleGateState = "inactive";
  private _idleGateElapsedSec: number = 0;
  private _stateActivationWeight: number = 0;
  private _stateActivationStartWeight: number = 0;
  private _stateActivationTargetWeight: number = 0;
  private _stateActivationElapsedSec: number = 0;
  private _stateActivationBlendSec: number =
    DEFAULT_SWAY_PROCEDURAL_ANIMATION_PARAMS.idleEnterBlendSec;
  private _time: number = 0;
  private _motion: number = 0;
  private _motionVelocity: number = 0;
  private _lastRawWave: number | null = null;
  private _rawWaveVelocity: number = 0;
  private _lastWave: number = 0;
  private _lastRotOffsets = new Map<SwayBoneName, THREE.Quaternion>();
  private _lastPosOffsets = new Map<SwayBoneName, THREE.Vector3>();
  private _rotOffsetScratchByBone = new Map<SwayBoneName, THREE.Quaternion>();
  private _posOffsetScratchByBone = new Map<SwayBoneName, THREE.Vector3>();
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

    this._time += deltaSec;

    const lag = THREE.MathUtils.clamp(this._params.lag, 0, 1);
    const stiffness = THREE.MathUtils.lerp(30, 7, lag);
    const damping = THREE.MathUtils.lerp(12, 4, lag);
    const phase = this._time * (this._params.cpm / 60) * TAU;
    const target = Math.sin(phase);

    this._motionVelocity += (target - this._motion) * stiffness * deltaSec;
    this._motionVelocity *= Math.exp(-damping * deltaSec);
    this._motion += this._motionVelocity * deltaSec;

    const settle = Math.sin(phase * 2.15 + 1.1) * 0.08;
    const wave = THREE.MathUtils.clamp(this._motion + settle, -1.15, 1.15);
    const rawWaveVelocity = this._updateRawWaveVelocity(wave, deltaSec);

    const idleWindowActive =
      context.avatarState === "idle"
        ? this._advanceIdleSwayWindow(deltaSec)
        : false;
    if (context.avatarState !== "idle") {
      this._idleCycleElapsedSec = 0;
    }
    const stateActivationWeight = this._advanceStateActivationWeight(
      this._advanceIdleGate(idleWindowActive, wave, rawWaveVelocity, deltaSec),
      deltaSec,
    );
    this._lastWave = wave * stateActivationWeight;

    const effectiveIntensity =
      this._params.intensity *
      this._weight *
      activationWeight *
      stateActivationWeight;
    if (effectiveIntensity <= 0) return;

    const sideShift = this._params.sideShift * 0.01 * effectiveIntensity * wave;
    const lean =
      this._params.torsoLean * DEG_TO_RAD * effectiveIntensity * wave;
    const headFollowTilt =
      -this._params.headFollowTilt * DEG_TO_RAD * effectiveIntensity * wave;
    const neckFollowTilt =
      -this._params.neckFollowTilt * DEG_TO_RAD * effectiveIntensity * wave;
    const shoulder =
      this._params.shoulderDrift * DEG_TO_RAD * effectiveIntensity * wave;

    this._applyPosition("hips", sideShift, 0, 0);
    this._applyRotation("hips", 0, lean * 0.08, -lean * 0.2);
    this._applyRotation("spine", 0, lean * 0.05, -lean * 0.45);
    this._applyRotation("chest", 0, -lean * 0.08, -lean * 0.75);
    this._applyRotation("upperChest", 0, -lean * 0.12, -lean * 0.55);
    this._applyRotation("neck", 0, 0, neckFollowTilt);
    this._applyRotation("head", 0, 0, headFollowTilt);
    this._applyRotation("leftShoulder", 0, 0, shoulder * 0.45);
    this._applyRotation("rightShoulder", 0, 0, shoulder * 0.45);
  }

  getSnapshot(): ProceduralAnimationLayerSnapshot<"sway"> {
    return {
      id: this.id,
      enabled: this._params.enabled,
      weight: this._weight,
      params: { ...this._params },
      resolvedBones: SWAY_BONE_NAMES.filter((boneName) =>
        this._bones.has(boneName),
      ),
      missingBones: SWAY_BONE_NAMES.filter(
        (boneName) => !this._bones.has(boneName),
      ),
    };
  }

  getTransitionState(): ProceduralAnimationTransitionState {
    const cycleSec = this._params.cpm > 0 ? 60 / this._params.cpm : 0;
    const maxWaitSec =
      cycleSec > 0
        ? THREE.MathUtils.clamp(
            cycleSec * 0.25,
            SWAY_DEACTIVATION_MIN_WAIT_SEC,
            SWAY_DEACTIVATION_MAX_WAIT_SEC,
          )
        : SWAY_DEACTIVATION_MIN_WAIT_SEC;

    return {
      canDeactivateNow:
        !this._params.enabled ||
        this._params.intensity <= 0 ||
        Math.abs(this._lastWave) <= SWAY_DEACTIVATION_WAVE_EPSILON,
      maxWaitSec,
    };
  }

  setEnabled(enabled: boolean): void {
    this._params.enabled = enabled;
    if (!enabled) {
      this.clearOffsets();
      this._clearStateActivation();
    }
  }

  setWeight(weight: number): void {
    if (!Number.isFinite(weight)) return;

    this._weight = THREE.MathUtils.clamp(weight, 0, 1);
    if (this._weight <= 0) {
      this.clearOffsets();
      this._clearStateActivation();
    }
  }

  setParams(params: Partial<SwayProceduralAnimationParams>): void {
    if (typeof params.enabled === "boolean") {
      this._params.enabled = params.enabled;
    }
    this._params.intensity = sanitizeNonNegativeNumber(
      params.intensity,
      this._params.intensity,
    );
    this._params.cpm = sanitizeNonNegativeNumber(params.cpm, this._params.cpm);
    this._params.idleActiveSec = sanitizeNonNegativeNumber(
      params.idleActiveSec,
      this._params.idleActiveSec,
    );
    this._params.idleIntervalSec = sanitizeNonNegativeNumber(
      params.idleIntervalSec,
      this._params.idleIntervalSec,
    );
    this._params.idleEnterBlendSec = sanitizeNonNegativeNumber(
      params.idleEnterBlendSec,
      this._params.idleEnterBlendSec,
    );
    this._params.idleExitBlendSec = sanitizeNonNegativeNumber(
      params.idleExitBlendSec,
      this._params.idleExitBlendSec,
    );
    this._params.sideShift = sanitizeNonNegativeNumber(
      params.sideShift,
      this._params.sideShift,
    );
    this._params.torsoLean = sanitizeNonNegativeNumber(
      params.torsoLean,
      this._params.torsoLean,
    );
    this._params.headFollowTilt = sanitizeNonNegativeNumber(
      params.headFollowTilt,
      this._params.headFollowTilt,
    );
    this._params.neckFollowTilt = sanitizeNonNegativeNumber(
      params.neckFollowTilt,
      this._params.neckFollowTilt,
    );
    this._params.shoulderDrift = sanitizeNonNegativeNumber(
      params.shoulderDrift,
      this._params.shoulderDrift,
    );
    this._params.lag = sanitizeLag(params.lag, this._params.lag);

    if (!this._params.enabled || this._params.intensity <= 0) {
      this.clearOffsets();
      this._clearStateActivation();
    }
  }

  reset(): void {
    this.clearOffsets();
    this._params = { ...DEFAULT_SWAY_PROCEDURAL_ANIMATION_PARAMS };
    this._weight = DEFAULT_LAYER_WEIGHT;
    this._clearStateActivation();
    this._time = 0;
    this._motion = 0;
    this._motionVelocity = 0;
    this._lastWave = 0;
  }

  dispose(): void {
    this.clearOffsets();
    this._bones.clear();
    this._lastRotOffsets.clear();
    this._lastPosOffsets.clear();
    this._rotOffsetScratchByBone.clear();
    this._posOffsetScratchByBone.clear();
    this._clearStateActivation();
    this._vrm = null;
  }

  private _cacheBones(): void {
    if (!this._vrm) return;

    for (const boneName of SWAY_BONE_NAMES) {
      const bone = this._vrm.humanoid.getNormalizedBoneNode(boneName);
      if (bone) {
        this._bones.set(boneName, bone);
      }
    }
  }

  private _clearStateActivation(): void {
    this._idleCycleElapsedSec = 0;
    this._idleGateState = "inactive";
    this._idleGateElapsedSec = 0;
    this._stateActivationWeight = 0;
    this._stateActivationStartWeight = 0;
    this._stateActivationTargetWeight = 0;
    this._stateActivationElapsedSec = 0;
    this._stateActivationBlendSec = this._params.idleEnterBlendSec;
    this._lastRawWave = null;
    this._rawWaveVelocity = 0;
    this._lastWave = 0;
  }

  private _advanceIdleSwayWindow(deltaSec: number): boolean {
    const cycleSec = Math.max(
      this._params.idleActiveSec,
      this._params.idleIntervalSec,
    );
    if (cycleSec <= 0 || this._params.idleActiveSec <= 0) {
      this._idleCycleElapsedSec = 0;
      return false;
    }

    const activeSec = Math.min(this._params.idleActiveSec, cycleSec);
    const cyclePositionSec = this._idleCycleElapsedSec % cycleSec;
    const isActive = cyclePositionSec < activeSec;

    this._idleCycleElapsedSec =
      (this._idleCycleElapsedSec + Math.max(0, deltaSec)) % cycleSec;
    return isActive;
  }

  private _advanceIdleGate(
    idleWindowRequested: boolean,
    wave: number,
    rawWaveVelocity: number,
    deltaSec: number,
  ): boolean {
    const nearRestEntry =
      Math.abs(wave) <= SWAY_IDLE_GATE_REST_EPSILON &&
      Math.abs(rawWaveVelocity) <= this._getIdleGateRestVelocityEpsilon();
    const lowVelocityExtremaExit =
      Math.abs(wave) >= SWAY_IDLE_GATE_EXIT_EXTREMA_MIN_WAVE &&
      Math.abs(rawWaveVelocity) <= this._getIdleGateExtremaVelocityEpsilon();
    const maxWaitSec = this._getIdleGateMaxWaitSec();

    switch (this._idleGateState) {
      case "inactive":
        this._idleGateElapsedSec = 0;
        if (idleWindowRequested) {
          this._idleGateState = "waitingToStart";
        }
        break;
      case "waitingToStart":
        if (!idleWindowRequested) {
          this._idleGateState = "inactive";
          this._idleGateElapsedSec = 0;
          break;
        }
        this._idleGateElapsedSec += Math.max(0, deltaSec);
        if (nearRestEntry || this._idleGateElapsedSec >= maxWaitSec) {
          this._idleGateState = "active";
          this._idleGateElapsedSec = 0;
        }
        break;
      case "active":
        this._idleGateElapsedSec = 0;
        if (!idleWindowRequested) {
          this._idleGateState = "waitingToStop";
        }
        break;
      case "waitingToStop":
        if (idleWindowRequested) {
          this._idleGateState = "active";
          this._idleGateElapsedSec = 0;
          break;
        }
        this._idleGateElapsedSec += Math.max(0, deltaSec);
        if (lowVelocityExtremaExit || this._idleGateElapsedSec >= maxWaitSec) {
          this._idleGateState = "inactive";
          this._idleGateElapsedSec = 0;
        }
        break;
    }

    return (
      this._idleGateState === "active" ||
      this._idleGateState === "waitingToStop"
    );
  }

  private _getIdleGateMaxWaitSec(): number {
    const cycleSec = this._params.cpm > 0 ? 60 / this._params.cpm : 0;
    if (cycleSec <= 0) return SWAY_IDLE_GATE_MIN_WAIT_SEC;
    return THREE.MathUtils.clamp(
      cycleSec * 0.55,
      SWAY_IDLE_GATE_MIN_WAIT_SEC,
      SWAY_IDLE_GATE_MAX_WAIT_SEC,
    );
  }

  private _getIdleGateRestVelocityEpsilon(): number {
    if (this._params.cpm <= 0) {
      return SWAY_IDLE_GATE_REST_MIN_VELOCITY_EPSILON;
    }
    const angularVelocity = (this._params.cpm / 60) * TAU;
    return THREE.MathUtils.clamp(
      angularVelocity * 0.85,
      SWAY_IDLE_GATE_REST_MIN_VELOCITY_EPSILON,
      SWAY_IDLE_GATE_REST_MAX_VELOCITY_EPSILON,
    );
  }

  private _getIdleGateExtremaVelocityEpsilon(): number {
    if (this._params.cpm <= 0) {
      return SWAY_IDLE_GATE_EXTREMA_MIN_VELOCITY_EPSILON;
    }
    const angularVelocity = (this._params.cpm / 60) * TAU;
    return THREE.MathUtils.clamp(
      angularVelocity * 0.22,
      SWAY_IDLE_GATE_EXTREMA_MIN_VELOCITY_EPSILON,
      SWAY_IDLE_GATE_EXTREMA_MAX_VELOCITY_EPSILON,
    );
  }

  private _advanceStateActivationWeight(
    shouldActivate: boolean,
    deltaSec: number,
  ): number {
    const targetWeight = shouldActivate ? 1 : 0;
    if (targetWeight !== this._stateActivationTargetWeight) {
      this._stateActivationStartWeight = this._stateActivationWeight;
      this._stateActivationTargetWeight = targetWeight;
      this._stateActivationElapsedSec = 0;
      this._stateActivationBlendSec =
        targetWeight > this._stateActivationWeight
          ? this._params.idleEnterBlendSec
          : this._params.idleExitBlendSec;
    }

    if (
      Math.abs(
        this._stateActivationWeight - this._stateActivationTargetWeight,
      ) <= SWAY_STATE_ACTIVATION_EPSILON
    ) {
      this._stateActivationWeight = this._stateActivationTargetWeight;
      return this._stateActivationWeight;
    }

    if (this._stateActivationBlendSec <= 0) {
      this._stateActivationWeight = this._stateActivationTargetWeight;
      return this._stateActivationWeight;
    }

    this._stateActivationElapsedSec += Math.max(0, deltaSec);
    const progress = THREE.MathUtils.clamp(
      this._stateActivationElapsedSec / this._stateActivationBlendSec,
      0,
      1,
    );
    this._stateActivationWeight = THREE.MathUtils.lerp(
      this._stateActivationStartWeight,
      this._stateActivationTargetWeight,
      smootherstep(progress),
    );
    if (
      progress >= 1 ||
      Math.abs(
        this._stateActivationWeight - this._stateActivationTargetWeight,
      ) <= SWAY_STATE_ACTIVATION_EPSILON
    ) {
      this._stateActivationWeight = this._stateActivationTargetWeight;
    }

    return this._stateActivationWeight;
  }

  private _updateRawWaveVelocity(wave: number, deltaSec: number): number {
    if (this._lastRawWave === null || deltaSec <= 0) {
      this._lastRawWave = wave;
      this._rawWaveVelocity = 0;
      return this._rawWaveVelocity;
    }

    this._rawWaveVelocity = (wave - this._lastRawWave) / deltaSec;
    this._lastRawWave = wave;
    return this._rawWaveVelocity;
  }

  private _applyRotation(
    boneName: SwayBoneName,
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
    boneName: SwayBoneName,
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

  private _getRotOffsetScratch(boneName: SwayBoneName): THREE.Quaternion {
    const existing = this._rotOffsetScratchByBone.get(boneName);
    if (existing) return existing;

    const offset = new THREE.Quaternion();
    this._rotOffsetScratchByBone.set(boneName, offset);
    return offset;
  }

  private _getPosOffsetScratch(boneName: SwayBoneName): THREE.Vector3 {
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

function smootherstep(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function sanitizeActivationWeight(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return THREE.MathUtils.clamp(value, 0, 1);
}
