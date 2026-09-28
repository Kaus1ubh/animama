import { describe, expect, it, vi } from "vitest";
import { PerspectiveCamera } from "three";

import { Avatar } from "../Avatar";
import type { AnimaPoseClip } from "../poses/animaPoseClip";
import { AVATAR_VFX_CATALOG } from "../vfx/catalog";
import { isHoverVFXEntry } from "../vfx/types";
import { ReactionClipPlayer } from "./ReactionClipPlayer";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ReactionClipPlayer", () => {
  it.each(["pending", "active"] as const)(
    "keeps the %s loop occurrence owned after an older Avatar load rejects",
    async (replacement) => {
      const active = new Set(["unrelated-effect"]);
      const effect = AVATAR_VFX_CATALOG.find(isHoverVFXEntry)!;
      const first = deferred<typeof effect>();
      const second = deferred<typeof effect>();
      const loadAvatarVFX = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const avatar = new Avatar(new PerspectiveCamera(), null, {
        mediaCatalog: { loadAvatarVFX } as unknown as NonNullable<
          ConstructorParameters<typeof Avatar>[2]
        >["mediaCatalog"],
      });
      vi.spyOn(avatar, "isReady", "get").mockReturnValue(true);
      avatar.vfxController = {
        removeEffect: (id: string) => active.delete(id),
        applyHoverVFX: async ({ effectId }: { effectId: string }) => {
          active.add(effectId);
        },
      } as unknown as NonNullable<Avatar["vfxController"]>;
      const player = new ReactionClipPlayer({
        setExpressionOverlay: () => true,
        clearExpressionOverlay: () => true,
      });
      avatar.reactionClipPlayer = player;
      avatar.setReactionClipExternalEventSink(null);
      player.play({
        ownerId: "owner",
        runId: "run",
        sourceEventId: "source",
        emotionEventId: "emotion",
        clip: {
          schema: "animaPoseClip/1.0",
          id: "late-load",
          name: "Late load",
          duration: 2,
          loop: true,
          poses: {},
          poseKeyframes: [],
          events: [
            { id: "effect", time: 0, kind: "avatar_vfx", effectId: effect.id },
          ],
        },
      });
      player.update(2.1);
      if (replacement === "active") {
        second.resolve(effect);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(active.size).toBe(2);
      }
      first.reject(new Error("Earlier loop load failed"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      second.resolve(effect);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(player.getSnapshot().activeEventCount).toBe(1);
      expect(active.size).toBe(2);
      player.clear("owner", { immediate: true });
      expect([...active]).toEqual(["unrelated-effect"]);
    },
  );

  it.each([undefined, 3])(
    "bounds Action-lifetime loop effects while retaining duration=%s overlap",
    (duration) => {
      const active = new Set(["unrelated-effect"]);
      const occurrences: number[] = [];
      const player = new ReactionClipPlayer(
        {
          setExpressionOverlay: () => true,
          clearExpressionOverlay: () => true,
        },
        {
          eventSink: {
            applyAvatarVFX: (_event, context) => {
              active.add(context.appliedId);
              occurrences.push(context.occurrenceIndex);
            },
            clearAvatarVFX: (_event, context) => {
              active.delete(context.appliedId);
            },
          },
        },
      );
      player.play({
        ownerId: "owner",
        runId: "run",
        sourceEventId: "source",
        emotionEventId: "emotion",
        clip: {
          schema: "animaPoseClip/1.0",
          id: "looping-effects",
          name: "Looping effects",
          duration: 2,
          loop: true,
          poses: {},
          poseKeyframes: [],
          // Separate timeline events can deliberately use the same catalog item.
          events: ["first", "second"].map((id) => ({
            id,
            kind: "avatar_vfx" as const,
            time: 0,
            effectId: "shared-effect",
            ...(duration === undefined ? {} : { duration }),
          })),
        },
      });
      expect(active.size).toBe(3);
      for (const elapsed of [2.1, 2, 4.7]) {
        player.update(elapsed);
        expect(player.getSnapshot().activeEventCount).toBe(
          duration === undefined ? 2 : 4,
        );
        expect(active.size).toBe(duration === undefined ? 3 : 5);
      }
      expect(occurrences).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
      expect(player.clear("other-owner", { immediate: true })).toBe(false);
      expect(active.size).toBe(duration === undefined ? 3 : 5);
      expect(player.clear("owner", { immediate: true })).toBe(true);
      expect([...active]).toEqual(["unrelated-effect"]);
    },
  );

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
