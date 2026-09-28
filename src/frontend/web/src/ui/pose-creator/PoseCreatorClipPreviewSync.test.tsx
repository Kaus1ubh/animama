import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { createPoseCreatorClipDraftFromAnimaPoseClip } from "./poseCreatorClipAuthoring";
import { getSceneBackgroundLayerPresetById } from "@/lib/scene-vfx/catalog";
import { PoseCreatorClipPreviewSync } from "./PoseCreatorClipPreviewSync";

const harness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  apply: vi.fn(() => ({ diagnostics: { missingPoseRefs: [] } })),
  restore: vi.fn(),
  catalog: null as unknown,
  sound: null as unknown,
  applyAvatarVFX: vi.fn().mockResolvedValue(true),
  retainedRefs: null as Array<{ current: unknown }> | null,
  refIndex: 0,
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      harness.effects.push(effect);
    },
    // Keep one mounted preview's ownership across manually advanced frames.
    useRef: (value: unknown) => {
      if (!harness.retainedRefs) return actual.useRef(value);
      const index = harness.refIndex++;
      return (harness.retainedRefs[index] ??= { current: value });
    },
  };
});
vi.mock("@/stores/pose-creator-store", async (original) => {
  const actual = await original<typeof import("@/stores/pose-creator-store")>();
  return {
    ...actual,
    usePoseCreatorStore: Object.assign(
      (
        selector: (
          state: ReturnType<typeof actual.usePoseCreatorStore.getState>,
        ) => unknown,
      ) => selector(actual.usePoseCreatorStore.getState()),
      actual.usePoseCreatorStore,
    ),
  };
});
vi.mock("./PoseCreatorPreviewProvider", () => ({
  usePoseCreatorPreview: () => ({
    catalog: harness.catalog,
    eventCatalog: {
      validationRefs: {
        avatarVFXIds: [],
        sceneBackgroundLayerPresetIds: [],
        sceneFocusLinePresetIds: [],
        particleVFXIds: [],
        sfxCueIds: [],
      },
    },
  }),
}));
vi.mock("@/hooks/use-sound-controller", () => ({
  useOptionalSoundController: () => harness.sound,
}));
vi.mock("./poseCreatorClipPreview", async (original) => ({
  ...(await original<typeof import("./poseCreatorClipPreview")>()),
  applyPoseCreatorClipPreview: harness.apply,
}));
vi.mock("./poseCreatorAuthoring", async (original) => ({
  ...(await original<typeof import("./poseCreatorAuthoring")>()),
  applyPoseCreatorDraftsToAvatar: harness.restore,
}));

vi.mock("@/lib/avatar/vfx/runtime", () => ({
  applyAvatarVFXEffectById: harness.applyAvatarVFX,
}));

beforeEach(() => {
  usePoseCreatorStore.getState().resetWorkspace();
  harness.effects = [];
  harness.catalog = null;
  harness.sound = null;
  harness.retainedRefs = null;
  harness.refIndex = 0;
  harness.applyAvatarVFX.mockReset().mockResolvedValue(true);
});

