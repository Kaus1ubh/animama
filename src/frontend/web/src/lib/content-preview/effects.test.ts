import { describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";
import type { ParticleVFXCatalogEntry } from "@/lib/avatar/particle-vfx/types";
import { TEST_HOVER_VFX_ENTRY } from "@/lib/avatar/vfx/avatarVFXTestFixtures";
import { getSceneBackgroundLayerPresetById } from "@/lib/scene-vfx/catalog";
import {
  CONTENT_PREVIEW_AVATAR_VFX_APPLIED_ID,
  CONTENT_PREVIEW_PARTICLE_APPLIED_ID,
  contentPreviewEffectCommand,
  attachContentPreviewClipEventBridge,
  buildParticlePreviewRequest,
  clearContentPreviewEffects,
  createContentPreviewClipEventBridge,
  playContentPreviewEffect,
} from "./effects";
import type { ContentPreviewTarget } from "./types";

const particleEffect: ParticleVFXCatalogEntry = {
  id: "sparkle",
  label: "Sparkle",
  description: "Sparkles around the avatar.",
  assetPath: "/sparkle.json",
  defaultAnchor: "head",
  defaultDurationSec: 12,
  defaultFollowAnchor: true,
  defaultTransform: {
    offset: { x: 1, y: 2, z: 3 },
    depthOffset: 0.25,
    rotation: { x: 0, y: 0.5, z: 0 },
    scale: { x: 2, y: 2, z: 2 },
  },
  preloadTier: "none",
  performanceBudget: {
    maxDurationSec: 4,
    maxParticles: 100,
    loopingAllowed: false,
    canCoexist: false,
  },
};

function effectTarget(
  kind: "particle_vfx" | "avatar_vfx" | "scene_vfx",
  slot:
    | "particle_vfx"
    | "avatar_vfx"
    | "scene_background_vfx"
    | "scene_focus_vfx",
): ContentPreviewTarget {
  return {
    key: `${kind}:${slot}`,
    sourceType: "resolved_entry",
    entry: {
      slot,
      runtime_id: "fixture",
      kind,
      display_name: kind,
      description: null,
      config_schema_version: 1,
      config: {},
      content_revision: `${kind}:fixture:1`,
      source: { type: "public_url", url: `/fixtures/${kind}` },
    },
    kind,
    displayName: kind,
    versionLabel: "Starter v1",
    slot,
    runtimeId: "fixture",
    configSchemaVersion: 1,
    config: {},
  };
}

function avatarHarness() {
  const clearEffect = vi.fn();
  const playEffect = vi.fn().mockResolvedValue(true);
  const removeEffect = vi.fn();
  const applyHoverVFX = vi.fn().mockResolvedValue(undefined);
  const applyFaceAnchoredVFX = vi.fn().mockResolvedValue(undefined);
  const applyTextureVFX = vi.fn().mockResolvedValue(undefined);
  return {
    avatar: {
      particleVFXController: { clearEffect, playEffect },
      vfxController: {
        removeEffect,
        applyHoverVFX,
        applyFaceAnchoredVFX,
        applyTextureVFX,
      },
    } as unknown as Avatar,
    clearEffect,
    playEffect,
    removeEffect,
    avatarApplyMethods: [applyHoverVFX, applyFaceAnchoredVFX, applyTextureVFX],
  };
}

describe("Asset preview effect playback", () => {
  it("maps each effect target, including the two scene slots", () => {
    expect(
      contentPreviewEffectCommand(effectTarget("particle_vfx", "particle_vfx")),
    ).toEqual({ type: "particle_vfx", runtimeId: "fixture" });
    expect(
      contentPreviewEffectCommand(effectTarget("avatar_vfx", "avatar_vfx")),
    ).toEqual({ type: "avatar_vfx", runtimeId: "fixture" });
    expect(
      contentPreviewEffectCommand(
        effectTarget("scene_vfx", "scene_background_vfx"),
      ),
    ).toMatchObject({ type: "scene_vfx", sceneKind: "background_layers" });
    expect(
      contentPreviewEffectCommand(effectTarget("scene_vfx", "scene_focus_vfx")),
    ).toMatchObject({ type: "scene_vfx", sceneKind: "focus_lines" });
  });

  it("preserves particle placement while capping duration to metadata", () => {
    expect(buildParticlePreviewRequest(particleEffect)).toEqual({
      effectId: "sparkle",
      appliedId: CONTENT_PREVIEW_PARTICLE_APPLIED_ID,
      ownerId: "content-preview",
      anchor: "head",
      durationSec: 4,
      followAnchor: true,
      transform: particleEffect.defaultTransform,
    });
    expect(
      buildParticlePreviewRequest({
        ...particleEffect,
        defaultAnchor: "root",
      }).anchor,
    ).toBe("root");
  });

  it("cleans the prior preview instance before playing one particle effect", async () => {
    const harness = avatarHarness();
    const onSceneVFXChange = vi.fn();
    await playContentPreviewEffect({
      avatar: harness.avatar,
      catalog: {
        resolveParticleVFX: vi.fn().mockResolvedValue(particleEffect),
        resolveAvatarVFX: vi.fn(),
        loadAvatarVFX: vi.fn(),
        resolveSceneVFX: vi.fn(),
        loadSceneVFX: vi.fn(),
      },
      command: { type: "particle_vfx", runtimeId: "sparkle" },
      onSceneVFXChange,
    });
    expect(harness.clearEffect).toHaveBeenCalledWith(
      CONTENT_PREVIEW_PARTICLE_APPLIED_ID,
    );
    expect(harness.playEffect).toHaveBeenCalledWith(
      buildParticlePreviewRequest(particleEffect),
    );
    expect(onSceneVFXChange).toHaveBeenLastCalledWith(null);
  });

  it("uses one stable applied ID for avatar effects and removes it on clear", async () => {
    const harness = avatarHarness();
    const effect = TEST_HOVER_VFX_ENTRY;
    await playContentPreviewEffect({
      avatar: harness.avatar,
      catalog: {
        resolveParticleVFX: vi.fn(),
        resolveAvatarVFX: vi.fn().mockReturnValue(effect),
        loadAvatarVFX: vi.fn().mockResolvedValue(effect),
        resolveSceneVFX: vi.fn(),
        loadSceneVFX: vi.fn(),
      },
      command: { type: "avatar_vfx", runtimeId: effect.id },
      onSceneVFXChange: vi.fn(),
    });
    expect(harness.removeEffect).toHaveBeenCalledWith(
      CONTENT_PREVIEW_AVATAR_VFX_APPLIED_ID,
    );
    const appliedCalls = harness.avatarApplyMethods.flatMap((method) =>
      method.mock.calls.flat(),
    );
    expect(appliedCalls).toContainEqual(
      expect.objectContaining({
        effectId: CONTENT_PREVIEW_AVATAR_VFX_APPLIED_ID,
      }),
    );
  });

  it("publishes a scene effect only to preview-local state", async () => {
    const harness = avatarHarness();
    const effect = getSceneBackgroundLayerPresetById("shoujo-hearts");
    if (!effect) throw new Error("Missing scene VFX test fixture");
    const onSceneVFXChange = vi.fn();
    await playContentPreviewEffect({
      avatar: harness.avatar,
      catalog: {
        resolveParticleVFX: vi.fn(),
        resolveAvatarVFX: vi.fn(),
        loadAvatarVFX: vi.fn(),
        resolveSceneVFX: vi.fn().mockReturnValue(effect),
        loadSceneVFX: vi.fn().mockResolvedValue(effect),
      },
      command: {
        type: "scene_vfx",
        runtimeId: effect.id,
        sceneKind: "background_layers",
      },
      onSceneVFXChange,
    });
    expect(onSceneVFXChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "background_layers",
        entry: expect.objectContaining({ id: effect.id }),
      }),
    );
  });

  it("bridges clip-owned Scene VFX and SFX into the preview surface", async () => {
    const effect = getSceneBackgroundLayerPresetById("kawaii-sparkles");
    if (!effect) throw new Error("Missing scene VFX test fixture");
    const onSceneVFXChange = vi.fn();
    const playSfx = vi.fn();
    const bridge = createContentPreviewClipEventBridge({
      catalog: { loadSceneVFX: vi.fn().mockResolvedValue(effect) },
      onSceneVFXChange,
      playSfx,
    });
    const context = {
      clipId: "reaction",
      eventId: "scene-event",
      appliedId: "preview:reaction:scene-event",
      playbackTime: 0.2,
      clipTime: 0.2,
      occurrenceIndex: 0,
    };
    const event = {
      id: "scene-event",
      time: 0.2,
      kind: "scene_vfx" as const,
      sceneKind: "background_layers" as const,
      presetId: "kawaii_sparkles",
    };

    await bridge.sink.applySceneVFX?.(event, context);
    expect(onSceneVFXChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "background_layers",
        runtimeId: effect.id,
        entry: expect.objectContaining({ id: context.appliedId }),
      }),
    );

    await bridge.sink.playSfx?.(
      { id: "sound", time: 0.4, kind: "sfx", cueId: "impact" },
      { ...context, eventId: "sound", appliedId: "preview:sound" },
    );
    expect(playSfx).toHaveBeenCalledWith("impact", undefined);

    await bridge.sink.clearSceneVFX?.(event, context);
    expect(onSceneVFXChange).toHaveBeenLastCalledWith(null);
  });

  it("attaches the Scene and SFX bridge to both Action clip players", () => {
    const setPoseClipExternalEventSink = vi.fn();
    const setReactionClipExternalEventSink = vi.fn();
    const bridge = { sink: {}, reset: vi.fn() };

    const detach = attachContentPreviewClipEventBridge(
      { setPoseClipExternalEventSink, setReactionClipExternalEventSink },
      bridge,
    );

    expect(setPoseClipExternalEventSink).toHaveBeenCalledWith(bridge.sink);
    expect(setReactionClipExternalEventSink).toHaveBeenCalledWith(bridge.sink);

    detach();

    expect(bridge.reset).toHaveBeenCalledOnce();
    expect(setPoseClipExternalEventSink).toHaveBeenLastCalledWith(null);
    expect(setReactionClipExternalEventSink).toHaveBeenLastCalledWith(null);
  });

  it("plays a Scene apply Sound once and drops a stale async result", async () => {
    const harness = avatarHarness();
    const fixture = getSceneBackgroundLayerPresetById("shoujo-hearts");
    if (!fixture) throw new Error("Missing scene VFX test fixture");
    const effect = { ...fixture, sound: { onApply: "opaque-cue" } };
    const onSceneVFXChange = vi.fn();
    const playApplySound = vi.fn();
    await playContentPreviewEffect({
      avatar: harness.avatar,
      catalog: {
        resolveParticleVFX: vi.fn(),
        resolveAvatarVFX: vi.fn(),
        loadAvatarVFX: vi.fn(),
        resolveSceneVFX: vi.fn(),
        loadSceneVFX: vi.fn().mockResolvedValue(effect),
      },
      command: {
        type: "scene_vfx",
        runtimeId: effect.id,
        sceneKind: "background_layers",
      },
      onSceneVFXChange,
      playApplySound,
    });
    expect(playApplySound).toHaveBeenCalledOnce();
    expect(playApplySound).toHaveBeenCalledWith("opaque-cue");

    onSceneVFXChange.mockClear();
    await playContentPreviewEffect({
      avatar: harness.avatar,
      catalog: {
        resolveParticleVFX: vi.fn(),
        resolveAvatarVFX: vi.fn(),
        loadAvatarVFX: vi.fn(),
        resolveSceneVFX: vi.fn(),
        loadSceneVFX: vi.fn().mockResolvedValue(effect),
      },
      command: {
        type: "scene_vfx",
        runtimeId: effect.id,
        sceneKind: "background_layers",
      },
      onSceneVFXChange,
      isCurrent: () => false,
      playApplySound,
    });
    expect(onSceneVFXChange).toHaveBeenCalledTimes(1);
    expect(onSceneVFXChange).toHaveBeenLastCalledWith(null);
    expect(playApplySound).toHaveBeenCalledOnce();
  });

  it("fails clearly when an exact effect entry is missing", async () => {
    const harness = avatarHarness();
    await expect(
      playContentPreviewEffect({
        avatar: harness.avatar,
        catalog: {
          resolveParticleVFX: vi.fn().mockResolvedValue(null),
          resolveAvatarVFX: vi.fn(),
          loadAvatarVFX: vi.fn(),
          resolveSceneVFX: vi.fn(),
          loadSceneVFX: vi.fn(),
        },
        command: { type: "particle_vfx", runtimeId: "missing" },
        onSceneVFXChange: vi.fn(),
      }),
    ).rejects.toThrow("unavailable");
  });

  it("clears all preview-owned effect channels", () => {
    const harness = avatarHarness();
    const onSceneVFXChange = vi.fn();
    clearContentPreviewEffects({
      avatar: harness.avatar,
      onSceneVFXChange,
    });
    expect(harness.clearEffect).toHaveBeenCalledWith(
      CONTENT_PREVIEW_PARTICLE_APPLIED_ID,
    );
    expect(harness.removeEffect).toHaveBeenCalledWith(
      CONTENT_PREVIEW_AVATAR_VFX_APPLIED_ID,
    );
    expect(onSceneVFXChange).toHaveBeenCalledWith(null);
  });
});

