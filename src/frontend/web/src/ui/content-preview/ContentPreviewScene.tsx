"use client";

import { TransformControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Group, type Object3D } from "three";

import type { RuntimeCatalogEntry } from "@/lib/runtime-content/types";
import type { Avatar } from "@/lib/avatar";
import { Avatar as AvatarRuntime } from "@/lib/avatar";
import type { PreviewRuntimeCatalogSession } from "@/lib/content-preview/PreviewRuntimeCatalogSession";
import {
  acquireContentPreviewResource,
  logContentPreviewLifecycle,
} from "@/lib/content-preview/lifecycle";
import {
  contentPreviewEffectCommand,
  ContentPreviewApplySoundPlayer,
  attachContentPreviewClipEventBridge,
  clearContentPreviewEffects,
  createContentPreviewClipEventBridge,
  playContentPreviewEffect,
} from "@/lib/content-preview/effects";
import {
  boundedContentPreviewFrameDelta,
  playContentPreviewMotion,
  type ContentPreviewMissingDependency,
} from "@/lib/content-preview/playback";
import type {
  ContentPreviewLoadStatus,
  ContentPreviewTarget,
} from "@/lib/content-preview/types";
import { runtimeContentEntryUrl } from "@/lib/runtime-content/animaRuntimeSnapshot";
import { runtimeContentDownloadUrl } from "@/lib/runtime-content/runtimeContentDelivery";
import type { SceneVFXRuntimeEntry } from "@/lib/scene-vfx/types";
import {
  applyAvatarTransformToObject,
  avatarTransformFromObject,
  type AvatarTransform,
} from "@/ui/main/canvas/transform-state";
import { AvatarPreviewSurface } from "@/ui/avatar-preview/AvatarPreviewSurface";
import type { SceneCameraSettings } from "@/ui/main/canvas/sceneCameraPresets";

const PARTICLE_PREVIEW_CAMERA: SceneCameraSettings = {
  position: { x: 0, y: 1.2, z: 2.75 },
  fov: 35,
  orbitTarget: { x: 0, y: 1, z: 0 },
};

type PreviewActorProps = {
  active: boolean;
  avatarTransform: AvatarTransform;
  avatarEntry: RuntimeCatalogEntry;
  catalog: PreviewRuntimeCatalogSession;
  loop: boolean;
  playRequest: number;
  resetCameraRequest: number;
  stopRequest: number;
  target: ContentPreviewTarget;
  moveAvatar: boolean;
  onAvatarChange: (avatar: Avatar | null) => void;
  onAvatarTransformChange: (transform: AvatarTransform) => void;
  onCameraChanged: (changed: boolean) => void;
  onMissingDependencies: (
    dependencies: ContentPreviewMissingDependency[],
  ) => void;
  onDependenciesLoadingChange: (loading: boolean) => void;
  onSceneVFXChange?: (entry: SceneVFXRuntimeEntry | null) => void;
  onStatusChange: (status: ContentPreviewLoadStatus, message?: string) => void;
};

type PreviewActorRuntimeProps = PreviewActorProps & {
  onSceneVFXChange: (entry: SceneVFXRuntimeEntry | null) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The selected content could not be previewed.";
}

