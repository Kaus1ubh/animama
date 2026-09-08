import type { Avatar } from "@/lib/avatar";
import type { SceneVFXRuntimeEntry } from "@/lib/scene-vfx/types";
import type {
  ContentPreviewKind,
  ContentPreviewLoadStatus,
  ContentPreviewTarget,
} from "./types";

export const PLAYBACK_OBSERVATION_SCHEMA_VERSION = 1 as const;
export const PLAYBACK_OBSERVATION_SAMPLE_INTERVAL_MS = 200;

const MAX_ACTIVE_ITEMS = 16;
const MAX_DIAGNOSTICS = 16;
const MAX_EXPRESSION_ITEMS = 16;
const MAX_LOGICAL_ID_LENGTH = 256;
const REDACTED_LOGICAL_ID = "[redacted]";
// Keep cleared facial channels observable: a sparse clip sample can omit Happy
// after switching to Angry, but omission alone is not proof of a zero weight.
const FACIAL_EXPRESSION_NAMES = [
  "angry",
  "happy",
  "relaxed",
  "sad",
  "surprised",
] as const;

export type PlaybackObservationSurface =
  | "library-dock"
  | "anima-loadout-stage"
  | "creator-stage";

export type PlaybackObservationStatus =
  | "loading"
  | "ready"
  | "playing"
  | "stopped"
  | "unavailable"
  | "error";

export type PlaybackObservationDiagnosticChannel =
  | "avatar"
  | "pose_clip"
  | "reaction_clip"
  | "particle_vfx"
  | "avatar_vfx";

export type PlaybackObservationDiagnostic = {
  channel: PlaybackObservationDiagnosticChannel;
  code: string;
  count?: number;
};

export type PlaybackObservationV1 = {
  version: typeof PLAYBACK_OBSERVATION_SCHEMA_VERSION;
  surface: PlaybackObservationSurface;
  target: {
    kind: ContentPreviewKind;
    runtimeId: string;
    status: PlaybackObservationStatus;
  };
  motion: {
    vrma: Array<{
      runtimeId: string;
      active: boolean;
      playheadSec: number;
      durationSec: number;
      weight: number;
    }>;
    poseClip: {
      runtimeId: string;
      active: boolean;
      playheadSec: number;
      durationSec: number;
      resolvedBoneCount: number;
      missingBoneCount: number;
      firedEventIds: string[];
    } | null;
    reactionClip: {
      runtimeId: string;
      active: boolean;
      phase: string | null;
      playheadSec: number;
      durationSec: number;
      firedEventIds: string[];
    } | null;
  };
  expressions: Record<string, number>;
  effects: {
    particle: Array<{
      runtimeId: string;
      active: true;
      elapsedSec: number;
      owner: string | null;
      anchor: string;
      resolvedAnchor: string;
    }>;
    avatar: Array<{
      runtimeId: string;
      active: true;
      elapsedSec: number | null;
      targetRole: string;
      animationPreset: string | null;
      renderMode: string;
    }>;
    scene: Array<{
      runtimeId: string;
      kind: string;
      active: boolean;
    }>;
  };
  diagnostics: PlaybackObservationDiagnostic[];
};

export type PlaybackObservationRuntimeCapture = {
  avatarReady: boolean;
  vrma: Array<{
    runtimeId: string;
    isCurrent: boolean;
    playheadSec: number;
    durationSec: number;
    weight: number;
  }>;
  poseClip: {
    runtimeId: string | null;
    active: boolean;
    playheadSec: number;
    durationSec: number;
    resolvedBoneCount: number;
    missingBoneCount: number;
    missingExpressionCount: number;
    missingPoseRefCount: number;
    firedEventIds: string[];
    eventCount: number;
    eventDispatchAvailable: boolean;
    skippedEventCount: number;
    eventErrorCount: number;
  };
  reactionClip: {
    runtimeId: string | null;
    active: boolean;
    phase: string | null;
    playheadSec: number;
    durationSec: number;
    firedEventIds: string[];
    eventCount: number;
    eventDispatchAvailable: boolean;
  };
  expressions: Record<string, number>;
  particle: {
    available: boolean;
    warningCount: number;
    hasError: boolean;
    active: Array<{
      runtimeId: string;
      elapsedSec: number;
      owner: string | null;
      anchor: string;
      resolvedAnchor: string;
    }>;
  };
  avatarVFX: {
    available: boolean;
    warningCount: number;
    active: Array<{
      runtimeId: string;
      targetRole: string;
      animationPreset: string | null;
      renderMode: string;
    }>;
  };
};

