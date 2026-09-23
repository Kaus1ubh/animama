import { describe, expect, it } from "vitest";
import { parseAnimaPoseClip } from "./schema";
import { sampleAnimaPoseClip } from "./sampling";

describe("event-only action sampling", () => {
  const clip = parseAnimaPoseClip({
    schema: "animaPoseClip/1.0",
    id: "events",
    name: "Events",
    duration: 1,
    poses: {},
    poseKeyframes: [],
    events: [{ id: "sound", kind: "sfx", cueId: "bell", time: 0 }],
  });
  it("leaves pose channels unmodified when only events are authored", () => {
    expect(sampleAnimaPoseClip(clip, 0.5)).toEqual({
      sample: {},
      diagnostics: { missingPoseRefs: [] },
    });
  });
  it("retains an explicitly selected base pose without synthetic keyframes", () => {
    const result = sampleAnimaPoseClip(
      { ...clip, basePose: "base" },
      0.5,
      () => ({
        schema: "animaPose/1.0",
        id: "base",
        name: "Base",
        expressions: { happy: 0.5 },
      }),
    );
    expect(result.sample.expressions).toEqual({ happy: 0.5 });
  });
});
