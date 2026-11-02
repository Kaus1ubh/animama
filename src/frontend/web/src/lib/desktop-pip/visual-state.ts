import type { AvatarPlannerEvent, EmotionalState } from "@/lib/avatar";
import type { VowelVisemeLipSyncSegment } from "@/lib/avatar/vowelVisemeSegment";
import type { RunClockAnchor } from "@/lib/lipsync/planned-segment";
import type { LipSyncEvent } from "@/lib/lipsync/track";
import type { SpeechGestureTimeline } from "@/lib/speech/speech-gesture-timeline";
import type {
  AvatarInteractionPhase,
  VoiceTurnState,
} from "@/lib/types/voice-types";
import { useAvatarRuntimeStore } from "@/stores/avatar-runtime-store";
import { useAvatarLipSyncBridgeStore } from "@/stores/avatar-lipsync-bridge-store";
import type { SceneCameraPreset } from "@/ui/main/canvas/sceneCameraPresets";
import type { AvatarTransform } from "@/ui/main/canvas/transform-state";

export type DesktopPipAvatarRuntimeSnapshot = {
  animaId: string | null;
  activeRunId: string | null;
  activeSpeechRunId: string | null;
  interactionPhase: AvatarInteractionPhase;
  activeVoiceTurn: VoiceTurnState | null;
  pendingNonTtsResponseCompletionRunId: string | null;
  plannerEvents: AvatarPlannerEvent[];
  emotionalState: EmotionalState;
  lastEmotionEventId: string | null;
};

export type DesktopPipStoredLipSyncSegment = VowelVisemeLipSyncSegment & {
  runId: string;
  queuedAtMs: number;
  revision: number;
};

export type DesktopPipSpeechAudioStart = {
  runId: string;
  audioStartSec: number;
  generationId: string | null;
  receivedAtMs: number;
  sourceAudioCurrentTimeSec: number;
  sourceCapturedAtMs: number;
};

export type DesktopPipSpeechAudioDuration = {
  runId: string;
  audioDurationSec: number;
  generationId: string | null;
  receivedAtMs: number;
};

export type DesktopPipLipSyncSnapshot = {
  speechGestureTimelinesByRun: Record<string, SpeechGestureTimeline>;
  /** Tag events, for the brief tag expressions. */
  lipSyncEventsByRun: Record<string, LipSyncEvent[]>;
  playbackAnchorsByRun: Record<string, RunClockAnchor[]>;
  segmentsByRun: Record<string, DesktopPipStoredLipSyncSegment>;
  speechAudioStartsByRun: Record<string, DesktopPipSpeechAudioStart>;
  speechAudioDurationsByRun: Record<string, DesktopPipSpeechAudioDuration>;
};

export type DesktopPipVisualState = {
  kind: "visual-state";
  backgroundMode: DesktopPipBackgroundMode;
  avatarTransform: AvatarTransform;
  /**
   * The PiP camera preset. PiP frames its own Avatar with it: the owner's
   * scene is suspended during PiP, so it cannot measure the Avatar.
   */
  cameraPreset: SceneCameraPreset;
  /**
   * Scene effects are not mirrored: the PiP renderer plays the Avatar's
   * clips, and with them their scene effects, in its own scene VFX store.
   * Replacing that store from the suspended main scene cleared them.
   */
  avatarRuntime: DesktopPipAvatarRuntimeSnapshot;
  lipSync: DesktopPipLipSyncSnapshot;
};

/**
 * PiP's report of the planner events its Avatar consumed. The owner's scene is
 * suspended during PiP, so PiP's Avatar is their only consumer; the owner
 * removes them from its queue so its snapshots stop delivering them again.
 */
export type DesktopPipPlannerEventsConsumed = {
  kind: "planner-events-consumed";
  eventIds: string[];
};

type FakeAudioContext = {
  readonly currentTime: number;
};

/**
 * Events PiP's Avatar consumed while the owner's queue may still hold them:
 * a snapshot sent before the owner hears of the consumption still carries
 * them, and applying it would play a Gesture again.
 */
const consumedPlannerEventIds = new Set<string>();
/** Whether the store change being observed is a snapshot, not PiP's Avatar. */
let isApplyingVisualState = false;

