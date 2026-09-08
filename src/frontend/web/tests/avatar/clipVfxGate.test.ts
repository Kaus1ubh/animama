import { beforeEach, describe, expect, it, vi } from "vitest";
import { Object3D } from "three";

import {
  Avatar,
  type AnimaPoseClipAvatarVFXEvent,
  type AnimaPoseClipEventContext,
  type AnimaPoseClipParticleVFXEvent,
  type AnimaPoseClipSceneVFXEvent,
} from "@/lib/avatar";
import { getSceneBackgroundLayerPresetById } from "@/lib/scene-vfx/catalog";
import type { SceneVFXKind } from "@/lib/scene-vfx/types";
import { useSceneVFXStore } from "@/stores/scene-vfx-store";
import {
  applyClipOwnedSceneVFX,
  clearAllClipOwnedSceneVFX,
  collectClipOwnedSceneVFXAppliedIds,
  type ClipOwnedSceneVFXRecord,
} from "@/ui/main/canvas/clip-owned-scene-vfx";

type AvatarClipVFXInternals = {
  _applyPoseClipAvatarVFX: (
    event: AnimaPoseClipAvatarVFXEvent,
    context: AnimaPoseClipEventContext,
  ) => Promise<void>;
  _applyPoseClipParticleVFX: (
    event: AnimaPoseClipParticleVFXEvent,
    context: AnimaPoseClipEventContext,
  ) => Promise<void>;
  _clipOwnedAvatarVFXIds: Set<string>;
  _clipOwnedParticleVFXIds: Set<string>;
};

const avatarEvent: AnimaPoseClipAvatarVFXEvent = {
  id: "avatar-star",
  time: 0,
  kind: "avatar_vfx",
  effectId: "star",
};

const particleEvent: AnimaPoseClipParticleVFXEvent = {
  id: "particle-stars",
  time: 0,
  kind: "particle_vfx",
  effectId: "stars",
  duration: 1.4,
};

const sceneEvent: AnimaPoseClipSceneVFXEvent = {
  id: "scene-emotion-background",
  time: 0,
  kind: "scene_vfx",
  sceneKind: "background_layers",
  presetId: "scene-vfx-emotion-joy",
};

const eventContext: AnimaPoseClipEventContext = {
  clipId: "joy-3",
  eventId: "particle-stars",
  appliedId: "poseClip:joy-3:particle-stars",
  playbackTime: 0,
  clipTime: 0,
  occurrenceIndex: 0,
};

const resolveFixtureSceneVFX = (kind: SceneVFXKind, runtimeId: string) =>
  kind === "background_layers"
    ? getSceneBackgroundLayerPresetById(runtimeId)
    : null;