function PreviewActor({
  active,
  avatarTransform,
  avatarEntry,
  catalog,
  loop,
  playRequest,
  stopRequest,
  target,
  moveAvatar,
  onAvatarChange,
  onAvatarTransformChange,
  onMissingDependencies,
  onDependenciesLoadingChange,
  onSceneVFXChange,
  onStatusChange,
}: PreviewActorRuntimeProps) {
  const { camera, gl } = useThree();
  const avatarRef = useRef<Avatar | null>(null);
  const sourceKeyRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const handledPlayRequestRef = useRef(0);
  const firstMotionFrameRef = useRef(false);
  const [sceneObject, setSceneObject] = useState<Object3D | null>(null);
  const [avatarRoot, setAvatarRoot] = useState<Group | null>(null);
  const [avatarReadyKey, setAvatarReadyKey] = useState<string | null>(null);
  const applySoundPlayer = useMemo(
    () => new ContentPreviewApplySoundPlayer(),
    [],
  );
  const clipEventBridge = useMemo(
    () =>
      createContentPreviewClipEventBridge({
        catalog,
        onSceneVFXChange,
        playSfx: (runtimeId) => applySoundPlayer.play(catalog, runtimeId),
      }),
    [applySoundPlayer, catalog, onSceneVFXChange],
  );
  const avatarSourceKey = avatarEntry.content_revision;

  useEffect(() => {
    const releaseAvatar = acquireContentPreviewResource("dock", "avatar");
    const avatar = new AvatarRuntime(camera, gl.domElement, {
      motionCatalog: catalog,
      mediaCatalog: catalog,
    });
    avatar.setAutomaticAnimationPlaybackEnabled(false);
    avatarRef.current = avatar;
    onAvatarChange(avatar);
    return () => {
      avatarRef.current = null;
      onAvatarChange(null);
      avatar.dispose();
      releaseAvatar();
    };
  }, [camera, catalog, gl.domElement, onAvatarChange]);

  useEffect(() => {
    const avatar = avatarRef.current;
    if (!avatar) return;
    return attachContentPreviewClipEventBridge(avatar, clipEventBridge);
  }, [clipEventBridge]);

  useEffect(() => {
    const avatar = avatarRef.current;
    if (!avatar) return;
    if (sourceKeyRef.current === avatarSourceKey && avatar.isReady) {
      logContentPreviewLifecycle("avatar_reuse", "dock");
      setAvatarReadyKey(avatarSourceKey);
      return;
    }
    const logicalUrl = runtimeContentEntryUrl(avatarEntry);
    if (!logicalUrl) {
      onStatusChange("error", "The preview avatar model has no runtime file.");
      return;
    }
    const generation = ++loadGenerationRef.current;
    setSceneObject(null);
    setAvatarReadyKey(null);
    onStatusChange("loading", "Loading avatar…");
    void (async () => {
      try {
        const filePath = await runtimeContentDownloadUrl(
          avatarEntry,
          logicalUrl,
        );
        if (!filePath)
          throw new Error("The preview avatar could not be authorized.");
        await avatar.load({
          filePath,
          sourceUrl: logicalUrl,
          sourceKey: avatarSourceKey,
        });
        if (
          generation !== loadGenerationRef.current ||
          avatar.isDisposed ||
          !avatar.scene
        ) {
          return;
        }
        avatar.setAutomaticAnimationPlaybackEnabled(false);
        sourceKeyRef.current = avatarSourceKey;
        setSceneObject(avatar.scene);
        setAvatarReadyKey(avatarSourceKey);
        logContentPreviewLifecycle("avatar_load", "dock");
        onStatusChange("ready");
      } catch (error) {
        if (generation !== loadGenerationRef.current) return;
        onStatusChange("error", errorMessage(error));
      }
    })();
  }, [avatarEntry, avatarSourceKey, onStatusChange]);

  useEffect(() => {
    if (avatarRoot) applyAvatarTransformToObject(avatarRoot, avatarTransform);
  }, [avatarRoot, avatarTransform]);

  useEffect(() => {
    const avatar = avatarRef.current;
    clipEventBridge.reset();
    avatar?.resetAnimations();
    clearContentPreviewEffects({
      avatar,
      onSceneVFXChange,
      stopApplySound: applySoundPlayer.stop,
    });
    if (avatar?.vrm) avatar.vrm.update(0);
  }, [applySoundPlayer, clipEventBridge, onSceneVFXChange, stopRequest]);

  useEffect(() => {
    if (active) return;
    const avatar = avatarRef.current;
    clipEventBridge.reset();
    avatar?.resetAnimations();
    clearContentPreviewEffects({
      avatar,
      onSceneVFXChange,
      stopApplySound: applySoundPlayer.stop,
    });
  }, [active, applySoundPlayer, clipEventBridge, onSceneVFXChange]);

  useEffect(() => () => applySoundPlayer.stop(), [applySoundPlayer]);

  useEffect(() => {
    const avatar = avatarRef.current;
    if (
      !active ||
      !avatar ||
      !avatar.isReady ||
      avatarReadyKey !== avatarSourceKey ||
      playRequest < 1 ||
      handledPlayRequestRef.current === playRequest
    ) {
      return;
    }
    const effectCommand = contentPreviewEffectCommand(target);
    if (
      !effectCommand &&
      target.kind !== "avatar_model" &&
      target.kind !== "animation" &&
      target.kind !== "anima_pose_clip"
    )
      return;
    handledPlayRequestRef.current = playRequest;
    let cancelled = false;
    clipEventBridge.reset();
    avatar.resetAnimations();
    clearContentPreviewEffects({
      avatar,
      onSceneVFXChange,
      stopApplySound: applySoundPlayer.stop,
    });
    void (async () => {
      try {
        if (effectCommand) {
          onStatusChange("playing");
          await playContentPreviewEffect({
            avatar,
            catalog,
            command: effectCommand,
            onSceneVFXChange,
            isCurrent: () => !cancelled,
            playApplySound: (runtimeId) =>
              applySoundPlayer.play(catalog, runtimeId),
            stopApplySound: applySoundPlayer.stop,
          });
          return;
        }
        if (target.kind === "avatar_model") {
          onStatusChange("ready");
          return;
        }
        onStatusChange("loading", "Preparing playback…");
        const didPlay = await playContentPreviewMotion({
          avatar,
          catalog,
          target,
          loop,
          isCurrent: () => !cancelled,
          onFinished: () => onStatusChange("ready"),
          onMissingDependencies,
          onDependenciesLoadingChange,
        });
        if (!cancelled && didPlay) {
          // Flush the zero-time expression overlay before the immediate
          // Playing render exposes its observation snapshot.
          avatar.update(0);
          // R3F's next delta began before asynchronous preparation finished.
          // Render the opening pose once before charging playback any time.
          firstMotionFrameRef.current = true;
          onStatusChange("playing");
        }
      } catch (error) {
        if (!cancelled) onStatusChange("error", errorMessage(error));
      }
    })();
    return () => {
      cancelled = true;
      onDependenciesLoadingChange(false);
    };
  }, [
    active,
    applySoundPlayer,
    avatarReadyKey,
    avatarSourceKey,
    catalog,
    clipEventBridge,
    loop,
    onDependenciesLoadingChange,
    onMissingDependencies,
    onSceneVFXChange,
    onStatusChange,
    playRequest,
    target,
  ]);

  useFrame((_state, delta) => {
    if (active) {
      const playbackDelta = boundedContentPreviewFrameDelta(
        delta,
        firstMotionFrameRef.current,
      );
      firstMotionFrameRef.current = false;
      avatarRef.current?.update(playbackDelta);
    }
  });

  return sceneObject ? (
    <>
      {/* Preserve Avatar.load()'s VRM0 orientation on the child model. */}
      <group ref={setAvatarRoot}>
        <primitive object={sceneObject} dispose={null} />
      </group>
      {moveAvatar && avatarRoot ? (
        <TransformControls
          enabled
          mode="translate"
          object={avatarRoot}
          onObjectChange={() =>
            onAvatarTransformChange(avatarTransformFromObject(avatarRoot))
          }
          showX
          showY
          showZ
          size={0.75}
          space="world"
        />
      ) : null}
    </>
  ) : null;
}

