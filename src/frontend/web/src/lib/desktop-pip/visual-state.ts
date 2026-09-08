import type { AvatarPlannerEvent, EmotionalState } from "@/lib/avatar";
import type { GruutVisemeKeyframePlanSummary } from "@/lib/avatar/viseme-worker-protocol";
import type { VowelVisemeLipSyncSegment } from "@/lib/avatar/vowelVisemeSegment";
import type { SpeechGestureTimeline } from "@/lib/speech/gruut-viseme-keyframes";
import type {
  AvatarInteractionPhase,
  VoiceTurnState,
} from "@/lib/types/voice-types";
import {
  useAvatarRuntimeStore,
  type RuntimeAvatarVFXEntry,
} from "@/stores/avatar-runtime-store";
import { useAvatarLipSyncBridgeStore } from "@/stores/avatar-lipsync-bridge-store";
import {
  useSceneVFXStore,
  type SceneVFXActiveByKind,
} from "@/stores/scene-vfx-store";
import type { SceneCameraSettings } from "@/ui/main/canvas/sceneCameraPresets";
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
  runtimeVfx: RuntimeAvatarVFXEntry[];
  lastEmotionEventId: string | null;
  lastCompletedTurnRunId: string | null;
  nextRuntimeVfxOrder: number;
};

export type DesktopPipStoredLipSyncSegment = VowelVisemeLipSyncSegment & {
  runId: string;
  queuedAtMs: number;
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
  sourcePlansByRun: Record<string, GruutVisemeKeyframePlanSummary>;
  speechGestureTimelinesByRun: Record<string, SpeechGestureTimeline>;
  segmentsByRun: Record<string, DesktopPipStoredLipSyncSegment>;
  speechAudioStartsByRun: Record<string, DesktopPipSpeechAudioStart>;
  speechAudioDurationsByRun: Record<string, DesktopPipSpeechAudioDuration>;
};

export type DesktopPipVisualState = {
  kind: "visual-state";
  backgroundMode: DesktopPipBackgroundMode;
  avatarTransform: AvatarTransform;
  sceneCameraSettings: SceneCameraSettings;
  avatarRuntime: DesktopPipAvatarRuntimeSnapshot;
  sceneVfx: SceneVFXActiveByKind;
  lipSync: DesktopPipLipSyncSnapshot;
};

type FakeAudioContext = {
  readonly currentTime: number;
};

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
    runtimeVfx: state.runtimeVfx,
    lastEmotionEventId: state.lastEmotionEventId,
    lastCompletedTurnRunId: state.lastCompletedTurnRunId,
    nextRuntimeVfxOrder: state.nextRuntimeVfxOrder,
  });
}

export function captureDesktopPipLipSyncSnapshot(): DesktopPipLipSyncSnapshot {
  const state = useAvatarLipSyncBridgeStore.getState();
  const sourceCapturedAtMs = Date.now();

  return {
    sourcePlansByRun: cloneJsonLike(state.sourcePlansByRun),
    speechGestureTimelinesByRun: cloneJsonLike(
      state.speechGestureTimelinesByRun,
    ),
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
  sceneCameraSettings: SceneCameraSettings;
}): DesktopPipVisualState {
  return {
    kind: "visual-state",
    backgroundMode: args.backgroundMode,
    avatarTransform: cloneJsonLike(args.avatarTransform),
    sceneCameraSettings: cloneJsonLike(args.sceneCameraSettings),
    avatarRuntime: captureDesktopPipAvatarRuntimeSnapshot(),
    sceneVfx: cloneJsonLike(useSceneVFXStore.getState().activeByKind),
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

export function applyDesktopPipVisualState(state: DesktopPipVisualState): void {
  useAvatarRuntimeStore.setState({
    animaId: state.avatarRuntime.animaId,
    activeRunId: state.avatarRuntime.activeRunId,
    activeSpeechRunId: state.avatarRuntime.activeSpeechRunId,
    interactionPhase: state.avatarRuntime.interactionPhase,
    activeVoiceTurn: state.avatarRuntime.activeVoiceTurn,
    pendingNonTtsResponseCompletionRunId:
      state.avatarRuntime.pendingNonTtsResponseCompletionRunId ?? null,
    plannerEvents: state.avatarRuntime.plannerEvents ?? [],
    emotionalState: state.avatarRuntime.emotionalState,
    runtimeVfx: state.avatarRuntime.runtimeVfx,
    lastEmotionEventId: state.avatarRuntime.lastEmotionEventId,
    lastCompletedTurnRunId: state.avatarRuntime.lastCompletedTurnRunId,
    nextRuntimeVfxOrder: state.avatarRuntime.nextRuntimeVfxOrder,
  });

  useSceneVFXStore.getState().replaceActiveByKind(state.sceneVfx);

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
      sourcePlansByRun: state.lipSync.sourcePlansByRun,
      speechGestureTimelinesByRun: state.lipSync.speechGestureTimelinesByRun,
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
}
