"use client";

import { create } from "zustand";

import {
  type Avatar,
  type AvatarAnimationState,
  type ProceduralSpeechTimingContext,
} from "@/lib/avatar";
import type { VowelVisemeLipSyncSegment } from "@/lib/avatar/vowelVisemeSegment";
import {
  addLipSyncRunTiming,
  cancelAllLipSyncRuns,
  cancelLipSyncRun,
  connectLipSyncRuns,
  endLipSyncRunAudio,
  setLipSyncRunText,
} from "@/lib/lipsync/lipsync-runs";
import {
  mergePlanFrames,
  phraseChunks,
  plannedGestureTimeline,
  plannedSegment,
  playbackGaps,
  playbackTime,
  runTime,
  tagOverlayWeights,
  type RunClockAnchor,
} from "@/lib/lipsync/planned-segment";
import { LIPSYNC_FPS, type LipSyncEvent } from "@/lib/lipsync/track";
import type { LipSyncWorkerResponse } from "@/lib/lipsync/worker-protocol";
import { createLogger } from "@/lib/logger";
import type { SpeechGestureTimeline } from "@/lib/speech/speech-gesture-timeline";
import { addSpeechPlaybackListener } from "@/lib/speech/speech-pcm-tap";
import type { TimedChar } from "@/lib/speech/provider-speech-timing";
import type { TtsChunkRecord } from "@/lib/speech/tts-chunker";

type SpeechAudioStart = {
  runId: string;
  audioStartSec: number;
  audioContext: AudioContext;
  generationId: string | null;
  receivedAtMs: number;
};

type SpeechAudioDuration = {
  runId: string;
  audioDurationSec: number;
  generationId: string | null;
  receivedAtMs: number;
};

type StoredSegment = VowelVisemeLipSyncSegment & {
  runId: string;
  queuedAtMs: number;
  /** Increases with every revision, so mirrors can tell when to re-apply it. */
  revision: number;
};

type TickGateArgs = {
  avatarState: AvatarAnimationState;
  preferredRunId?: string | null;
};

type ClearOptions = {
  clearAvatarLipSync?: boolean;
};

/**
 * A run's provider character timing on the run clock (seconds from its first
 * audio sample; add the run's `audioStartSec` for the playback clock, which
 * holds until playback starves). The lip-sync planner reads it as evidence.
 */
export type ProviderSpeechTiming = {
  provider: "elevenlabs";
  chars: TimedChar[];
};

/** How a run's lip-sync planning is going. */
export type PlannedLipSyncStats = {
  /** Whether all of the run's text and audio were planned. */
  complete: boolean;
  /**
   * Why the mouth follows the audio alone, if it does: the text has nothing to
   * say, no alignment fits, or the planner failed.
   */
  fallback: "no_text" | "no_alignment" | "planner_failed" | null;
  /** Seconds of the run's audio planned so far. */
  audioSec: number;
  /** Planning CPU per second of audio, in milliseconds. */
  cpuMsPerAudioSec: number | null;
};

