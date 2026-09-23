import { describe, expect, it } from "vitest";
import compatibilityValid from "./fixtures/compatibility-valid.json";
import { parseAnimaPoseClip } from "./schema";

describe("animaPoseClip backend compatibility fixture", () => {
  it("is consumed by the runtime parser without dropping supported fields", () => {
    const parsed = parseAnimaPoseClip(compatibilityValid);

    expect(parsed.id).toBe("compatibility-valid");
    expect(parsed.poseKeyframes).toHaveLength(3);
    expect(parsed.events?.map((event) => event.kind)).toEqual([
      "avatar_vfx",
      "scene_vfx",
      "particle_vfx",
      "sfx",
    ]);
    expect(parsed.events?.[2]).toMatchObject({
      anchor: "head",
      followAnchor: true,
      transform: {
        offset: { y: 0.2 },
        depthOffset: 0.1,
      },
    });
  });

  it("accepts an effect-only action without a synthetic pose keyframe", () => {
    const parsed = parseAnimaPoseClip({
      schema: "animaPoseClip/1.0",
      id: "effect-only",
      name: "Effect only",
      duration: 1,
      poses: {},
      poseKeyframes: [],
      events: [
        {
          id: "sparkles",
          time: 0.4,
          kind: "particle_vfx",
          effectId: "sparkles",
          duration: 0.2,
        },
      ],
    });

    expect(parsed.poseKeyframes).toEqual([]);
    expect(parsed.events).toHaveLength(1);
  });
});

describe("per-event accompanying sound", () => {
  it.each([false, true])(
    "preserves explicit %s through JSON reopen",
    (enabled) => {
      const input = structuredClone(compatibilityValid);
      const events = input.events.map((event) =>
        event.kind === "avatar_vfx" || event.kind === "scene_vfx"
          ? { ...event, playAccompanyingSound: enabled }
          : event,
      );
      const parsed = parseAnimaPoseClip({ ...input, events });
      expect(JSON.parse(JSON.stringify(parsed)).events.slice(0, 2)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "avatar_vfx",
            playAccompanyingSound: enabled,
          }),
          expect.objectContaining({
            kind: "scene_vfx",
            playAccompanyingSound: enabled,
          }),
        ]),
      );
    },
  );

  it.each(["avatar_vfx", "scene_vfx"])(
    "rejects nonboolean flags on %s",
    (kind) => {
      const events = compatibilityValid.events.map((event) =>
        event.kind === kind
          ? { ...event, playAccompanyingSound: "false" }
          : event,
      );
      expect(() =>
        parseAnimaPoseClip({ ...compatibilityValid, events }),
      ).toThrow();
    },
  );
});
