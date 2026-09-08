import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  buildEmotionRuntimeState,
  createEmptyEmotionStateMap,
} from "@/lib/emotion";
import {
  retargetVrm1AuthoredQuaternionOffsetToVrm0,
  resolveEmotionPostureTarget,
  type EmotionPostureResolution,
} from "@/lib/avatar/proc-animation/EmotionPostureProceduralAnimationLayer";
import {
  DEFAULT_EMOTION_POSTURE_PROCEDURAL_ANIMATION_PARAMS,
  type EmotionPostureProceduralAnimationParams,
} from "@/lib/avatar";

function emotionState(values: Partial<Record<string, number>> = {}) {
  const state = createEmptyEmotionStateMap();
  for (const [emotion, value] of Object.entries(values)) {
    if (emotion in state) {
      state[emotion as keyof typeof state] = value;
    }
  }
  return buildEmotionRuntimeState(state);
}

function defaultParams(): EmotionPostureProceduralAnimationParams {
  return JSON.parse(
    JSON.stringify(DEFAULT_EMOTION_POSTURE_PROCEDURAL_ANIMATION_PARAMS),
  ) as EmotionPostureProceduralAnimationParams;
}

function resolve(
  params: EmotionPostureProceduralAnimationParams,
  values: Partial<Record<string, number>>,
): EmotionPostureResolution {
  return resolveEmotionPostureTarget(params, emotionState(values));
}

describe("EmotionPostureProceduralAnimationLayer", () => {
  it("resolves progressively stronger Gloom targets for levels one through three", () => {
    const params = defaultParams();

    const levelOne = resolve(params, { sadness: 8 });
    const levelTwo = resolve(params, { sadness: 20 });
    const levelThree = resolve(params, { sadness: 30 });

    expect(levelOne).toMatchObject({
      resolvedGroup: "gloom",
      resolvedLevel: 1,
      reason: "active",
    });
    expect(levelTwo.resolvedLevel).toBe(2);
    expect(levelThree.resolvedLevel).toBe(3);
    expect(levelOne.target?.headPitchDeg).toBeCloseTo(3.6);
    expect(levelTwo.target?.headPitchDeg).toBeCloseTo(6);
    expect(levelThree.target?.headPitchDeg).toBeCloseTo(8.4);
    expect(levelOne.postureIntensity).toBeCloseTo(0.3);
    expect(levelTwo.postureIntensity).toBeCloseTo(0.5);
    expect(levelThree.postureIntensity).toBeCloseTo(0.7);
    expect(levelOne.target!.headPitchDeg).toBeLessThan(
      levelTwo.target!.headPitchDeg,
    );
    expect(levelTwo.target!.headPitchDeg).toBeLessThan(
      levelThree.target!.headPitchDeg,
    );
  });

  it("returns no target when the dominant preset is disabled", () => {
    const params = defaultParams();
    params.presets.gloom.enabled = false;

    const resolution = resolve(params, { sadness: 18 });

    expect(resolution).toMatchObject({
      resolvedGroup: "gloom",
      resolvedLevel: 2,
      presetEnabled: false,
      reason: "presetDisabled",
      target: null,
    });
  });

  it("returns no target when the dominant group has no posture preset", () => {
    const resolution = resolve(defaultParams(), { joy: 22 });

    expect(resolution).toMatchObject({
      resolvedGroup: "delight",
      resolvedLevel: 2,
      presetEnabled: false,
      reason: "unsupportedGroup",
      target: null,
    });
  });

  it("uses separate default level intensities for rejection and revulsion", () => {
    const params = defaultParams();

    const revulsionLevelOne = resolve(params, { disgust: 8 });
    const rejectionLevelOne = resolve(params, { anger: 8 });

    expect(revulsionLevelOne).toMatchObject({
      resolvedGroup: "revulsion",
      resolvedLevel: 1,
      reason: "active",
    });
    expect(revulsionLevelOne.postureIntensity).toBeCloseTo(0.15);
    expect(revulsionLevelOne.target?.headPitchDeg).toBeCloseTo(1.35);
    expect(revulsionLevelOne.target?.headYawDeg).toBeCloseTo(-2.7);
    expect(revulsionLevelOne.target?.shoulderLiftCm).toBeCloseTo(0.525);

    expect(rejectionLevelOne).toMatchObject({
      resolvedGroup: "rejection",
      resolvedLevel: 1,
      reason: "active",
    });
    expect(rejectionLevelOne.postureIntensity).toBeCloseTo(0.2);
    expect(rejectionLevelOne.target?.headPitchDeg).toBeCloseTo(1.6);
    expect(rejectionLevelOne.target?.chestPitchDeg).toBeCloseTo(1.8);
    expect(rejectionLevelOne.target?.shoulderLiftCm).toBeCloseTo(0.6);
  });

  it("returns no target for neutral emotion state", () => {
    const resolution = resolveEmotionPostureTarget(
      defaultParams(),
      emotionState(),
    );

    expect(resolution).toMatchObject({
      resolvedGroup: "neutral",
      resolvedLevel: 0,
      reason: "neutral",
      target: null,
    });
  });

  it("returns no target when the global planner gate is disabled", () => {
    const params = defaultParams();
    params.plannerEnabled = false;

    const resolution = resolve(params, { sadness: 18 });

    expect(resolution).toMatchObject({
      resolvedGroup: "neutral",
      resolvedLevel: 0,
      reason: "plannerDisabled",
      target: null,
    });
  });

  it("uses debug mode group and level instead of the live emotion state", () => {
    const params = defaultParams();
    params.debugModeEnabled = true;
    params.debugGroup = "revulsion";
    params.debugLevel = 3;
    params.plannerEnabled = false;

    const resolution = resolve(params, { sadness: 30 });

    expect(resolution).toMatchObject({
      resolvedGroup: "revulsion",
      resolvedLevel: 3,
      primaryEmotion: null,
      reason: "debugOverride",
    });
    expect(resolution.target?.headPitchDeg).toBeCloseTo(4.05);
    expect(resolution.postureIntensity).toBeCloseTo(0.45);
  });

  it("retargets VRM1-authored posture quaternion offsets for VRM0", () => {
    const quaternion = new THREE.Quaternion(0.1, 0.2, 0.3, 0.9);

    retargetVrm1AuthoredQuaternionOffsetToVrm0(quaternion);

    expect(quaternion.x).toBeCloseTo(-0.1);
    expect(quaternion.y).toBeCloseTo(0.2);
    expect(quaternion.z).toBeCloseTo(-0.3);
    expect(quaternion.w).toBeCloseTo(0.9);
  });
});
