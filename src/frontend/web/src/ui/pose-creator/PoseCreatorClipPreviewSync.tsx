"use client";

import { useEffect, useRef } from "react";
import { getI18n } from "react-i18next";

import { useOptionalSoundController } from "@/hooks/use-sound-controller";
import {
  collectAnimaPoseClipEventsBetween,
  isAnimaPoseClipVFXEvent,
  sampleAnimaPoseClipActiveEventsAtTime,
  sampleAnimaPoseClipAvatarVFXIntensity,
  type AnimaPoseClipV2,
  type AnimaPoseClipActiveVFXEvent,
  type AnimaPoseClipDueEvent,
  type AnimaPoseClipEventContext,
  type AnimaPoseClipSceneVFXEvent,
  type AnimaPoseClipVFXEvent,
  type Avatar,
} from "@/lib/avatar";
import { applyAvatarVFXEffectById } from "@/lib/avatar/vfx/runtime";
import type { AnimaRuntimeCatalog } from "@/lib/runtime-content/AnimaRuntimeCatalog";
import type { SceneVFXKind, SceneVFXRuntimeEntry } from "@/lib/scene-vfx/types";
import {
  POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
  usePoseCreatorStore,
} from "@/stores/pose-creator-store";
import {
  useSceneVFXStore,
  type SceneVFXActiveByKind,
} from "@/stores/scene-vfx-store";
import type { SoundContextValue } from "@/ui/sound/SoundProvider";
import { applyPoseCreatorDraftsToAvatar } from "./poseCreatorAuthoring";
import {
  buildAnimaPoseClipFromPoseCreatorDraft,
  type PoseCreatorClipDraft,
  type PoseCreatorClipPreviewDiagnostics,
} from "./poseCreatorClipAuthoring";
import {
  applyPoseCreatorClipPreview,
  createPoseCreatorClipPreviewDiagnostics,
} from "./poseCreatorClipPreview";
import {
  activeVFXEventsBeforePlaybackStart,
  poseCreatorScrubVFXSignature,
  samplePoseCreatorScrubVFXEvents,
} from "./poseCreatorClipEventPlayback";
import { usePoseCreatorPreview } from "./PoseCreatorPreviewProvider";

type PoseCreatorClipPreviewMode = "playback" | "scrub";

type ActivePreviewVFX = {
  event: AnimaPoseClipVFXEvent;
  context: AnimaPoseClipEventContext;
  mode: PoseCreatorClipPreviewMode;
  clearAtPlaybackTime: number | null;
};

type PoseCreatorSceneVFXRecord = {
  appliedId: string;
  previousEntry: NonNullable<SceneVFXActiveByKind[SceneVFXKind]> | null;
};

type EffectPreviewRuntimeState = {
  activeEffects: Map<string, ActivePreviewVFX>;
  sceneRecords: Map<SceneVFXKind, PoseCreatorSceneVFXRecord>;
  lastPlaying: boolean;
  lastClipId: string | null;
  lastAbsoluteTimeSec: number;
  lastClearRevision: number;
  lastCompletedRevision: number;
  lastScrubSignature: string | null;
  session: number;
};

function createEffectPreviewRuntimeState(): EffectPreviewRuntimeState {
  return {
    activeEffects: new Map(),
    sceneRecords: new Map(),
    lastPlaying: false,
    lastClipId: null,
    lastAbsoluteTimeSec: 0,
    lastClearRevision: 0,
    lastCompletedRevision: 0,
    lastScrubSignature: null,
    session: 0,
  };
}

