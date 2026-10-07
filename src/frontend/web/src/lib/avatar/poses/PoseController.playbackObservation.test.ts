import type { VRM } from "@pixiv/three-vrm";
import { describe, expect, it } from "vitest";

import { parseAnimaPoseClip, type AnimaPoseClip } from "./animaPoseClip";
import {
  PoseController,
  type AnimaPoseClipEventContext,
} from "./PoseController";

function minimalVrm(): VRM {
  return {
    humanoid: {
      getNormalizedPose: () => ({}),
      getNormalizedBoneNode: () => null,
      resetNormalizedPose: () => undefined,
      setNormalizedPose: () => undefined,
    },
    expressionManager: null,
  } as unknown as VRM;
}

describe("PoseController playback observation", () => {
  it("reports the logical IDs of events fired by the active pose clip", () => {
    const controller = new PoseController(minimalVrm());
    controller.setClipEventSink({ playSfx: () => undefined });
    const clip: AnimaPoseClip = {
      schema: "animaPoseClip/1.0",
      id: "shy-finger-poke",
      name: "Shy Finger Poke",
      duration: 1,
      poses: {
        shy: { humanoid: { head: { rotation: [0, 0, 0, 1] } } },
      },
      poseKeyframes: [{ time: 0, pose: "shy" }],
      events: [
        {
          id: "shy-sparkle",
          time: 0,
          kind: "sfx",
          cueId: "sparkle",
        },
      ],
    };

    controller.playAnimaPoseClip(clip);

    expect(controller.getClipSnapshot().firedEventIds).toEqual(["shy-sparkle"]);
  });
});

describe("finite idle playback", () => {
  const clip: AnimaPoseClip = {
    schema: "animaPoseClip/1.0",
    id: "idle-clip",
    name: "Idle",
    duration: 1,
    loop: true,
    poses: {},
    poseKeyframes: [],
    events: [
      { id: "start", time: 0, kind: "sfx", cueId: "tap" },
      { id: "end", time: 1, kind: "sfx", cueId: "tap" },
    ],
  };
  it("uses authored speed, stops after N cycles and excludes the next cycle's zero event", () => {
    const controller = new PoseController(minimalVrm());
    const seen: string[] = [];
    controller.setClipEventSink({
      playSfx: (event, context) => {
        seen.push(`${event.id}:${context.occurrenceIndex}`);
      },
    });
    controller.playAnimaPoseClip(clip, {
      finitePlayback: { timeScale: 2, repetitions: 2 },
    });
    controller.update(0.5);
    expect(seen).toEqual(["start:0", "start:1", "end:0"]);
    expect(controller.isClipActive()).toBe(true);
    controller.update(0.5);
    expect(seen).toEqual(["start:0", "start:1", "end:0", "end:1"]);
    expect(controller.isClipActive()).toBe(false);
  });
  it("uses admitted repetitions even when the authored clip loop flag differs", () => {
    const controller = new PoseController(minimalVrm());
    const events: string[] = [];
    controller.setClipEventSink({
      playSfx: (event) => {
        events.push(event.id);
      },
    });
    controller.playAnimaPoseClip(
      { ...clip, loop: false },
      { finitePlayback: { timeScale: 1, repetitions: 2 } },
    );
    controller.update(1.5);
    expect(controller.isClipActive()).toBe(true);
    expect(events.filter((id) => id === "start")).toHaveLength(2);
    controller.update(0.5);
    expect(controller.isClipActive()).toBe(false);
  });

  it("advances the pose and expression sample on the same authored-speed clock as events", () => {
    let happy = 0;
    const vrm = {
      ...minimalVrm(),
      expressionManager: {
        getExpression: () => ({}),
        getValue: () => happy,
        update: () => {},
        setValue: (_name: string, value: number) => {
          happy = value;
        },
      } as unknown as VRM["expressionManager"],
    } as unknown as VRM;
    const controller = new PoseController(vrm);
    controller.playAnimaPoseClip(
      {
        schema: "animaPoseClip/1.0",
        id: "expression",
        name: "Expression",
        duration: 1,
        poses: {
          start: { expressions: { happy: 0 } },
          end: { expressions: { happy: 1 } },
        },
        poseKeyframes: [
          { time: 0, pose: "start" },
          { time: 1, pose: "end", transition: { easing: "linear" } },
        ],
      },
      { finitePlayback: { timeScale: 2, repetitions: 1 } },
    );
    controller.update(0.25);
    expect(happy).toBeCloseTo(0.5);
  });

  it("cancels only the occurrence's event work immediately when interrupted or replaced", () => {
    const controller = new PoseController(minimalVrm());
    const contexts: AnimaPoseClipEventContext[] = [];
    controller.setClipEventSink({
      playSfx: (_event, context) => {
        contexts.push(context);
      },
    });
    const options = { finitePlayback: { timeScale: 1, repetitions: 2 } };
    controller.playAnimaPoseClip(clip, options);
    controller.stopClip({ fadeOutDurationSec: 1 });
    expect(contexts[0]?.signal?.aborted).toBe(true);
    controller.playAnimaPoseClip(clip, options);
    expect(contexts[1]?.signal?.aborted).toBe(false);
    expect(contexts[1]?.appliedId).not.toBe(contexts[0]?.appliedId);
    controller.dispose();
    expect(contexts[1]?.signal?.aborted).toBe(true);
  });
});

