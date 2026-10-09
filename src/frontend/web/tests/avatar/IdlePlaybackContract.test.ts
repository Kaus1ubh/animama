import type { VRM } from "@pixiv/three-vrm";
import { describe, expect, it } from "vitest";
import idlePlaybackCases from "../../../../../tests/fixtures/idle-playback-cases.json";
import { PoseController } from "@/lib/avatar/poses/PoseController";
import {
  getAnimaPoseClipTimelineDuration,
  parseAnimaPoseClip,
  RETIRED_ANIMA_POSE_CLIP_SCHEMA,
  UnsupportedAnimaPoseClipFormatError,
  unsupportedAnimaPoseClipFormatMessage,
} from "@/lib/avatar/poses/animaPoseClip";

/** The backend admission facts must describe a timeline the actual player can finish. */
describe("shared finite idle clip contract", () => {
  it.each(idlePlaybackCases.filter((row) => row.kind === "anima_clip"))(
    "$name matches actual parser admission",
    ({ clip, parser_valid }) => {
      const schema = (clip as { schema?: unknown } | null)?.schema;
      if (parser_valid) {
        expect(() => parseAnimaPoseClip(clip)).not.toThrow();
      } else if (schema === RETIRED_ANIMA_POSE_CLIP_SCHEMA) {
        // The retired format is rejected by schema, before validation.
        expect(() => parseAnimaPoseClip(clip)).toThrow(
          UnsupportedAnimaPoseClipFormatError,
        );
        expect(() => parseAnimaPoseClip(clip)).toThrow(
          unsupportedAnimaPoseClipFormatMessage(RETIRED_ANIMA_POSE_CLIP_SCHEMA),
        );
      } else if (schema === "animaPoseClip/2.0") {
        expect(() => parseAnimaPoseClip(clip)).toThrow(
          /Invalid animaPoseClip\/2\.0 payload/,
        );
      } else {
        expect(() => parseAnimaPoseClip(clip)).toThrow(
          UnsupportedAnimaPoseClipFormatError,
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
