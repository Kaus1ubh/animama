import { describe, expect, it, vi } from "vitest";
import { PerspectiveCamera } from "three";
import { Avatar } from "./Avatar";
import { TEST_HOVER_VFX_ENTRY } from "./vfx/avatarVFXTestFixtures";
import type { AnimaPoseClipEventSink } from "./poses/PoseController";

/** Exercise the installed player sinks; renderer effects are the external boundary. */
function fixture(player: "gesture" | "reaction") {
  const effect = TEST_HOVER_VFX_ENTRY;
  const loadAvatarVFX = vi
    .fn()
    .mockResolvedValue({ ...effect, sound: { onApply: "attached" } });
  const avatar = new Avatar(new PerspectiveCamera(), null, {
    mediaCatalog: { loadAvatarVFX } as unknown as NonNullable<
      ConstructorParameters<typeof Avatar>[2]
    >["mediaCatalog"],
  });
  vi.spyOn(avatar, "isReady", "get").mockReturnValue(true);
  const applyHoverVFX = vi.fn().mockResolvedValue(undefined);
  const findUnavailableFacePart = vi.fn((): string | null => null);
  const reportUnavailableFacePart = vi.fn();
  avatar.vfxController = {
    removeEffect: vi.fn(),
    applyHoverVFX,
    findUnavailableFacePart,
    reportUnavailableFacePart,
  } as unknown as NonNullable<Avatar["vfxController"]>;
  let sink: AnimaPoseClipEventSink = {};
  const playSfx = vi.fn();
  if (player === "gesture") {
    avatar.poseController = {
      setClipEventSink: (value: AnimaPoseClipEventSink) => {
        sink = value;
      },
    } as unknown as NonNullable<Avatar["poseController"]>;
    avatar.setPoseClipExternalEventSink({ playSfx });
  } else {
    avatar.reactionClipPlayer = {
      setEventSink: (value: AnimaPoseClipEventSink) => {
        sink = value;
      },
    } as unknown as NonNullable<Avatar["reactionClipPlayer"]>;
    avatar.setReactionClipExternalEventSink({ playSfx });
  }
  return {
    sink,
    effect,
    playSfx,
    applyHoverVFX,
    loadAvatarVFX,
    findUnavailableFacePart,
    reportUnavailableFacePart,
  };
}
const context = {
  clipId: "clip",
  eventId: "event",
  appliedId: "clip:event",
  playbackTime: 0,
  clipTime: 0,
  occurrenceIndex: 0,
};

describe.each(["gesture", "reaction"] as const)(
  "%s accompanying audio",
  (player) => {
    it("does not apply a visual or its sound after an idle occurrence is cancelled during loading", async () => {
      const { sink, effect, loadAvatarVFX, applyHoverVFX, playSfx } =
        fixture(player);
      const abort = new AbortController();
      let resolve!: (value: unknown) => void;
      loadAvatarVFX.mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const pending = sink.applyAvatarVFX?.(
        { id: "event", time: 0, kind: "avatar_vfx", effectId: effect.id },
        { ...context, signal: abort.signal },
      );
      abort.abort();
      resolve({ ...effect, sound: { onApply: "attached" } });
      await pending;
      expect(applyHoverVFX).not.toHaveBeenCalled();
      expect(playSfx).not.toHaveBeenCalled();
    });
    it.each([undefined, true, false])(
      "plays successful visuals with accompanying=%s",
      async (playAccompanyingSound) => {
        const { sink, effect, playSfx, applyHoverVFX } = fixture(player);
        await sink.applyAvatarVFX?.(
          {
            id: "event",
            time: 0,
            kind: "avatar_vfx",
            effectId: effect.id,
            playAccompanyingSound,
          },
          context,
        );
        expect(applyHoverVFX).toHaveBeenCalledOnce();
        expect(playSfx).toHaveBeenCalledTimes(
          playAccompanyingSound === false ? 0 : 1,
        );
        if (playAccompanyingSound !== false)
          expect(playSfx).toHaveBeenCalledWith(
            expect.objectContaining({ cueId: "attached", kind: "sfx" }),
            context,
          );
        await sink.playSfx?.(
          { id: "independent", time: 0, kind: "sfx", cueId: "separate" },
          context,
        );
        expect(playSfx).toHaveBeenLastCalledWith(
          expect.objectContaining({ cueId: "separate" }),
          context,
        );
      },
    );

    it("skips an effect without its face part, without its sound or an event error", async () => {
      const {
        sink,
        effect,
        playSfx,
        applyHoverVFX,
        findUnavailableFacePart,
        reportUnavailableFacePart,
      } = fixture(player);
      findUnavailableFacePart.mockReturnValue("face_skin");
      await expect(
        sink.applyAvatarVFX?.(
          { id: "event", time: 0, kind: "avatar_vfx", effectId: effect.id },
          context,
        ),
      ).resolves.toBeUndefined();
      expect(applyHoverVFX).not.toHaveBeenCalled();
      expect(playSfx).not.toHaveBeenCalled();
      expect(reportUnavailableFacePart).toHaveBeenCalledWith(
        expect.objectContaining({ id: effect.id }),
        "face_skin",
      );
    });

    it("keeps sound choices local to each event using the same effect", async () => {
      const { sink, effect, playSfx, applyHoverVFX } = fixture(player);
      const event = {
        id: "muted",
        time: 0,
        kind: "avatar_vfx" as const,
        effectId: effect.id,
        playAccompanyingSound: false,
      };
      await sink.applyAvatarVFX?.(event, context);
      await sink.applyAvatarVFX?.(
        { ...event, id: "audible", playAccompanyingSound: true },
        { ...context, eventId: "audible", appliedId: "clip:audible" },
      );
      expect(applyHoverVFX).toHaveBeenCalledTimes(2);
      expect(playSfx).toHaveBeenCalledOnce();
      expect(playSfx).toHaveBeenCalledWith(
        expect.objectContaining({ id: "audible", cueId: "attached" }),
        expect.objectContaining({ eventId: "audible" }),
      );
    });

    it("does not play audio after an async visual was cancelled", async () => {
      const { sink, effect, playSfx, applyHoverVFX } = fixture(player);
      let finish!: () => void;
      applyHoverVFX.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const event = {
        id: "event",
        time: 0,
        kind: "avatar_vfx" as const,
        effectId: effect.id,
      };
      const pending = sink.applyAvatarVFX?.(event, context);
      await vi.waitFor(() => expect(applyHoverVFX).toHaveBeenCalled());
      sink.clearAvatarVFX?.(event, context);
      finish();
      await pending;
      expect(playSfx).not.toHaveBeenCalled();
    });
  },
);