export type PlaybackObservationPoseClipSample = {
  runtimeId: string;
  active: boolean;
  playheadSec: number;
  durationSec: number;
};

type PlaybackObservationRuntimeProjection = {
  expressionNames?: readonly string[];
  poseClipSample?: PlaybackObservationPoseClipSample;
};

export type PlaybackObservationSamplingEnvironment = {
  isVisible: () => boolean;
  setInterval: (callback: () => void, delayMs: number) => number;
  clearInterval: (intervalId: number) => void;
  subscribeVisibility: (callback: () => void) => () => void;
};

type PlaybackObservationTarget = Pick<
  ContentPreviewTarget,
  "kind" | "runtimeId"
>;

type BuildPlaybackObservationV1Input = {
  surface: PlaybackObservationSurface;
  target: PlaybackObservationTarget;
  status: PlaybackObservationStatus;
  runtime: PlaybackObservationRuntimeCapture;
  sceneVFX: SceneVFXRuntimeEntry | readonly SceneVFXRuntimeEntry[] | null;
  nowMs: number;
};

/** Map product preview state into the stable observation status vocabulary. */
export function resolvePlaybackObservationStatus(input: {
  active: boolean;
  status: ContentPreviewLoadStatus;
  stopped?: boolean;
  unavailable?: boolean;
}): PlaybackObservationStatus {
  if (!input.active || input.stopped) return "stopped";
  if (input.status === "error") return "error";
  if (input.unavailable) return "unavailable";
  return input.status === "idle" ? "stopped" : input.status;
}

/** Temporal sampling is useful only while a mounted preview can still change. */
export function shouldSamplePlaybackObservation(input: {
  active: boolean;
  status: PlaybackObservationStatus;
}): boolean {
  return (
    input.active && (input.status === "loading" || input.status === "playing")
  );
}

