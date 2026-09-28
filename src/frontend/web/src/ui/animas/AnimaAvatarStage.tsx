"use client";

import { AvatarTransformControls as TransformControls } from "@/ui/avatar-preview/AvatarTransformControls";
import { useFrame, useThree } from "@react-three/fiber";
import { Camera } from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Group, Object3D } from "three";

import type {
  AnimaRuntimeCatalogSnapshot,
  RuntimeCatalogEntry,
} from "@/lib/runtime-content/types";
import { Avatar } from "@/lib/avatar";
import {
  contentPreviewEffectCommand,
  ContentPreviewApplySoundPlayer,
  attachContentPreviewClipEventBridge,
  clearContentPreviewEffects,
  createContentPreviewClipEventBridge,
  playContentPreviewEffect,
} from "@/lib/content-preview/effects";
import {
  selectAnimaStageAvatarEntry,
  type PreparedAnimaStagePreview,
} from "@/lib/content-preview/managementPreview";
import {
  contentPreviewPlaybackCommand,
  playContentPreviewMotion,
} from "@/lib/content-preview/playback";
import { PreviewRuntimeCatalogSession } from "@/lib/content-preview/PreviewRuntimeCatalogSession";
import {
  acquireContentPreviewResource,
  logContentPreviewLifecycle,
} from "@/lib/content-preview/lifecycle";
import { resolvePlaybackObservationStatus } from "@/lib/content-preview/playbackObservation";
import type {
  ContentPreviewLoadStatus,
  ContentPreviewTarget,
} from "@/lib/content-preview/types";
import { createLogger } from "@/lib/logger";
import { AnimaRuntimeCatalog } from "@/lib/runtime-content/AnimaRuntimeCatalog";
import { runtimeContentEntryUrl } from "@/lib/runtime-content/animaRuntimeSnapshot";
import {
  runtimeContentDownloadUrl,
  type RuntimeContentUrlLease,
} from "@/lib/runtime-content/runtimeContentDelivery";
import type { SceneVFXRuntimeEntry } from "@/lib/scene-vfx/types";
import { cn } from "@/lib/utils";
import { AvatarPreviewSurface } from "@/ui/avatar-preview/AvatarPreviewSurface";
import { PlaybackObservationOutput } from "@/ui/avatar-preview/PlaybackObservationOutput";
import { Button } from "@/ui/components/button";
import { TransformPanel } from "@/ui/main/canvas/TransformPanel";
import {
  applyAvatarTransformToObject,
  areAvatarTransformsEqual,
  avatarTransformFromObject,
  cloneAvatarTransform,
  DEFAULT_AVATAR_TRANSFORM,
  type AvatarTransform,
  type TransformAxis,
} from "@/ui/main/canvas/transform-state";
import {
  DEFAULT_SCENE_CAMERA,
  DEFAULT_SCENE_ORBIT_TARGET,
  type SceneCameraSettings,
} from "@/ui/main/canvas/sceneCameraPresets";

type StageStatus = "idle" | "loading" | "ready" | "error";

type StageSource =
  | { kind: "file"; file: File }
  | {
      kind: "url";
      url: string;
      runtimeContentEntry?: RuntimeCatalogEntry | null;
    };

type StageActorProps = {
  source: StageSource;
  runtimeContent?: AnimaAvatarStageProps["runtimeContent"];
  contentPreview?: PreparedAnimaStagePreview | null;
  contentPreviewLoop: boolean;
  contentPreviewPlayRequest: number;
  onContentPreviewStatusChange?: AnimaAvatarStageProps["onContentPreviewStatusChange"];
  onAvatarChange: (avatar: Avatar | null) => void;
  onSceneVFXChange: (entry: SceneVFXRuntimeEntry | null) => void;
  previewModelFailed: boolean;
  temporaryPreviewModel: boolean;
  onTemporaryPreviewModelError: () => void;
  avatarTransform: AvatarTransform;
  moveAvatar: boolean;
  onAvatarTransformChange: (transform: AvatarTransform) => void;
  setStatus: Dispatch<SetStateAction<StageStatus>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
};