export function PoseCreatorClipPreviewSync({
  previewBasePose,
}: { previewBasePose?: string } = {}) {
  const { catalog, eventCatalog } = usePoseCreatorPreview();
  const authoringMode = usePoseCreatorStore((state) => state.authoringMode);
  const activeAvatar = usePoseCreatorStore((state) => state.activeAvatar);
  const basePose = usePoseCreatorStore((state) => state.basePose);
  const boneDrafts = usePoseCreatorStore((state) => state.boneDrafts);
  const expressionDrafts = usePoseCreatorStore(
    (state) => state.expressionDrafts,
  );
  const clipDraft = usePoseCreatorStore((state) => state.clipDraft);
  const clipInlineEdit = usePoseCreatorStore((state) => state.clipInlineEdit);
  const clipPlaybackPlaying = usePoseCreatorStore(
    (state) => state.clipPlaybackPlaying,
  );
  const clipPlaybackAbsoluteTimeSec = usePoseCreatorStore(
    (state) => state.clipPlaybackAbsoluteTimeSec,
  );
  const clipPreviewClearRevision = usePoseCreatorStore(
    (state) => state.clipPreviewClearRevision,
  );
  const clipPlaybackCompletedRevision = usePoseCreatorStore(
    (state) => state.clipPlaybackCompletedRevision,
  );
  const setClipPreviewDiagnostics = usePoseCreatorStore(
    (state) => state.setClipPreviewDiagnostics,
  );
  const soundController = useOptionalSoundController();
  const soundControllerRef = useRef(soundController);
  const lastAvatarRef = useRef<Avatar | null>(activeAvatar);
  const effectRuntimeRef = useRef<EffectPreviewRuntimeState>(
    createEffectPreviewRuntimeState(),
  );

  useEffect(() => {
    soundControllerRef.current = soundController;
  }, [soundController]);

  useEffect(() => {
    if (activeAvatar) {
      lastAvatarRef.current = activeAvatar;
    }
  }, [activeAvatar]);

  useEffect(() => {
    const runtimeState = effectRuntimeRef.current;
    const lastAvatar = lastAvatarRef;
    return () => {
      clearAllPoseCreatorClipPreviewEffects(runtimeState, lastAvatar.current);
    };
  }, []);

  useEffect(() => {
    if (authoringMode !== "clip" || !activeAvatar || clipInlineEdit) {
      setClipPreviewDiagnostics(createPoseCreatorClipPreviewDiagnostics());
      return;
    }

    const result = applyPoseCreatorClipPreview(
      activeAvatar,
      clipDraft,
      previewBasePose,
    );
    setClipPreviewDiagnostics(
      createPoseCreatorClipPreviewDiagnostics(
        result.diagnostics,
        createPoseCreatorClipEventDiagnostics(
          clipDraft,
          activeAvatar,
          soundController,
          eventCatalog.validationRefs,
        ),
      ),
    );

    return () => {
      applyPoseCreatorDraftsToAvatar(
        activeAvatar,
        previewBasePose ?? basePose,
        boneDrafts,
        expressionDrafts,
      );
    };
  }, [
    activeAvatar,
    authoringMode,
    basePose,
    boneDrafts,
    clipInlineEdit,
    clipDraft,
    expressionDrafts,
    eventCatalog.validationRefs,
    previewBasePose,
    setClipPreviewDiagnostics,
    soundController,
  ]);

  useEffect(() => {
    const runtimeState = effectRuntimeRef.current;
    const inactive =
      authoringMode !== "clip" || clipInlineEdit || !activeAvatar;
    const clip = inactive ? null : buildPoseCreatorPreviewClip(clipDraft);

    if (inactive || !clip) {
      clearAllPoseCreatorClipPreviewEffects(
        runtimeState,
        activeAvatar ?? lastAvatarRef.current,
      );
      resetEffectPreviewRuntimeState(
        runtimeState,
        clipPlaybackPlaying,
        clip?.id ?? null,
        clipPlaybackAbsoluteTimeSec,
        clipPreviewClearRevision,
        clipPlaybackCompletedRevision,
      );
      return;
    }

    const clearRevisionChanged =
      runtimeState.lastClearRevision !== clipPreviewClearRevision;
    const clipChanged = runtimeState.lastClipId !== clip.id;
    const playbackReset =
      clipPlaybackAbsoluteTimeSec < runtimeState.lastAbsoluteTimeSec;
    const playbackStarted =
      clipPlaybackPlaying &&
      (!runtimeState.lastPlaying ||
        clearRevisionChanged ||
        clipChanged ||
        playbackReset);
    const playbackStopped = !clipPlaybackPlaying && runtimeState.lastPlaying;
    const playbackCompleted =
      clipPlaybackCompletedRevision !== runtimeState.lastCompletedRevision;

    if (playbackStopped) {
      if (
        playbackCompleted &&
        clipPlaybackAbsoluteTimeSec >= runtimeState.lastAbsoluteTimeSec &&
        runtimeState.lastClipId === clip.id
      ) {
        dispatchPoseCreatorClipDueEvents({
          clip,
          fromPlaybackTimeSec: runtimeState.lastAbsoluteTimeSec,
          toPlaybackTimeSec: clipPlaybackAbsoluteTimeSec,
          includeStart: false,
          runtimeState,
          activeAvatar,
          mode: "playback",
          soundController: soundControllerRef.current,
          catalog,
        });
      }
      clearAllPoseCreatorClipPreviewEffects(runtimeState, activeAvatar);
      resetEffectPreviewRuntimeState(
        runtimeState,
        false,
        clip.id,
        clipPlaybackAbsoluteTimeSec,
        clipPreviewClearRevision,
        clipPlaybackCompletedRevision,
      );
      return;
    }

    if (clipPlaybackPlaying) {
      if (playbackStarted) {
        clearAllPoseCreatorClipPreviewEffects(runtimeState, activeAvatar);
        applyPoseCreatorClipActiveVFXAtTime({
          clip,
          playbackTimeSec: clipPlaybackAbsoluteTimeSec,
          runtimeState,
          activeAvatar,
          mode: "playback",
          catalog,
          excludeEventsStartingAtSample: true,
        });
        dispatchPoseCreatorClipDueEvents({
          clip,
          fromPlaybackTimeSec: clipPlaybackAbsoluteTimeSec,
          toPlaybackTimeSec: clipPlaybackAbsoluteTimeSec,
          includeStart: true,
          runtimeState,
          activeAvatar,
          mode: "playback",
          soundController: soundControllerRef.current,
          catalog,
        });
      } else if (
        clipPlaybackAbsoluteTimeSec >= runtimeState.lastAbsoluteTimeSec
      ) {
        dispatchPoseCreatorClipDueEvents({
          clip,
          fromPlaybackTimeSec: runtimeState.lastAbsoluteTimeSec,
          toPlaybackTimeSec: clipPlaybackAbsoluteTimeSec,
          includeStart: false,
          runtimeState,
          activeAvatar,
          mode: "playback",
          soundController: soundControllerRef.current,
          catalog,
        });
      }
      clearExpiredPoseCreatorClipPlaybackEffects(
        runtimeState,
        activeAvatar,
        clipPlaybackAbsoluteTimeSec,
      );
      syncPoseCreatorClipAvatarVFXIntensities(
        runtimeState,
        activeAvatar,
        clipPlaybackAbsoluteTimeSec,
      );
      resetEffectPreviewRuntimeState(
        runtimeState,
        true,
        clip.id,
        clipPlaybackAbsoluteTimeSec,
        clipPreviewClearRevision,
        clipPlaybackCompletedRevision,
      );
      return;
    }

    if (clearRevisionChanged) {
      clearAllPoseCreatorClipPreviewEffects(runtimeState, activeAvatar);
      resetEffectPreviewRuntimeState(
        runtimeState,
        false,
        clip.id,
        clipPlaybackAbsoluteTimeSec,
        clipPreviewClearRevision,
        clipPlaybackCompletedRevision,
      );
      return;
    }

    const scrubActiveEvents = samplePoseCreatorScrubVFXEvents(
      clip,
      clipDraft.currentTimeSec,
    );
    const scrubSignature = poseCreatorScrubVFXSignature(
      clip,
      scrubActiveEvents,
      catalog?.revision ?? null,
    );
    if (runtimeState.lastScrubSignature !== scrubSignature) {
      clearAllPoseCreatorClipPreviewEffects(runtimeState, activeAvatar);
      for (const activeEvent of scrubActiveEvents) {
        applyPoseCreatorClipActiveVFXEvent({
          clip,
          activeEvent,
          runtimeState,
          activeAvatar,
          mode: "scrub",
          catalog,
        });
      }
      runtimeState.lastScrubSignature = scrubSignature;
    }
    syncPoseCreatorClipAvatarVFXIntensities(
      runtimeState,
      activeAvatar,
      clipDraft.currentTimeSec,
    );

    resetEffectPreviewRuntimeState(
      runtimeState,
      false,
      clip.id,
      clipPlaybackAbsoluteTimeSec,
      clipPreviewClearRevision,
      clipPlaybackCompletedRevision,
    );
  }, [
    activeAvatar,
    authoringMode,
    catalog,
    clipDraft,
    clipPlaybackCompletedRevision,
    clipInlineEdit,
    clipPlaybackAbsoluteTimeSec,
    clipPlaybackPlaying,
    clipPreviewClearRevision,
  ]);

  return null;
}