type AvatarLipSyncBridgeState = {
  avatar: Avatar | null;
  avatarAnimaId: string | null;
  speechGestureTimelinesByRun: Record<string, SpeechGestureTimeline>;
  speechChunksByRun: Record<string, TtsChunkRecord[]>;
  segmentsByRun: Record<string, StoredSegment>;
  speechAudioStartsByRun: Record<string, SpeechAudioStart>;
  speechAudioDurationsByRun: Record<string, SpeechAudioDuration>;
  providerSpeechTimingByRun: Record<string, ProviderSpeechTiming>;
  /** Each run's complete speech text, for the debug comparison. */
  speechTextByRun: Record<string, string>;
  /** Tag events (laughs, sighs, pauses) on each run's own audio clock. */
  lipSyncEventsByRun: Record<string, LipSyncEvent[]>;
  plannerStatsByRun: Record<string, PlannedLipSyncStats>;
  /** Where each run's playback resumed after an underrun. */
  playbackAnchorsByRun: Record<string, RunClockAnchor[]>;
  startedRuns: Record<string, true>;
  registerAvatarInstance: (args: {
    avatar: Avatar;
    animaId?: string | null;
  }) => void;
  unregisterAvatarInstance: (avatar: Avatar) => void;
  queueTtsChunksForRun: (args: {
    runId: string;
    chunks: readonly TtsChunkRecord[];
  }) => void;
  /** The text a run's voice speaks so far, tags included; `final` once complete. */
  setSpeechText: (args: {
    runId: string;
    text: string;
    final: boolean;
  }) => void;
  markSpeechAudioStarted: (args: {
    runId: string;
    audioStartSec: number;
    audioContext: AudioContext;
    generationId?: string | null;
  }) => void;
  /** All of a run's audio has arrived; its duration is known. */
  markSpeechAudioDurationResolved: (args: {
    runId: string;
    audioDurationSec: number;
    generationId?: string | null;
  }) => void;
  /** Playback of a run resumed after an underrun: run second `runSec` played at `contextSec`. */
  markPlaybackResumed: (args: {
    runId: string;
    runSec: number;
    contextSec: number;
  }) => void;
  /** Append characters the speech runtime timed for a run, in arrival order. */
  appendProviderSpeechTiming: (args: {
    runId: string;
    provider: ProviderSpeechTiming["provider"];
    chars: readonly TimedChar[];
  }) => void;
  /** Apply a lip-sync worker response for a run. */
  applyPlannerResponse: (
    runId: string,
    response: LipSyncWorkerResponse,
  ) => void;
  getSpeechTimingContext: (
    preferredRunId?: string | null,
  ) => ProceduralSpeechTimingContext | null;
  /**
   * Play a debug replay's plan on the avatar against the replay's own audio
   * clock (the debug panel's Lip-sync view). It bypasses the chat-run gate and
   * returns whether an avatar was ready.
   */
  playReplaySegment: (args: {
    segment: VowelVisemeLipSyncSegment;
    audioContext: AudioContext;
    audioStartSec: number;
  }) => boolean;
  /**
   * Clear a debug replay's plan from the avatar, unless a speaking reply has
   * since applied its own plan.
   */
  stopReplaySegment: () => void;
  tickGate: (args: TickGateArgs) => void;
  /** Show the brief expressions of the tags sounding now (laughs, sighs, gasps). */
  tickTagOverlays: (preferredRunId?: string | null) => void;
  clearRun: (runId?: string | null, options?: ClearOptions) => void;
  clearAll: (options?: ClearOptions) => void;
};

