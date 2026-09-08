import { describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";
import { parseAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import type { PreviewRuntimeCatalogSession } from "./PreviewRuntimeCatalogSession";
import {
  boundedContentPreviewFrameDelta,
  contentPreviewPlaybackCommand,
  collectContentPreviewMissingDependencies,
  playContentPreviewMotion,
  prepareContentPreviewDependencies,
  shouldAutoplayContentPreview,
} from "./playback";
import type { ContentPreviewTarget } from "./types";

function target(kind: "avatar_model" | "animation" | "anima_pose_clip") {
  const slot =
    kind === "avatar_model"
      ? "primary_model"
      : kind === "animation"
        ? "gesture"
        : "pose";
  return {
    key: kind,
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
  } as ContentPreviewTarget;
}

const emptyClip = parseAnimaPoseClip({
  schema: "animaPoseClip/1.0",
  id: "fixture",
  name: "Fixture",
  duration: 1,
  poses: { base: { expressions: { happy: 0.5 } } },
  poseKeyframes: [{ time: 0, pose: "base" }],
});

describe("Asset preview playback policy", () => {
  it("maps supported targets to one explicit playback command", () => {
    expect(contentPreviewPlaybackCommand(target("avatar_model"))).toEqual({
      type: "avatar_model",
    });
    expect(contentPreviewPlaybackCommand(target("animation"))).toEqual({
      type: "gesture_animation",
      runtimeId: "fixture",
    });
    expect(contentPreviewPlaybackCommand(target("anima_pose_clip"))).toEqual({
      type: "pose_clip",
      runtimeId: "fixture",
    });
  });

  it("keeps idle animations and reactions in their slot-specific catalogs", () => {
    expect(
      contentPreviewPlaybackCommand({
        ...target("animation"),
        slot: "idle_animation",
      }),
    ).toEqual({ type: "idle_animation", runtimeId: "fixture" });
    expect(
      contentPreviewPlaybackCommand({
        ...target("anima_pose_clip"),
        slot: "reaction",
      }),
    ).toEqual({ type: "reaction_clip", runtimeId: "fixture" });
  });

  it("does not autoplay when reduced motion is requested", () => {
    expect(shouldAutoplayContentPreview(false)).toBe(true);
    expect(shouldAutoplayContentPreview(true)).toBe(false);
  });

  it("bounds resumed preview frames without changing normal deltas", () => {
    expect(boundedContentPreviewFrameDelta(1 / 60)).toBe(1 / 60);
    expect(boundedContentPreviewFrameDelta(1.6)).toBe(0.1);
    expect(boundedContentPreviewFrameDelta(-1)).toBe(0);
    expect(boundedContentPreviewFrameDelta(Number.NaN)).toBe(0);
    expect(boundedContentPreviewFrameDelta(1.6, true)).toBe(0);
    expect(boundedContentPreviewFrameDelta(1 / 60, true)).toBe(0);
  });

  it("reports exact missing clip dependencies without rejecting the clip", () => {
    const clip = parseAnimaPoseClip({
      schema: "animaPoseClip/1.0",
      id: "fixture",
      name: "Fixture",
      duration: 1,
      poses: { base: { expressions: { happy: 0.5 } } },
      poseKeyframes: [{ time: 0, pose: "base" }],
      events: [
        {
          id: "avatar",
          time: 0,
          kind: "avatar_vfx",
          effectId: "equipped-avatar-vfx",
        },
        {
          id: "particles",
          time: 0,
          kind: "particle_vfx",
          effectId: "missing-particles",
        },
        {
          id: "sound",
          time: 0,
          kind: "sfx",
          cueId: "missing-sound",
        },
      ],
    });
    const catalog = {
      listAvatarVFX: () => [{ id: "equipped-avatar-vfx" }],
      listSceneVFX: () => [],
      listParticleVFX: () => [],
      listAudio: () => [],
    } as unknown as PreviewRuntimeCatalogSession;

    expect(collectContentPreviewMissingDependencies(clip, catalog)).toEqual([
      {
        kind: "particle_vfx",
        label: "Particle VFX",
        runtimeId: "missing-particles",
      },
      { kind: "sfx", label: "SFX", runtimeId: "missing-sound" },
    ]);
  });

  it("preloads private Scene and Avatar VFX before reporting diagnostics", async () => {
    const clip = parseAnimaPoseClip({
      schema: "animaPoseClip/1.0",
      id: "private-effects",
      name: "Private effects",
      duration: 1,
      poses: { base: { expressions: { happy: 0.5 } } },
      poseKeyframes: [{ time: 0, pose: "base" }],
      events: [
        {
          id: "avatar",
          time: 0,
          kind: "avatar_vfx",
          effectId: "private-avatar",
        },
        {
          id: "scene",
          time: 0,
          kind: "scene_vfx",
          sceneKind: "background_layers",
          presetId: "private-scene",
        },
      ],
    });
    const loadAvatarVFX = vi.fn().mockResolvedValue({ id: "private-avatar" });
    const loadSceneVFX = vi.fn().mockResolvedValue({ id: "private-scene" });
    const catalog = {
      loadAvatarVFX,
      loadSceneVFX,
      listAvatarVFX: () => [],
      listSceneVFX: () => [],
      listParticleVFX: () => [],
      listAudio: () => [],
    } as unknown as PreviewRuntimeCatalogSession;

    await expect(
      prepareContentPreviewDependencies(clip, catalog),
    ).resolves.toEqual([]);
    expect(loadAvatarVFX).toHaveBeenCalledWith("private-avatar");
    expect(loadSceneVFX).toHaveBeenCalledWith(
      "background_layers",
      "private-scene",
    );
  });

  it("warns only for dependencies whose preload actually fails", async () => {
    const clip = parseAnimaPoseClip({
      schema: "animaPoseClip/1.0",
      id: "failed-effect",
      name: "Failed effect",
      duration: 1,
      poses: { base: { expressions: { happy: 0.5 } } },
      poseKeyframes: [{ time: 0, pose: "base" }],
      events: [
        {
          id: "scene",
          time: 0,
          kind: "scene_vfx",
          sceneKind: "background_layers",
          presetId: "broken-scene",
        },
      ],
    });
    const catalog = {
      loadSceneVFX: vi.fn().mockRejectedValue(new Error("download failed")),
      listAvatarVFX: () => [],
      listSceneVFX: () => [],
      listParticleVFX: () => [],
      listAudio: () => [],
    } as unknown as PreviewRuntimeCatalogSession;

    await expect(
      prepareContentPreviewDependencies(clip, catalog),
    ).resolves.toEqual([
      {
        kind: "scene_background_vfx",
        label: "Background Scene VFX",
        runtimeId: "broken-scene",
      },
    ]);
  });

  it("reports dependency loading until a private effect is ready to play", async () => {
    const clip = parseAnimaPoseClip({
      schema: "animaPoseClip/1.0",
      id: "loading-effect",
      name: "Loading effect",
      duration: 1,
      poses: { base: { expressions: { happy: 0.5 } } },
      poseKeyframes: [{ time: 0, pose: "base" }],
      events: [
        {
          id: "scene",
          time: 0,
          kind: "scene_vfx",
          sceneKind: "background_layers",
          presetId: "private-scene",
        },
      ],
    });
    let finishSceneLoad: (value: { id: string }) => void = () => undefined;
    const sceneLoad = new Promise<{ id: string }>((resolve) => {
      finishSceneLoad = resolve;
    });
    const catalog = {
      loadPoseClip: vi.fn().mockResolvedValue(clip),
      loadSceneVFX: vi.fn().mockReturnValue(sceneLoad),
      listAvatarVFX: () => [],
      listSceneVFX: () => [],
      listParticleVFX: () => [],
      listAudio: () => [],
    } as unknown as PreviewRuntimeCatalogSession;
    const loadAndPlayClip = vi.fn().mockResolvedValue({});
    const onDependenciesLoadingChange = vi.fn();
    const playback = playContentPreviewMotion({
      avatar: { loadAndPlayClip } as unknown as Avatar,
      catalog,
      target: target("anima_pose_clip"),
      loop: false,
      onDependenciesLoadingChange,
    });

    await vi.waitFor(() =>
      expect(onDependenciesLoadingChange).toHaveBeenCalledWith(true),
    );
    expect(loadAndPlayClip).not.toHaveBeenCalled();
    finishSceneLoad({ id: "private-scene" });
    await playback;

    expect(onDependenciesLoadingChange.mock.calls).toEqual([[true], [false]]);
    expect(loadAndPlayClip).toHaveBeenCalledOnce();
  });

  it("executes idle playback through the supplied catalog and lifecycle", async () => {
    const onFinished = vi.fn();
    const playAnimationWithName = vi.fn(
      async (
        _file: string,
        _name: string,
        options: { onFinished?: () => void },
      ) => {
        options.onFinished?.();
        return null;
      },
    );
    const avatar = { playAnimationWithName } as unknown as Avatar;
    const catalog = {
      getIdleAnimations: () => [
        {
          id: "fixture",
          name: "Idle Fixture",
          type: "vrma",
          file: "/idle.vrma",
          time_scale: 0.8,
        },
      ],
    } as unknown as PreviewRuntimeCatalogSession;

    await playContentPreviewMotion({
      avatar,
      catalog,
      target: { ...target("animation"), slot: "idle_animation" },
      loop: false,
      onFinished,
    });

    expect(playAnimationWithName).toHaveBeenCalledWith(
      "/idle.vrma",
      "Idle Fixture",
      expect.objectContaining({ loopType: "once", timeScale: 0.8 }),
    );
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("uses reaction and pose players rather than flattening their slots", async () => {
    const playDebugReactionClip = vi.fn(async () => true);
    const loadAndPlayClip = vi.fn(async () => ({}));
    const avatar = {
      playDebugReactionClip,
      loadAndPlayClip,
    } as unknown as Avatar;
    const catalog = {
      loadReactionClip: vi.fn().mockResolvedValue(emptyClip),
      loadPoseClip: vi.fn().mockResolvedValue(emptyClip),
    } as unknown as PreviewRuntimeCatalogSession;

    await playContentPreviewMotion({
      avatar,
      catalog,
      target: { ...target("anima_pose_clip"), slot: "reaction" },
      loop: false,
    });
    await playContentPreviewMotion({
      avatar,
      catalog,
      target: target("anima_pose_clip"),
      loop: false,
    });

    expect(playDebugReactionClip).toHaveBeenCalledWith("fixture");
    expect(loadAndPlayClip).toHaveBeenCalledWith("fixture", {
      preserveProceduralOffsets: true,
    });
  });

  it("suppresses stale completion and reports an unavailable reaction", async () => {
    const onFinished = vi.fn();
    const avatar = {
      playAnimationWithName: vi.fn(
        async (
          _file: string,
          _name: string,
          options: { onFinished?: () => void },
        ) => {
          options.onFinished?.();
          return null;
        },
      ),
      playDebugReactionClip: vi.fn(async () => false),
    } as unknown as Avatar;
    const catalog = {
      getGesture: () => ({
        type: "vrma",
        name: "Gesture",
        timeScale: 1,
        entry: { file: "/gesture.vrma" },
      }),
      loadReactionClip: vi.fn().mockResolvedValue(emptyClip),
    } as unknown as PreviewRuntimeCatalogSession;

    await playContentPreviewMotion({
      avatar,
      catalog,
      target: target("animation"),
      loop: false,
      isCurrent: () => false,
      onFinished,
    });
    expect(onFinished).not.toHaveBeenCalled();
    await expect(
      playContentPreviewMotion({
        avatar,
        catalog,
        target: { ...target("anima_pose_clip"), slot: "reaction" },
        loop: false,
      }),
    ).rejects.toThrow("selected reaction is unavailable");
  });
});
