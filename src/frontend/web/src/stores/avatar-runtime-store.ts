"use client";

import { create } from "zustand";

import type { AvatarPlannerEvent, EmotionalState } from "@/lib/avatar";
import {
  buildEmotionRuntimeState,
  createEmptyEmotionStateMap,
  emotionStateFromValues,
  normalizeEmotionStateMap,
} from "@/lib/emotion";
import { normalizeEmotionReactionIntensity } from "@/lib/avatar/reactionClips";
import type {
  AvatarInteractionPhase,
  VoiceTurnState,
} from "@/lib/types/voice-types";
import { createLogger } from "@/lib/logger";

type AvatarEmotionUpdate = {
  eventId?: string | null;
  runId?: string | null;
  emotions?: unknown;
  emotionalTone?: string | null;
  emotionalIntensity?: number | null;
};

type AvatarGestureRequest = {
  eventId?: string | null;
  runId?: string | null;
  gesture?: string | null;
};

type NonTtsPresentationDrainState = {
  runId: string;
  hasActivePresentationWork: boolean;
};

type StartAvatarRunOptions = {
  inputText?: string | null;
  thinkingPoseDwellMs?: number | null;
};

type AvatarRuntimeStoreState = {
  animaId: string | null;
  activeRunId: string | null;
  activeSpeechRunId: string | null;
  interactionPhase: AvatarInteractionPhase;
  activeVoiceTurn: VoiceTurnState | null;
  pendingNonTtsResponseCompletionRunId: string | null;
  plannerEvents: AvatarPlannerEvent[];
  emotionalState: EmotionalState;
  lastEmotionEventId: string | null;
  resetForAnima: (animaId: string | null) => void;
  setAnimaEmotionSnapshot: (snapshot: unknown) => void;
  setInteractionPhase: (phase: AvatarInteractionPhase) => void;
  beginTypingActivity: () => void;
  endTypingActivity: () => void;
  beginListeningCapture: () => void;
  endListeningCapture: () => void;
  startRun: (runId: string, options?: StartAvatarRunOptions) => void;
  markNonTtsResponseStarted: (runId: string) => void;
  requestNonTtsResponseCompletion: (runId: string) => void;
  completeNonTtsResponseIfPlannerIdle: (
    drainState: NonTtsPresentationDrainState,
  ) => void;
  markSpeechStarted: (runId: string) => void;
  markSpeechEnded: (runId: string) => void;
  finishRun: (runId?: string | null) => void;
  abortRun: (runId?: string | null) => void;
  applyEmotionUpdate: (update: AvatarEmotionUpdate) => void;
  requestGesture: (request: AvatarGestureRequest) => void;
  consumePlannerEvents: (eventIds: readonly string[]) => void;
};

const MAX_PLANNER_EVENT_QUEUE_SIZE = 12;

function createDefaultEmotionalState(): EmotionalState {
  return buildEmotionRuntimeState(createEmptyEmotionStateMap());
}

