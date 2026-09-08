import { describe, expect, it } from "vitest";

import type { AnimaPoseClip } from "../poses/animaPoseClip";
import { ReactionClipPlayer } from "./ReactionClipPlayer";

describe("ReactionClipPlayer", () => {
  it("accepts a generic clip with body motion and applies only expressions", () => {
    const overlays: Record<string, number>[] = [];
    const player = new ReactionClipPlayer({
      setExpressionOverlay: (_ownerId, expressions) => {
        overlays.push(expressions);
        return true;
      },
      clearExpressionOverlay: () => true,
    });
    const clip: AnimaPoseClip = {
      schema: "animaPoseClip/1.0",
      id: "surprised-blink",
      name: "Surprised Blink",
      duration: 1,
      poses: {
        surprisedBlink: {
          humanoid: { head: { rotation: [0, 0, 0, 1] } },
          expressions: { surprised: 1, blink: 1 },
        },
      },
      poseKeyframes: [{ time: 0, pose: "surprisedBlink" }],
    };

    expect(
      player.play({
        ownerId: "reaction:test",
        runId: "run-1",
        sourceEventId: "event-1",
        emotionEventId: "emotion-1",
        clip,
      }),
    ).toBe(true);
    expect(overlays.at(-1)).toEqual({ surprised: 1, blink: 1 });
    expect(player.getSnapshot().expressionKeys).toEqual(["surprised", "blink"]);
  });

  it("reports the logical IDs of events fired by the active reaction", () => {
    const player = new ReactionClipPlayer(
      {
        setExpressionOverlay: () => true,
        clearExpressionOverlay: () => true,
      },
      { eventSink: { playSfx: () => undefined } },
    );
    const clip: AnimaPoseClip = {
      schema: "animaPoseClip/1.0",
      id: "admiration-3",
      name: "Admiration 3",
      duration: 1,
      poses: { admiration: { expressions: { happy: 1 } } },
      poseKeyframes: [{ time: 0, pose: "admiration" }],
      events: [
        {
          id: "admiration-sparkle",
          time: 0,
          kind: "sfx",
          cueId: "sparkle",
        },
      ],
    };

    player.play({
      ownerId: "reaction:test",
      runId: "run-1",
      sourceEventId: "event-1",
      emotionEventId: "emotion-1",
      clip,
    });

    expect(player.getSnapshot().firedEventIds).toEqual(["admiration-sparkle"]);
  });
});