export function ContentPreviewScene(props: PreviewActorProps) {
  const { onAvatarChange, onSceneVFXChange } = props;
  const [activeAvatar, setActiveAvatar] = useState<Avatar | null>(null);
  const [sceneVFX, setSceneVFX] = useState<SceneVFXRuntimeEntry | null>(null);
  const handleAvatarChange = useCallback(
    (avatar: Avatar | null) => {
      setActiveAvatar(avatar);
      onAvatarChange(avatar);
    },
    [onAvatarChange],
  );
  const handleSceneVFXChange = useCallback(
    (entry: SceneVFXRuntimeEntry | null) => {
      setSceneVFX(entry);
      onSceneVFXChange?.(entry);
    },
    [onSceneVFXChange],
  );

  useEffect(() => {
    if (!sceneVFX?.expiresAtMs) return;
    const delayMs = Math.max(0, sceneVFX.expiresAtMs - Date.now());
    const timeoutId = window.setTimeout(
      () => handleSceneVFXChange(null),
      delayMs,
    );
    return () => window.clearTimeout(timeoutId);
  }, [handleSceneVFXChange, sceneVFX]);

  return (
    <AvatarPreviewSurface
      active={props.active}
      activeAvatar={activeAvatar}
      cameraProfile={
        props.target.kind === "particle_vfx" ? "custom" : "full-body"
      }
      cameraSettings={
        props.target.kind === "particle_vfx"
          ? PARTICLE_PREVIEW_CAMERA
          : undefined
      }
      canvasTestId="content-preview-canvas"
      lifecycleOwner="dock"
      minDistance={1.2}
      maxDistance={5}
      onCameraChanged={props.onCameraChanged}
      resetCameraRequest={props.resetCameraRequest}
      sceneVFX={sceneVFX}
    >
      <PreviewActor
        {...props}
        onAvatarChange={handleAvatarChange}
        onSceneVFXChange={handleSceneVFXChange}
      />
    </AvatarPreviewSurface>
  );
}
