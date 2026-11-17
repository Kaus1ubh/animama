import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

import {
  DEFAULT_BREATHING_PROCEDURAL_ANIMATION_PARAMS,
  type BreathingProceduralAnimationParams,
  type ProceduralAnimationBasisOptions,
  type ProceduralAnimationLayer,
  type ProceduralAnimationLayerSnapshot,
  type ProceduralAnimationRuntimeContext,
} from "./types";
import { retargetVrm1AuthoredQuaternionOffsetToVrm0 } from "../poses/poseRetargeting";
import {
  sanitizeActivationWeight,
  sanitizeLag,
  sanitizeNonNegativeNumber,
} from "./layerParams";

const DEG_TO_RAD = Math.PI / 180;
const TAU = Math.PI * 2;
const DEFAULT_LAYER_WEIGHT = 1;

const BREATHING_BONE_NAMES = [
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftShoulder",
  "rightShoulder",
] as const satisfies readonly VRMHumanBoneName[];

type BreathingBoneName = (typeof BREATHING_BONE_NAMES)[number];

export class BreathingProceduralAnimationLayer implements ProceduralAnimationLayer<"breathing"> {
  readonly id = "breathing";

  private _vrm: VRM | null;
  private _params: BreathingProceduralAnimationParams = {
    ...DEFAULT_BREATHING_PROCEDURAL_ANIMATION_PARAMS,
  };
  private _weight: number = DEFAULT_LAYER_WEIGHT;
  private _bones = new Map<BreathingBoneName, THREE.Object3D>();
  private _time: number = 0;
  private _sway: number = 0;
  private _swayVelocity: number = 0;
  private _lastOffsets = new Map<BreathingBoneName, THREE.Quaternion>();
  private _offsetScratchByBone = new Map<BreathingBoneName, THREE.Quaternion>();
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

    this._time += deltaSec;

    const phase = this._time * (this._params.bpm / 60) * TAU;
    const inhale = 0.5 - 0.5 * Math.cos(phase);
    const centeredBreath = inhale * 2 - 1;
    const secondaryWave = Math.sin(phase * 2 + 0.4) * 0.08;
    const breath = centeredBreath + secondaryWave;

    const lag = THREE.MathUtils.clamp(this._params.lag, 0, 1);
    const targetSway =
      Math.sin(phase - 0.7) *
      this._params.sway *
      DEG_TO_RAD *
      effectiveIntensity;
    const stiffness = THREE.MathUtils.lerp(26, 6, lag);
    const damping = THREE.MathUtils.lerp(11, 4, lag);

    this._swayVelocity += (targetSway - this._sway) * stiffness * deltaSec;
    this._swayVelocity *= Math.exp(-damping * deltaSec);
    this._sway += this._swayVelocity * deltaSec;

    const chest = this._params.chest * DEG_TO_RAD * effectiveIntensity * breath;
    const spine = this._params.spine * DEG_TO_RAD * effectiveIntensity * breath;
    const shoulder =
      this._params.shoulder * DEG_TO_RAD * effectiveIntensity * inhale;
    const head =
      this._params.head *
      DEG_TO_RAD *
      effectiveIntensity *
      Math.sin(phase - 0.25);

    this._applyOffset("spine", -spine * 0.45, 0, this._sway * 0.65);
    this._applyOffset("chest", chest * 0.75, 0, this._sway * 0.35);
    this._applyOffset("upperChest", chest, 0, this._sway * 0.25);
    this._applyOffset("neck", -head * 0.35, 0, -this._sway * 0.25);
    this._applyOffset("head", -head, this._sway * 0.18, -this._sway * 0.45);
    this._applyOffset("leftShoulder", 0, 0, shoulder * 0.35);
    this._applyOffset("rightShoulder", 0, 0, -shoulder * 0.35);
  }

  getSnapshot(): ProceduralAnimationLayerSnapshot<"breathing"> {
    return {
      id: this.id,
      enabled: this._params.enabled,
      weight: this._weight,
      params: { ...this._params },
      resolvedBones: BREATHING_BONE_NAMES.filter((boneName) =>
        this._bones.has(boneName),
      ),
      missingBones: BREATHING_BONE_NAMES.filter(
        (boneName) => !this._bones.has(boneName),
      ),
    };
  }

  setEnabled(enabled: boolean): void {
    this._params.enabled = enabled;
    if (!enabled) {
      this.clearOffsets();
    }
  }

  setWeight(weight: number): void {
    if (!Number.isFinite(weight)) return;

    this._weight = THREE.MathUtils.clamp(weight, 0, 1);
    if (this._weight <= 0) {
      this.clearOffsets();
    }
  }

  setParams(params: Partial<BreathingProceduralAnimationParams>): void {
    if (typeof params.enabled === "boolean") {
      this._params.enabled = params.enabled;
    }
    this._params.intensity = sanitizeNonNegativeNumber(
      params.intensity,
      this._params.intensity,
    );
    this._params.bpm = sanitizeNonNegativeNumber(params.bpm, this._params.bpm);
    this._params.chest = sanitizeNonNegativeNumber(
      params.chest,
      this._params.chest,
    );
    this._params.spine = sanitizeNonNegativeNumber(
      params.spine,
      this._params.spine,
    );
    this._params.shoulder = sanitizeNonNegativeNumber(
      params.shoulder,
      this._params.shoulder,
    );
    this._params.head = sanitizeNonNegativeNumber(
      params.head,
      this._params.head,
    );
    this._params.sway = sanitizeNonNegativeNumber(
      params.sway,
      this._params.sway,
    );
    this._params.lag = sanitizeLag(params.lag, this._params.lag);

    if (!this._params.enabled || this._params.intensity <= 0) {
      this.clearOffsets();
    }
  }

  reset(): void {
    this.clearOffsets();
    this._params = { ...DEFAULT_BREATHING_PROCEDURAL_ANIMATION_PARAMS };
    this._weight = DEFAULT_LAYER_WEIGHT;
    this._time = 0;
    this._sway = 0;
    this._swayVelocity = 0;
  }

  dispose(): void {
    this.clearOffsets();
    this._bones.clear();
    this._lastOffsets.clear();
    this._offsetScratchByBone.clear();
    this._vrm = null;
  }

  private _cacheBones(): void {
    if (!this._vrm) return;

    for (const boneName of BREATHING_BONE_NAMES) {
      const bone = this._vrm.humanoid.getNormalizedBoneNode(boneName);
      if (bone) {
        this._bones.set(boneName, bone);
      }
    }
  }

  private _applyOffset(
    boneName: BreathingBoneName,
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

  private _getOffsetScratch(boneName: BreathingBoneName): THREE.Quaternion {
    const existing = this._offsetScratchByBone.get(boneName);
    if (existing) return existing;

    const offset = new THREE.Quaternion();
    this._offsetScratchByBone.set(boneName, offset);
    return offset;
  }
}
