import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

import {
  buildEmotionRuntimeState,
  createEmptyEmotionStateMap,
} from "@/lib/emotion";
import { BounceProceduralAnimationLayer } from "@/lib/avatar/proc-animation/BounceProceduralAnimationLayer";
import { BreathingProceduralAnimationLayer } from "@/lib/avatar/proc-animation/BreathingProceduralAnimationLayer";
import { HeadNodProceduralAnimationLayer } from "@/lib/avatar/proc-animation/HeadNodProceduralAnimationLayer";
import { HeadSideTiltProceduralAnimationLayer } from "@/lib/avatar/proc-animation/HeadSideTiltProceduralAnimationLayer";
import { SwayProceduralAnimationLayer } from "@/lib/avatar/proc-animation/SwayProceduralAnimationLayer";
import { TalkingHandsProceduralAnimationLayer } from "@/lib/avatar/proc-animation/TalkingHandsProceduralAnimationLayer";
import type {
  ProceduralAnimationBasisOptions,
  ProceduralAnimationLayer,
  ProceduralAnimationRuntimeContext,
} from "@/lib/avatar/proc-animation/types";

type LayerFactory = (
  vrm: VRM,
  options: ProceduralAnimationBasisOptions,
) => ProceduralAnimationLayer;

type BoneState = { quaternion: THREE.Quaternion; position: THREE.Vector3 };

const STEP_SEC = 1 / 30;
const STEP_COUNT = 240;

const LAYERS: Record<string, LayerFactory> = {
  breathing: (vrm, options) =>
    new BreathingProceduralAnimationLayer(vrm, options),
  sway: (vrm, options) => new SwayProceduralAnimationLayer(vrm, options),
  bounce: (vrm, options) => new BounceProceduralAnimationLayer(vrm, options),
  headNod: (vrm, options) => new HeadNodProceduralAnimationLayer(vrm, options),
  headSideTilt: (vrm, options) =>
    new HeadSideTiltProceduralAnimationLayer(vrm, options),
  talkingHands: (vrm, options) =>
    new TalkingHandsProceduralAnimationLayer(vrm, options),
};

/** Minimal VRM whose normalized bones are identity-rest Object3Ds. */
function createFakeVrm(bones: Map<string, THREE.Object3D>): VRM {
  const scene = new THREE.Group();
  return {
    scene,
    humanoid: {
      getNormalizedBoneNode: (name: VRMHumanBoneName) => {
        let bone = bones.get(name);
        if (!bone) {
          bone = new THREE.Object3D();
          bone.name = name;
          scene.add(bone);
          bones.set(name, bone);
        }
        return bone;
      },
    },
  } as unknown as VRM;
}

/** Deterministic Math.random so both basis runs make identical choices. */
function seedRandom(): void {
  let state = 0x2545f491;
  vi.spyOn(Math, "random").mockImplementation(() => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  });
}

function runLayer(
  factory: LayerFactory,
  isVrm0: boolean,
): Map<string, BoneState>[] {
  vi.restoreAllMocks();
  seedRandom();
  const bones = new Map<string, THREE.Object3D>();
  const layer = factory(createFakeVrm(bones), { isVrm0 });
  layer.setEnabled(true);
  layer.playGroup?.({ source: "debug", durationSec: 4 });
  const context: ProceduralAnimationRuntimeContext = {
    avatarState: "idle",
    emotionLabel: "neutral",
    emotionalState: buildEmotionRuntimeState(createEmptyEmotionStateMap()),
    globalRestPoseActive: false,
    layerActivationWeight: 1,
  };

  const frames: Map<string, BoneState>[] = [];
  for (let step = 0; step < STEP_COUNT; step += 1) {
    layer.update(STEP_SEC, context);
    frames.push(
      new Map(
        [...bones].map(([name, bone]) => [
          name,
          {
            quaternion: bone.quaternion.clone(),
            position: bone.position.clone(),
          },
        ]),
      ),
    );
  }
  layer.clearOffsets();
  for (const bone of bones.values()) {
    expect(bone.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
    expect(bone.position.length()).toBeLessThan(1e-9);
  }
  return frames;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("procedural layers on VRM0 normalized bones", () => {
  it.each(Object.keys(LAYERS))(
    "%s applies the VRM1 motion converted into the VRM0 basis",
    (layerId) => {
      const factory = LAYERS[layerId]!;
      const vrm1Frames = runLayer(factory, false);
      const vrm0Frames = runLayer(factory, true);

      let maxMirroredComponent = 0;
      vrm1Frames.forEach((vrm1Bones, step) => {
        const vrm0Bones = vrm0Frames[step]!;
        expect([...vrm0Bones.keys()].sort()).toEqual(
          [...vrm1Bones.keys()].sort(),
        );
        for (const [name, vrm1] of vrm1Bones) {
          const vrm0 = vrm0Bones.get(name)!;
          // A 180-degree Y basis change conjugates rotations and mirrors x/z.
          const expectedRotation = new THREE.Quaternion(
            -vrm1.quaternion.x,
            vrm1.quaternion.y,
            -vrm1.quaternion.z,
            vrm1.quaternion.w,
          );
          expect(vrm0.quaternion.angleTo(expectedRotation)).toBeLessThan(1e-6);
          expect(vrm0.position.x).toBeCloseTo(-vrm1.position.x, 9);
          expect(vrm0.position.y).toBeCloseTo(vrm1.position.y, 9);
          expect(vrm0.position.z).toBeCloseTo(-vrm1.position.z, 9);
          maxMirroredComponent = Math.max(
            maxMirroredComponent,
            Math.abs(vrm1.quaternion.x) + Math.abs(vrm1.quaternion.z),
          );
        }
      });
      // Guard against a vacuous comparison: the layer must pitch or roll.
      expect(maxMirroredComponent).toBeGreaterThan(0.001);
    },
  );
});