function buildPoseCreatorPreviewClip(
  draft: PoseCreatorClipDraft,
): AnimaPoseClipV2 | null {
  return buildAnimaPoseClipFromPoseCreatorDraft(draft, {
    omittedBasePoseId: POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
  });
}

function createPoseCreatorClipEventDiagnostics(
  draft: PoseCreatorClipDraft,
  activeAvatar: Avatar | null,
  soundController: SoundContextValue | null,
  available: {
    avatarVFXIds: readonly string[];
    sceneBackgroundLayerPresetIds: readonly string[];
    sceneFocusLinePresetIds: readonly string[];
    particleVFXIds: readonly string[];
    sfxCueIds: readonly string[];
  },
): Omit<PoseCreatorClipPreviewDiagnostics, "missingPoseRefs"> {
  const missingAvatarVFXIds = new Set<string>();
  const missingSceneVFXPresetIds = new Set<string>();
  const missingParticleVFXIds = new Set<string>();
  const missingSFXCueIds = new Set<string>();
  const t = getI18n().getFixedT(null, "pose");
  const eventAdapterWarnings = new Set<string>();
  const hasAvatarVFX = draft.events.some(
    (event) => event.kind === "avatar_vfx",
  );
  const hasParticleVFX = draft.events.some(
    (event) => event.kind === "particle_vfx",
  );
  const hasSFX = draft.events.some((event) => event.kind === "sfx");
  const avatarVFXIds = new Set(available.avatarVFXIds);
  const sceneBackgroundIds = new Set(available.sceneBackgroundLayerPresetIds);
  const sceneFocusIds = new Set(available.sceneFocusLinePresetIds);
  const particleVFXIds = new Set(available.particleVFXIds);
  const sfxCueIds = new Set(available.sfxCueIds);

  for (const event of draft.events) {
    if (event.kind === "avatar_vfx" && !avatarVFXIds.has(event.effectId)) {
      missingAvatarVFXIds.add(event.effectId);
    } else if (event.kind === "scene_vfx") {
      const knownPreset =
        event.sceneKind === "background_layers"
          ? sceneBackgroundIds.has(event.presetId)
          : sceneFocusIds.has(event.presetId);
      if (!knownPreset) {
        missingSceneVFXPresetIds.add(event.presetId);
      }
    } else if (
      event.kind === "particle_vfx" &&
      !particleVFXIds.has(event.effectId)
    ) {
      missingParticleVFXIds.add(event.effectId);
    } else if (event.kind === "sfx" && !sfxCueIds.has(event.cueId)) {
      missingSFXCueIds.add(event.cueId);
    }
  }

  if (hasAvatarVFX && !activeAvatar) {
    eventAdapterWarnings.add(t("preview.warnings.avatarVfxNeedsAvatar"));
  }
  if (hasParticleVFX && !activeAvatar) {
    eventAdapterWarnings.add(t("preview.warnings.particleVfxNeedsAvatar"));
  }
  if (hasSFX && !soundController) {
    eventAdapterWarnings.add(t("preview.warnings.sfxNeedsController"));
  }
  if (
    hasSFX &&
    soundController &&
    (soundController.masterMuted ||
      soundController.sfxMuted ||
      soundController.sfxVolume <= 0)
  ) {
    eventAdapterWarnings.add(t("preview.warnings.sfxMuted"));
  }

  return {
    missingAvatarVFXIds: [...missingAvatarVFXIds],
    missingSceneVFXPresetIds: [...missingSceneVFXPresetIds],
    missingParticleVFXIds: [...missingParticleVFXIds],
    missingSFXCueIds: [...missingSFXCueIds],
    eventAdapterWarnings: [...eventAdapterWarnings],
  };
}