function normalizeAnimationHint(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutLeadingSlash = trimmed.startsWith("/")
    ? trimmed.slice(1)
    : trimmed;
  const withoutPrefix = withoutLeadingSlash.replace(/^vrm\/animations\//, "");
  return withoutPrefix.endsWith(".vrma")
    ? withoutPrefix.slice(0, -".vrma".length)
    : withoutPrefix;
}

function toEmotionalStateSnapshot(snapshot: unknown): EmotionalState {
  return buildEmotionRuntimeState(normalizeEmotionStateMap(snapshot));
}

function buildGestureRequestId(
  runId: string | null,
  eventId: string | null,
): string {
  const seed =
    eventId ??
    `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return runId ? `${runId}:${seed}` : seed;
}

function buildPlannerEventId(type: string, runId: string | null): string {
  return `${runId ?? "global"}:${type}:${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function enqueuePlannerEvents(
  queue: AvatarPlannerEvent[],
  events: readonly AvatarPlannerEvent[],
): AvatarPlannerEvent[] {
  if (events.length === 0) {
    return queue;
  }
  const next = queue.concat(events);
  if (next.length <= MAX_PLANNER_EVENT_QUEUE_SIZE) {
    return next;
  }
  return next.slice(next.length - MAX_PLANNER_EVENT_QUEUE_SIZE);
}

function canTransitionPhase(
  current: AvatarInteractionPhase,
  next: AvatarInteractionPhase,
): boolean {
  if (current === next) return true;
  switch (current) {
    case "idle":
      return (
        next === "user_typing" || next === "listening" || next === "thinking"
      );
    case "user_typing":
      return (
        next === "idle" ||
        next === "listening" ||
        next === "submitting" ||
        next === "thinking"
      );
    case "listening":
      return (
        next === "idle" ||
        next === "user_speaking" ||
        next === "semantic_check" ||
        next === "submitting" ||
        next === "thinking"
      );
    case "user_speaking":
      return (
        next === "listening" ||
        next === "semantic_check" ||
        next === "submitting" ||
        next === "thinking" ||
        next === "idle"
      );
    case "semantic_check":
      return (
        next === "listening" ||
        next === "submitting" ||
        next === "thinking" ||
        next === "idle"
      );
    case "submitting":
      return next === "thinking" || next === "listening" || next === "idle";
    case "thinking":
      return (
        next === "talking" ||
        next === "responding_no_tts" ||
        next === "idle" ||
        next === "listening"
      );
    case "responding_no_tts":
      return next === "idle" || next === "listening";
    case "talking":
      return next === "idle" || next === "listening";
    default:
      return false;
  }
}

function isListeningPhase(phase: AvatarInteractionPhase): boolean {
  return (
    phase === "listening" ||
    phase === "user_speaking" ||
    phase === "semantic_check"
  );
}

const logger = createLogger("AvatarRuntimeStore");

export const useAvatarRuntimeStore = create<AvatarRuntimeStoreState>((set) => ({
  animaId: null,
  activeRunId: null,
  activeSpeechRunId: null,
  interactionPhase: "idle",
  activeVoiceTurn: null,
  pendingNonTtsResponseCompletionRunId: null,
  plannerEvents: [],
  emotionalState: createDefaultEmotionalState(),
  lastEmotionEventId: null,

  resetForAnima: (animaId) => {
    logger.info("Anima", "Reset runtime store for anima", { animaId });
    set({
      animaId,
      activeRunId: null,
      activeSpeechRunId: null,
      interactionPhase: "idle",
      activeVoiceTurn: null,
      pendingNonTtsResponseCompletionRunId: null,
      plannerEvents: [],
      emotionalState: createDefaultEmotionalState(),
      lastEmotionEventId: null,
    });
  },

  setAnimaEmotionSnapshot: (snapshot) => {
    const emotionalState = toEmotionalStateSnapshot(snapshot);
    logger.info("Emotion", "Applied anima emotion snapshot", {
      dominantEmotion: emotionalState.dominantEmotion,
      dominantGroup: emotionalState.dominantGroup,
      rankedGroups: emotionalState.rankedGroups,
      rankedEmotions: emotionalState.rankedEmotions,
    });
    set({
      emotionalState,
    });
  },

  setInteractionPhase: (phase) =>
    set((state) => {
      if (state.activeRunId || state.activeSpeechRunId) {
        logger.info("Phase", "Skipped manual phase update due to active run", {
          current: state.interactionPhase,
          next: phase,
          activeRunId: state.activeRunId,
          activeSpeechRunId: state.activeSpeechRunId,
        });
        return state;
      }
      if (!canTransitionPhase(state.interactionPhase, phase)) {
        logger.info("Phase", "Rejected illegal interaction phase transition", {
          current: state.interactionPhase,
          next: phase,
        });
        return state;
      }
      logger.info("Phase", "Set interaction phase", {
        current: state.interactionPhase,
        next: phase,
      });
      return { interactionPhase: phase };
    }),

  beginTypingActivity: () =>
    set((state) => {
      if (state.activeRunId || state.activeSpeechRunId) {
        logger.info("Phase", "Skipped beginTypingActivity due to active run", {
          activeRunId: state.activeRunId,
          activeSpeechRunId: state.activeSpeechRunId,
          interactionPhase: state.interactionPhase,
        });
        return state;
      }
      if (state.interactionPhase === "user_typing") {
        return state;
      }
      if (!canTransitionPhase(state.interactionPhase, "user_typing")) {
        logger.info("Phase", "Rejected user_typing transition", {
          current: state.interactionPhase,
        });
        return state;
      }
      logger.info("Phase", "Typing activity started");
      return { interactionPhase: "user_typing" };
    }),

  endTypingActivity: () =>
    set((state) => {
      if (state.interactionPhase !== "user_typing") {
        return state;
      }
      if (!canTransitionPhase(state.interactionPhase, "idle")) {
        logger.info("Phase", "Rejected idle transition after typing", {
          current: state.interactionPhase,
        });
        return state;
      }
      logger.info("Phase", "Typing activity ended");
      return { interactionPhase: "idle" };
    }),

  beginListeningCapture: () =>
    set((state) => {
      if (state.activeRunId || state.activeSpeechRunId) {
        logger.info(
          "Phase",
          "Skipped beginListeningCapture due to active run",
          {
            activeRunId: state.activeRunId,
            activeSpeechRunId: state.activeSpeechRunId,
            interactionPhase: state.interactionPhase,
          },
        );
        return state;
      }
      if (state.interactionPhase === "listening") {
        return state;
      }
      if (!canTransitionPhase(state.interactionPhase, "listening")) {
        logger.info("Phase", "Rejected listening transition", {
          current: state.interactionPhase,
        });
        return state;
      }
      logger.info("Phase", "Listening capture started");
      return { interactionPhase: "listening" };
    }),

  endListeningCapture: () =>
    set((state) => {
      if (state.activeRunId || state.activeSpeechRunId) {
        logger.info("Phase", "Skipped endListeningCapture due to active run", {
          activeRunId: state.activeRunId,
          activeSpeechRunId: state.activeSpeechRunId,
          interactionPhase: state.interactionPhase,
        });
        return state;
      }
      if (!isListeningPhase(state.interactionPhase)) {
        return state;
      }
      if (!canTransitionPhase(state.interactionPhase, "idle")) {
        logger.info("Phase", "Rejected idle transition after listening", {
          current: state.interactionPhase,
        });
        return state;
      }
      logger.info("Phase", "Listening capture ended");
      return { interactionPhase: "idle" };
    }),

  startRun: (runId, options) => {
    if (!runId) {
      logger.warn("Run", "Ignored startRun with empty run id");
      return;
    }
    const createdAtMs = Date.now();
    const inputText = options?.inputText?.trim() ?? "";
    const plannerEvent: AvatarPlannerEvent = {
      type: "runStarted",
      eventId: buildPlannerEventId("runStarted", runId),
      runId,
      inputText,
      createdAtMs,
      ...(options?.thinkingPoseDwellMs !== undefined
        ? { thinkingPoseDwellMs: options.thinkingPoseDwellMs }
        : {}),
    };
    logger.info("Run", "Started avatar run", {
      runId,
      plannerEventId: plannerEvent.eventId,
    });
    set({
      activeRunId: runId,
      activeSpeechRunId: null,
      interactionPhase: "thinking",
      pendingNonTtsResponseCompletionRunId: null,
      plannerEvents: [plannerEvent],
    });
  },

  markNonTtsResponseStarted: (runId) =>
    set((state) => {
      if (!runId) {
        logger.warn(
          "NonTtsResponse",
          "Ignored markNonTtsResponseStarted with empty run id",
        );
        return state;
      }
      if (state.activeRunId && state.activeRunId !== runId) {
        logger.info(
          "NonTtsResponse",
          "Ignored non-TTS response start for inactive run",
          {
            runId,
            activeRunId: state.activeRunId,
          },
        );
        return state;
      }
      if (state.interactionPhase === "responding_no_tts") {
        return state;
      }
      if (!canTransitionPhase(state.interactionPhase, "responding_no_tts")) {
        logger.info("NonTtsResponse", "Rejected responding_no_tts transition", {
          runId,
          current: state.interactionPhase,
        });
        return state;
      }
      logger.info("NonTtsResponse", "Marked non-TTS response started", {
        runId,
      });
      return {
        activeSpeechRunId: null,
        interactionPhase: "responding_no_tts",
      };
    }),

  requestNonTtsResponseCompletion: (runId) =>
    set((state) => {
      if (!runId) {
        logger.warn(
          "NonTtsResponse",
          "Ignored requestNonTtsResponseCompletion with empty run id",
        );
        return state;
      }
      if (state.activeRunId && state.activeRunId !== runId) {
        logger.info(
          "NonTtsResponse",
          "Ignored non-TTS response completion for inactive run",
          {
            runId,
            activeRunId: state.activeRunId,
          },
        );
        return state;
      }
      if (state.pendingNonTtsResponseCompletionRunId === runId) {
        return state;
      }
      logger.info(
        "NonTtsResponse",
        "Requested non-TTS response completion after planner drain",
        {
          runId,
          interactionPhase: state.interactionPhase,
        },
      );
      return {
        pendingNonTtsResponseCompletionRunId: runId,
      };
    }),

  completeNonTtsResponseIfPlannerIdle: ({ runId, hasActivePresentationWork }) =>
    set((state) => {
      if (!runId) return state;
      if (state.pendingNonTtsResponseCompletionRunId !== runId) {
        return state;
      }
      if (state.activeRunId !== runId) {
        logger.info(
          "NonTtsResponse",
          "Cleared stale non-TTS completion request for inactive run",
          {
            runId,
            activeRunId: state.activeRunId,
          },
        );
        return {
          pendingNonTtsResponseCompletionRunId: null,
        };
      }
      if (hasActivePresentationWork) {
        return state;
      }

      logger.info(
        "NonTtsResponse",
        "Finished non-TTS response after planner drained",
        {
          runId,
        },
      );
      return {
        activeRunId: null,
        activeSpeechRunId: null,
        interactionPhase: "idle",
        activeVoiceTurn: null,
        pendingNonTtsResponseCompletionRunId: null,
        plannerEvents: [],
      };
    }),

  markSpeechStarted: (runId) =>
    set((state) => {
      if (!runId) {
        logger.warn("Speech", "Ignored markSpeechStarted with empty run id");
        return state;
      }
      if (state.activeRunId && state.activeRunId !== runId) {
        logger.info("Speech", "Ignored markSpeechStarted for inactive run", {
          runId,
          activeRunId: state.activeRunId,
        });
        return state;
      }
      logger.info("Speech", "Marked speech started for run", { runId });
      if (!canTransitionPhase(state.interactionPhase, "talking")) {
        logger.info("Speech", "Rejected talking transition", {
          runId,
          current: state.interactionPhase,
        });
        return state;
      }
      return {
        activeSpeechRunId: runId,
        interactionPhase: "talking",
        pendingNonTtsResponseCompletionRunId: null,
      };
    }),

  markSpeechEnded: (runId) =>
    set((state) => {
      if (!runId) {
        logger.warn("Speech", "Ignored markSpeechEnded with empty run id");
        return state;
      }
      if (state.activeSpeechRunId !== runId) {
        logger.info(
          "Speech",
          "Ignored markSpeechEnded for inactive speech run",
          {
            runId,
            activeSpeechRunId: state.activeSpeechRunId,
          },
        );
        return state;
      }
      logger.info("Speech", "Marked speech ended for run", { runId });
      if (!canTransitionPhase(state.interactionPhase, "idle")) {
        logger.info("Speech", "Rejected idle transition after speech end", {
          runId,
          current: state.interactionPhase,
        });
        return state;
      }
      return {
        activeSpeechRunId: null,
        interactionPhase: "idle",
      };
    }),

  finishRun: (runId) =>
    set((state) => {
      const targetRunId =
        runId ?? state.activeRunId ?? state.activeSpeechRunId ?? null;

      if (!state.activeRunId) {
        logger.info(
          "Run",
          "finishRun with no active run; clearing run-only transient flags",
          {
            runId: targetRunId,
          },
        );
        return {
          activeSpeechRunId: null,
          interactionPhase: "idle",
          activeVoiceTurn: null,
          pendingNonTtsResponseCompletionRunId: null,
          plannerEvents: [],
        };
      }
      if (runId && runId !== state.activeRunId) {
        logger.info("Run", "Ignored finishRun for non-active run", {
          runId,
          activeRunId: state.activeRunId,
        });
        return state;
      }
      logger.info("Run", "Finished avatar run", {
        runId: runId ?? state.activeRunId,
      });
      return {
        activeRunId: null,
        activeSpeechRunId: null,
        interactionPhase: "idle",
        activeVoiceTurn: null,
        pendingNonTtsResponseCompletionRunId: null,
        plannerEvents: [],
      };
    }),

  abortRun: (runId) =>
    set((state) => {
      if (runId && state.activeRunId && runId !== state.activeRunId) {
        logger.info("Run", "abortRun for non-active run id; clearing anyway", {
          runId,
          activeRunId: state.activeRunId,
          activeSpeechRunId: state.activeSpeechRunId,
        });
      }
      logger.info("Run", "Aborted avatar run and speech state", {
        runId: runId ?? state.activeRunId ?? state.activeSpeechRunId,
      });
      return {
        activeRunId: null,
        activeSpeechRunId: null,
        interactionPhase: "idle",
        activeVoiceTurn: null,
        pendingNonTtsResponseCompletionRunId: null,
        plannerEvents: [],
      };
    }),

  applyEmotionUpdate: (update) =>
    set((state) => {
      const eventId = update.eventId ?? null;
      const runId = update.runId ?? null;
      if (eventId && eventId === state.lastEmotionEventId) {
        logger.info("Emotion", "Ignored duplicate emotion event", {
          eventId,
          runId,
        });
        return state;
      }
      if (!state.activeRunId) {
        logger.info("Emotion", "Ignored emotion update with no active run", {
          eventId,
          runId,
        });
        return state;
      }
      if (!runId || runId !== state.activeRunId) {
        logger.info(
          "Emotion",
          "Ignored stale emotion update for inactive run",
          {
            eventId,
            runId,
            activeRunId: state.activeRunId,
          },
        );
        return state;
      }

      const nextValues = Array.isArray(update.emotions)
        ? emotionStateFromValues(update.emotions)
        : state.emotionalState.values;
      const nextEmotionalState = buildEmotionRuntimeState(nextValues);
      const createdAtMs = Date.now();
      const emotionUpdatedPlannerEvent: AvatarPlannerEvent = {
        type: "emotionUpdated",
        eventId: buildPlannerEventId("emotionUpdated", runId),
        emotionEventId: eventId,
        runId,
        animationHint: null,
        createdAtMs,
      };
      const emotionReactionPlannerEvent: AvatarPlannerEvent = {
        type: "emotionReactionUpdated",
        eventId: buildPlannerEventId("emotionReactionUpdated", runId),
        emotionEventId: eventId,
        runId,
        emotional_tone: update.emotionalTone?.trim() || null,
        emotional_intensity: normalizeEmotionReactionIntensity(
          update.emotionalIntensity,
        ),
        createdAtMs,
      };
      const nextPlannerEvents = enqueuePlannerEvents(state.plannerEvents, [
        emotionUpdatedPlannerEvent,
        emotionReactionPlannerEvent,
      ]);

      logger.info("Emotion", "Applied emotion update", {
        eventId,
        runId,
        activeRunId: state.activeRunId,
        emotionalTone: emotionReactionPlannerEvent.emotional_tone,
        emotionalIntensity: emotionReactionPlannerEvent.emotional_intensity,
        dominantEmotion: nextEmotionalState.dominantEmotion,
        dominantGroup: nextEmotionalState.dominantGroup,
        rankedGroups: nextEmotionalState.rankedGroups,
        rankedEmotions: nextEmotionalState.rankedEmotions,
        plannerEventIds: [
          emotionUpdatedPlannerEvent.eventId,
          emotionReactionPlannerEvent.eventId,
        ],
        plannerEventDepth: nextPlannerEvents.length,
      });

      return {
        emotionalState: nextEmotionalState,
        plannerEvents: nextPlannerEvents,
        lastEmotionEventId: eventId ?? state.lastEmotionEventId,
      };
    }),

  requestGesture: (request) =>
    set((state) => {
      const eventId = request.eventId ?? null;
      const runId = request.runId ?? null;
      const normalizedHint = normalizeAnimationHint(request.gesture ?? null);
      if (!normalizedHint) {
        logger.info("Gesture", "Ignored empty gesture request", {
          eventId,
          runId,
        });
        return state;
      }
      if (!state.activeRunId) {
        logger.info("Gesture", "Ignored gesture request with no active run", {
          eventId,
          runId,
          gesture: normalizedHint,
        });
        return state;
      }
      if (!runId || runId !== state.activeRunId) {
        logger.info("Gesture", "Ignored stale gesture request", {
          eventId,
          runId,
          activeRunId: state.activeRunId,
          gesture: normalizedHint,
        });
        return state;
      }

      const createdAtMs = Date.now();
      const requestId = buildGestureRequestId(runId, eventId);
      const gesturePlannerEvent: AvatarPlannerEvent = {
        type: "gestureRequested",
        eventId: buildPlannerEventId("gestureRequested", runId),
        requestId,
        runId,
        animationHint: normalizedHint,
        sourceEventId: eventId,
        sourceEmotionEventId: null,
        createdAtMs,
      };
      const nextPlannerEvents = enqueuePlannerEvents(state.plannerEvents, [
        gesturePlannerEvent,
      ]);

      logger.info("Gesture", "Queued avatar gesture request", {
        eventId,
        runId,
        requestId,
        gesture: normalizedHint,
        plannerEventId: gesturePlannerEvent.eventId,
        plannerEventDepth: nextPlannerEvents.length,
      });

      return {
        plannerEvents: nextPlannerEvents,
      };
    }),

  consumePlannerEvents: (eventIds) =>
    set((state) => {
      if (eventIds.length === 0 || state.plannerEvents.length === 0) {
        return state;
      }
      const consumedIds = new Set(eventIds);
      const nextEvents = state.plannerEvents.filter(
        (event) => !consumedIds.has(event.eventId),
      );
      if (nextEvents.length === state.plannerEvents.length) {
        return state;
      }
      logger.info("AvatarPlanner", "Consumed avatar planner events", {
        eventIds: [...consumedIds],
        previousDepth: state.plannerEvents.length,
        nextDepth: nextEvents.length,
      });
      return {
        plannerEvents: nextEvents,
      };
    }),
}));