/** Read the public Avatar snapshots without retaining controllers or asset data. */
export function capturePlaybackObservationRuntime(
  avatar: Avatar | null,
  projection: PlaybackObservationRuntimeProjection = {},
): PlaybackObservationRuntimeCapture {
  const poseClip = avatar?.getClipSnapshot();
  const reactionClip = avatar?.getReactionClipSnapshot();
  const expressionNames = Array.from(
    new Set([
      ...FACIAL_EXPRESSION_NAMES,
      ...(poseClip?.resolvedExpressions ?? []),
      ...(reactionClip?.expressionKeys ?? []),
      ...(projection.expressionNames ?? []),
    ]),
  )
    .slice(0, MAX_EXPRESSION_ITEMS)
    .sort();
  const particleSnapshot = avatar?.particleVFXController?.getSnapshot() ?? null;
  const avatarVFXSnapshot =
    avatar?.vfxController?.getObservationSnapshot() ?? null;

  return {
    avatarReady: avatar?.isReady === true,
    vrma:
      avatar?.getActiveAnimations().map((animation) => ({
        runtimeId: animation.name,
        isCurrent: animation.isCurrent,
        playheadSec: animation.playheadSec,
        durationSec: animation.durationSec,
        weight: animation.weight,
      })) ?? [],
    poseClip: projection.poseClipSample
      ? {
          ...projection.poseClipSample,
          resolvedBoneCount: 0,
          missingBoneCount: 0,
          missingExpressionCount: 0,
          missingPoseRefCount: 0,
          firedEventIds: [],
          eventCount: 0,
          eventDispatchAvailable: false,
          skippedEventCount: 0,
          eventErrorCount: 0,
        }
      : {
          runtimeId: poseClip?.clipId ?? null,
          active: poseClip?.playing === true,
          playheadSec: poseClip?.elapsedSec ?? 0,
          durationSec: poseClip?.durationSec ?? 0,
          resolvedBoneCount: poseClip?.resolvedBones.length ?? 0,
          missingBoneCount: poseClip?.missingBones.length ?? 0,
          missingExpressionCount: poseClip?.missingExpressions.length ?? 0,
          missingPoseRefCount: poseClip?.missingPoseRefs.length ?? 0,
          firedEventIds: poseClip?.firedEventIds ?? [],
          eventCount: poseClip?.eventCount ?? 0,
          eventDispatchAvailable: poseClip?.eventDispatchAvailable ?? false,
          skippedEventCount: poseClip?.skippedEventCount ?? 0,
          eventErrorCount: poseClip?.eventErrorCount ?? 0,
        },
    reactionClip: {
      runtimeId: reactionClip?.clipId ?? null,
      active: reactionClip?.active === true,
      phase: reactionClip?.phase ?? null,
      playheadSec: reactionClip?.elapsedSec ?? 0,
      durationSec: reactionClip?.timelineDurationSec ?? 0,
      firedEventIds: reactionClip?.firedEventIds ?? [],
      eventCount: reactionClip?.eventCount ?? 0,
      eventDispatchAvailable: reactionClip?.eventDispatchAvailable ?? false,
    },
    expressions: Object.fromEntries(
      expressionNames.map((name) => [
        name,
        avatar?.getExpressionValue(name) ?? 0,
      ]),
    ),
    particle: {
      available: particleSnapshot !== null,
      warningCount: particleSnapshot?.warnings.length ?? 0,
      hasError: Boolean(particleSnapshot?.lastError),
      active:
        particleSnapshot?.activeInstances.map((instance) => ({
          runtimeId: instance.effectId,
          elapsedSec: instance.elapsedSec,
          owner: instance.ownerId,
          anchor: instance.anchor,
          resolvedAnchor: instance.resolvedAnchor,
        })) ?? [],
    },
    avatarVFX: {
      available: avatarVFXSnapshot !== null,
      warningCount: avatarVFXSnapshot?.warningCount ?? 0,
      active:
        avatarVFXSnapshot?.activeEffects.map((effect) => ({
          runtimeId: effect.effectId,
          targetRole: effect.targetRole,
          animationPreset: effect.animationPreset,
          renderMode: effect.renderMode,
        })) ?? [],
    },
  };
}