describe("looping timeline effect ownership", () => {
  it.each([undefined, 3])(
    "bounds Action-lifetime effects while preserving duration=%s overlap",
    async (duration) => {
      const active = new Set(["unrelated-effect"]);
      harness.retainedRefs = [];
      harness.catalog = {
        loadAvatarVFX: vi.fn().mockResolvedValue({ id: "shared-effect" }),
      };
      harness.applyAvatarVFX.mockImplementation(async ({ appliedEffectId }) => {
        active.add(appliedEffectId);
        return true;
      });
      const avatar = {
        vfxController: {
          removeEffect: (id: string) => active.delete(id),
        },
      } as unknown as NonNullable<
        ReturnType<typeof usePoseCreatorStore.getState>["activeAvatar"]
      >;
      usePoseCreatorStore.setState({
        authoringMode: "clip",
        activeAvatar: avatar,
        clipPlaybackPlaying: true,
        clipDraft: createPoseCreatorClipDraftFromAnimaPoseClip(
          {
            schema: "animaPoseClip/1.0",
            id: "looping-effects",
            name: "Looping effects",
            duration: 2,
            loop: true,
            poses: {},
            poseKeyframes: [],
            // Distinct timeline events may intentionally share an effect.
            events: ["first", "second"].map((id) => ({
              id,
              kind: "avatar_vfx" as const,
              time: 0,
              effectId: "shared-effect",
              ...(duration === undefined ? {} : { duration }),
            })),
          },
          { fallbackBasePose: "relaxedRest" },
        ),
      });
      const frame = async (time: number, playing = true) => {
        harness.effects = [];
        harness.refIndex = 0;
        usePoseCreatorStore.setState({
          clipPlaybackAbsoluteTimeSec: time,
          clipPlaybackPlaying: playing,
        });
        renderToString(<PoseCreatorClipPreviewSync />);
        harness.effects.forEach((effect) => effect());
        await new Promise((resolve) => setTimeout(resolve, 0));
      };
      await frame(0);
      expect(active.size).toBe(3);
      for (const time of [2.1, 4.1, 8.8]) {
        await frame(time);
        expect(active.size).toBe(duration === undefined ? 3 : 5);
      }
      // Late completion/cancellation must address only its own occurrence.
      const appliedIds = harness.applyAvatarVFX.mock.calls.map(
        ([request]) => request.appliedEffectId,
      );
      expect(new Set(appliedIds).size).toBe(appliedIds.length);
      await frame(8.8, false);
      expect([...active]).toEqual(["unrelated-effect"]);
      usePoseCreatorStore.setState({ activeAvatar: null });
    },
  );
});
describe("timeline preview posture lifetime", () => {
  it.each(["relaxedRest", undefined])(
    "forwards %s through preview and cleanup without editing the draft",
    (previewBasePose) => {
      const avatar = {} as unknown as NonNullable<
        ReturnType<typeof usePoseCreatorStore.getState>["activeAvatar"]
      >;
      usePoseCreatorStore.setState((state) => ({
        authoringMode: "clip",
        activeAvatar: avatar,
        basePose: "",
        clipDraft: { ...state.clipDraft, basePose: "" },
      }));
      const before = usePoseCreatorStore.getState().clipDraft;
      renderToString(
        <PoseCreatorClipPreviewSync previewBasePose={previewBasePose} />,
      );
      const cleanups = harness.effects.map((effect) => effect());
      expect(harness.apply).toHaveBeenCalledWith(
        avatar,
        before,
        previewBasePose,
      );
      cleanups.forEach((cleanup) => cleanup?.());
      expect(harness.restore).toHaveBeenCalledWith(
        avatar,
        previewBasePose ?? "",
        {},
        {},
      );
      expect(usePoseCreatorStore.getState().clipDraft).toBe(before);
      usePoseCreatorStore.setState({ activeAvatar: null });
    },
  );
});

describe.each(["avatar_vfx", "scene_vfx"] as const)(
  "%s creator audio",
  (kind) => {
    it.each([undefined, true, false])(
      "only plays due-event accompanying audio when enabled=%s",
      async (playAccompanyingSound) => {
        const playSfxCue = vi.fn();
        harness.sound = { playSfxCue, sfxVolume: 1 };
        const preset = getSceneBackgroundLayerPresetById("kawaii-sparkles")!;
        harness.catalog = {
          loadAvatarVFX: vi.fn().mockResolvedValue({
            id: "effect",
            sound: { onApply: "attached" },
          }),
          loadSceneVFX: vi
            .fn()
            .mockResolvedValue({ ...preset, sound: { onApply: "attached" } }),
        };
        const avatar = {
          vfxController: { removeEffect: vi.fn() },
        } as unknown as NonNullable<
          ReturnType<typeof usePoseCreatorStore.getState>["activeAvatar"]
        >;
        const clipDraft = createPoseCreatorClipDraftFromAnimaPoseClip(
          {
            schema: "animaPoseClip/1.0",
            id: "audio",
            name: "Audio",
            duration: 2,
            poses: {},
            poseKeyframes: [],
            events: [
              {
                id: "effect",
                kind,
                time: 0,
                duration: 2,
                effectId: "effect",
                sceneKind: "background_layers",
                presetId: preset.id,
                playAccompanyingSound,
              },
              { id: "separate", kind: "sfx", time: 0, cueId: "independent" },
            ],
          },
          { fallbackBasePose: "relaxedRest" },
        );
        for (const mode of ["scrub", "resume", "start"] as const) {
          harness.effects = [];
          playSfxCue.mockClear();
          usePoseCreatorStore.setState({
            authoringMode: "clip",
            activeAvatar: avatar,
            clipDraft,
            clipPlaybackPlaying: mode !== "scrub",
            clipPlaybackAbsoluteTimeSec: mode === "start" ? 0 : 0.5,
          });
          renderToString(<PoseCreatorClipPreviewSync />);
          const cleanups = harness.effects.map((effect) => effect());
          await new Promise((resolve) => setTimeout(resolve, 0));
          const cues = playSfxCue.mock.calls.map(([cue]) => cue);
          expect(cues).toEqual(
            mode === "start"
              ? playAccompanyingSound === false
                ? ["independent"]
                : ["independent", "attached"]
              : [],
          );
          cleanups.forEach((cleanup) => cleanup?.());
          usePoseCreatorStore.setState({ activeAvatar: null });
        }
      },
    );
  },
);
