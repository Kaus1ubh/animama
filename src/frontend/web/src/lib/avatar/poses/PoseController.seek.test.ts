import type { VRM } from "@pixiv/three-vrm";
import { describe, expect, it } from "vitest";

import type { AnimaPoseClipV2 } from "./animaPoseClip";
import { PoseController } from "./PoseController";

/** A VRM stub whose `happy` expression weight records what playback applies. */
function expressionVrm() {
  const weights = { happy: 0 };
  const vrm = {
    humanoid: {
      getNormalizedPose: () => ({}),
      getNormalizedBoneNode: () => null,
      resetNormalizedPose: () => undefined,
      setNormalizedPose: () => undefined,
    },
    expressionManager: {
      getExpression: () => ({}),
      getValue: () => weights.happy,
      update: () => undefined,
      setValue: (_name: string, value: number) => {
        weights.happy = value;
      },
    },
  } as unknown as VRM;
  return { vrm, weights };
}

/** `happy` rises linearly from 0 to 1 over one second. */
function rampClip(overrides: Partial<AnimaPoseClipV2> = {}): AnimaPoseClipV2 {
  return {
    schema: "animaPoseClip/2.0",
    id: "ramp",
    name: "Ramp",
    duration: 1,
    beats: [
      { id: "start", label: "Start", time: 0 },
      { id: "end", label: "End", time: 1, ease: "linear" },
    ],
    expressions: {
      happy: [
        { beat: "start", v: 0 },
        { beat: "end", v: 1 },
      ],
    },
    ...overrides,
  };
}

describe("PoseController.seekClip", () => {
  it("jumps the playing clip to a time and keeps playing from there", () => {
    const { vrm, weights } = expressionVrm();
    const controller = new PoseController(vrm);
    controller.playAnimaPoseClip(rampClip());

    expect(controller.seekClip(0.5)).toBe(true);
    controller.update(0);
    expect(weights.happy).toBeCloseTo(0.5);

    controller.update(0.25);
    expect(weights.happy).toBeCloseTo(0.75);
  });

  it("derives the fade-in phase from the sought time", () => {
    const { vrm } = expressionVrm();
    const controller = new PoseController(vrm);
    controller.playAnimaPoseClip(
      rampClip({
        fadeIn: { duration: 0.4, easing: "linear" },
        mutedProceduralLayers: ["sway"],
      }),
    );

    controller.seekClip(0.2);
    controller.update(0);
    expect(controller.getClipPresence()).toMatchObject({
      weight: expect.closeTo(0.5),
      mutedLayers: ["sway"],
    });

    controller.seekClip(0.6);
    controller.update(0);
    expect(controller.getClipPresence()?.weight).toBe(1);
  });

  it("enters a one-shot's fade-out after its duration and stays active until it ends", () => {
    const { vrm } = expressionVrm();
    const controller = new PoseController(vrm);
    controller.playAnimaPoseClip(
      rampClip({ fadeOut: { duration: 0.4, easing: "linear" } }),
    );

    controller.seekClip(1.2);
    controller.update(0);
    expect(controller.isClipActive()).toBe(true);
    expect(controller.getClipPresence()?.weight).toBeCloseTo(0.5);

    // Seeking back into the timeline leaves the fade-out.
    controller.seekClip(0.5);
    controller.update(0);
    expect(controller.getClipPresence()?.weight).toBe(1);

    // A time past the fade-out holds its last frame instead of ending playback.
    controller.seekClip(5);
    controller.update(0);
    expect(controller.isClipActive()).toBe(true);
  });

  it("wraps a looping clip", () => {
    const { vrm, weights } = expressionVrm();
    const controller = new PoseController(vrm);
    controller.playAnimaPoseClip(rampClip({ loop: true }));

    controller.seekClip(2.25);
    controller.update(0);
    expect(weights.happy).toBeCloseTo(0.25);
  });

  it("fires no events when seeking, and only later events once playback resumes", () => {
    const { vrm } = expressionVrm();
    const controller = new PoseController(vrm);
    const fired: string[] = [];
    controller.setClipEventSink({
      playSfx: (event) => {
        fired.push(event.id);
      },
    });
    controller.playAnimaPoseClip(
      rampClip({
        events: [
          { id: "early", time: 0.3, kind: "sfx", cueId: "tap" },
          { id: "late", time: 0.7, kind: "sfx", cueId: "tap" },
        ],
      }),
    );

    controller.seekClip(0.5);
    controller.update(0);
    expect(fired).toEqual([]);

    controller.update(0.3);
    expect(fired).toEqual(["late"]);

    // Seeking back re-arms the events after the new time.
    controller.seekClip(0.1);
    controller.update(0.3);
    expect(fired).toEqual(["late", "early"]);
  });

  it("returns false when no clip is playing", () => {
    const { vrm } = expressionVrm();
    expect(new PoseController(vrm).seekClip(0.5)).toBe(false);
  });
});