/** Project one bounded, serializable observation without changing its sources. */
export function buildPlaybackObservationV1({
  surface,
  target,
  status,
  runtime,
  sceneVFX,
  nowMs,
}: BuildPlaybackObservationV1Input): PlaybackObservationV1 {
  const sceneEntries = Array.isArray(sceneVFX)
    ? sceneVFX
    : sceneVFX
      ? [sceneVFX]
      : [];
  const diagnostics: PlaybackObservationDiagnostic[] = [];
  if (!runtime.avatarReady) {
    diagnostics.push({ channel: "avatar", code: "avatar_not_ready" });
  }
  appendCountDiagnostic(
    diagnostics,
    "pose_clip",
    "missing_bones",
    runtime.poseClip.missingBoneCount,
  );
  appendCountDiagnostic(
    diagnostics,
    "pose_clip",
    "missing_expressions",
    runtime.poseClip.missingExpressionCount,
  );
  appendCountDiagnostic(
    diagnostics,
    "pose_clip",
    "missing_pose_refs",
    runtime.poseClip.missingPoseRefCount,
  );
  appendCountDiagnostic(
    diagnostics,
    "pose_clip",
    "skipped_events",
    runtime.poseClip.skippedEventCount,
  );
  appendCountDiagnostic(
    diagnostics,
    "pose_clip",
    "event_errors",
    runtime.poseClip.eventErrorCount,
  );
  if (
    runtime.poseClip.eventCount > 0 &&
    !runtime.poseClip.eventDispatchAvailable
  ) {
    diagnostics.push({
      channel: "pose_clip",
      code: "event_dispatch_unavailable",
    });
  }
  if (
    runtime.reactionClip.eventCount > 0 &&
    !runtime.reactionClip.eventDispatchAvailable
  ) {
    diagnostics.push({
      channel: "reaction_clip",
      code: "event_dispatch_unavailable",
    });
  }
  if (!runtime.particle.available) {
    diagnostics.push({
      channel: "particle_vfx",
      code: "controller_unavailable",
    });
  }
  if (runtime.particle.hasError) {
    diagnostics.push({ channel: "particle_vfx", code: "controller_error" });
  }
  appendCountDiagnostic(
    diagnostics,
    "particle_vfx",
    "controller_warnings",
    runtime.particle.warningCount,
  );
  if (!runtime.avatarVFX.available) {
    diagnostics.push({
      channel: "avatar_vfx",
      code: "controller_unavailable",
    });
  }
  appendCountDiagnostic(
    diagnostics,
    "avatar_vfx",
    "controller_warnings",
    runtime.avatarVFX.warningCount,
  );

  const poseClip = runtime.poseClip.runtimeId
    ? {
        runtimeId: logicalId(runtime.poseClip.runtimeId),
        active: runtime.poseClip.active,
        playheadSec: roundedNonNegative(runtime.poseClip.playheadSec),
        durationSec: roundedNonNegative(runtime.poseClip.durationSec),
        resolvedBoneCount: boundedCount(runtime.poseClip.resolvedBoneCount),
        missingBoneCount: boundedCount(runtime.poseClip.missingBoneCount),
        firedEventIds: boundedLogicalIds(runtime.poseClip.firedEventIds),
      }
    : null;
  const reactionClip = runtime.reactionClip.runtimeId
    ? {
        runtimeId: logicalId(runtime.reactionClip.runtimeId),
        active: runtime.reactionClip.active,
        phase: runtime.reactionClip.phase
          ? logicalId(runtime.reactionClip.phase)
          : null,
        playheadSec: roundedNonNegative(runtime.reactionClip.playheadSec),
        durationSec: roundedNonNegative(runtime.reactionClip.durationSec),
        firedEventIds: boundedLogicalIds(runtime.reactionClip.firedEventIds),
      }
    : null;

  return {
    version: PLAYBACK_OBSERVATION_SCHEMA_VERSION,
    surface,
    target: {
      kind: target.kind,
      runtimeId: logicalId(target.runtimeId),
      status,
    },
    motion: {
      vrma: runtime.vrma
        .slice()
        .filter(
          (animation) => target.kind !== "animation" || animation.isCurrent,
        )
        .sort((left, right) => left.runtimeId.localeCompare(right.runtimeId))
        .slice(0, MAX_ACTIVE_ITEMS)
        .map((animation) => ({
          runtimeId: logicalId(
            target.kind === "animation"
              ? target.runtimeId
              : animation.runtimeId,
          ),
          active: finiteNumber(animation.weight, 0) > 0,
          playheadSec: roundedNonNegative(animation.playheadSec),
          durationSec: roundedNonNegative(animation.durationSec),
          weight: roundedClamped(animation.weight, 0, 1),
        })),
      poseClip,
      reactionClip,
    },
    expressions: Object.fromEntries(
      Object.entries(runtime.expressions)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, MAX_EXPRESSION_ITEMS)
        .map(([name, value]) => [logicalId(name), roundedClamped(value, 0, 1)]),
    ),
    effects: {
      particle: runtime.particle.active
        .slice()
        .sort((left, right) => left.runtimeId.localeCompare(right.runtimeId))
        .slice(0, MAX_ACTIVE_ITEMS)
        .map((effect) => ({
          runtimeId: logicalId(effect.runtimeId),
          active: true as const,
          elapsedSec: roundedNonNegative(effect.elapsedSec),
          owner: effect.owner ? logicalId(effect.owner) : null,
          anchor: logicalId(effect.anchor),
          resolvedAnchor: logicalId(effect.resolvedAnchor),
        })),
      avatar: runtime.avatarVFX.active
        .slice()
        .sort((left, right) => left.runtimeId.localeCompare(right.runtimeId))
        .slice(0, MAX_ACTIVE_ITEMS)
        .map((effect) => ({
          runtimeId: logicalId(effect.runtimeId),
          active: true as const,
          // The existing public Avatar VFX snapshot identifies active effects
          // but does not expose its internal animation clock yet.
          elapsedSec: null,
          targetRole: logicalId(effect.targetRole),
          animationPreset: effect.animationPreset
            ? logicalId(effect.animationPreset)
            : null,
          renderMode: logicalId(effect.renderMode),
        })),
      scene: sceneEntries
        .slice()
        .sort((left, right) => left.kind.localeCompare(right.kind))
        .slice(0, MAX_ACTIVE_ITEMS)
        .map((entry) => ({
          runtimeId: logicalId(entry.runtimeId ?? entry.entry.id),
          kind: logicalId(entry.kind),
          active: entry.expiresAtMs === null || entry.expiresAtMs > nowMs,
        })),
    },
    diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS),
  };
}