function dispatchPoseCreatorClipDueEvents({
  clip,
  fromPlaybackTimeSec,
  toPlaybackTimeSec,
  includeStart,
  runtimeState,
  activeAvatar,
  mode,
  soundController,
  catalog,
}: {
  clip: AnimaPoseClipV2;
  fromPlaybackTimeSec: number;
  toPlaybackTimeSec: number;
  includeStart: boolean;
  runtimeState: EffectPreviewRuntimeState;
  activeAvatar: Avatar;
  mode: PoseCreatorClipPreviewMode;
  soundController: SoundContextValue | null;
  catalog: AnimaRuntimeCatalog | null;
}) {
  const dueEvents = collectAnimaPoseClipEventsBetween(
    clip,
    fromPlaybackTimeSec,
    toPlaybackTimeSec,
    { includeStart },
  );

  for (const dueEvent of dueEvents) {
    dispatchPoseCreatorClipDueEvent({
      clip,
      dueEvent,
      runtimeState,
      activeAvatar,
      mode,
      soundController,
      catalog,
    });
  }
}

function dispatchPoseCreatorClipDueEvent({
  clip,
  dueEvent,
  runtimeState,
  activeAvatar,
  mode,
  soundController,
  catalog,
}: {
  clip: AnimaPoseClipV2;
  dueEvent: AnimaPoseClipDueEvent;
  runtimeState: EffectPreviewRuntimeState;
  activeAvatar: Avatar;
  mode: PoseCreatorClipPreviewMode;
  soundController: SoundContextValue | null;
  catalog: AnimaRuntimeCatalog | null;
}) {
  const event = dueEvent.event;
  const context: AnimaPoseClipEventContext = {
    clipId: clip.id,
    eventId: event.id,
    appliedId: getPoseCreatorClipAppliedId(
      mode,
      clip.id,
      event.id,
      dueEvent.occurrenceIndex,
    ),
    playbackTime: dueEvent.playbackTime,
    clipTime: dueEvent.clipTime,
    occurrenceIndex: dueEvent.occurrenceIndex,
  };

  if (isAnimaPoseClipVFXEvent(event)) {
    applyPoseCreatorClipVFXEvent({
      event,
      context,
      runtimeState,
      activeAvatar,
      mode,
      catalog,
      playApplySound: soundController?.playSfxCue,
    });
    return;
  }

  void soundController?.playSfxCue(event.cueId, {
    ...(event.volume !== undefined ? { volume: event.volume } : {}),
  });
}