describe("clip accompanying audio", () => {
  it.each([undefined, true, false])(
    "keeps visuals and independent SFX with accompanying=%s",
    async (playAccompanyingSound) => {
      const preset = getSceneBackgroundLayerPresetById("kawaii-sparkles");
      if (!preset) throw new Error("Missing scene fixture");
      const onSceneVFXChange = vi.fn();
      const playSfx = vi.fn();
      const bridge = createContentPreviewClipEventBridge({
        catalog: {
          loadSceneVFX: vi.fn().mockResolvedValue({
            ...preset,
            sound: { onApply: "accompanying" },
          }),
        },
        onSceneVFXChange,
        playSfx,
      });
      const context = {
        clipId: "clip",
        eventId: "event",
        appliedId: "clip:event",
        playbackTime: 0,
        clipTime: 0,
        occurrenceIndex: 0,
      };
      await bridge.sink.applySceneVFX?.(
        {
          id: "event",
          time: 0,
          kind: "scene_vfx",
          sceneKind: "background_layers",
          presetId: preset.id,
          playAccompanyingSound,
        },
        context,
      );
      expect(onSceneVFXChange).toHaveBeenCalledWith(
        expect.objectContaining({ runtimeId: preset.id }),
      );
      expect(playSfx.mock.calls).toEqual(
        playAccompanyingSound === false ? [] : [["accompanying", undefined]],
      );
      await bridge.sink.playSfx?.(
        { id: "independent", time: 0, kind: "sfx", cueId: "independent" },
        context,
      );
      expect(playSfx).toHaveBeenLastCalledWith("independent", undefined);
    },
  );
});
