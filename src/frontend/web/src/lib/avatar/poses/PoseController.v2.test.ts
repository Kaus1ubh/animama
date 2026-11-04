import type { VRM, VRMPose } from "@pixiv/three-vrm";
import { Quaternion } from "three";
import { describe, expect, it } from "vitest";

import { angularDistanceDegrees } from "./anatomy/anatomy";
import {
  UnsupportedAnimaPoseClipFormatError,
  type AnimaPoseClipV2,
} from "./animaPoseClip";
import { PoseController } from "./PoseController";

/** A VRM stub recording the normalized pose and expression weights applied. */
function stubVrm() {
  const applied: { pose: VRMPose; weights: Record<string, number> } = {
    pose: {},
    weights: {},
  };
  const vrm = {
    humanoid: {
      getNormalizedPose: () => applied.pose,
      // Every bone exists, so sampled bones are applied.
      getNormalizedBoneNode: () => ({}),
      resetNormalizedPose: () => {
        applied.pose = {};
      },
      setNormalizedPose: (pose: VRMPose) => {
        applied.pose = pose;
      },
    },
    expressionManager: {
      getExpression: () => ({}),
      getValue: (name: string) => applied.weights[name] ?? 0,
      update: () => undefined,
      setValue: (name: string, value: number) => {
        applied.weights[name] = value;
      },
    },
  } as unknown as VRM;
  return { vrm, applied };
}

const clip = (overrides: Partial<AnimaPoseClipV2> = {}): AnimaPoseClipV2 => ({
  schema: "animaPoseClip/2.0",
  id: "nod",
  name: "Nod",
  duration: 1,
  beats: [
    { id: "start", label: "Start", time: 0 },
    { id: "nod", label: "Nod", time: 1, ease: "linear" },
  ],
  joints: {
    head: {
      flexion: [
        { beat: "start", v: 0 },
        { beat: "nod", v: 20 },
      ],
    },
  },
  expressions: {
    happy: [
      { beat: "start", v: 0 },
      { beat: "nod", v: 1 },
    ],
  },
  ...overrides,
});