function applyPoseCreatorClipActiveVFXAtTime({
  clip,
  playbackTimeSec,
  runtimeState,
  activeAvatar,
  mode,
  catalog,
  excludeEventsStartingAtSample = false,
}: {
  clip: AnimaPoseClipV2;
  playbackTimeSec: number;
  runtimeState: EffectPreviewRuntimeState;
  activeAvatar: Avatar;
  mode: PoseCreatorClipPreviewMode;
  catalog: AnimaRuntimeCatalog | null;
  /** Due-event dispatch owns effects that begin exactly when playback starts. */
  excludeEventsStartingAtSample?: boolean;
}) {
  const activeEvents = excludeEventsStartingAtSample
    ? activeVFXEventsBeforePlaybackStart(clip, playbackTimeSec)
    : sampleAnimaPoseClipActiveEventsAtTime(clip, playbackTimeSec);

  for (const activeEvent of activeEvents) {
    applyPoseCreatorClipActiveVFXEvent({
      clip,
      activeEvent,
      runtimeState,
      activeAvatar,
      mode,
      catalog,
    });
  }
}

function applyPoseCreatorClipActiveVFXEvent({
  clip,
  activeEvent,
  runtimeState,
  activeAvatar,
  mode,
  catalog,
}: {
  clip: AnimaPoseClipV2;
  activeEvent: AnimaPoseClipActiveVFXEvent;
  runtimeState: EffectPreviewRuntimeState;
  activeAvatar: Avatar;
  mode: PoseCreatorClipPreviewMode;
  catalog: AnimaRuntimeCatalog | null;
}) {
  const event = activeEvent.event;
  const context: AnimaPoseClipEventContext = {
    clipId: clip.id,
    eventId: event.id,
    appliedId: getPoseCreatorClipAppliedId(
      mode,
      clip.id,
      event.id,
      activeEvent.occurrenceIndex,
    ),
    playbackTime: activeEvent.playbackStartTime,
    clipTime: event.time,
    occurrenceIndex: activeEvent.occurrenceIndex,
  };
  applyPoseCreatorClipVFXEvent({
    event,
    context,
    runtimeState,
    activeAvatar,
    mode,
    catalog,
  });
}

