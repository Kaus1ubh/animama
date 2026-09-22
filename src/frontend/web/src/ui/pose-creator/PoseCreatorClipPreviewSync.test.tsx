import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { PoseCreatorClipPreviewSync } from "./PoseCreatorClipPreviewSync";

const harness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  apply: vi.fn(() => ({ diagnostics: { missingPoseRefs: [] } })),
  restore: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => void | (() => void)) => {
    harness.effects.push(effect);
  },
}));
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
    catalog: null,
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
  useOptionalSoundController: () => null,
}));
vi.mock("./poseCreatorClipPreview", async (original) => ({
  ...(await original<typeof import("./poseCreatorClipPreview")>()),
  applyPoseCreatorClipPreview: harness.apply,
}));
vi.mock("./poseCreatorAuthoring", async (original) => ({
  ...(await original<typeof import("./poseCreatorAuthoring")>()),
  applyPoseCreatorDraftsToAvatar: harness.restore,
}));

beforeEach(() => {
  usePoseCreatorStore.getState().resetWorkspace();
  harness.effects = [];
});
describe("timeline preview posture lifetime", () => {
  it.each(["relaxedRest", undefined])(
    "forwards %s through preview and cleanup without editing the draft",
    (previewBasePose) => {
      const avatar = {} as NonNullable<
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