function cloneJsonLike<T>(value: T): T {
  return structuredClone(value);
}

function createFakeAudioContext(
  start: DesktopPipSpeechAudioStart,
): AudioContext {
  const fakeContext: FakeAudioContext = {
    get currentTime() {
      return (
        start.sourceAudioCurrentTimeSec +
        (Date.now() - start.sourceCapturedAtMs) / 1000
      );
    },
  };
  return fakeContext as AudioContext;
}

export function captureDesktopPipAvatarRuntimeSnapshot(): DesktopPipAvatarRuntimeSnapshot {
  const state = useAvatarRuntimeStore.getState();
  return cloneJsonLike({
    animaId: state.animaId,
    activeRunId: state.activeRunId,
    activeSpeechRunId: state.activeSpeechRunId,
    interactionPhase: state.interactionPhase,
    activeVoiceTurn: state.activeVoiceTurn,
    pendingNonTtsResponseCompletionRunId:
      state.pendingNonTtsResponseCompletionRunId,
    plannerEvents: state.plannerEvents,
    emotionalState: state.emotionalState,
    lastEmotionEventId: state.lastEmotionEventId,
  });
}

export function captureDesktopPipLipSyncSnapshot(): DesktopPipLipSyncSnapshot {
  const state = useAvatarLipSyncBridgeStore.getState();
  const sourceCapturedAtMs = Date.now();

  return {
    speechGestureTimelinesByRun: cloneJsonLike(
      state.speechGestureTimelinesByRun,
    ),
    lipSyncEventsByRun: cloneJsonLike(state.lipSyncEventsByRun),
    playbackAnchorsByRun: cloneJsonLike(state.playbackAnchorsByRun),
    segmentsByRun: cloneJsonLike(state.segmentsByRun),
    speechAudioDurationsByRun: cloneJsonLike(state.speechAudioDurationsByRun),
    speechAudioStartsByRun: Object.fromEntries(
      Object.entries(state.speechAudioStartsByRun).map(([runId, start]) => [
        runId,
        {
          runId: start.runId,
          audioStartSec: start.audioStartSec,
          generationId: start.generationId,
          receivedAtMs: start.receivedAtMs,
          sourceAudioCurrentTimeSec: start.audioContext.currentTime,
          sourceCapturedAtMs,
        },
      ]),
    ),
  };
}

export function captureDesktopPipVisualState(args: {
  avatarTransform: AvatarTransform;
  backgroundMode: DesktopPipBackgroundMode;
  cameraPreset: SceneCameraPreset;
}): DesktopPipVisualState {
  return {
    kind: "visual-state",
    backgroundMode: args.backgroundMode,
    avatarTransform: cloneJsonLike(args.avatarTransform),
    cameraPreset: args.cameraPreset,
    avatarRuntime: captureDesktopPipAvatarRuntimeSnapshot(),
    lipSync: captureDesktopPipLipSyncSnapshot(),
  };
}

export function isDesktopPipVisualState(
  value: unknown,
): value is DesktopPipVisualState {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === "visual-state"
  );
}

export function isDesktopPipPlannerEventsConsumed(
  value: unknown,
): value is DesktopPipPlannerEventsConsumed {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const report = value as { kind?: unknown; eventIds?: unknown };
  return (
    report.kind === "planner-events-consumed" &&
    Array.isArray(report.eventIds) &&
    report.eventIds.every((eventId) => typeof eventId === "string")
  );
}

/** Owner side: drop the planner events PiP reports consumed. */
export function applyDesktopPipPlannerEventsConsumed(payload: unknown): void {
  if (!isDesktopPipPlannerEventsConsumed(payload)) return;
  useAvatarRuntimeStore.getState().consumePlannerEvents(payload.eventIds);
}

/**
 * PiP side: report each planner event PiP's own Avatar consumes. Events a
 * snapshot replaces are not reported. Returns the unsubscribe function.
 */