function applyPoseCreatorClipVFXEvent({
  event,
  context,
  runtimeState,
  activeAvatar,
  mode,
  catalog,
  playApplySound,
}: {
  event: AnimaPoseClipVFXEvent;
  context: AnimaPoseClipEventContext;
  runtimeState: EffectPreviewRuntimeState;
  activeAvatar: Avatar;
  mode: PoseCreatorClipPreviewMode;
  catalog: AnimaRuntimeCatalog | null;
  /** Only due-event dispatch supplies audio; scrub and restored effects stay silent. */
  playApplySound?: SoundContextValue["playSfxCue"];
}) {
  // Retire the preceding loop without reusing its asynchronous ownership ID.
  // Explicit durations keep independent occurrences for authored overlap.
  if (event.duration === undefined) {
    for (const previous of Array.from(runtimeState.activeEffects.values())) {
      if (
        previous.event.duration === undefined &&
        previous.context.clipId === context.clipId &&
        previous.context.eventId === context.eventId
      ) {
        clearPoseCreatorClipPreviewEffect(
          runtimeState,
          activeAvatar,
          previous.context.appliedId,
        );
      }
    }
  }
  clearPoseCreatorClipPreviewEffect(
    runtimeState,
    activeAvatar,
    context.appliedId,
  );

  runtimeState.activeEffects.set(context.appliedId, {
    event,
    context,
    mode,
    clearAtPlaybackTime:
      mode === "playback" && event.duration !== undefined
        ? context.playbackTime + event.duration
        : null,
  });

  if (event.kind === "avatar_vfx") {
    const session = runtimeState.session;
    let soundCueId: string | undefined;
    void (async () => {
      const effect =
        (await catalog?.loadAvatarVFX(event.effectId, event.override)) ?? null;
      soundCueId = effect?.sound?.onApply;
      return applyAvatarVFXEffectById({
        avatar: activeAvatar,
        effectId: event.effectId,
        appliedEffectId: context.appliedId,
        effectEntry: effect,
      });
    })()
      .then(async (didApply) => {
        const currentEffect = runtimeState.activeEffects.get(context.appliedId);
        if (
          runtimeState.session !== session ||
          currentEffect?.context !== context
        ) {
          // A newer scrub state may intentionally reuse this logical id. Its
          // request owns the controller entry, so stale completion must not
          // remove it.
          if (!currentEffect) {
            activeAvatar.vfxController?.removeEffect(context.appliedId);
          }
          return;
        }
        if (!didApply) {
          runtimeState.activeEffects.delete(context.appliedId);
        } else if (event.playAccompanyingSound !== false && soundCueId) {
          await playApplySound?.(soundCueId);
        }
      })
      .catch(() => {
        if (
          runtimeState.session === session &&
          runtimeState.activeEffects.get(context.appliedId)?.context === context
        ) {
          runtimeState.activeEffects.delete(context.appliedId);
        }
      });
    return;
  }

  if (event.kind === "particle_vfx") {
    const session = runtimeState.session;
    const controller = activeAvatar.particleVFXController;
    if (!controller) {
      runtimeState.activeEffects.delete(context.appliedId);
      return;
    }

    void controller
      .playEffect({
        effectId: event.effectId,
        appliedId: context.appliedId,
        ownerId: `poseCreatorClip:${mode}`,
        ...(event.anchor ? { anchor: event.anchor } : {}),
        ...(event.duration !== undefined
          ? { durationSec: event.duration }
          : {}),
        ...(event.transform ? { transform: event.transform } : {}),
        ...(event.followAnchor !== undefined
          ? { followAnchor: event.followAnchor }
          : {}),
      })
      .then((didApply) => {
        const currentEffect = runtimeState.activeEffects.get(context.appliedId);
        if (
          runtimeState.session !== session ||
          currentEffect?.context !== context
        ) {
          if (!currentEffect) controller.clearEffect(context.appliedId);
          return;
        }
        if (!didApply) {
          runtimeState.activeEffects.delete(context.appliedId);
        }
      })
      .catch(() => {
        if (
          runtimeState.session === session &&
          runtimeState.activeEffects.get(context.appliedId)?.context === context
        ) {
          runtimeState.activeEffects.delete(context.appliedId);
        }
      });
    return;
  }

  applyPoseCreatorSceneVFXEvent(
    runtimeState,
    event,
    context,
    catalog,
    playApplySound,
  );
}