describe("PoseController with animaPoseClip/2.0", () => {
  it("applies the sampled body and expression tracks as it plays", () => {
    const { vrm, applied } = stubVrm();
    const controller = new PoseController(vrm);
    controller.playAnimaPoseClip(clip());
    controller.update(0.5);
    expect(applied.weights.happy).toBeCloseTo(0.5);
    const head = new Quaternion(...applied.pose.head!.rotation!);
    expect(angularDistanceDegrees(head, new Quaternion())).toBeCloseTo(10);
    expect(controller.getClipPresence()?.expressions).toMatchObject({
      happy: expect.closeTo(0.5),
    });
  });

  it("fades in and out, then finishes", () => {
    const { vrm } = stubVrm();
    const controller = new PoseController(vrm);
    controller.playAnimaPoseClip(
      clip({
        fadeIn: { duration: 0.2, easing: "linear" },
        fadeOut: { duration: 0.2, easing: "linear" },
        mutedProceduralLayers: ["sway"],
      }),
    );
    controller.update(0.1);
    expect(controller.getClipPresence()).toMatchObject({
      weight: expect.closeTo(0.5),
      mutedLayers: ["sway"],
    });
    controller.update(0.9);
    controller.update(0.1);
    expect(controller.getClipPresence()?.weight).toBeCloseTo(0.5);
    controller.update(0.2);
    expect(controller.isClipActive()).toBe(false);
  });

  it("dispatches events at their times and stops after finite repetitions", () => {
    const { vrm } = stubVrm();
    const controller = new PoseController(vrm);
    const fired: string[] = [];
    controller.setClipEventSink({
      playSfx: (event, context) => {
        fired.push(`${event.id}:${context.occurrenceIndex}`);
      },
    });
    controller.playAnimaPoseClip(
      clip({ events: [{ id: "tap", time: 0.5, kind: "sfx", cueId: "tap" }] }),
      { finitePlayback: { timeScale: 1, repetitions: 2 } },
    );
    controller.update(1);
    expect(fired).toEqual(["tap:0"]);
    controller.update(1);
    expect(fired).toEqual(["tap:0", "tap:1"]);
    expect(controller.isClipActive()).toBe(false);
  });

  it("fades out from the frame it reached when stopped, then restores the rest pose and face", () => {
    const { vrm, applied } = stubVrm();
    const controller = new PoseController(vrm);
    controller.playAnimaPoseClip(
      clip({ fadeOut: { duration: 0.2, easing: "linear" } }),
    );
    controller.update(0.5);
    expect(controller.stopClip()).toBe(false);
    controller.update(0.1);
    // Halfway through the fade from the stop frame (happy 0.5) to none.
    expect(controller.getClipPresence()?.weight).toBeCloseTo(0.5);
    expect(applied.weights.happy).toBeGreaterThan(0);
    controller.update(0.2);
    expect(controller.isClipActive()).toBe(false);
    expect(applied.pose).toEqual({});
    expect(applied.weights.happy).toBe(0);
  });

  describe("hip offsets", () => {
    const hipsX = (pose: VRMPose) => pose.hips?.position?.[0] ?? 0;
    const shifted = (x: number) =>
      clip({
        id: "shift",
        name: "Shift",
        fadeIn: { duration: 0.2, easing: "linear" },
        fadeOut: { duration: 0.2, easing: "linear" },
        hipsPosition: { x: [{ beat: "start", v: x }] },
      });

    it("fades a clip's hip offset back to rest as it stops", () => {
      const { vrm, applied } = stubVrm();
      const controller = new PoseController(vrm);
      controller.playAnimaPoseClip(shifted(0.02));
      controller.update(0.5);
      const offset = hipsX(applied.pose);
      expect(offset).not.toBe(0);
      expect(controller.stopClip()).toBe(false);
      controller.update(0.1);
      expect(hipsX(applied.pose)).toBeCloseTo(offset / 2, 5);
      controller.update(0.09);
      expect(Math.abs(hipsX(applied.pose))).toBeLessThan(
        Math.abs(offset) * 0.1,
      );
    });

    it("fades an inherited hip offset to rest when the new clip has no hip motion", () => {
      const { vrm, applied } = stubVrm();
      const controller = new PoseController(vrm);
      applied.pose = { hips: { position: [0.02, 0, 0] } };
      controller.playAnimaPoseClip(
        clip({ fadeIn: { duration: 0.2, easing: "linear" } }),
      );
      controller.update(0.1);
      expect(hipsX(applied.pose)).toBeCloseTo(0.01, 5);
      controller.update(0.1);
      expect(hipsX(applied.pose)).toBeCloseTo(0, 5);
    });

    it("keeps the hip offset a clip itself keys", () => {
      const { vrm, applied } = stubVrm();
      const controller = new PoseController(vrm);
      controller.playAnimaPoseClip(shifted(0.02));
      controller.update(0.5);
      expect(hipsX(applied.pose)).not.toBe(0);
    });
  });

  it("replaces a playing clip and reports only its own expressions", () => {
    const { vrm } = stubVrm();
    const controller = new PoseController(vrm);
    controller.playAnimaPoseClip(
      clip({
        id: "frown",
        name: "Frown",
        beats: [{ id: "frown", label: "Frown", time: 0 }],
        joints: undefined,
        expressions: { angry: [{ beat: "frown", v: 1 }] },
      }),
    );
    controller.update(0.2);
    controller.playAnimaPoseClip(clip());
    controller.update(0.5);
    expect(controller.isClipActive("nod")).toBe(true);
    expect(
      Object.keys(controller.getClipPresence()?.expressions ?? {}),
    ).toEqual(["happy"]);
  });

  it("refuses a retired 1.0 clip and keeps the playing clip", () => {
    const { vrm } = stubVrm();
    const controller = new PoseController(vrm);
    controller.playAnimaPoseClip(clip());
    const retired = {
      schema: "animaPoseClip/1.0",
      id: "frown",
      name: "Frown",
      duration: 1,
      poses: { frown: { expressions: { angry: 1 } } },
      poseKeyframes: [{ time: 0, pose: "frown" }],
    } as unknown as AnimaPoseClipV2;
    expect(() => controller.playAnimaPoseClip(retired)).toThrow(
      UnsupportedAnimaPoseClipFormatError,
    );
    expect(controller.isClipActive("nod")).toBe(true);
  });

  it("times an effect-only clip without replacing the pose", () => {
    const { vrm, applied } = stubVrm();
    applied.pose = { head: { rotation: [0, 0.1, 0, 0.995] } };
    const controller = new PoseController(vrm);
    controller.playAnimaPoseClip(
      clip({
        joints: undefined,
        expressions: undefined,
        events: [{ id: "tap", time: 0.1, kind: "sfx", cueId: "tap" }],
      }),
    );
    controller.update(0.5);
    expect(applied.pose.head?.rotation).toEqual([0, 0.1, 0, 0.995]);
  });
});
