import { Object3D } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Avatar } from "@/lib/avatar";
import { useAnimationDebugStore } from "@/stores/animation-debug-store";
import { useAnimaAnimationDebugStore } from "@/stores/anima-animation-debug-store";
import { useVRMEditorDebugStore } from "@/stores/vrm-editor-debug-store";
import { attachAvatarDebugRuntime } from "./avatarDebugRuntime";

const cleanups: Array<() => void> = [];

/** Use real stores and an unloaded engine; no GPU or model request is needed. */
function attach(animaId: string) {
  const avatar = new Avatar(new Object3D());
  vi.spyOn(avatar, "isReady", "get").mockReturnValue(true);
  const actions = vi.spyOn(avatar, "getActiveAnimations").mockReturnValue([]);
  const face = vi
    .spyOn(avatar, "setFaceDebugBoxVisible")
    .mockImplementation(() => {});
  const dispose = attachAvatarDebugRuntime(
    { avatar, animaId, sourceUrl: null, sourceKey: null },
    () => null,
  );
  cleanups.push(() => {
    dispose();
    avatar.dispose();
  });
  return { avatar, actions, face, dispose };
}

beforeEach(() => {
  vi.useFakeTimers();
  useAnimaAnimationDebugStore.getState().setOpen(false);
  useAnimaAnimationDebugStore.getState().clearSnapshot();
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.useRealTimers();
});

describe("optional avatar inspectors", () => {
  it("only polls while requested and stops all observation on disposal", () => {
    const { avatar, actions, face, dispose } = attach("current");
    vi.advanceTimersByTime(1_000);
    expect(actions).not.toHaveBeenCalled();

    useAnimaAnimationDebugStore.getState().setAnimationSnapshotDemand(true);
    expect(actions).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(actions).toHaveBeenCalledTimes(3);
    expect(useAnimaAnimationDebugStore.getState().snapshot?.animaId).toBe(
      "current",
    );

    useVRMEditorDebugStore.getState().setShowFaceDebugBox(true);
    expect(face).toHaveBeenLastCalledWith(true);
    expect(useAnimationDebugStore.getState().target?.avatar).toBe(avatar);
    useAnimaAnimationDebugStore.getState().setAnimationSnapshotDemand(false);
    vi.advanceTimersByTime(1_000);
    expect(actions).toHaveBeenCalledTimes(3);

    dispose();
    useAnimaAnimationDebugStore.getState().setAnimationSnapshotDemand(true);
    vi.advanceTimersByTime(1_000);
    expect(actions).toHaveBeenCalledTimes(3);
    expect(useAnimationDebugStore.getState().target).toBeNull();
    expect(useVRMEditorDebugStore.getState().target).toBeNull();
    expect(face).toHaveBeenLastCalledWith(false);
  });

  it("does not clear a replacement avatar's target or snapshot", () => {
    const old = attach("old");
    const current = attach("current");
    old.dispose();
    useAnimaAnimationDebugStore.getState().setAnimationSnapshotDemand(true);
    expect(useVRMEditorDebugStore.getState().target?.avatar).toBe(
      current.avatar,
    );
    expect(useAnimaAnimationDebugStore.getState().snapshot?.animaId).toBe(
      "current",
    );
    expect(old.actions).not.toHaveBeenCalled();
  });

  it("registering an inspector observes playback without resetting its settings", () => {
    const avatar = new Avatar(new Object3D());
    try {
      avatar.setAutomaticAnimationPlaybackEnabled(false);
      avatar.setVrmaRootedPlaybackEnabled(false);
      avatar.setIdleStintQuietIntervalSec(7);
      useAnimationDebugStore.getState().registerTarget({
        avatar,
        animaId: "current",
        sourceUrl: null,
        sourceKey: null,
      });
      expect(avatar.isAutomaticAnimationPlaybackEnabled()).toBe(false);
      expect(avatar.isVrmaRootedPlaybackEnabled()).toBe(false);
      expect(avatar.getIdleStintQuietIntervalSec()).toBe(7);
      expect(useAnimationDebugStore.getState().idleStintQuietIntervalSec).toBe(
        7,
      );
    } finally {
      useAnimationDebugStore.getState().clearTarget(avatar);
      avatar.dispose();
    }
  });
});
