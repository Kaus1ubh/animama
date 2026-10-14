// @vitest-environment happy-dom
import type { AvatarEffectDefinitionV2 } from "@animama/runtime-contracts/api-types";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";
import type { AnimaPoseClipAvatarVFXEvent } from "@/lib/avatar/poses/animaPoseClip";
import type { AnimaRuntimeCatalogSnapshot } from "@/lib/runtime-content/types";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import type { AvatarEffectDragTarget } from "@/ui/avatar-effect-creator/avatarEffectDrag";
import { createPoseCreatorClipDraftFromAnimaPoseClip } from "./poseCreatorClipAuthoring";
import { usePoseCreatorEffectHandles } from "./PoseCreatorEffectHandles";

const harness = vi.hoisted(() => ({
  runtime: null as AnimaRuntimeCatalogSnapshot | null,
  manipulation: null as {
    enabled: boolean;
    target: AvatarEffectDragTarget;
  } | null,
}));
vi.mock("./PoseCreatorPreviewProvider", () => ({
  usePoseCreatorPreview: () => ({ runtime: harness.runtime }),
}));
vi.mock("@/ui/avatar-effect-creator/AvatarEffectManipulator", () => ({
  AvatarEffectHandleRenderer: () => null,
  createAvatarEffectManipulationState: () => ({}),
  useAvatarEffectManipulation: (args: {
    enabled: boolean;
    target: AvatarEffectDragTarget;
  }) => {
    harness.manipulation = args;
    return { onKeyDown: () => undefined };
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const STAR: AvatarEffectDefinitionV2 = {
  schema: "animama/avatar-effect/2",
  region: "body",
  attachment: { kind: "body", bone: "head", size: 0.065 },
  art: { image: "kira_star.png" },
};

const EVENT: AnimaPoseClipAvatarVFXEvent = {
  id: "star",
  time: 0.5,
  kind: "avatar_vfx",
  effectId: "star",
  duration: 1,
};

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  usePoseCreatorEffectHandles(ref);
  return <div ref={ref} />;
}

describe("usePoseCreatorEffectHandles", () => {
  const updateEffectTransform = vi.fn(() => true);
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    harness.manipulation = null;
    harness.runtime = {
      avatar_vfx: [
        {
          slot: "avatar_vfx",
          runtime_id: "star",
          kind: "avatar_vfx",
          display_name: "Kira Star",
          description: null,
          config_schema_version: 1,
          config: {},
          definition: STAR,
          content_revision: "1",
          source: { type: "authorized_files", files: [] },
        },
      ],
      sfx: [],
    } as unknown as AnimaRuntimeCatalogSnapshot;
    const draft = createPoseCreatorClipDraftFromAnimaPoseClip(
      {
        schema: "animaPoseClip/2.0",
        id: "wink",
        name: "Wink",
        duration: 2,
        beats: [],
        events: [EVENT],
      },
      { fallbackBasePose: "" },
    );
    usePoseCreatorStore.setState({
      activeAvatar: {
        vfxController: { updateEffectTransform },
      } as unknown as Avatar,
      authoringMode: "clip",
      clipInlineEdit: null,
      clipPlaybackPlaying: false,
      clipUndoHistory: [],
      clipDraft: { ...draft, currentTimeSec: 1, selectedEventId: EVENT.id },
    });
    container = document.createElement("div");
    root = createRoot(container);
    act(() => root.render(<Probe />));
  });

  afterEach(() => act(() => root.unmount()));

  const event = () =>
    usePoseCreatorStore.getState().clipDraft
      .events[0] as AnimaPoseClipAvatarVFXEvent;

  it("is enabled only while the paused playhead shows the selected event", () => {
    expect(harness.manipulation?.enabled).toBe(true);
    act(() =>
      usePoseCreatorStore.setState((state) => ({
        clipDraft: { ...state.clipDraft, currentTimeSec: 0.25 },
      })),
    );
    expect(harness.manipulation?.enabled).toBe(false);
    act(() =>
      usePoseCreatorStore.setState((state) => ({
        clipPlaybackPlaying: true,
        clipDraft: { ...state.clipDraft, currentTimeSec: 1 },
      })),
    );
    expect(harness.manipulation?.enabled).toBe(false);
  });

  it("moves the art in place and writes the override once per gesture", () => {
    const target = harness.manipulation!.target;
    act(() => {
      target.beginGroup();
      target.apply({ rotationDeg: 10 });
      target.apply({ rotationDeg: 30 });
    });
    expect(updateEffectTransform).toHaveBeenLastCalledWith(
      "poseCreatorClip:scrub:wink:star:0",
      expect.objectContaining({ kind: "body", size: 0.065 }),
    );
    // The event is unchanged until the gesture ends.
    expect(event()).not.toHaveProperty("override");
    act(() => target.endGroup());
    expect(event().override).toEqual({
      attachment: { kind: "body", bone: "head", size: 0.065, rotationDeg: 30 },
    });
    act(() => usePoseCreatorStore.getState().undoClip());
    expect(event()).not.toHaveProperty("override");
  });
});
