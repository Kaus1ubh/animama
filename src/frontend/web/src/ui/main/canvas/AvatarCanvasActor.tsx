"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useParams } from "@tanstack/react-router";
import type { Object3D } from "three";

import {
  Avatar,
  type AnimaPoseClipEventSink,
  type AvatarPlannerOutput,
  type CursorLookAtInputProvider,
  hasBlockingNonTtsPresentationWork,
} from "@/lib/avatar";
import { buildAnimationPreloadPlan } from "@/lib/avatar/animationPreloadPlan";
import { useOptionalSoundController } from "@/hooks/use-sound-controller";
import { applyAvatarVFXEffectById } from "@/lib/avatar/vfx/runtime";
import type { SceneVFXKind } from "@/lib/scene-vfx/types";
import { createLogger } from "@/lib/logger";
import { runtimeContentEntryLoadKey } from "@/lib/runtime-content/animaRuntimeSnapshot";
import {
  runtimeContentDeliveryUrl,
  runtimeContentDownloadUrl,
  preparedRuntimeResourceUrls,
} from "@/lib/runtime-content/runtimeContentDelivery";
import { useAvatarLipSyncBridgeStore } from "@/stores/avatar-lipsync-bridge-store";
import { useAvatarRuntimeStore } from "@/stores/avatar-runtime-store";
import { DEBUG_ENABLED } from "@/platform/env";
import { useMountedAnimaRuntimeContent } from "@/ui/app/AnimaRouteProviders";
import {
  applyClipOwnedSceneVFX,
  clearAllClipOwnedSceneVFX,
  clearClipOwnedSceneVFX,
  collectClipOwnedSceneVFXAppliedIds,
  type ClipOwnedSceneVFXRecord,
} from "./clip-owned-scene-vfx";
import { observeFirstPosedFrame } from "./firstPosedFrame";

const PRELOAD_CONCURRENCY = 3;
const PARTICLE_VFX_PRELOAD_CONCURRENCY = 2;
const BACKGROUND_PRELOAD_DELAY_MS = 300;
const BACKGROUND_PRELOAD_IDLE_TIMEOUT_MS = 5000;

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency: number = PRELOAD_CONCURRENCY,
): Promise<void> {
  if (items.length === 0) return;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let index = 0;

  const tasks = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      // Warm-cache decode work still gives input and rendering a turn.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await worker(current);
    }
  });

  await Promise.all(tasks);
}

type AvatarCanvasActorProps = {
  clipVfxEnabled?: boolean;
  cursorLookAtInputProvider?: CursorLookAtInputProvider | null;
  onAvatarInstanceChange?: (avatar: Avatar | null) => void;
  playRuntimeVfxSounds?: boolean;
};

type AvatarLoadSpec = {
  loadKey: string | null;
  requestedAvatarPath: string | null;
};

function buildAvatarLoadKey({
  animaId,
  fetchPath,
  stableAvatarPath,
}: {
  animaId: string | null;
  fetchPath: string | null;
  stableAvatarPath: string | null;
}): string | null {
  if (!fetchPath) return null;
  if (stableAvatarPath) {
    return `${animaId ?? "__anima__"}:${stableAvatarPath}`;
  }

  try {
    const url = new URL(fetchPath, "http://animama.local");
    const isSignedObjectUrl =
      url.searchParams.has("X-Amz-Signature") ||
      url.searchParams.has("X-Amz-Credential") ||
      url.searchParams.has("X-Amz-Algorithm");
    if (isSignedObjectUrl) {
      const pathKey = url.pathname;
      return url.origin === "http://animama.local"
        ? pathKey
        : `${url.origin}${pathKey}`;
    }
  } catch {
    // Non-URL fetch paths are already stable enough to use as the load key.
  }

  return fetchPath;
}

