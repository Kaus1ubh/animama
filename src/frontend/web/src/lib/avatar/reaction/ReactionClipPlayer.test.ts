import { describe, expect, it } from "vitest";

import type { AnimaPoseClip } from "../poses/animaPoseClip";
import { ReactionClipPlayer } from "./ReactionClipPlayer";

describe("ReactionClipPlayer", () => {
  it("expires timed VFX independently and clears remaining VFX when the Action ends", () => {
    const cleared: string[] = [];
    const applied: string[] = [];
    const player = new ReactionClipPlayer(
      { setExpressionOverlay: () => true, clearExpressionOverlay: () => true },
      {
        eventSink: {
          applyAvatarVFX: (event) => {
            applied.push(event.id);
          },
          clearAvatarVFX: (event) => {
            cleared.push(event.id);
          },
        },
      },
    );
    const clip: AnimaPoseClip = {
      schema: "animaPoseClip/1.0",
      id: "timing",
      name: "Timing",
      duration: 2,
      poses: {},
      poseKeyframes: [],
      events: [
        { id: "with-action", time: 0, kind: "avatar_vfx", effectId: "eyes" },
        {
          id: "timed",
          time: 0.25,
          duration: 0.25,
          kind: "avatar_vfx",
          effectId: "stars",
        },
      ],
    };
    player.play({
      ownerId: "owner",
      runId: "run",
      sourceEventId: "source",
      emotionEventId: "emotion",
      clip,
    });
    expect(applied).toEqual(["with-action"]);
    player.update(0.25);
    expect(applied).toEqual(["with-action", "timed"]);
    expect(cleared).toEqual([]);
    player.update(0.25);
    expect(cleared).toEqual(["timed"]);
    player.clear("owner", { immediate: true });
    expect(cleared).toEqual(["timed", "with-action"]);
  });

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
