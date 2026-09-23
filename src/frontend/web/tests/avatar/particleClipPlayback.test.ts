import { afterEach, describe, expect, it, vi } from "vitest";
import { Group, Object3D, Scene, Vector3 } from "three";
import { QuarksLoader, type ParticleEmitter } from "three.quarks";

import { Avatar, PoseController, parseAnimaPoseClip } from "@/lib/avatar";
import { ReactionClipPlayer } from "@/lib/avatar/reaction/ReactionClipPlayer";
import {
  ParticleVFXController,
  normalizeParticleVFXTransform,
  type ParticleVFXCatalogEntry,
} from "@/lib/avatar/particle-vfx";
import fixture from "@/lib/avatar/particle-vfx/fixtures/compatibility-valid.json";
import { EMPTY_RUNTIME_MEDIA_PROVIDER } from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";

const effect: ParticleVFXCatalogEntry = {
  id: "multi-anchor",
  label: "Multi-anchor",
  description: "",
  assetPath: "/multi-anchor.json",
  defaultAnchor: "chest",
  defaultDurationSec: 2,
  defaultFollowAnchor: true,
  defaultTransform: normalizeParticleVFXTransform(),
  preloadTier: "none",
  performanceBudget: {
    maxDurationSec: 5,
    maxParticles: 32,
    canCoexist: true,
    loopingAllowed: false,
  },
};

/** Exercise the real asset parser and particle systems without an HTTP server. */
function parseMultiAnchorEffect(): Object3D {
  const json = structuredClone(fixture);
  json.object.children = ["head", "leftHand", "inherit"].map((anchor) => ({
    ...structuredClone(fixture.object.children[0]!),
    uuid: `emitter-${anchor}`,
    name: anchor,
    userData: anchor === "inherit" ? {} : { animamaParticleAnchor: anchor },
    // An authored 10 cm vertical offset must stay relative to each anchor.
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0.1, 0, 1],
  }));
  return new QuarksLoader().parse(json);
}

/** Bind real clip players through Avatar's production event-sink wiring. */
function createPlaybackHarness(lane: "gesture" | "reaction") {
  const scene = new Group();
  new Scene().add(scene);
  const bones = {
    chest: new Object3D(),
    head: new Object3D(),
    leftHand: new Object3D(),
  };
  bones.chest.position.set(0, 1, 0);
  bones.head.position.set(0, 1.6, 0);
  bones.leftHand.position.set(-0.5, 0.9, 0);
  scene.add(...Object.values(bones));
  const avatar = new Avatar(new Object3D());
  avatar.vrm = {
    scene,
    update: () => {},
    humanoid: {
      getNormalizedPose: () => ({}),
      setNormalizedPose: () => {},
      resetNormalizedPose: () => {},
      getNormalizedBoneNode: (name: string) =>
        bones[name as keyof typeof bones] ?? null,
    },
  } as never;
  const controller = new ParticleVFXController(avatar, {
    ...EMPTY_RUNTIME_MEDIA_PROVIDER,
    listParticleVFX: () => [effect],
    resolveParticleVFX: async () => effect,
  });
  avatar.particleVFXController = controller;
  avatar.poseController = new PoseController(avatar.vrm!);
  avatar.reactionClipPlayer = new ReactionClipPlayer({
    setExpressionOverlay: () => true,
    clearExpressionOverlay: () => true,
  });
  avatar.setPoseClipExternalEventSink(null);
  avatar.setReactionClipExternalEventSink(null);
  const clip = parseAnimaPoseClip({
    schema: "animaPoseClip/1.0",
    id: "anchored-clip",
    name: "Anchored clip",
    duration: 2,
    poses: {},
    poseKeyframes: [],
    events: [
      {
        id: "particles",
        time: 0,
        kind: "particle_vfx",
        effectId: effect.id,
        duration: 2,
      },
    ],
  });
  const play = () =>
    lane === "gesture"
      ? avatar.playAnimaPoseClip(clip)
      : avatar.reactionClipPlayer!.play({
          ownerId: "reaction-owner",
          runId: "run",
          sourceEventId: "source",
          emotionEventId: "emotion",
          clip,
        });
  const stop = () =>
    lane === "gesture"
      ? avatar.stopClip()
      : avatar.reactionClipPlayer!.clear(null, { immediate: true });
  const update = (dt: number) => {
    avatar.update(dt);
    scene.updateMatrixWorld(true);
  };
  return { scene, bones, controller, play, stop, update };
}