export function AvatarCanvasActor({
  clipVfxEnabled = true,
  cursorLookAtInputProvider = null,
  onAvatarInstanceChange,
  playRuntimeVfxSounds = true,
}: AvatarCanvasActorProps) {
  const logger = useMemo(() => createLogger("AvatarCanvasActor"), []);
  const { gl, camera, scene } = useThree();
  const params = useParams({ strict: false });
  const [sceneObject, setSceneObject] = useState<Object3D | null>(null);
  const [, setAvatarReady] = useState(false);
  const avatarRef = useRef<Avatar | null>(null);
  const firstFrameRef = useRef<ReturnType<
    typeof observeFirstPosedFrame
  > | null>(null);
  const latestPlannerOutputRef = useRef<AvatarPlannerOutput | null>(null);

  const animaId = typeof params?.animaId === "string" ? params.animaId : null;
  const mountedRuntimeContent = useMountedAnimaRuntimeContent();
  const finishAvatarPreparation = mountedRuntimeContent.finishAvatarPreparation;
  const runtimeCatalogRef = useRef(mountedRuntimeContent.catalog);
  runtimeCatalogRef.current = mountedRuntimeContent.catalog;
  const consumePlannerEvents = useAvatarRuntimeStore(
    (state) => state.consumePlannerEvents,
  );
  const runtimeVfx = useAvatarRuntimeStore((state) => state.runtimeVfx);
  const pruneExpiredRuntimeVfx = useAvatarRuntimeStore(
    (state) => state.pruneExpiredRuntimeVfx,
  );
  const soundController = useOptionalSoundController();
  const playSfxCue = playRuntimeVfxSounds
    ? soundController?.playSfxCue
    : undefined;
  const playSfxCueRef = useRef(playSfxCue);
  const clipVfxEnabledRef = useRef(clipVfxEnabled);
  const poseClipSceneVfxRef = useRef<
    Map<SceneVFXKind, ClipOwnedSceneVFXRecord>
  >(new Map());
  const reactionClipSceneVfxRef = useRef<
    Map<SceneVFXKind, ClipOwnedSceneVFXRecord>
  >(new Map());
  const poseClipSceneLoadRef = useRef<Map<SceneVFXKind, string>>(new Map());
  const reactionClipSceneLoadRef = useRef<Map<SceneVFXKind, string>>(new Map());
  const poseClipEventSink = useMemo<AnimaPoseClipEventSink>(
    () => ({
      applySceneVFX: async (event, context) => {
        poseClipSceneLoadRef.current.set(event.sceneKind, context.appliedId);
        const preset =
          (await runtimeCatalogRef.current?.loadSceneVFX(
            event.sceneKind,
            event.presetId,
          )) ?? null;
        if (
          poseClipSceneLoadRef.current.get(event.sceneKind) !==
            context.appliedId ||
          !clipVfxEnabledRef.current
        ) {
          return;
        }
        poseClipSceneLoadRef.current.delete(event.sceneKind);
        applyClipOwnedSceneVFX(poseClipSceneVfxRef.current, event, context, {
          resolvePreset: () => preset,
        });
        if (preset?.sound?.onApply)
          await playSfxCueRef.current?.(preset.sound.onApply);
      },
      clearSceneVFX: (event, context) => {
        if (
          poseClipSceneLoadRef.current.get(event.sceneKind) ===
          context.appliedId
        ) {
          poseClipSceneLoadRef.current.delete(event.sceneKind);
        }
        clearClipOwnedSceneVFX(poseClipSceneVfxRef.current, event, context);
      },
      playSfx: (event) => {
        playSfxCueRef.current?.(event.cueId, {
          ...(event.volume !== undefined ? { volume: event.volume } : {}),
        });
      },
    }),
    [],
  );
  const reactionClipEventSink = useMemo<AnimaPoseClipEventSink>(
    () => ({
      applySceneVFX: async (event, context) => {
        reactionClipSceneLoadRef.current.set(
          event.sceneKind,
          context.appliedId,
        );
        const preset =
          (await runtimeCatalogRef.current?.loadSceneVFX(
            event.sceneKind,
            event.presetId,
          )) ?? null;
        if (
          reactionClipSceneLoadRef.current.get(event.sceneKind) !==
            context.appliedId ||
          !clipVfxEnabledRef.current
        ) {
          return;
        }
        reactionClipSceneLoadRef.current.delete(event.sceneKind);
        applyClipOwnedSceneVFX(
          reactionClipSceneVfxRef.current,
          event,
          context,
          {
            resolvePreset: () => preset,
          },
        );
        if (preset?.sound?.onApply)
          await playSfxCueRef.current?.(preset.sound.onApply);
      },
      clearSceneVFX: (event, context) => {
        if (
          reactionClipSceneLoadRef.current.get(event.sceneKind) ===
          context.appliedId
        ) {
          reactionClipSceneLoadRef.current.delete(event.sceneKind);
        }
        clearClipOwnedSceneVFX(reactionClipSceneVfxRef.current, event, context);
      },
      playSfx: (event) => {
        playSfxCueRef.current?.(event.cueId, {
          ...(event.volume !== undefined ? { volume: event.volume } : {}),
        });
      },
    }),
    [],
  );
  const runtimeAvatarEntry = mountedRuntimeContent.data?.avatar_model ?? null;
  const runtimeAvatarUrl = runtimeContentDeliveryUrl(runtimeAvatarEntry);
  const runtimeAvatarLoadKey =
    mountedRuntimeContent.data && runtimeAvatarEntry
      ? runtimeContentEntryLoadKey(
          mountedRuntimeContent.data.effective_revision,
          runtimeAvatarEntry,
        )
      : null;
  const motionCatalog = mountedRuntimeContent.catalog;
  const resolvedAvatarPath = runtimeAvatarUrl;
  const shouldWaitForAnimaAvatar =
    Boolean(animaId) &&
    !resolvedAvatarPath &&
    (mountedRuntimeContent.isPending ||
      mountedRuntimeContent.playbackStatus === "preparing");
  const requestedAvatarPath = shouldWaitForAnimaAvatar
    ? null
    : resolvedAvatarPath;
  const avatarLoadKey = buildAvatarLoadKey({
    animaId,
    fetchPath: requestedAvatarPath,
    stableAvatarPath: runtimeAvatarLoadKey,
  });
  const avatarLoadSpecRef = useRef<AvatarLoadSpec>({
    loadKey: avatarLoadKey,
    requestedAvatarPath,
  });
  avatarLoadSpecRef.current = {
    loadKey: avatarLoadKey,
    requestedAvatarPath,
  };
  const runtimeManagedVfxRef = useRef<Map<string, number>>(new Map());
  const runtimeVfxReconcileTokenRef = useRef(0);
  const nextRuntimeVfxExpiryAtMs = runtimeVfx.reduce<number | null>(
    (nearestExpiryAtMs, entry) => {
      if (entry.lifetime.kind !== "duration" || entry.expiresAtMs === null) {
        return nearestExpiryAtMs;
      }
      if (nearestExpiryAtMs === null || entry.expiresAtMs < nearestExpiryAtMs) {
        return entry.expiresAtMs;
      }
      return nearestExpiryAtMs;
    },
    null,
  );

  useEffect(() => {
    playSfxCueRef.current = playSfxCue;
  }, [playSfxCue]);

  useEffect(() => {
    clipVfxEnabledRef.current = clipVfxEnabled;
    avatarRef.current?.setClipVFXEnabled(clipVfxEnabled);
    if (clipVfxEnabled) return;

    poseClipSceneLoadRef.current.clear();
    reactionClipSceneLoadRef.current.clear();

    const clipOwnedSceneAppliedIds = collectClipOwnedSceneVFXAppliedIds(
      poseClipSceneVfxRef.current,
      reactionClipSceneVfxRef.current,
    );
    clearAllClipOwnedSceneVFX(poseClipSceneVfxRef.current, {
      skipRestoreAppliedIds: clipOwnedSceneAppliedIds,
    });
    clearAllClipOwnedSceneVFX(reactionClipSceneVfxRef.current, {
      skipRestoreAppliedIds: clipOwnedSceneAppliedIds,
    });
  }, [clipVfxEnabled, sceneObject]);

  useEffect(() => {
    if (avatarLoadKey) return;
    onAvatarInstanceChange?.(null);
  }, [avatarLoadKey, onAvatarInstanceChange]);

  useEffect(() => {
    if (!avatarLoadKey || !motionCatalog) {
      return;
    }
    const loadSpec = avatarLoadSpecRef.current;
    if (loadSpec.loadKey !== avatarLoadKey || !loadSpec.requestedAvatarPath) {
      return;
    }

    setAvatarReady(false);
    let isCancelled = false;
    let idlePreloadHandle: number | null = null;
    let timeoutPreloadHandle: ReturnType<typeof setTimeout> | null = null;
    let firstFrame: ReturnType<typeof observeFirstPosedFrame> | null = null;
    const poseClipSceneVfx = poseClipSceneVfxRef.current;
    const reactionClipSceneVfx = reactionClipSceneVfxRef.current;
    const poseClipSceneLoads = poseClipSceneLoadRef.current;
    const reactionClipSceneLoads = reactionClipSceneLoadRef.current;
    const avatar = new Avatar(camera, gl.domElement, {
      cursorLookAtInputProvider,
      motionCatalog,
      mediaCatalog: motionCatalog,
    });
    avatar.setClipVFXEnabled(clipVfxEnabledRef.current);
    latestPlannerOutputRef.current = null;
    let disposeDebug: (() => void) | undefined;
    const candidates = [loadSpec.requestedAvatarPath];
    const primedClips = new Set<string>();
    const primedParticles = new Set<string>();
    let warming = false;
    let warmAgain = false;

    // One background decode job coalesces admissions. Pending resources are
    // absent from the catalog; neither this warmer nor playback can fetch them.
    const warmReadyResources = async () => {
      if (isCancelled || avatar.isDisposed || !firstFrame?.rendered) return;
      warming = true;
      warmAgain = false;
      try {
        const plan = buildAnimationPreloadPlan(motionCatalog);
        for (const tier of ["tierA", "tierB"] as const) {
          const clips = plan[tier].filter(({ clipName, clipUrl }) => {
            const key = `${clipName}:${clipUrl}`;
            if (primedClips.has(key)) return false;
            primedClips.add(key);
            return true;
          });
          await runWithConcurrency(clips, async ({ clipName, clipUrl }) => {
            if (isCancelled || avatar.isDisposed) return;
            try {
              const resource = motionCatalog.resolveVrma(clipUrl);
              if (!resource) return;
              await Avatar.preloadVrma(resource);
              if (isCancelled || avatar.isDisposed) return;
              await avatar.loadAnimationClip(clipUrl, { clipName });
            } catch {
              if (!isCancelled)
                logger.warn("Preload", "Failed motion preload", {
                  tier,
                  reason: "motion_preload_failed",
                });
            }
          });
          const particles = motionCatalog
            .getParticlePreloadIds(tier)
            .filter((id) => {
              if (primedParticles.has(id)) return false;
              primedParticles.add(id);
              return true;
            });
          await runWithConcurrency(
            particles,
            async (id) => {
              if (!isCancelled && !avatar.isDisposed)
                await avatar.particleVFXController?.preloadEffect(id);
            },
            PARTICLE_VFX_PRELOAD_CONCURRENCY,
          );
        }
      } catch {
        if (!isCancelled)
          logger.warn("Preload", "Failed background preparation", {
            reason: "optional_preload_failed",
          });
      } finally {
        warming = false;
        if (warmAgain && !isCancelled) scheduleOptionalPreload();
      }
    };
    const scheduleOptionalPreload = () => {
      if (isCancelled || !firstFrame?.rendered) return;
      warmAgain = true;
      if (
        warming ||
        idlePreloadHandle !== null ||
        timeoutPreloadHandle !== null
      )
        return;
      const execute = () => {
        idlePreloadHandle = null;
        timeoutPreloadHandle = null;
        void warmReadyResources();
      };
      const idleWindow =
        typeof window !== "undefined" ? (window as IdleWindow) : null;
      if (idleWindow?.requestIdleCallback) {
        idlePreloadHandle = idleWindow.requestIdleCallback(execute, {
          timeout: BACKGROUND_PRELOAD_IDLE_TIMEOUT_MS,
        });
      } else {
        timeoutPreloadHandle = setTimeout(execute, BACKGROUND_PRELOAD_DELAY_MS);
      }
    };
    const unsubscribeAvailability = motionCatalog.subscribe(
      scheduleOptionalPreload,
    );

    const loadAvatar = async () => {
      let loadedPath: string | null = null;
      let loadedSourceKey: string | null = null;

      for (const filePath of candidates) {
        try {
          loadedSourceKey = avatarLoadKey;
          if (
            filePath === loadSpec.requestedAvatarPath &&
            !runtimeAvatarEntry
          ) {
            throw new Error("avatar_model_entry_unavailable");
          }
          const resolvedFilePath =
            filePath === loadSpec.requestedAvatarPath
              ? await runtimeContentDownloadUrl(runtimeAvatarEntry!, filePath)
              : filePath;
          if (!resolvedFilePath) {
            throw new Error("avatar_model_download_unavailable");
          }
          await avatar.load({
            filePath: resolvedFilePath,
            sourceUrl: filePath,
            sourceKey: loadedSourceKey,
            resourceUrls: preparedRuntimeResourceUrls(runtimeAvatarEntry),
          });
          avatar.setClipVFXEnabled(clipVfxEnabledRef.current);
          avatar.setPoseClipExternalEventSink(poseClipEventSink);
          avatar.setReactionClipExternalEventSink(reactionClipEventSink);
          loadedPath = filePath;
          break;
        } catch {
          logger.warn("Load", "Failed to load avatar candidate", {
            reason: "avatar_model_load_failed",
          });
        }
      }

      if (!loadedPath) {
        if (!isCancelled) {
          finishAvatarPreparation("unavailable");
          logger.error("Load", "Unable to load any avatar model", {
            reason: "avatar_model_unavailable",
          });
        }
        avatar.dispose();
        return;
      }

      if (isCancelled) {
        avatar.dispose();
        return;
      }

      try {
        // Live playback must not depend on attaching a development inspector.
        // Preview/editor Avatars retain their separate unrooted default.
        avatar.setVrmaRootedPlaybackEnabled(true);
        avatar.prepareFirstFrame();
        firstFrame = observeFirstPosedFrame(avatar.scene!, camera, () => {
          if (isCancelled || avatarRef.current !== avatar) return;
          finishAvatarPreparation("visible");
          scheduleOptionalPreload();
        });
        firstFrameRef.current = firstFrame;
      } catch {
        if (!isCancelled) finishAvatarPreparation("unavailable");
        avatar.dispose();
        return;
      }

      runtimeManagedVfxRef.current = new Map();
      avatar.setPoseClipExternalEventSink(poseClipEventSink);
      avatar.setReactionClipExternalEventSink(reactionClipEventSink);
      avatarRef.current = avatar;
      avatar.setSpringBonePhysicsHelperHost(scene);
      onAvatarInstanceChange?.(avatar);
      useAvatarLipSyncBridgeStore.getState().registerAvatarInstance({
        avatar,
        animaId,
      });
      if (__ANIMAMA_DEV_BUILD__ && DEBUG_ENABLED) {
        void import("@/ui/debug/avatarDebugRuntime")
          .then(({ attachAvatarDebugRuntime }) => {
            if (isCancelled || avatarRef.current !== avatar) return;
            disposeDebug = attachAvatarDebugRuntime(
              {
                animaId,
                avatar,
                sourceUrl: avatar.sourceUrl,
                sourceKey: loadedSourceKey ?? loadedPath,
              },
              () => latestPlannerOutputRef.current,
            );
          })
          .catch(() =>
            logger.warn("Debug", "Unable to load avatar diagnostics"),
          );
      }
      setSceneObject(avatar.scene);
      setAvatarReady(true);
      logger.info("Load", "Avatar model loaded", {
        sourceType: runtimeAvatarEntry?.source.type ?? "unknown",
      });
    };

    void loadAvatar();

    return () => {
      isCancelled = true;
      unsubscribeAvailability();
      firstFrame?.dispose();
      if (firstFrameRef.current === firstFrame) firstFrameRef.current = null;
      poseClipSceneLoads.clear();
      reactionClipSceneLoads.clear();
      const idleWindow =
        typeof window !== "undefined" ? (window as IdleWindow) : null;
      if (idlePreloadHandle !== null) {
        idleWindow?.cancelIdleCallback?.(idlePreloadHandle);
      }
      if (timeoutPreloadHandle !== null) {
        clearTimeout(timeoutPreloadHandle);
      }
      if (avatarRef.current === avatar) {
        avatarRef.current = null;
      }
      avatar.setSpringBonePhysicsHelperHost(null);
      runtimeManagedVfxRef.current = new Map();
      disposeDebug?.();
      latestPlannerOutputRef.current = null;
      setSceneObject(null);
      setAvatarReady(false);
      onAvatarInstanceChange?.(null);
      useAvatarLipSyncBridgeStore.getState().unregisterAvatarInstance(avatar);
      avatar.dispose();
      const clipOwnedSceneAppliedIds = collectClipOwnedSceneVFXAppliedIds(
        poseClipSceneVfx,
        reactionClipSceneVfx,
      );
      clearAllClipOwnedSceneVFX(poseClipSceneVfx, {
        skipRestoreAppliedIds: clipOwnedSceneAppliedIds,
      });
      clearAllClipOwnedSceneVFX(reactionClipSceneVfx, {
        skipRestoreAppliedIds: clipOwnedSceneAppliedIds,
      });
    };
  }, [
    camera,
    finishAvatarPreparation,
    cursorLookAtInputProvider,
    scene,
    gl,
    logger,
    onAvatarInstanceChange,
    animaId,
    avatarLoadKey,
    poseClipEventSink,
    reactionClipEventSink,
    runtimeAvatarEntry,
    motionCatalog,
  ]);

  useEffect(() => {
    const avatar = avatarRef.current;
    const controller = avatar?.vfxController ?? null;
    if (!avatar?.isReady || !controller) {
      return;
    }

    let isCancelled = false;
    const reconcileToken = runtimeVfxReconcileTokenRef.current + 1;
    runtimeVfxReconcileTokenRef.current = reconcileToken;
    const desiredRuntimeVfx = runtimeVfx
      .slice()
      .sort((left, right) => left.order - right.order);
    const desiredRevisionByEffectId = new Map(
      desiredRuntimeVfx.map((entry) => [entry.effectId, entry.revision]),
    );
    const runtimeManagedVfx = runtimeManagedVfxRef.current;
    const isStaleReconcile = () =>
      isCancelled ||
      runtimeVfxReconcileTokenRef.current !== reconcileToken ||
      avatarRef.current !== avatar ||
      avatar.isDisposed;

    for (const effectId of Array.from(runtimeManagedVfx.keys())) {
      if (desiredRevisionByEffectId.has(effectId)) {
        continue;
      }
      controller.removeEffect(effectId);
      runtimeManagedVfx.delete(effectId);
    }

    const reconcileRuntimeVfx = async () => {
      for (const entry of desiredRuntimeVfx) {
        if (isStaleReconcile()) {
          return;
        }

        const appliedRevision = runtimeManagedVfx.get(entry.effectId);
        if (appliedRevision === entry.revision) {
          continue;
        }
        const shouldPlayApplySound = appliedRevision === undefined;
        if (appliedRevision !== undefined) {
          controller.removeEffect(entry.effectId);
        }

        const effect =
          (await motionCatalog?.loadAvatarVFX(entry.effectId)) ?? null;
        if (isStaleReconcile()) return;
        const didApply = await applyAvatarVFXEffectById({
          avatar,
          effectId: entry.effectId,
          effectEntry: effect,
        });
        if (isStaleReconcile()) {
          if (didApply) {
            controller.removeEffect(entry.effectId);
          }
          return;
        }

        if (didApply) {
          runtimeManagedVfx.set(entry.effectId, entry.revision);
          if (shouldPlayApplySound) {
            const soundCueId = effect?.sound?.onApply ?? null;
            if (soundCueId) {
              void playSfxCue?.(soundCueId);
            }
          }
        } else {
          runtimeManagedVfx.delete(entry.effectId);
        }
      }
    };

    void reconcileRuntimeVfx();

    return () => {
      isCancelled = true;
    };
  }, [motionCatalog, playSfxCue, runtimeVfx, sceneObject]);

  useEffect(() => {
    if (nextRuntimeVfxExpiryAtMs === null) {
      return;
    }

    const nowMs = Date.now();
    if (nextRuntimeVfxExpiryAtMs <= nowMs) {
      pruneExpiredRuntimeVfx(nowMs);
      return;
    }

    const timerId = window.setTimeout(() => {
      pruneExpiredRuntimeVfx(Date.now());
    }, nextRuntimeVfxExpiryAtMs - nowMs);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [nextRuntimeVfxExpiryAtMs, pruneExpiredRuntimeVfx]);

  useFrame((_state, delta) => {
    const avatar = avatarRef.current;
    if (!avatar?.isReady || !firstFrameRef.current?.rendered) return;

    const runtimeState = useAvatarRuntimeStore.getState();
    const nowMs = Date.now();

    const motionOutput = avatar.updateState(
      {
        emotionalState: runtimeState.emotionalState,
        signals: {
          interactionPhase: runtimeState.interactionPhase,
        },
      },
      {
        nowMs,
        animaId,
        activeRunId: runtimeState.activeRunId,
        activeVrmaActions: avatar.getActiveAnimations(),
        pendingEvents: runtimeState.plannerEvents,
        randomRolls: [
          Math.random(),
          Math.random(),
          Math.random(),
          Math.random(),
        ],
      },
    );
    if (motionOutput?.consumedPlannerEventIds.length) {
      consumePlannerEvents(motionOutput.consumedPlannerEventIds);
    }
    const pendingNonTtsCompletionRunId =
      runtimeState.pendingNonTtsResponseCompletionRunId;
    if (
      pendingNonTtsCompletionRunId &&
      runtimeState.activeRunId === pendingNonTtsCompletionRunId
    ) {
      runtimeState.completeNonTtsResponseIfPlannerIdle({
        runId: pendingNonTtsCompletionRunId,
        hasActivePresentationWork: hasBlockingNonTtsPresentationWork(
          motionOutput,
          pendingNonTtsCompletionRunId,
        ),
      });
    }
    const avatarState = avatar.getState();
    const preferredSpeechRunId =
      runtimeState.activeSpeechRunId ?? runtimeState.activeRunId;
    const lipSyncBridge = useAvatarLipSyncBridgeStore.getState();
    lipSyncBridge.tickGate({
      avatarState,
      preferredRunId: preferredSpeechRunId,
    });

    avatar.update(delta, {
      speechTiming: lipSyncBridge.getSpeechTimingContext(preferredSpeechRunId),
    });

    if (__ANIMAMA_DEV_BUILD__ && DEBUG_ENABLED)
      latestPlannerOutputRef.current = motionOutput;
  });

  if (!sceneObject || !requestedAvatarPath) return null;
  return <primitive object={sceneObject} dispose={null} />;
}
