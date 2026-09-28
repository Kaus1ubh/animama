import type { VRM } from "@pixiv/three-vrm";
import { describe, expect, it } from "vitest";
import idlePlaybackCases from "../../../../../tests/fixtures/idle-playback-cases.json";
import { PoseController } from "@/lib/avatar/poses/PoseController";
import {
  getAnimaPoseClipTimelineDuration,
  parseAnimaPoseClip,
} from "@/lib/avatar/poses/animaPoseClip";

/** The backend admission facts must describe a timeline the actual player can finish. */
describe("shared finite idle clip contract", () => {
  it.each(idlePlaybackCases.filter((row) => row.kind === "anima_clip"))(
    "$name matches actual parser admission",
    ({ clip, parser_valid }) => {
      if (parser_valid) {
        expect(() => parseAnimaPoseClip(clip)).not.toThrow();
      } else {
        expect(() => parseAnimaPoseClip(clip)).toThrow(
          "Invalid animaPoseClip/1.0 payload",
        );
      }
    },
  );

  it.each(
    idlePlaybackCases.filter(
      (row) => row.kind === "anima_clip" && row.expected,
    ),
  )("$name completes at the admitted horizon", ({ clip: raw, expected }) => {
    const facts = expected!;
    const clip = parseAnimaPoseClip(raw);
    expect(getAnimaPoseClipTimelineDuration(clip)).toBe(facts.cycle_seconds);
    const vrm = {
      humanoid: {
        getNormalizedPose: () => ({}),
        getNormalizedBoneNode: () => null,
        resetNormalizedPose: () => {},
        setNormalizedPose: () => {},
      },
    } as unknown as VRM;
    const controller = new PoseController(vrm);
    controller.setClipEventSink({
      applyAvatarVFX: () => {},
      clearAvatarVFX: () => {},
    });
    controller.playAnimaPoseClip(clip, {
      finitePlayback: {
        timeScale: facts.time_scale,
        repetitions: facts.repetitions,
      },
    });
    controller.update(facts.duration_seconds - 0.001);
    expect(controller.isClipActive()).toBe(true);
    controller.update(0.0011);
    expect(controller.isClipActive()).toBe(false);
  });
});