afterEach(() => vi.restoreAllMocks());

describe.each(["gesture", "reaction"] as const)(
  "%s multi-anchor particle playback",
  (lane) => {
    it("follows independently moving bones through the clip event sink and removes systems on stop", async () => {
      vi.spyOn(QuarksLoader.prototype, "load").mockImplementation(
        (_url, onLoad) => {
          onLoad(parseMultiAnchorEffect());
        },
      );
      const harness = createPlaybackHarness(lane);
      try {
        harness.play();
        await vi.waitFor(() =>
          expect(harness.controller.getSnapshot().activeCount).toBe(1),
        );
        harness.update(0.01);
        expect(harness.controller.getSnapshot()).toMatchObject({
          activeCount: 1,
          lastError: null,
        });
        const emitters = ["head", "leftHand", "inherit"].map(
          (name) => harness.scene.getObjectByName(name) as ParticleEmitter,
        );
        const expected = [
          new Vector3(0, 1.7, 0),
          new Vector3(-0.5, 1, 0),
          new Vector3(0, 1.1, 0),
        ];
        for (const [index, emitter] of emitters.entries()) {
          expect(
            emitter
              .getWorldPosition(new Vector3())
              .distanceTo(expected[index]!),
          ).toBeLessThan(1e-10);
        }
        const dispose = emitters.map((emitter) =>
          vi.spyOn(emitter.system, "dispose"),
        );
        harness.bones.head.position.x += 0.2;
        harness.bones.leftHand.position.y += 0.3;
        harness.bones.chest.position.z += 0.4;
        harness.update(0.01);
        const positions = emitters.map((emitter) =>
          emitter.getWorldPosition(new Vector3()),
        );
        expect(positions[0]!.x).toBeCloseTo(0.2);
        expect(positions[0]!.y).toBeCloseTo(1.7);
        expect(positions[0]!.z).toBeCloseTo(0);
        expect(positions[1]!.x).toBeCloseTo(-0.5);
        expect(positions[1]!.y).toBeCloseTo(1.3);
        expect(positions[1]!.z).toBeCloseTo(0);
        expect(positions[2]!.x).toBeCloseTo(0);
        expect(positions[2]!.y).toBeCloseTo(1.1);
        expect(positions[2]!.z).toBeCloseTo(0.4);

        harness.stop();
        expect(harness.controller.getSnapshot().activeCount).toBe(0);
        expect(dispose.every((spy) => spy.mock.calls.length === 1)).toBe(true);
        expect(harness.scene.getObjectByName("leftHand")).toBeUndefined();
        expect(harness.controller.getSnapshot().warnings).toEqual([]);
      } finally {
        harness.controller.dispose();
      }
    });

    it("does not resurrect multi-anchor emitters when stopped during asset loading", async () => {
      let finishLoad: ((object: Object3D) => void) | undefined;
      vi.spyOn(QuarksLoader.prototype, "load").mockImplementation(
        (_url, onLoad) => {
          finishLoad = onLoad;
        },
      );
      const harness = createPlaybackHarness(lane);
      const playEffect = vi.spyOn(harness.controller, "playEffect");
      try {
        harness.play();
        await vi.waitFor(() => expect(finishLoad).toBeDefined());
        harness.stop();
        finishLoad!(parseMultiAnchorEffect());
        await Promise.all(
          playEffect.mock.results.map((result) => result.value),
        );
        expect(harness.controller.getSnapshot().activeCount).toBe(0);
        expect(harness.scene.getObjectByName("head")).toBeUndefined();
        expect(harness.controller.getSnapshot().lastError).toBeNull();
      } finally {
        harness.controller.dispose();
      }
    });
  },
);
