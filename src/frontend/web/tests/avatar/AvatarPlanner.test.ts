import { describe, expect, it } from "vitest";
import {
  buildEmotionRuntimeState,
  createEmptyEmotionStateMap,
} from "@/lib/emotion";
import {
  createInitialAvatarPlannerState,
  hasBlockingNonTtsPresentationWork,
  NON_TTS_REACTION_CLIP_VISIBLE_DURATION_MS,
  planAvatar,
  type AvatarPlannerAction,
  type AvatarPlannerEmotionReactionEvent,
  type AvatarPlannerInput,
} from "@/lib/avatar/planner/AvatarPlanner";

type PlannerActionOf<Type extends AvatarPlannerAction["type"]> = Extract<
  AvatarPlannerAction,
  { type: Type }
>;

function createEmotionalState(values: Partial<Record<string, number>> = {}) {
  const state = createEmptyEmotionStateMap();
  const entries =
    Object.keys(values).length > 0 ? values : ({ joy: 18 } as const);
  for (const [emotion, value] of Object.entries(entries)) {
    if (emotion in state) {
      state[emotion as keyof typeof state] = value;
    }
  }
  return buildEmotionRuntimeState(state);
}

function createPlannerInput(
  overrides: Partial<AvatarPlannerInput> = {},
): AvatarPlannerInput {
  return {
    nowMs: 1_000,
    animaId: "anima:test",
    activeRunId: "run-1",
    interactionPhase: "talking",
    avatarState: "talking",
    emotionalState: createEmotionalState(),
    activeVrmaActions: [],
    activePlannerPoseClip: null,
    manualPoseClipActive: false,
    activePlannerProceduralLayerIds: [],
    manualProceduralLayerIds: [],
    eligiblePlannerProceduralLayerIds: [],
    pendingEvents: [],
    randomRolls: [0, 0, 0, 0],
    ...overrides,
  };
}

function createReactionEvent(
  overrides: Partial<AvatarPlannerEmotionReactionEvent> = {},
): AvatarPlannerEmotionReactionEvent {
  return {
    type: "emotionReactionUpdated",
    eventId: "planner-reaction-1",
    emotionEventId: "emotion-sse-1",
    runId: "run-1",
    emotional_tone: "joy",
    emotional_intensity: 2,
    createdAtMs: 1_000,
    ...overrides,
  };
}

function findAction<Type extends AvatarPlannerAction["type"]>(
  actions: readonly AvatarPlannerAction[],
  type: Type,
): PlannerActionOf<Type> | null {
  return (
    actions.find(
      (action): action is PlannerActionOf<Type> => action.type === type,
    ) ?? null
  );
}