function applyPoseCreatorSceneVFXEvent(
  runtimeState: EffectPreviewRuntimeState,
  event: AnimaPoseClipSceneVFXEvent,
  context: AnimaPoseClipEventContext,
  catalog: AnimaRuntimeCatalog | null,
  playApplySound?: SoundContextValue["playSfxCue"],
) {
  const session = runtimeState.session;
  void (async () => {
    const preset =
      (await catalog?.loadSceneVFX(event.sceneKind, event.presetId)) ?? null;
    if (
      runtimeState.session !== session ||
      runtimeState.activeEffects.get(context.appliedId)?.context !== context
    ) {
      return;
    }
    if (!preset) {
      runtimeState.activeEffects.delete(context.appliedId);
      return;
    }
    const sceneState = useSceneVFXStore.getState();
    const activeEntry = sceneState.activeByKind[event.sceneKind] ?? null;
    const existingRecord = runtimeState.sceneRecords.get(event.sceneKind);
    const previousEntry = isPoseCreatorOwnedSceneVFXEntry(
      activeEntry,
      existingRecord?.appliedId ?? "",
    )
      ? (existingRecord?.previousEntry ?? null)
      : activeEntry;
    runtimeState.sceneRecords.set(event.sceneKind, {
      appliedId: context.appliedId,
      previousEntry,
    });
    sceneState.applySceneVFX({
      ...preset,
      id: context.appliedId,
      durationMs: null,
    });
    if (event.playAccompanyingSound !== false && preset.sound?.onApply) {
      await playApplySound?.(preset.sound.onApply);
    }
  })();
}

/**
 * Send each fading Avatar Effect event's envelope to the preview Avatar, as
 * the chat players do, so a paused or playing preview shows the fade. The
 * controller holds a value for an effect that is still loading.
 */
function syncPoseCreatorClipAvatarVFXIntensities(
  runtimeState: EffectPreviewRuntimeState,
  activeAvatar: Avatar,
  playbackTimeSec: number,
) {
  for (const { event, context } of runtimeState.activeEffects.values()) {
    if (event.kind !== "avatar_vfx") continue;
    const intensity = sampleAnimaPoseClipAvatarVFXIntensity(
      event,
      playbackTimeSec - context.playbackTime,
    );
    if (intensity === undefined) continue;
    activeAvatar.vfxController?.setEffectIntensity(
      context.appliedId,
      intensity,
    );
  }
}