export function watchDesktopPipPlannerEventConsumption(
  onConsumed: (eventIds: string[]) => void,
): () => void {
  return useAvatarRuntimeStore.subscribe((state, previous) => {
    if (
      isApplyingVisualState ||
      state.plannerEvents === previous.plannerEvents
    ) {
      return;
    }
    const remainingIds = new Set(
      state.plannerEvents.map((event) => event.eventId),
    );
    const eventIds = previous.plannerEvents
      .map((event) => event.eventId)
      .filter((eventId) => !remainingIds.has(eventId));
    if (eventIds.length === 0) return;
    for (const eventId of eventIds) consumedPlannerEventIds.add(eventId);
    onConsumed(eventIds);
  });
}

/** The owner's planner events, without those PiP's Avatar already consumed. */
function selectUnconsumedPlannerEvents(
  ownerEvents: readonly AvatarPlannerEvent[],
): AvatarPlannerEvent[] {
  // Event ids are unique, so one the owner no longer holds never returns.
  const ownerEventIds = new Set(ownerEvents.map((event) => event.eventId));
  for (const eventId of consumedPlannerEventIds) {
    if (!ownerEventIds.has(eventId)) consumedPlannerEventIds.delete(eventId);
  }
  return ownerEvents.filter(
    (event) => !consumedPlannerEventIds.has(event.eventId),
  );
}

export function applyDesktopPipVisualState(state: DesktopPipVisualState): void {
  isApplyingVisualState = true;
  try {
    useAvatarRuntimeStore.setState({
      animaId: state.avatarRuntime.animaId,
      activeRunId: state.avatarRuntime.activeRunId,
      activeSpeechRunId: state.avatarRuntime.activeSpeechRunId,
      interactionPhase: state.avatarRuntime.interactionPhase,
      activeVoiceTurn: state.avatarRuntime.activeVoiceTurn,
      pendingNonTtsResponseCompletionRunId:
        state.avatarRuntime.pendingNonTtsResponseCompletionRunId ?? null,
      plannerEvents: selectUnconsumedPlannerEvents(
        state.avatarRuntime.plannerEvents ?? [],
      ),
      emotionalState: state.avatarRuntime.emotionalState,
      lastEmotionEventId: state.avatarRuntime.lastEmotionEventId,
    });
  } finally {
    isApplyingVisualState = false;
  }

  const currentLipSyncState = useAvatarLipSyncBridgeStore.getState();
  const hasLipSyncState =
    Object.keys(state.lipSync.segmentsByRun).length > 0 ||
    Object.keys(state.lipSync.speechAudioStartsByRun).length > 0;

  if (!hasLipSyncState) {
    currentLipSyncState.clearAll({ clearAvatarLipSync: true });
    return;
  }

  useAvatarLipSyncBridgeStore.setState((current) => {
    const nextStartedRuns: Record<string, true> = {};
    for (const runId of Object.keys(state.lipSync.segmentsByRun)) {
      if (current.startedRuns[runId]) {
        nextStartedRuns[runId] = true;
      }
    }

    return {
      speechGestureTimelinesByRun: state.lipSync.speechGestureTimelinesByRun,
      lipSyncEventsByRun: state.lipSync.lipSyncEventsByRun ?? {},
      playbackAnchorsByRun: state.lipSync.playbackAnchorsByRun ?? {},
      segmentsByRun: state.lipSync.segmentsByRun,
      speechAudioStartsByRun: Object.fromEntries(
        Object.entries(state.lipSync.speechAudioStartsByRun).map(
          ([runId, start]) => [
            runId,
            {
              runId: start.runId,
              audioStartSec: start.audioStartSec,
              audioContext: createFakeAudioContext(start),
              generationId: start.generationId,
              receivedAtMs: start.receivedAtMs,
            },
          ],
        ),
      ),
      speechAudioDurationsByRun: state.lipSync.speechAudioDurationsByRun,
      startedRuns: nextStartedRuns,
    };
  });

  // The planner revises a run's segment while it plays; a run already started
  // here takes the revision too.
  const avatar = currentLipSyncState.avatar;
  if (!avatar?.isReady) return;
  for (const [runId, segment] of Object.entries(state.lipSync.segmentsByRun)) {
    const previous = currentLipSyncState.segmentsByRun[runId];
    if (!currentLipSyncState.startedRuns[runId] || !previous) continue;
    if (previous.revision === segment.revision) continue;
    avatar.replaceLipSyncFrames(
      segment.segmentId,
      0,
      segment.frames,
      segment.durationSec,
    );
  }
}
