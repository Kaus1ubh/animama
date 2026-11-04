import { describe, expect, it, vi } from "vitest";
import { PerspectiveCamera } from "three";

import { Avatar } from "../Avatar";
import type { AnimaPoseClipV2 } from "../poses/animaPoseClip";
import { TEST_HOVER_VFX_ENTRY } from "../vfx/avatarVFXTestFixtures";
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
      const effect = TEST_HOVER_VFX_ENTRY;
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
        findUnavailableFacePart: () => null,
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
          schema: "animaPoseClip/2.0",
          id: "late-load",
          name: "Late load",
          duration: 2,
          loop: true,
          beats: [],
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
          schema: "animaPoseClip/2.0",
          id: "looping-effects",
          name: "Looping effects",
          duration: 2,
          loop: true,
          beats: [],
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
    const clip: AnimaPoseClipV2 = {
      schema: "animaPoseClip/2.0",
      id: "timing",
      name: "Timing",
      duration: 2,
      beats: [],
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

  it("plays a Reaction's expression track", () => {
    const overlays: Record<string, number>[] = [];
    const player = new ReactionClipPlayer({
      setExpressionOverlay: (_ownerId, expressions) => {
        overlays.push({ ...expressions });
        return true;
      },
      clearExpressionOverlay: () => true,
    });
    player.play({
      ownerId: "owner",
      runId: "run",
      sourceEventId: "source",
      emotionEventId: "emotion",
      clip: {
        schema: "animaPoseClip/2.0",
        id: "joy-1",
        name: "Joy 1",
        role: "reaction",
        duration: 1,
        beats: [
          { id: "start", label: "Start", time: 0 },
          { id: "peak", label: "Peak", time: 1, ease: "linear" },
        ],
        expressions: {
          happy: [
            { beat: "start", v: 0 },
            { beat: "peak", v: 0.8 },
          ],
        },
        joints: { head: { flexion: [{ beat: "peak", v: 10 }] } },
      },
    });
    player.update(0.5);
    expect(overlays.at(-1)).toEqual({ happy: expect.closeTo(0.4) });
  });

  it("times a Reaction's events and clears them when it ends", () => {
    const applied: string[] = [];
    const cleared: string[] = [];
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
    player.play({
      ownerId: "owner",
      runId: "run",
      sourceEventId: "source",
      emotionEventId: "emotion",
      clip: {
        schema: "animaPoseClip/2.0",
        id: "sparkle",
        name: "Sparkle",
        duration: 1,
        beats: [{ id: "start", label: "Start", time: 0 }],
        expressions: { happy: [{ beat: "start", v: 1 }] },
        events: [
          { id: "stars", time: 0.5, kind: "avatar_vfx", effectId: "stars" },
        ],
      },
    });
    player.update(0.25);
    expect(applied).toEqual([]);
    player.update(0.5);
    expect(applied).toEqual(["stars"]);
    player.clear("owner", { immediate: true });
    expect(cleared).toEqual(["stars"]);
  });

  it("sends an Avatar Effect event's fade in and fade out to the sink", () => {
    const values: number[] = [];
    const player = new ReactionClipPlayer(
      { setExpressionOverlay: () => true, clearExpressionOverlay: () => true },
      {
        eventSink: {
          applyAvatarVFX: () => undefined,
          clearAvatarVFX: () => undefined,
          setAvatarVFXIntensity: (_event, _context, intensity) => {
            values.push(Number(intensity.toFixed(3)));
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
        schema: "animaPoseClip/2.0",
        id: "fade",
        name: "Fade",
        duration: 4,
        beats: [],
        events: [
          {
            id: "blush",
            time: 0,
            duration: 2,
            kind: "avatar_vfx",
            effectId: "blush",
            envelope: {
              intensity: { fadeIn: 1, fadeOut: 0.5, easing: "linear" },
            },
          },
        ],
      },
    });
    // A zero-time event gets its first value at play, before any frame renders.
    expect(values).toEqual([0]);
    player.update(0.5);
    player.update(0.5);
    player.update(0.75);
    expect(values).toEqual([0, 0.5, 1, 0.5]);
  });

  it("sends the Avatar Effect fade of a Reaction with expression tracks", () => {
    const values: number[] = [];
    const player = new ReactionClipPlayer(
      { setExpressionOverlay: () => true, clearExpressionOverlay: () => true },
      {
        eventSink: {
          applyAvatarVFX: () => undefined,
          clearAvatarVFX: () => undefined,
          setAvatarVFXIntensity: (_event, _context, intensity) => {
            values.push(Number(intensity.toFixed(3)));
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
        schema: "animaPoseClip/2.0",
        id: "fade-v2",
        name: "Fade with expressions",
        role: "reaction",
        duration: 4,
        beats: [{ id: "start", label: "Start", time: 0 }],
        expressions: { happy: [{ beat: "start", v: 1 }] },
        events: [
          {
            id: "blush",
            time: 0,
            duration: 2,
            kind: "avatar_vfx",
            effectId: "blush",
            envelope: {
              intensity: { fadeIn: 1, fadeOut: 0.5, easing: "linear" },
            },
          },
        ],
      },
    });
    expect(values).toEqual([0]);
    player.update(0.5);
    player.update(0.5);
    player.update(0.75);
    expect(values).toEqual([0, 0.5, 1, 0.5]);
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
    const clip: AnimaPoseClipV2 = {
      schema: "animaPoseClip/2.0",
      id: "surprised-blink",
      name: "Surprised Blink",
      duration: 1,
      beats: [{ id: "blink", label: "Blink", time: 0 }],
      rotations: { head: [{ beat: "blink", q: [0, 0, 0, 1] }] },
      expressions: {
        surprised: [{ beat: "blink", v: 1 }],
        blink: [{ beat: "blink", v: 1 }],
      },
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
    const clip: AnimaPoseClipV2 = {
      schema: "animaPoseClip/2.0",
      id: "admiration-3",
      name: "Admiration 3",
      duration: 1,
      beats: [{ id: "admiration", label: "Admiration", time: 0 }],
      expressions: { happy: [{ beat: "admiration", v: 1 }] },
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

  describe("replacing and fading out", () => {
    const reaction = (
      id: string,
      expression: string,
      fade: { fadeIn?: number; fadeOut?: number } = {},
      events: AnimaPoseClipV2["events"] = [],
    ): AnimaPoseClipV2 => ({
      schema: "animaPoseClip/2.0",
      id,
      name: id,
      role: "reaction",
      duration: 4,
      beats: [{ id: "start", label: "Start", time: 0 }],
      ...(fade.fadeIn === undefined
        ? {}
        : { fadeIn: { duration: fade.fadeIn, easing: "linear" as const } }),
      ...(fade.fadeOut === undefined
        ? {}
        : { fadeOut: { duration: fade.fadeOut, easing: "linear" as const } }),
      expressions: { [expression]: [{ beat: "start", v: 1 }] },
      events,
    });
    const vein = {
      id: "vein",
      time: 0,
      kind: "avatar_vfx" as const,
      effectId: "vein",
    };
    const play = (player: ReactionClipPlayer, clip: AnimaPoseClipV2) =>
      player.play({
        ownerId: "owner",
        runId: "run",
        sourceEventId: clip.id,
        emotionEventId: null,
        clip,
      });
    const recordingPlayer = () => {
      const faces: Record<string, number>[] = [];
      const intensities: number[] = [];
      const cleared: string[] = [];
      const particleClears: string[] = [];
      const player = new ReactionClipPlayer(
        {
          setExpressionOverlay: (_ownerId, expressions) => {
            faces.push(
              Object.fromEntries(
                Object.entries(expressions).map(([k, v]) => [
                  k,
                  Number(v.toFixed(3)),
                ]),
              ),
            );
            return true;
          },
          clearExpressionOverlay: () => true,
        },
        {
          eventSink: {
            applyAvatarVFX: () => undefined,
            clearAvatarVFX: (event) => {
              cleared.push(event.id);
            },
            setAvatarVFXIntensity: (_event, _context, intensity) => {
              intensities.push(Number(intensity.toFixed(3)));
            },
            applyParticleVFX: () => undefined,
            clearParticleVFX: (event, _context, options) => {
              particleClears.push(
                `${event.id}:${options?.finish ? "finish" : "now"}`,
              );
            },
          },
        },
      );
      return { player, faces, intensities, cleared, particleClears };
    };

    it("fades a Reaction in from the face the one it replaces shows", () => {
      const { player, faces } = recordingPlayer();
      play(player, reaction("anger", "angry"));
      player.update(0.5);
      play(player, reaction("worry", "surprised", { fadeIn: 0.2 }));
      expect(faces.at(-1)).toEqual({ angry: 1, surprised: 0 });
      player.update(0.1);
      expect(faces.at(-1)).toEqual({ angry: 0.5, surprised: 0.5 });
      player.update(0.1);
      expect(faces.at(-1)).toEqual({ angry: 0, surprised: 1 });
    });

    it("crossfades from where a fading-out Reaction has got to", () => {
      const { player, faces } = recordingPlayer();
      play(player, reaction("anger", "angry", { fadeOut: 0.4 }));
      player.update(0.5);
      player.clear("owner");
      player.update(0.2);
      expect(faces.at(-1)).toEqual({ angry: 0.5 });
      play(player, reaction("worry", "surprised", { fadeIn: 0.2 }));
      expect(faces.at(-1)).toEqual({ angry: 0.5, surprised: 0 });
      player.update(0.1);
      expect(faces.at(-1)).toEqual({ angry: 0.25, surprised: 0.5 });
    });

    it("fades the replaced Reaction's Avatar Effects over the new fade-in, then removes them", () => {
      const { player, intensities, cleared } = recordingPlayer();
      play(player, reaction("anger", "angry", {}, [vein]));
      player.update(0.5);
      play(player, reaction("worry", "surprised", { fadeIn: 0.2 }));
      expect(cleared).toEqual([]);
      player.update(0.1);
      expect(intensities).toEqual([0.5]);
      expect(cleared).toEqual([]);
      player.update(0.1);
      expect(cleared).toEqual(["vein"]);
    });

    it("fades a Reaction's Avatar Effects with its face as it fades out", () => {
      const { player, intensities, cleared } = recordingPlayer();
      play(player, reaction("anger", "angry", { fadeOut: 0.4 }, [vein]));
      player.update(0.5);
      player.clear("owner");
      player.update(0.2);
      expect(intensities.at(-1)).toBe(0.5);
      expect(cleared).toEqual([]);
      player.update(0.2);
      expect(cleared).toEqual(["vein"]);
    });

    it("removes effects still fading from a replaced Reaction on an immediate clear", () => {
      const { player, cleared } = recordingPlayer();
      play(player, reaction("anger", "angry", {}, [vein]));
      play(player, reaction("worry", "surprised", { fadeIn: 0.2 }));
      player.clear("owner", { immediate: true });
      expect(cleared).toEqual(["vein"]);
    });

    it("keeps a replaying Reaction's effect when an earlier copy of it fades out", () => {
      const log: string[] = [];
      const player = new ReactionClipPlayer(
        {
          setExpressionOverlay: () => true,
          clearExpressionOverlay: () => true,
        },
        {
          eventSink: {
            applyAvatarVFX: (event) => {
              log.push(`apply ${event.id}`);
            },
            clearAvatarVFX: (event) => {
              log.push(`clear ${event.id}`);
            },
            setAvatarVFXIntensity: () => undefined,
          },
        },
      );
      const clip = reaction("anger", "angry", { fadeIn: 0.2 }, [vein]);
      play(player, clip);
      play(player, clip);
      player.update(0.3);
      expect(log).toEqual(["apply vein", "clear vein", "apply vein"]);
    });

    const hearts = {
      id: "hearts",
      time: 0,
      kind: "particle_vfx" as const,
      effectId: "hearts",
    };

    it("lets a fading-out Reaction's particles finish", () => {
      const { player, particleClears } = recordingPlayer();
      play(player, reaction("love", "happy", { fadeOut: 0.2 }, [hearts]));
      player.clear("owner");
      player.update(0.2);
      expect(particleClears).toEqual(["hearts:finish"]);
    });

    it("lets a replaced Reaction's particles finish under the new fade-in", () => {
      const { player, particleClears } = recordingPlayer();
      play(player, reaction("love", "happy", {}, [hearts]));
      play(player, reaction("worry", "surprised", { fadeIn: 0.2 }));
      expect(particleClears).toEqual(["hearts:finish"]);
    });

    it("removes a Reaction's particles at once on an immediate clear or a cut", () => {
      const { player, particleClears } = recordingPlayer();
      play(player, reaction("love", "happy", {}, [hearts]));
      player.clear("owner", { immediate: true });
      play(player, reaction("love", "happy", {}, [hearts]));
      play(player, reaction("calm", "relaxed", { fadeIn: 0 }));
      expect(particleClears).toEqual(["hearts:now", "hearts:now"]);
    });

    it("cuts to the new Reaction when it has no fade-in", () => {
      const { player, faces, cleared } = recordingPlayer();
      play(player, reaction("anger", "angry", {}, [vein]));
      play(player, reaction("worry", "surprised", { fadeIn: 0 }));
      expect(cleared).toEqual(["vein"]);
      expect(faces.at(-1)).toEqual({ surprised: 1 });
    });

    it("ends an earlier crossfade's effects when a Reaction cuts in", () => {
      const { player, cleared } = recordingPlayer();
      play(player, reaction("anger", "angry", {}, [vein]));
      play(player, reaction("worry", "surprised", { fadeIn: 0.2 }));
      play(player, reaction("calm", "relaxed", { fadeIn: 0 }));
      expect(cleared).toEqual(["vein"]);
    });
  });
});