function clearExpiredPoseCreatorClipPlaybackEffects(
  runtimeState: EffectPreviewRuntimeState,
  activeAvatar: Avatar,
  playbackTimeSec: number,
) {
  for (const activeEffect of Array.from(runtimeState.activeEffects.values())) {
    if (
      activeEffect.mode === "playback" &&
      activeEffect.clearAtPlaybackTime !== null &&
      activeEffect.clearAtPlaybackTime <= playbackTimeSec
    ) {
      clearPoseCreatorClipPreviewEffect(
        runtimeState,
        activeAvatar,
        activeEffect.context.appliedId,
      );
    }
  }
}

function clearAllPoseCreatorClipPreviewEffects(
  runtimeState: EffectPreviewRuntimeState,
  activeAvatar: Avatar | null,
) {
  runtimeState.session += 1;
  for (const appliedId of Array.from(runtimeState.activeEffects.keys())) {
    clearPoseCreatorClipPreviewEffect(runtimeState, activeAvatar, appliedId);
  }
  runtimeState.activeEffects.clear();
  runtimeState.sceneRecords.clear();
  runtimeState.lastScrubSignature = null;
}

function clearPoseCreatorClipPreviewEffect(
  runtimeState: EffectPreviewRuntimeState,
  activeAvatar: Avatar | null,
  appliedId: string,
) {
  const activeEffect = runtimeState.activeEffects.get(appliedId);
  if (!activeEffect) return;
  runtimeState.activeEffects.delete(appliedId);

  if (activeEffect.event.kind === "avatar_vfx") {
    activeAvatar?.vfxController?.removeEffect(appliedId);
    return;
  }

  if (activeEffect.event.kind === "particle_vfx") {
    activeAvatar?.particleVFXController?.clearEffect(appliedId);
    return;
  }

  clearPoseCreatorSceneVFXEvent(
    runtimeState,
    activeEffect.event,
    activeEffect.context,
  );
}

function clearPoseCreatorSceneVFXEvent(
  runtimeState: EffectPreviewRuntimeState,
  event: AnimaPoseClipSceneVFXEvent,
  context: AnimaPoseClipEventContext,
) {
  const record = runtimeState.sceneRecords.get(event.sceneKind);
  if (!record || record.appliedId !== context.appliedId) return;

  const sceneState = useSceneVFXStore.getState();
  const activeEntry = sceneState.activeByKind[event.sceneKind] ?? null;
  if (isPoseCreatorOwnedSceneVFXEntry(activeEntry, context.appliedId)) {
    const nextActiveByKind = { ...sceneState.activeByKind };
    if (record.previousEntry?.kind === "background_layers") {
      nextActiveByKind.background_layers = record.previousEntry;
    } else if (record.previousEntry?.kind === "focus_lines") {
      nextActiveByKind.focus_lines = record.previousEntry;
    } else {
      delete nextActiveByKind[event.sceneKind];
    }
    sceneState.replaceActiveByKind(nextActiveByKind);
  }

  runtimeState.sceneRecords.delete(event.sceneKind);
}

function isPoseCreatorOwnedSceneVFXEntry(
  runtimeEntry: SceneVFXRuntimeEntry | null | undefined,
  appliedId: string,
): boolean {
  return runtimeEntry?.entry.id === appliedId;
}

function getPoseCreatorClipAppliedId(
  mode: PoseCreatorClipPreviewMode,
  clipId: string,
  eventId: string,
  occurrenceIndex: number,
): string {
  return `poseCreatorClip:${mode}:${clipId}:${eventId}:${occurrenceIndex}`;
}

function resetEffectPreviewRuntimeState(
  runtimeState: EffectPreviewRuntimeState,
  playing: boolean,
  clipId: string | null,
  absoluteTimeSec: number,
  clearRevision: number,
  completedRevision: number,
) {
  runtimeState.lastPlaying = playing;
  runtimeState.lastClipId = clipId;
  runtimeState.lastAbsoluteTimeSec = absoluteTimeSec;
  runtimeState.lastClearRevision = clearRevision;
  runtimeState.lastCompletedRevision = completedRevision;
}