const logger = createLogger("AvatarVisemeSync");
const DURATION_DEDUPE_EPS_SEC = 1e-4;
const SPEECH_GESTURE_TIMELINE_DURATION_EPS_SEC = 0.05;
const TAG_OVERLAY_OWNER = "lipsync-tags";
/** Each run's full planned track (60 FPS vowel5), merged from worker updates. */
const plannedTracks = new Map<string, Float32Array>();
/** Whether the tag overlay is currently set, so clearing it is not repeated. */
let tagOverlayShown = false;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidDurationSec(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function applySegmentToAvatarPlayback(args: {
  avatar: Avatar;
  segment: VowelVisemeLipSyncSegment;
  audioStart: SpeechAudioStart;
}): void {
  const { avatar, segment, audioStart } = args;
  avatar.clearLipSync();
  avatar.setAudioContext(audioStart.audioContext);
  avatar.initLipSyncSegment(segment.meta);
  for (const frame of segment.frames) {
    avatar.registerLipSyncFrame(frame);
  }
  avatar.onSegmentAudioStarted(segment.segmentId, audioStart.audioStartSec);
}

/**
 * Whether an update changed only the provider timing, which mirrors of this
 * store (the desktop PiP window) do not copy.
 */
export function isProviderTimingOnlyChange(
  state: AvatarLipSyncBridgeState,
  previous: AvatarLipSyncBridgeState,
): boolean {
  if (state.providerSpeechTimingByRun === previous.providerSpeechTimingByRun)
    return false;
  return (Object.keys(state) as Array<keyof AvatarLipSyncBridgeState>).every(
    (key) =>
      key === "providerSpeechTimingByRun" || state[key] === previous[key],
  );
}

function withoutRun<T>(record: Record<string, T>, runId: string) {
  if (!(runId in record)) return record;
  const next = { ...record };
  delete next[runId];
  return next;
}

const emptyRunState = () => ({
  speechGestureTimelinesByRun: {},
  speechChunksByRun: {},
  segmentsByRun: {},
  speechAudioStartsByRun: {},
  speechAudioDurationsByRun: {},
  providerSpeechTimingByRun: {},
  speechTextByRun: {},
  lipSyncEventsByRun: {},
  plannerStatsByRun: {},
  playbackAnchorsByRun: {},
  startedRuns: {},
});

export const useAvatarLipSyncBridgeStore = create<AvatarLipSyncBridgeState>(
  (set, get) => {
    /** The gaps underruns inserted in a run's playback. */
    const gapsFor = (state: AvatarLipSyncBridgeState, runId: string) => {
      const start = state.speechAudioStartsByRun[runId];
      const anchors = state.playbackAnchorsByRun[runId];
      return start && anchors?.length
        ? playbackGaps(anchors, start.audioStartSec)
        : [];
    };

    /**
     * Rebuild a run's segment (and, with `gestures`, its timeline) from its
     * planned track, and revise the live segment from run time `fromRunSec`
     * on if playback has started.
     */
    const refreshPlannedRun = (
      runId: string,
      fromRunSec: number,
      gestures?: Parameters<typeof plannedGestureTimeline>[0],
    ) => {
      const track = plannedTracks.get(runId);
      if (!track) return;
      const state = get();
      const gaps = gapsFor(state, runId);
      const segment = plannedSegment(runId, track, gaps);
      const previous = state.segmentsByRun[runId];
      const stored: StoredSegment = {
        ...segment,
        runId,
        queuedAtMs: previous?.queuedAtMs ?? Date.now(),
        revision: (previous?.revision ?? 0) + 1,
      };
      const audioSec = Math.max(0, (track.length / 5 - 1) / LIPSYNC_FPS);
      // The timeline spans the words placed ahead of the audio too, so talking
      // hands can use their provisional beats before the audio arrives.
      const timelineSec = gestures
        ? Math.max(
            audioSec,
            ...gestures.words.map((word) => word.endSec),
            ...gestures.phrases.map((phrase) => phrase.endSec),
          )
        : audioSec;
      set((current) => ({
        segmentsByRun: { ...current.segmentsByRun, [runId]: stored },
        ...(gestures
          ? {
              speechGestureTimelinesByRun: {
                ...current.speechGestureTimelinesByRun,
                [runId]: plannedGestureTimeline(gestures, timelineSec, gaps),
              },
            }
          : {}),
      }));
      const avatar = state.avatar;
      if (!state.startedRuns[runId] || !avatar?.isReady) return;
      const fromSec = playbackTime(fromRunSec, gaps);
      avatar.replaceLipSyncFrames(
        segment.segmentId,
        fromSec,
        segment.frames.filter(
          (frame) => (frame.time_sec ?? 0) >= fromSec - 1e-6,
        ),
        segment.durationSec,
      );
    };

    // Plans from the lip-sync worker arrive here, and so do the points where
    // playback resumed after an underrun.
    connectLipSyncRuns({
      onResponse: (runId, response) =>
        get().applyPlannerResponse(runId, response),
    });
    addSpeechPlaybackListener((event) => get().markPlaybackResumed(event));

    return {
      avatar: null,
      avatarAnimaId: null,
      ...emptyRunState(),

      registerAvatarInstance: ({ avatar, animaId }) => {
        if (!avatar) return;
        logger.info("Init", "Registered avatar instance for viseme sync", {
          animaId: animaId ?? null,
        });
        set({
          avatar,
          avatarAnimaId: animaId ?? null,
        });
      },

      unregisterAvatarInstance: (avatar) => {
        const state = get();
        if (state.avatar !== avatar) return;
        logger.info("Cleanup", "Unregistered avatar instance for viseme sync", {
          animaId: state.avatarAnimaId,
        });
        set({
          avatar: null,
          avatarAnimaId: null,
        });
      },

      queueTtsChunksForRun: ({ runId, chunks }) => {
        if (!runId || chunks.length === 0) return;

        set((state) => {
          const existing = state.speechChunksByRun[runId] ?? [];
          const existingIds = new Set(existing.map((chunk) => chunk.chunkId));
          const nextChunks = chunks.filter(
            (chunk) => chunk.runId === runId && !existingIds.has(chunk.chunkId),
          );
          if (nextChunks.length === 0) return state;

          return {
            speechChunksByRun: {
              ...state.speechChunksByRun,
              [runId]: existing.concat(nextChunks),
            },
          };
        });
      },

      setSpeechText: ({ runId, text, final }) => {
        if (!runId) return;
        setLipSyncRunText(runId, text, final);
        if (final) {
          set((state) => ({
            speechTextByRun: { ...state.speechTextByRun, [runId]: text },
          }));
        }
      },

      markSpeechAudioStarted: ({
        runId,
        audioStartSec,
        audioContext,
        generationId,
      }) => {
        if (!runId) return;
        if (!audioContext || !isFiniteNumber(audioStartSec)) {
          logger.warn(
            "Playback",
            "Ignored speech audio start missing timing/context",
            {
              runId,
              hasAudioContext: Boolean(audioContext),
              audioStartSec,
            },
          );
          return;
        }

        logger.info("Playback", "Recorded speech audio start for viseme sync", {
          runId,
          audioStartSec,
          generationId: generationId ?? null,
        });

        set((state) => ({
          speechAudioStartsByRun: {
            ...state.speechAudioStartsByRun,
            [runId]: {
              runId,
              audioStartSec,
              audioContext,
              generationId: generationId ?? null,
              receivedAtMs: Date.now(),
            },
          },
        }));
      },

      markSpeechAudioDurationResolved: ({
        runId,
        audioDurationSec,
        generationId,
      }) => {
        if (!runId || !isValidDurationSec(audioDurationSec)) return;

        const previousDuration = get().speechAudioDurationsByRun[runId];
        if (
          previousDuration &&
          Math.abs(previousDuration.audioDurationSec - audioDurationSec) <=
            DURATION_DEDUPE_EPS_SEC &&
          (previousDuration.generationId ?? null) === (generationId ?? null)
        ) {
          return;
        }

        set((state) => ({
          speechAudioDurationsByRun: {
            ...state.speechAudioDurationsByRun,
            [runId]: {
              runId,
              audioDurationSec,
              generationId: generationId ?? null,
              receivedAtMs: Date.now(),
            },
          },
        }));
        endLipSyncRunAudio(runId);
      },

      markPlaybackResumed: ({ runId, runSec, contextSec }) => {
        if (!runId || !isFiniteNumber(runSec) || !isFiniteNumber(contextSec))
          return;
        set((state) => ({
          playbackAnchorsByRun: {
            ...state.playbackAnchorsByRun,
            [runId]: [
              ...(state.playbackAnchorsByRun[runId] ?? []),
              { runSec, contextSec },
            ],
          },
        }));
        logger.info("Playback", "Shifted a run's lip-sync past an underrun", {
          runId,
          runSec,
          contextSec,
        });
        // What follows the gap now plays later.
        refreshPlannedRun(runId, runSec);
      },

      appendProviderSpeechTiming: ({ runId, provider, chars }) => {
        if (!runId || chars.length === 0) return;
        set((state) => ({
          providerSpeechTimingByRun: {
            ...state.providerSpeechTimingByRun,
            [runId]: {
              provider,
              chars: (
                state.providerSpeechTimingByRun[runId]?.chars ?? []
              ).concat(chars),
            },
          },
        }));
        addLipSyncRunTiming(runId, chars);
      },

      applyPlannerResponse: (runId, response) => {
        if (response.type === "error") {
          set((state) => ({
            plannerStatsByRun: {
              ...state.plannerStatsByRun,
              [runId]: {
                complete: false,
                fallback: "planner_failed",
                audioSec: state.plannerStatsByRun[runId]?.audioSec ?? 0,
                cpuMsPerAudioSec: null,
              },
            },
          }));
          return;
        }
        plannedTracks.set(
          runId,
          mergePlanFrames(plannedTracks.get(runId) ?? null, response),
        );
        const previous = get().plannerStatsByRun[runId];
        set((state) => ({
          lipSyncEventsByRun: {
            ...state.lipSyncEventsByRun,
            [runId]: response.events,
          },
          plannerStatsByRun: {
            ...state.plannerStatsByRun,
            [runId]: {
              complete: response.complete,
              fallback: response.fallback,
              audioSec: response.audioSec,
              cpuMsPerAudioSec:
                response.audioSec > 0
                  ? response.cpuMs / response.audioSec
                  : null,
            },
          },
        }));
        // A planner failure is worth one log line per run.
        if (response.error) {
          logger.error(
            "Plan",
            "Lip-sync planning failed; the mouth follows the audio",
            { runId, message: response.error },
          );
        } else if (
          response.fallback === "no_alignment" &&
          previous?.fallback !== "no_alignment"
        ) {
          logger.warn("Plan", "Lip-sync text did not fit a run's audio", {
            runId,
            audioSec: response.audioSec,
          });
        }
        refreshPlannedRun(
          runId,
          response.fromFrame / LIPSYNC_FPS,
          response.gestures,
        );
      },

      playReplaySegment: ({ segment, audioContext, audioStartSec }) => {
        const avatar = get().avatar;
        if (!avatar?.isReady) return false;
        applySegmentToAvatarPlayback({
          avatar,
          segment,
          audioStart: {
            runId: segment.meta.run_id ?? segment.segmentId,
            audioStartSec,
            audioContext,
            generationId: null,
            receivedAtMs: Date.now(),
          },
        });
        return true;
      },

      stopReplaySegment: () => {
        const state = get();
        // A reply without its own plan would otherwise keep the replay's last
        // pose on a stopped clock.
        if (
          Object.keys(state.speechAudioStartsByRun).some(
            (runId) => state.startedRuns[runId],
          )
        )
          return;
        state.avatar?.clearLipSync();
      },

      getSpeechTimingContext: (preferredRunId) => {
        const state = get();
        const startsByRun = state.speechAudioStartsByRun;
        const selectedRunId =
          preferredRunId && startsByRun[preferredRunId]
            ? preferredRunId
            : (Object.keys(startsByRun).sort((left, right) => {
                const leftReceivedAt = startsByRun[left]?.receivedAtMs ?? 0;
                const rightReceivedAt = startsByRun[right]?.receivedAtMs ?? 0;
                return rightReceivedAt - leftReceivedAt;
              })[0] ?? null);
        if (!selectedRunId) return null;

        const audioStart = startsByRun[selectedRunId];
        if (!audioStart) return null;

        const elapsedSec =
          audioStart.audioContext.currentTime - audioStart.audioStartSec;
        if (!isFiniteNumber(elapsedSec)) return null;

        const nonNegativeElapsedSec = Math.max(0, elapsedSec);
        const durationSec =
          state.speechAudioDurationsByRun[selectedRunId]?.audioDurationSec ??
          null;
        const gestureTimeline =
          state.speechGestureTimelinesByRun[selectedRunId] ?? null;
        // The planner's timeline grows with the audio and brings its phrases,
        // which stand in for the chunks gestures are scheduled by.
        const phrases = gestureTimeline?.phrases ?? null;
        const ttsChunks = phrases
          ? phraseChunks(selectedRunId, phrases)
          : (state.speechChunksByRun[selectedRunId] ?? []);
        if (isValidDurationSec(durationSec)) {
          const matchingGestureTimeline =
            gestureTimeline &&
            (phrases ||
              Math.abs(gestureTimeline.utteranceDurationSec - durationSec) <=
                SPEECH_GESTURE_TIMELINE_DURATION_EPS_SEC)
              ? gestureTimeline
              : null;
          return {
            runId: selectedRunId,
            elapsedSec: nonNegativeElapsedSec,
            utteranceDurationSec: durationSec,
            durationSec,
            remainingSec: Math.max(0, durationSec - nonNegativeElapsedSec),
            durationKnown: true,
            gestureTimeline: matchingGestureTimeline,
            ttsChunks,
          };
        }

        const provisionalDurationSec =
          gestureTimeline &&
          isValidDurationSec(gestureTimeline.utteranceDurationSec)
            ? gestureTimeline.utteranceDurationSec
            : null;

        return {
          runId: selectedRunId,
          elapsedSec: nonNegativeElapsedSec,
          utteranceDurationSec: provisionalDurationSec,
          durationSec: provisionalDurationSec,
          remainingSec:
            provisionalDurationSec != null
              ? Math.max(0, provisionalDurationSec - nonNegativeElapsedSec)
              : null,
          durationKnown: false,
          gestureTimeline,
          ttsChunks,
        };
      },

      tickGate: ({ avatarState, preferredRunId }) => {
        if (avatarState !== "talking") return;

        const state = get();
        const avatar = state.avatar;
        if (!avatar?.isReady) return;

        const candidateRunIds = Object.keys(state.segmentsByRun).filter(
          (runId) => {
            if (state.startedRuns[runId]) return false;
            return Boolean(state.speechAudioStartsByRun[runId]);
          },
        );
        if (candidateRunIds.length === 0) return;

        let selectedRunId: string | null = null;
        if (preferredRunId && candidateRunIds.includes(preferredRunId)) {
          selectedRunId = preferredRunId;
        } else {
          selectedRunId =
            candidateRunIds.sort((a, b) => {
              const aQueued = state.segmentsByRun[a]?.queuedAtMs ?? 0;
              const bQueued = state.segmentsByRun[b]?.queuedAtMs ?? 0;
              return aQueued - bQueued;
            })[0] ?? null;
        }
        if (!selectedRunId) return;

        const segment = state.segmentsByRun[selectedRunId];
        const audioStart = state.speechAudioStartsByRun[selectedRunId];
        if (!segment || !audioStart) return;

        try {
          applySegmentToAvatarPlayback({
            avatar,
            segment,
            audioStart,
          });
        } catch (error) {
          logger.warn(
            "Playback",
            "Failed to start expression blendshape playback",
            {
              runId: selectedRunId,
              segmentId: segment.segmentId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
          // Drop the run's plan; it is not retried.
          get().clearRun(selectedRunId);
          set((current) => ({
            startedRuns: { ...current.startedRuns, [selectedRunId!]: true },
          }));
          return;
        }

        logger.info("Playback", "Expression blendshape started", {
          runId: selectedRunId,
          segmentId: segment.segmentId,
          audioStartSec: audioStart.audioStartSec,
          avatarState,
          frameCount: segment.frameCount,
          durationMs: segment.durationMs,
        });

        set((current) => ({
          startedRuns: {
            ...current.startedRuns,
            [selectedRunId!]: true,
          },
        }));
      },

      tickTagOverlays: (preferredRunId) => {
        const state = get();
        const controller = state.avatar?.expressionController;
        if (!controller) return;
        const runId =
          preferredRunId && state.startedRuns[preferredRunId]
            ? preferredRunId
            : (Object.keys(state.startedRuns).find(
                (candidate) => state.lipSyncEventsByRun[candidate]?.length,
              ) ?? null);
        const events = runId ? state.lipSyncEventsByRun[runId] : null;
        const start = runId ? state.speechAudioStartsByRun[runId] : null;
        const weights =
          events?.length && start
            ? tagOverlayWeights(
                events,
                runTime(
                  start.audioContext.currentTime - start.audioStartSec,
                  gapsFor(state, runId!),
                ),
              )
            : {};
        if (Object.keys(weights).length) {
          controller.setExpressionOverlay(TAG_OVERLAY_OWNER, weights);
          tagOverlayShown = true;
        } else if (tagOverlayShown) {
          controller.clearExpressionOverlay(TAG_OVERLAY_OWNER);
          tagOverlayShown = false;
        }
      },

      clearRun: (runId, options) => {
        if (!runId) {
          get().clearAll(options);
          return;
        }
        const state = get();
        if (options?.clearAvatarLipSync === true) {
          state.avatar?.clearLipSync();
        }
        cancelLipSyncRun(runId);
        plannedTracks.delete(runId);
        if (tagOverlayShown) {
          state.avatar?.expressionController?.clearExpressionOverlay(
            TAG_OVERLAY_OWNER,
          );
          tagOverlayShown = false;
        }
        set((current) => ({
          speechGestureTimelinesByRun: withoutRun(
            current.speechGestureTimelinesByRun,
            runId,
          ),
          speechChunksByRun: withoutRun(current.speechChunksByRun, runId),
          segmentsByRun: withoutRun(current.segmentsByRun, runId),
          speechAudioStartsByRun: withoutRun(
            current.speechAudioStartsByRun,
            runId,
          ),
          speechAudioDurationsByRun: withoutRun(
            current.speechAudioDurationsByRun,
            runId,
          ),
          providerSpeechTimingByRun: withoutRun(
            current.providerSpeechTimingByRun,
            runId,
          ),
          speechTextByRun: withoutRun(current.speechTextByRun, runId),
          lipSyncEventsByRun: withoutRun(current.lipSyncEventsByRun, runId),
          plannerStatsByRun: withoutRun(current.plannerStatsByRun, runId),
          playbackAnchorsByRun: withoutRun(current.playbackAnchorsByRun, runId),
          startedRuns: withoutRun(current.startedRuns, runId),
        }));
        logger.info("Cleanup", "Cleared viseme bridge run state", {
          runId,
          clearAvatarLipSync: options?.clearAvatarLipSync === true,
        });
      },

      clearAll: (options) => {
        const state = get();
        if (options?.clearAvatarLipSync === true) {
          state.avatar?.clearLipSync();
        }
        cancelAllLipSyncRuns();
        plannedTracks.clear();
        if (tagOverlayShown) {
          state.avatar?.expressionController?.clearExpressionOverlay(
            TAG_OVERLAY_OWNER,
          );
          tagOverlayShown = false;
        }
        set(emptyRunState());
        logger.info("Cleanup", "Cleared all viseme bridge state", {
          clearAvatarLipSync: options?.clearAvatarLipSync === true,
        });
      },
    };
  },
);