describe("finite authored timeline admission", () => {
  const base = {
    schema: "animaPoseClip/1.0",
    id: "extent",
    name: "Extent",
    poses: {},
    poseKeyframes: [],
  };
  it("plays an inferred positive event extent without including effect duration", () => {
    const controller = new PoseController(minimalVrm());
    const seen: string[] = [];
    controller.setClipEventSink({
      applyAvatarVFX: (event) => {
        seen.push(event.id);
      },
    });
    const clip = parseAnimaPoseClip({
      ...base,
      events: [
        {
          id: "end",
          kind: "avatar_vfx",
          effectId: "sparkle",
          time: 0.5,
          duration: 40,
        },
      ],
    });
    controller.playAnimaPoseClip(clip, {
      finitePlayback: { timeScale: 2, repetitions: 1 },
    });
    controller.update(0.25);
    expect(seen).toEqual(["end"]);
    expect(controller.isClipActive()).toBe(false);
  });
  it("admits timed looping clips with only zero events and rejects an unknown horizon", () => {
    const events = [{ id: "start", kind: "sfx", cueId: "tap", time: 0 }];
    expect(() =>
      parseAnimaPoseClip({ ...base, duration: 0.25, loop: true, events }),
    ).not.toThrow();
    expect(() => parseAnimaPoseClip({ ...base, events })).toThrow();
  });
});

describe("Avatar Effect event envelopes", () => {
  const fadingClip = (envelope: boolean): AnimaPoseClip =>
    parseAnimaPoseClip({
      schema: "animaPoseClip/1.0",
      id: "fade",
      name: "Fade",
      duration: 4,
      poses: {},
      poseKeyframes: [],
      events: [
        {
          id: "glow",
          kind: "avatar_vfx",
          effectId: "glow",
          time: 0.5,
          duration: 2,
          ...(envelope
            ? {
                envelope: {
                  intensity: { fadeIn: 0.5, fadeOut: 1, easing: "linear" },
                },
              }
            : {}),
        },
      ],
    });

  it("sends the fade in and fade out on the event's own timeline", () => {
    const controller = new PoseController(minimalVrm());
    const values: Array<[string, number]> = [];
    controller.setClipEventSink({
      applyAvatarVFX: () => undefined,
      clearAvatarVFX: () => undefined,
      setAvatarVFXIntensity: (event, _context, intensity) => {
        values.push([event.id, Number(intensity.toFixed(3))]);
      },
    });
    controller.playAnimaPoseClip(fadingClip(true));
    controller.update(0.5); // starts at 0.5 s: local 0
    controller.update(0.25); // local 0.25: halfway through the fade in
    controller.update(0.5); // local 0.75: full
    controller.update(0.25); // local 1.0: still full, unchanged values are skipped
    controller.update(0.75); // local 1.75: halfway through the fade out
    expect(values).toEqual([
      ["glow", 0],
      ["glow", 0.5],
      ["glow", 1],
      ["glow", 0.25],
    ]);
  });

  it("leaves events without an envelope at full intensity", () => {
    const controller = new PoseController(minimalVrm());
    const values: number[] = [];
    controller.setClipEventSink({
      applyAvatarVFX: () => undefined,
      setAvatarVFXIntensity: (_event, _context, intensity) => {
        values.push(intensity);
      },
    });
    controller.playAnimaPoseClip(fadingClip(false));
    controller.update(0.5);
    controller.update(1);
    expect(values).toEqual([]);
  });
});
