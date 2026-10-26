import { afterEach, describe, expect, it } from "vitest";

import {
  applyDesktopPipVisualState,
  captureDesktopPipVisualState,
} from "./visual-state";
import {
  useSceneVFXStore,
  type SceneVFXActiveByKind,
} from "@/stores/scene-vfx-store";
import { DEFAULT_AVATAR_TRANSFORM } from "@/ui/main/canvas/transform-state";

/** A Reaction's scene background, as PiP's own Avatar applies it. */
const reactionBackground = {
  background_layers: { entry: { id: "scene-b-excitement" } },
} as unknown as SceneVFXActiveByKind;

describe("PiP visual state", () => {
  afterEach(() => {
    useSceneVFXStore.getState().replaceActiveByKind({});
  });

  it("keeps the scene effects PiP's Avatar plays when a snapshot arrives", () => {
    // The main window's scene is suspended during PiP, so its store is empty.
    const snapshot = captureDesktopPipVisualState({
      avatarTransform: DEFAULT_AVATAR_TRANSFORM,
      backgroundMode: "scene",
      cameraPreset: "portrait",
    });
    useSceneVFXStore.getState().replaceActiveByKind(reactionBackground);

    applyDesktopPipVisualState(snapshot);

    expect(useSceneVFXStore.getState().activeByKind).toBe(reactionBackground);
  });
});