/** Serialize with stable insertion order and no replacer-owned side channel. */
export function serializePlaybackObservation(
  observation: PlaybackObservationV1,
): string {
  return JSON.stringify(observation);
}

/** Own the visibility-aware 5 Hz timer used by the read-only output. */
export function startPlaybackObservationSampling(input: {
  enabled: boolean;
  sample: () => void;
  environment: PlaybackObservationSamplingEnvironment;
}): () => void {
  if (!input.enabled) return () => undefined;

  let intervalId: number | null = null;
  const stopInterval = () => {
    if (intervalId === null) return;
    input.environment.clearInterval(intervalId);
    intervalId = null;
  };
  const syncVisibility = () => {
    stopInterval();
    if (!input.environment.isVisible()) return;
    intervalId = input.environment.setInterval(
      input.sample,
      PLAYBACK_OBSERVATION_SAMPLE_INTERVAL_MS,
    );
  };
  const unsubscribeVisibility =
    input.environment.subscribeVisibility(syncVisibility);
  syncVisibility();

  return () => {
    stopInterval();
    unsubscribeVisibility();
  };
}

function appendCountDiagnostic(
  diagnostics: PlaybackObservationDiagnostic[],
  channel: PlaybackObservationDiagnosticChannel,
  code: string,
  count: number,
): void {
  const bounded = boundedCount(count);
  if (bounded <= 0) return;
  diagnostics.push({ channel, code, count: bounded });
}

function boundedCount(value: number): number {
  return Math.max(0, Math.min(999, Math.round(finiteNumber(value, 0))));
}

function boundedLogicalIds(values: readonly string[]): string[] {
  return Array.from(new Set(values.map(logicalId)))
    .sort()
    .slice(0, MAX_ACTIVE_ITEMS);
}

function logicalId(value: string): string {
  const normalized = value.trim().slice(0, MAX_LOGICAL_ID_LENGTH);
  if (
    /^(?:https?:\/\/|blob:|data:|file:)/i.test(normalized) ||
    normalized.startsWith("/") ||
    normalized.startsWith("~/") ||
    /^[a-z]:[\\/]/i.test(normalized) ||
    normalized.includes("\\")
  ) {
    return REDACTED_LOGICAL_ID;
  }
  return normalized;
}

function roundedClamped(value: number, min: number, max: number): number {
  return roundToThree(Math.max(min, Math.min(max, finiteNumber(value, min))));
}

function roundedNonNegative(value: number): number {
  return roundToThree(Math.max(0, finiteNumber(value, 0)));
}

function roundToThree(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
