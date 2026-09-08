import type { VRM } from "@pixiv/three-vrm";
import { describe, expect, it } from "vitest";

import type { AnimaPoseClip } from "./animaPoseClip";
import { PoseController } from "./PoseController";

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
