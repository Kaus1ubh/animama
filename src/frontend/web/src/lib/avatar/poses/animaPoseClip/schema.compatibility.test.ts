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