export type AnimaAvatarStageProps = {
  animaId?: string | null;
  animaName: string;
  avatarUrl?: string | null;
  avatarRuntimeContentEntry?: RuntimeCatalogEntry | null;
  avatarFile?: File | null;
  camera?: {
    position: [number, number, number];
    fov: number;
  };
  orbitTarget?: [number, number, number];
  className?: string;
  backdrop?: ReactNode;
  overlay?: ReactNode;
  runtimeContent?: AnimaRuntimeCatalogSnapshot | null;
  contentPreview?: PreparedAnimaStagePreview | null;
  contentPreviewTarget?: ContentPreviewTarget | null;
  contentPreviewStatus?: ContentPreviewLoadStatus;
  contentPreviewLoop?: boolean;
  contentPreviewMoveAvatar?: boolean;
  contentPreviewPlayRequest?: number;
  onContentPreviewMoveAvatarChange?: (moving: boolean) => void;
  onContentPreviewStatusChange?: (
    status: ContentPreviewLoadStatus,
    message?: string,
  ) => void;
  transparent?: boolean;
  showMetadata?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StageAvatarActor({
  source,
  runtimeContent,
  contentPreview,
  contentPreviewLoop,
  contentPreviewPlayRequest,
  onContentPreviewStatusChange,
  onAvatarChange,
  onSceneVFXChange,
  previewModelFailed,
  temporaryPreviewModel,
  onTemporaryPreviewModelError,
  avatarTransform,
  moveAvatar,
  onAvatarTransformChange,
  setStatus,
  setErrorMessage,
}: StageActorProps) {
  const logger = useMemo(() => createLogger("AnimaAvatarStage"), []);
  const { camera, gl } = useThree();
  const avatarRef = useRef<Avatar | null>(null);
  const catalogSession = useMemo(() => new PreviewRuntimeCatalogSession(), []);
  const applySoundPlayer = useMemo(
    () => new ContentPreviewApplySoundPlayer(),
    [],
  );
  const clipEventBridge = useMemo(
    () =>
      createContentPreviewClipEventBridge({
        catalog: catalogSession,
        onSceneVFXChange,
        playSfx: (runtimeId, signal) =>
          applySoundPlayer.play(catalogSession, runtimeId, signal),
      }),
    [applySoundPlayer, catalogSession, onSceneVFXChange],
  );
  const playbackGenerationRef = useRef(0);
  const handledPlayRequestRef = useRef(0);
  const temporaryModelErrorRef = useRef(onTemporaryPreviewModelError);
  const completionWatchRef = useRef<{
    generation: number;
    type: "pose_clip" | "reaction_clip";
    runtimeId: string;
  } | null>(null);
  const [sceneObject, setSceneObject] = useState<Object3D | null>(null);
  const [avatarRoot, setAvatarRoot] = useState<Group | null>(null);
  const [avatarReady, setAvatarReady] = useState(false);
  useEffect(() => {
    temporaryModelErrorRef.current = onTemporaryPreviewModelError;
  }, [onTemporaryPreviewModelError]);

  useEffect(() => {
    const runtime = contentPreview?.runtime ?? runtimeContent;
    catalogSession.replace(runtime ? new AnimaRuntimeCatalog(runtime) : null);
  }, [contentPreview?.runtime, catalogSession, runtimeContent]);

  useEffect(() => () => catalogSession.dispose(), [catalogSession]);
  useEffect(() => () => applySoundPlayer.stop(), [applySoundPlayer]);

  useEffect(() => {
    const avatar = avatarRef.current;
    if (!avatar || !avatarReady) return;
    return attachContentPreviewClipEventBridge(avatar, clipEventBridge);
  }, [avatarReady, clipEventBridge]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const releaseAvatar = acquireContentPreviewResource("management", "avatar");
    const loadPath =
      source.kind === "file" ? URL.createObjectURL(source.file) : source.url;
    const avatar = new Avatar(camera, gl.domElement, {
      motionCatalog: catalogSession,
      mediaCatalog: catalogSession,
    });
    avatarRef.current = avatar;
    onAvatarChange(avatar);
    setSceneObject(null);
    setAvatarReady(false);
    setStatus("loading");

    const loadAvatar = async () => {
      let download: RuntimeContentUrlLease | null = null;
      try {
        download =
          source.kind === "url" && source.runtimeContentEntry
            ? await runtimeContentDownloadUrl(
                source.runtimeContentEntry,
                loadPath,
                { signal: controller.signal },
              )
            : null;
        const resolvedLoadPath = download?.url ?? loadPath;
        if (!resolvedLoadPath) {
          throw new Error("avatar_model_download_unavailable");
        }
        controller.signal.throwIfAborted();
        await avatar.load({
          filePath: resolvedLoadPath,
          sourceUrl: loadPath,
        });
        if (cancelled || avatar.isDisposed || !avatar.scene) return;
        setSceneObject(avatar.scene);
        setAvatarReady(true);
        logContentPreviewLifecycle("avatar_load", "management");
        setErrorMessage(null);
        setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        logger.error("Preview", "Failed to load avatar preview", {
          sourceKind: source.kind,
          error,
        });
        if (temporaryPreviewModel) {
          temporaryModelErrorRef.current();
          onContentPreviewStatusChange?.(
            "error",
            "The selected avatar model could not be loaded. The saved model was restored.",
          );
          return;
        }
        setStatus("error");
        setErrorMessage("This avatar could not be rendered as a VRM preview.");
      } finally {
        download?.release();
      }
    };

    void loadAvatar();

    return () => {
      cancelled = true;
      controller.abort();
      clearContentPreviewEffects({
        avatar,
        onSceneVFXChange,
        stopApplySound: applySoundPlayer.stop,
      });
      avatar.dispose();
      releaseAvatar();
      avatarRef.current = null;
      onAvatarChange(null);
      setAvatarReady(false);
      if (source.kind === "file") {
        URL.revokeObjectURL(loadPath);
      }
    };
  }, [
    camera,
    applySoundPlayer,
    catalogSession,
    gl,
    logger,
    onContentPreviewStatusChange,
    onAvatarChange,
    onSceneVFXChange,
    setErrorMessage,
    setStatus,
    source,
    temporaryPreviewModel,
  ]);

  useEffect(() => {
    const avatar = avatarRef.current;
    if (!avatar) return;
    playbackGenerationRef.current += 1;
    completionWatchRef.current = null;
    clipEventBridge.reset();
    avatar.resetAnimations();
    clearContentPreviewEffects({
      avatar,
      onSceneVFXChange,
      stopApplySound: applySoundPlayer.stop,
    });
    avatar.setAutomaticAnimationPlaybackEnabled(!contentPreview);
    if (!contentPreview && avatar.vrm) avatar.vrm.update(0);
  }, [applySoundPlayer, clipEventBridge, contentPreview, onSceneVFXChange]);

  useEffect(() => {
    if (
      contentPreview &&
      avatarRef.current?.isReady &&
      !temporaryPreviewModel
    ) {
      logContentPreviewLifecycle("avatar_reuse", "management");
    }
  }, [contentPreview, temporaryPreviewModel]);

  useEffect(() => {
    if (avatarRoot) applyAvatarTransformToObject(avatarRoot, avatarTransform);
  }, [avatarRoot, avatarTransform]);

  useEffect(() => {
    const avatar = avatarRef.current;
    if (
      !contentPreview ||
      !avatar ||
      !avatarReady ||
      previewModelFailed ||
      contentPreviewPlayRequest < 1 ||
      handledPlayRequestRef.current === contentPreviewPlayRequest
    ) {
      return;
    }
    handledPlayRequestRef.current = contentPreviewPlayRequest;
    const generation = ++playbackGenerationRef.current;
    const command = contentPreviewPlaybackCommand(contentPreview.target);
    const effectCommand = contentPreviewEffectCommand(contentPreview.target);
    completionWatchRef.current = null;
    clipEventBridge.reset();
    avatar.resetAnimations();
    avatar.setAutomaticAnimationPlaybackEnabled(false);
    onContentPreviewStatusChange?.("playing");
    void (async () => {
      if (effectCommand) {
        await playContentPreviewEffect({
          avatar,
          catalog: catalogSession,
          command: effectCommand,
          onSceneVFXChange,
          isCurrent: () => generation === playbackGenerationRef.current,
          playApplySound: (runtimeId) =>
            applySoundPlayer.play(catalogSession, runtimeId),
          stopApplySound: applySoundPlayer.stop,
        });
        return;
      }
      if (contentPreview.target.kind === "avatar_model") {
        onContentPreviewStatusChange?.("ready");
        return;
      }
      await playContentPreviewMotion({
        avatar,
        catalog: catalogSession,
        target: contentPreview.target,
        loop: contentPreviewLoop,
        isCurrent: () => generation === playbackGenerationRef.current,
        onFinished: () => {
          if (generation !== playbackGenerationRef.current) return;
          avatar.resetAnimations();
          onContentPreviewStatusChange?.("ready");
        },
      });
      if (
        generation === playbackGenerationRef.current &&
        command &&
        (command.type === "pose_clip" || command.type === "reaction_clip")
      ) {
        completionWatchRef.current = {
          generation,
          type: command.type,
          runtimeId: command.runtimeId,
        };
      }
    })().catch((error: unknown) => {
      if (generation !== playbackGenerationRef.current) return;
      onContentPreviewStatusChange?.(
        "error",
        error instanceof Error && error.message.trim()
          ? error.message
          : "The selected content could not be previewed.",
      );
    });
    return () => {
      if (generation === playbackGenerationRef.current) {
        playbackGenerationRef.current += 1;
        completionWatchRef.current = null;
      }
    };
  }, [
    applySoundPlayer,
    contentPreview,
    contentPreviewLoop,
    contentPreviewPlayRequest,
    avatarReady,
    catalogSession,
    clipEventBridge,
    onSceneVFXChange,
    onContentPreviewStatusChange,
    previewModelFailed,
  ]);

  useFrame((_, delta) => {
    const avatar = avatarRef.current;
    avatar?.update(delta);
    const watch = completionWatchRef.current;
    if (!avatar || !watch) return;
    const active =
      watch.type === "reaction_clip"
        ? avatar.getReactionClipSnapshot().active
        : avatar.getClipSnapshot(watch.runtimeId).playing;
    if (active || watch.generation !== playbackGenerationRef.current) return;
    completionWatchRef.current = null;
    avatar.resetAnimations();
    onContentPreviewStatusChange?.("ready");
  });

  if (!sceneObject) return null;
  return (
    <>
      {/* Preserve Avatar.load()'s VRM0 orientation on the child model. */}
      <group ref={setAvatarRoot}>
        <primitive object={sceneObject} dispose={null} />
      </group>
      {contentPreview && moveAvatar && avatarRoot ? (
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
  );
}

function AnimaAvatarStageInner({
  animaName,
  avatarUrl = null,
  avatarRuntimeContentEntry = null,
  avatarFile = null,
  camera = DEFAULT_SCENE_CAMERA,
  orbitTarget = DEFAULT_SCENE_ORBIT_TARGET,
  className,
  backdrop,
  overlay,
  runtimeContent = null,
  contentPreview = null,
  contentPreviewTarget = null,
  contentPreviewStatus = "idle",
  contentPreviewLoop = false,
  contentPreviewMoveAvatar = false,
  contentPreviewPlayRequest = 0,
  onContentPreviewMoveAvatarChange,
  onContentPreviewStatusChange,
  transparent = false,
  showMetadata = true,
  emptyTitle = "No avatar preview available",
  emptyDescription = "This anima does not currently expose a previewable VRM avatar.",
}: AnimaAvatarStageProps) {
  const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null);
  const [activeAvatar, setActiveAvatar] = useState<Avatar | null>(null);
  const [sceneVFX, setSceneVFX] = useState<SceneVFXRuntimeEntry | null>(null);
  const [cameraChanged, setCameraChanged] = useState(false);
  const [resetCameraRequest, setResetCameraRequest] = useState(0);
  const [previewOverlayBottom, setPreviewOverlayBottom] = useState<
    number | null
  >(null);
  const [avatarTransform, setAvatarTransform] = useState<AvatarTransform>(() =>
    cloneAvatarTransform(DEFAULT_AVATAR_TRANSFORM),
  );
  const observationTarget = contentPreviewTarget ?? contentPreview?.target;
  const previewModelEntry =
    contentPreview?.target.kind === "avatar_model"
      ? contentPreview.entry
      : null;
  const previewModelKey = previewModelEntry?.content_revision ?? null;
  const [failedPreviewModel, setFailedPreviewModel] = useState<{
    key: string;
    playRequest: number;
  } | null>(null);
  const avatarSelection = selectAnimaStageAvatarEntry({
    saved: avatarRuntimeContentEntry,
    prepared: contentPreview,
    failed: failedPreviewModel,
    playRequest: contentPreviewPlayRequest,
  });
  const temporaryPreviewModel = avatarSelection.temporary;
  const activeRuntimeEntry = avatarSelection.entry;
  const temporaryPreviewModelUrl =
    temporaryPreviewModel && activeRuntimeEntry
      ? runtimeContentEntryUrl(activeRuntimeEntry)
      : null;
  const source = useMemo<StageSource | null>(() => {
    if (
      temporaryPreviewModel &&
      activeRuntimeEntry &&
      temporaryPreviewModelUrl
    ) {
      return {
        kind: "url",
        url: temporaryPreviewModelUrl,
        runtimeContentEntry: activeRuntimeEntry,
      };
    }
    if (avatarFile) {
      return { kind: "file", file: avatarFile };
    }
    if (avatarUrl) {
      return {
        kind: "url",
        url: avatarUrl,
        runtimeContentEntry: avatarRuntimeContentEntry,
      };
    }
    return null;
  }, [
    activeRuntimeEntry,
    avatarFile,
    avatarRuntimeContentEntry,
    avatarUrl,
    temporaryPreviewModel,
    temporaryPreviewModelUrl,
  ]);
  const [status, setStatus] = useState<StageStatus>(
    source ? "loading" : "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const previewLabel =
    source?.kind === "file" ? source.file.name : `${animaName} avatar`;
  const previewMeta =
    source?.kind === "file"
      ? `${formatFileSize(source.file.size)} • Local replacement preview`
      : source
        ? "Current saved avatar"
        : "No VRM avatar available";
  const cameraSettings = useMemo<SceneCameraSettings>(
    () => ({
      position: {
        x: camera.position[0],
        y: camera.position[1],
        z: camera.position[2],
      },
      orbitTarget: { x: orbitTarget[0], y: orbitTarget[1], z: orbitTarget[2] },
      fov: camera.fov,
    }),
    [camera.fov, camera.position, orbitTarget],
  );

  useEffect(() => {
    setFailedPreviewModel(null);
    onContentPreviewMoveAvatarChange?.(false);
    setAvatarTransform(cloneAvatarTransform(DEFAULT_AVATAR_TRANSFORM));
    setResetCameraRequest((current) => current + 1);
  }, [contentPreview?.entryKey, onContentPreviewMoveAvatarChange]);

  useEffect(() => {
    if (!contentPreview) setSceneVFX(null);
  }, [contentPreview]);

  useLayoutEffect(() => {
    if (!contentPreview || !hostElement) {
      setPreviewOverlayBottom(null);
      return;
    }
    const previewOverlay = hostElement.querySelector<HTMLElement>(
      "[data-anima-preview-overlay]",
    );
    if (!previewOverlay) {
      setPreviewOverlayBottom(null);
      return;
    }
    const measureOverlay = () => {
      setPreviewOverlayBottom(
        previewOverlay.offsetTop + previewOverlay.offsetHeight,
      );
    };
    measureOverlay();
    const observer = new ResizeObserver(measureOverlay);
    observer.observe(previewOverlay);
    return () => observer.disconnect();
  }, [contentPreview, hostElement]);

  useEffect(() => {
    if (!contentPreview) return;
    return acquireContentPreviewResource("management", "catalog");
  }, [contentPreview]);

  const handleAvatarTransformChange = (nextTransform: AvatarTransform) => {
    setAvatarTransform((current) =>
      areAvatarTransformsEqual(current, nextTransform)
        ? current
        : cloneAvatarTransform(nextTransform),
    );
  };
  const handlePositionChange = (axis: TransformAxis, value: number) => {
    setAvatarTransform((current) => {
      const next = cloneAvatarTransform(current);
      next.position[axis] = value;
      return areAvatarTransformsEqual(current, next) ? current : next;
    });
  };
  const handleTemporaryPreviewModelError = useCallback(() => {
    if (!previewModelKey) return;
    setFailedPreviewModel({
      key: previewModelKey,
      playRequest: contentPreviewPlayRequest,
    });
  }, [contentPreviewPlayRequest, previewModelKey]);

  useEffect(() => {
    if (!temporaryPreviewModel || temporaryPreviewModelUrl) return;
    handleTemporaryPreviewModelError();
    onContentPreviewStatusChange?.(
      "error",
      "The selected avatar model has no previewable runtime file. The saved model was restored.",
    );
  }, [
    handleTemporaryPreviewModelError,
    onContentPreviewStatusChange,
    temporaryPreviewModel,
    temporaryPreviewModelUrl,
  ]);

  useEffect(() => {
    if (!sceneVFX?.expiresAtMs) return;
    const timeoutId = window.setTimeout(
      () => setSceneVFX((current) => (current === sceneVFX ? null : current)),
      Math.max(0, sceneVFX.expiresAtMs - Date.now()),
    );
    return () => window.clearTimeout(timeoutId);
  }, [sceneVFX]);

  return (
    <div
      ref={setHostElement}
      className={cn(
        "relative overflow-hidden",
        transparent ? "bg-transparent" : "bg-background",
        className,
      )}
      aria-label={`Interactive preview of ${animaName}`}
      data-playback-surface={
        observationTarget ? "anima-loadout-stage" : undefined
      }
    >
      {observationTarget ? (
        <PlaybackObservationOutput
          active
          avatar={activeAvatar}
          sceneVFX={sceneVFX}
          status={resolvePlaybackObservationStatus({
            active: true,
            status: contentPreviewStatus,
          })}
          surface="anima-loadout-stage"
          target={observationTarget}
        />
      ) : null}
      {backdrop ? (
        <div className="pointer-events-none absolute inset-0 z-0">
          {backdrop}
        </div>
      ) : null}

      {source ? (
        <>
          <AvatarPreviewSurface
            activeAvatar={activeAvatar}
            cameraProfile="custom"
            cameraSettings={cameraSettings}
            canvasTestId="anima-management-canvas"
            className="absolute inset-0 z-10"
            lifecycleOwner="management"
            minDistance={1.75}
            maxDistance={6}
            resetCameraRequest={resetCameraRequest}
            onCameraChanged={setCameraChanged}
            sceneVFX={sceneVFX}
            sceneBackgroundScope="viewport"
          >
            <Suspense fallback={null}>
              <StageAvatarActor
                source={source}
                runtimeContent={runtimeContent}
                contentPreview={contentPreview}
                contentPreviewLoop={contentPreviewLoop}
                contentPreviewPlayRequest={contentPreviewPlayRequest}
                onContentPreviewStatusChange={onContentPreviewStatusChange}
                onAvatarChange={setActiveAvatar}
                onSceneVFXChange={setSceneVFX}
                previewModelFailed={
                  failedPreviewModel?.key === previewModelKey &&
                  failedPreviewModel.playRequest === contentPreviewPlayRequest
                }
                temporaryPreviewModel={temporaryPreviewModel}
                onTemporaryPreviewModelError={handleTemporaryPreviewModelError}
                avatarTransform={avatarTransform}
                moveAvatar={contentPreviewMoveAvatar}
                onAvatarTransformChange={handleAvatarTransformChange}
                setStatus={setStatus}
                setErrorMessage={setErrorMessage}
              />
            </Suspense>
          </AvatarPreviewSurface>

          {contentPreview && cameraChanged ? (
            <div
              className="pointer-events-auto absolute right-5 z-40 flex items-center gap-1.5"
              style={{ top: (previewOverlayBottom ?? 88) + 8 }}
            >
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="bg-background/85 min-h-10 gap-1 px-2.5 text-xs shadow-sm backdrop-blur-sm"
                aria-label="Reset preview camera"
                onClick={() => setResetCameraRequest((current) => current + 1)}
              >
                Reset <Camera className="size-3.5" />
              </Button>
            </div>
          ) : null}
          {contentPreview && contentPreviewMoveAvatar ? (
            <div
              className="absolute right-5 z-40"
              style={{
                top: (previewOverlayBottom ?? 88) + (cameraChanged ? 56 : 8),
              }}
            >
              <TransformPanel
                className="static w-44 max-w-none"
                compact
                mode="translate"
                transform={avatarTransform}
                uniformScaleLocked
                onPositionChange={handlePositionChange}
                onRotationChangeDegrees={() => undefined}
                onScaleChange={() => undefined}
                onUniformScaleLockedChange={() => undefined}
                showShortcut={false}
              />
            </div>
          ) : null}

          {showMetadata ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/60 via-black/5 to-transparent px-4 py-3">
              <p className="text-sm font-medium text-white">{previewLabel}</p>
              <p className="text-xs text-white/80">{previewMeta}</p>
            </div>
          ) : null}
        </>
      ) : (
        <div className="relative z-10 flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(148,163,184,0.18),transparent_42%),linear-gradient(160deg,rgba(15,23,42,0.15),transparent_58%)] px-6 text-center">
          <div className="space-y-2">
            <p className="text-foreground text-sm font-medium">{emptyTitle}</p>
            <p className="text-muted-foreground text-xs">{emptyDescription}</p>
          </div>
        </div>
      )}

      {source && status === "loading" ? (
        <div
          className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center"
          role="status"
          aria-live="polite"
        >
          <div className="rounded-full border border-white/20 bg-black/45 px-4 py-2 text-xs font-medium text-white">
            Loading anima
          </div>
        </div>
      ) : null}

      {source && status === "error" ? (
        <div
          className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/45 px-6 text-center"
          role="alert"
        >
          <p className="max-w-xs text-sm font-medium text-white">
            {errorMessage}
          </p>
        </div>
      ) : null}

      {overlay ? (
        <div className="pointer-events-none absolute inset-0 z-30">
          {overlay}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Owns exactly one interactive VRM lifecycle. A source-key remount ensures the
 * previous Avatar and any local object URL are disposed before replacement.
 */
export function AnimaAvatarStage(props: AnimaAvatarStageProps) {
  const sourceKey = props.avatarFile
    ? `${props.avatarFile.name}:${props.avatarFile.size}:${props.avatarFile.lastModified}`
    : props.avatarUrl || "empty";

  return <AnimaAvatarStageInner key={sourceKey} {...props} />;
}