describe("clip-owned VFX preference gate", () => {
  beforeEach(() => {
    useSceneVFXStore.getState().replaceActiveByKind({});
  });

  it("suppresses new clip-owned avatar and particle VFX applies when disabled", async () => {
    const avatar = new Avatar(new Object3D());
    const internals = avatar as unknown as AvatarClipVFXInternals;
    const removeEffect = vi.fn();
    const clearEffect = vi.fn();
    const playEffect = vi.fn().mockResolvedValue(true);
    avatar.vfxController = { removeEffect } as never;
    avatar.particleVFXController = {
      clearEffect,
      playEffect,
    } as never;

    avatar.setClipVFXEnabled(false);
    await internals._applyPoseClipAvatarVFX(avatarEvent, eventContext);
    await internals._applyPoseClipParticleVFX(particleEvent, eventContext);

    expect(removeEffect).not.toHaveBeenCalled();
    expect(clearEffect).not.toHaveBeenCalled();
    expect(playEffect).not.toHaveBeenCalled();
  });

  it("clears tracked clip-owned avatar and particle VFX when disabled", () => {
    const avatar = new Avatar(new Object3D());
    const internals = avatar as unknown as AvatarClipVFXInternals;
    const removeEffect = vi.fn();
    const clearEffect = vi.fn();
    avatar.vfxController = { removeEffect } as never;
    avatar.particleVFXController = { clearEffect } as never;
    internals._clipOwnedAvatarVFXIds.add("reaction:run:emotion:joy-3:avatar");
    internals._clipOwnedParticleVFXIds.add(
      "reaction:run:emotion:joy-3:particle",
    );

    avatar.setClipVFXEnabled(false);

    expect(removeEffect).toHaveBeenCalledWith(
      "reaction:run:emotion:joy-3:avatar",
    );
    expect(clearEffect).toHaveBeenCalledWith(
      "reaction:run:emotion:joy-3:particle",
    );
    expect(internals._clipOwnedAvatarVFXIds.size).toBe(0);
    expect(internals._clipOwnedParticleVFXIds.size).toBe(0);
  });

  it("skips disabled clip-owned scene VFX applies", () => {
    const records = new Map<SceneVFXKind, ClipOwnedSceneVFXRecord>();

    applyClipOwnedSceneVFX(records, sceneEvent, eventContext, {
      enabled: false,
      resolvePreset: resolveFixtureSceneVFX,
    });

    expect(records.size).toBe(0);
    expect(useSceneVFXStore.getState().activeByKind.background_layers).toBe(
      undefined,
    );
  });

  it("clears tracked clip-owned scene VFX and restores the previous entry", () => {
    const previousPreset = getSceneBackgroundLayerPresetById("comic-pop");
    if (!previousPreset) {
      throw new Error("Missing comic-pop scene VFX preset.");
    }
    useSceneVFXStore.getState().applySceneVFX({
      ...previousPreset,
      id: "manual-background",
      durationMs: null,
    });

    const records = new Map<SceneVFXKind, ClipOwnedSceneVFXRecord>();
    applyClipOwnedSceneVFX(
      records,
      sceneEvent,
      {
        ...eventContext,
        appliedId: "reaction:run:emotion:joy-3:scene-emotion-background",
      },
      { resolvePreset: resolveFixtureSceneVFX },
    );
    expect(
      useSceneVFXStore.getState().activeByKind.background_layers?.entry.id,
    ).toBe("reaction:run:emotion:joy-3:scene-emotion-background");

    clearAllClipOwnedSceneVFX(records);

    expect(records.size).toBe(0);
    expect(
      useSceneVFXStore.getState().activeByKind.background_layers?.entry.id,
    ).toBe("manual-background");
  });

  it("does not restore another clip-owned scene VFX while disabling", () => {
    const poseRecords = new Map<SceneVFXKind, ClipOwnedSceneVFXRecord>();
    const reactionRecords = new Map<SceneVFXKind, ClipOwnedSceneVFXRecord>();

    applyClipOwnedSceneVFX(
      poseRecords,
      sceneEvent,
      {
        ...eventContext,
        appliedId: "poseClip:joy-3:scene-emotion-background",
      },
      { resolvePreset: resolveFixtureSceneVFX },
    );
    applyClipOwnedSceneVFX(
      reactionRecords,
      sceneEvent,
      {
        ...eventContext,
        appliedId: "reaction:run:emotion:joy-3:scene-emotion-background",
      },
      { resolvePreset: resolveFixtureSceneVFX },
    );

    const skipRestoreAppliedIds = collectClipOwnedSceneVFXAppliedIds(
      poseRecords,
      reactionRecords,
    );
    clearAllClipOwnedSceneVFX(poseRecords, { skipRestoreAppliedIds });
    clearAllClipOwnedSceneVFX(reactionRecords, { skipRestoreAppliedIds });

    expect(poseRecords.size).toBe(0);
    expect(reactionRecords.size).toBe(0);
    expect(useSceneVFXStore.getState().activeByKind.background_layers).toBe(
      undefined,
    );
  });
});