describe("AvatarPlanner reaction clips", () => {
  it("keeps emotion reactions pending until the run starts talking", () => {
    const event = createReactionEvent();

    const thinkingOutput = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        interactionPhase: "thinking",
        avatarState: "thinking",
        pendingEvents: [event],
      }),
    );

    expect(findAction(thinkingOutput.actions, "playReactionClip")).toBe(null);
    expect(thinkingOutput.consumedPlannerEventIds).toEqual([]);
    expect(thinkingOutput.state.pendingReactionClipEvents).toEqual([event]);
    expect(thinkingOutput.debug.activeReactionClip).toBeNull();
    expect(thinkingOutput.debug.pendingReactionClipEvents).toEqual([event]);
    expect(thinkingOutput.debug.pendingReactionClipEventCount).toBe(1);

    const talkingOutput = planAvatar(
      thinkingOutput.state,
      createPlannerInput({
        nowMs: 1_250,
        pendingEvents: [],
      }),
    );

    const action = findAction(talkingOutput.actions, "playReactionClip");
    expect(action).toMatchObject({
      lane: "reactionClip",
      runId: "run-1",
      emotionEventId: "emotion-sse-1",
      emotionalTone: "joy",
      emotionalIntensity: 2,
      clipId: "joy-2",
    });
    expect(talkingOutput.consumedPlannerEventIds).toEqual([event.eventId]);
    expect(talkingOutput.state.pendingReactionClipEvents).toEqual([]);
    expect(talkingOutput.debug.activeReactionClip).toMatchObject({
      clipId: "joy-2",
      ownerId: "emotionReaction:run-1:planner-reaction-1",
    });
    expect(talkingOutput.debug.pendingReactionClipEvents).toEqual([]);
    expect(talkingOutput.debug.pendingReactionClipEventCount).toBe(0);
    expect(talkingOutput.debug.lastReactionClipEventKey).toBe(
      "run-1:emotion-sse-1",
    );
    expect(talkingOutput.debug.actionTypes).toContain("playReactionClip");
    expect(talkingOutput.debug.consumedPlannerEventIds).toEqual([
      event.eventId,
    ]);
  });

  it("consumes stale reaction events without emitting an action", () => {
    const event = createReactionEvent({ runId: "old-run" });

    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        pendingEvents: [event],
      }),
    );

    expect(findAction(output.actions, "playReactionClip")).toBe(null);
    expect(output.consumedPlannerEventIds).toEqual([event.eventId]);
    expect(output.state.pendingReactionClipEvents).toEqual([]);
  });

  it("consumes neutral and zero-intensity reactions without emitting actions", () => {
    const neutralEvent = createReactionEvent({
      eventId: "planner-reaction-neutral",
      emotional_tone: "neutral",
      emotional_intensity: 3,
    });
    const zeroIntensityEvent = createReactionEvent({
      eventId: "planner-reaction-zero",
      emotional_tone: "joy",
      emotional_intensity: 0,
    });

    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        pendingEvents: [neutralEvent, zeroIntensityEvent],
      }),
    );

    expect(findAction(output.actions, "playReactionClip")).toBe(null);
    expect(output.consumedPlannerEventIds).toEqual([
      neutralEvent.eventId,
      zeroIntensityEvent.eventId,
    ]);
    expect(output.state.pendingReactionClipEvents).toEqual([]);
  });

  it("maps exact canonical reaction tones to matching reaction clips", () => {
    const event = createReactionEvent({
      emotional_tone: "curiosity",
      emotional_intensity: 1,
    });

    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        pendingEvents: [event],
      }),
    );

    const action = findAction(output.actions, "playReactionClip");
    expect(action?.clipId).toBe("curiosity-1");
    expect(output.consumedPlannerEventIds).toEqual([event.eventId]);
  });

  it("plays talking-scoped reaction clips during non-TTS response presentation", () => {
    const event = createReactionEvent({
      emotional_tone: "joy",
      emotional_intensity: 2,
    });

    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        interactionPhase: "responding_no_tts",
        avatarState: "talking",
        pendingEvents: [event],
      }),
    );

    const action = findAction(output.actions, "playReactionClip");
    expect(action).toMatchObject({
      runId: "run-1",
      emotionalTone: "joy",
      emotionalIntensity: 2,
      clipId: "joy-2",
    });
    expect(output.state.activeReactionClip).toMatchObject({
      runId: "run-1",
      clipId: "joy-2",
    });
    expect(output.consumedPlannerEventIds).toEqual([event.eventId]);
  });

  it("caps reaction clip visibility during non-TTS response presentation", () => {
    const event = createReactionEvent({
      emotional_tone: "joy",
      emotional_intensity: 2,
    });
    const startedAtMs = 1_000;

    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        nowMs: startedAtMs,
        interactionPhase: "responding_no_tts",
        avatarState: "talking",
        pendingEvents: [event],
      }),
    );

    expect(output.state.activeReactionClip).toMatchObject({
      runId: "run-1",
      clipId: "joy-2",
      startedAtMs,
    });
    const beforeCap = planAvatar(
      output.state,
      createPlannerInput({
        nowMs: startedAtMs + NON_TTS_REACTION_CLIP_VISIBLE_DURATION_MS - 1,
        interactionPhase: "responding_no_tts",
        avatarState: "talking",
      }),
    );
    expect(beforeCap.state.activeReactionClip).toMatchObject({
      runId: "run-1",
      clipId: "joy-2",
      startedAtMs,
    });
    expect(findAction(beforeCap.actions, "clearReactionClip")).toBe(null);
    expect(hasBlockingNonTtsPresentationWork(beforeCap, "run-1")).toBe(true);

    const capped = planAvatar(
      beforeCap.state,
      createPlannerInput({
        nowMs: startedAtMs + NON_TTS_REACTION_CLIP_VISIBLE_DURATION_MS,
        interactionPhase: "responding_no_tts",
        avatarState: "talking",
      }),
    );
    expect(capped.state.activeReactionClip).toBe(null);
    expect(findAction(capped.actions, "clearReactionClip")).toMatchObject({
      runId: "run-1",
      reason: "nonTtsReactionDurationElapsed",
    });
    expect(hasBlockingNonTtsPresentationWork(capped, "run-1")).toBe(false);
  });

  it("consumes emotion group reaction events without fallback clips", () => {
    const event = createReactionEvent({
      emotional_tone: "alarm",
      emotional_intensity: 1,
    });

    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        pendingEvents: [event],
      }),
    );

    expect(findAction(output.actions, "playReactionClip")).toBe(null);
    expect(output.consumedPlannerEventIds).toEqual([event.eventId]);
  });

  it("consumes unmapped reaction events without falling back to dominant emotion", () => {
    const event = createReactionEvent({
      emotional_tone: "not-an-emotion",
      emotional_intensity: 1,
    });

    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        emotionalState: createEmotionalState({ anger: 20 }),
        pendingEvents: [event],
      }),
    );

    expect(findAction(output.actions, "playReactionClip")).toBe(null);
    expect(output.consumedPlannerEventIds).toEqual([event.eventId]);
  });

  it("suppresses duplicate same-run emotion reaction events", () => {
    const firstEvent = createReactionEvent({
      eventId: "planner-reaction-first",
      emotionEventId: "emotion-sse-duplicate",
    });
    const firstOutput = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        pendingEvents: [firstEvent],
      }),
    );

    const duplicateEvent = createReactionEvent({
      eventId: "planner-reaction-duplicate",
      emotionEventId: "emotion-sse-duplicate",
    });
    const duplicateOutput = planAvatar(
      firstOutput.state,
      createPlannerInput({
        nowMs: 1_500,
        pendingEvents: [duplicateEvent],
      }),
    );

    expect(findAction(firstOutput.actions, "playReactionClip")?.clipId).toBe(
      "joy-2",
    );
    expect(findAction(duplicateOutput.actions, "playReactionClip")).toBe(null);
    expect(duplicateOutput.consumedPlannerEventIds).toEqual([
      duplicateEvent.eventId,
    ]);
  });

  it("emits a clear action when a talking reaction leaves talking", () => {
    const event = createReactionEvent();
    const started = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        pendingEvents: [event],
      }),
    );

    const ended = planAvatar(
      started.state,
      createPlannerInput({
        nowMs: 2_000,
        interactionPhase: "idle",
        avatarState: "idle",
        pendingEvents: [],
      }),
    );

    const clearAction = findAction(ended.actions, "clearReactionClip");
    expect(clearAction).toMatchObject({
      lane: "reactionClip",
      runId: "run-1",
      reason: "talkingEnded",
    });
    expect(ended.state.activeReactionClip).toBeNull();
  });
});
