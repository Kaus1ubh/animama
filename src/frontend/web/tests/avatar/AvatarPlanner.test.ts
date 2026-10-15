import { describe, expect, it, vi } from "vitest";
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
import {
  BUILT_IN_AVATAR_MOTION_CATALOG,
  type AvatarMotionCatalog,
  type ReactionPoolPickArgs,
} from "@/lib/avatar/motion/AvatarMotionCatalog";
import { pickReactionPoolMember } from "@/lib/avatar/reactionPools";

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

/**
 * A motion catalog whose Reaction cells hold the given pools ("joy-4" → ids).
 * Every member plays the built-in joy-2 clip, so lifetimes match the real ones.
 */
function poolCatalog(pools: Record<string, string[]>) {
  const picks: ReactionPoolPickArgs[] = [];
  const clip = BUILT_IN_AVATAR_MOTION_CATALOG.getReactionClip("joy-2");
  const members = new Set(Object.values(pools).flat());
  const catalog: AvatarMotionCatalog = Object.assign(
    Object.create(BUILT_IN_AVATAR_MOTION_CATALOG) as AvatarMotionCatalog,
    {
      getReactionClip: (runtimeId: string) =>
        members.has(runtimeId) ? clip : null,
      getReactionRuntimeId: (args: ReactionPoolPickArgs) => {
        picks.push(args);
        return pickReactionPoolMember(
          pools[`${args.emotionalTone}-${args.emotionalIntensity}`] ?? [],
          args.randomRoll,
          args.previousRuntimeId,
        );
      },
    },
  );
  return { catalog, picks };
}

/** Plan one talking frame that receives `events`, with every roll equal to `roll`. */
function planTalking(
  previous: ReturnType<typeof createInitialAvatarPlannerState>,
  catalog: AvatarMotionCatalog,
  events: AvatarPlannerEmotionReactionEvent[],
  roll: number,
  overrides: Partial<AvatarPlannerInput> = {},
) {
  return planAvatar(
    previous,
    createPlannerInput({
      motionCatalog: catalog,
      pendingEvents: events,
      randomRolls: [roll, roll, roll, roll],
      ...overrides,
    }),
  );
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
    const picked = { ...event, reactionRuntimeId: "joy-2" };
    expect(thinkingOutput.state.pendingReactionClipEvents).toEqual([picked]);
    expect(thinkingOutput.debug.activeReactionClip).toBeNull();
    expect(thinkingOutput.debug.pendingReactionClipEvents).toEqual([picked]);
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
  it("plays Intense (4) Reactions and nothing for intensity 0", () => {
    const { catalog, picks } = poolCatalog({ "joy-4": ["intense"] });
    const output = planTalking(
      createInitialAvatarPlannerState(),
      catalog,
      [
        createReactionEvent({ emotional_intensity: 4 }),
        createReactionEvent({
          eventId: "planner-reaction-zero",
          emotionEventId: "emotion-sse-zero",
          emotional_intensity: 0,
        }),
      ],
      0,
    );

    const plays = output.actions.filter(
      (action) => action.type === "playReactionClip",
    );
    expect(plays).toEqual([
      expect.objectContaining({ emotionalIntensity: 4, clipId: "intense" }),
    ]);
    // Intensity 0 is never a cell, so it draws no roll.
    expect(picks).toHaveLength(1);
  });

  it("picks uniformly from the cell's pool with the injected roll", () => {
    const { catalog } = poolCatalog({ "joy-2": ["a", "b", "c"] });
    const clipFor = (roll: number) =>
      findAction(
        planTalking(
          createInitialAvatarPlannerState(),
          catalog,
          [createReactionEvent()],
          roll,
        ).actions,
        "playReactionClip",
      )?.clipId;

    expect([0, 0.4, 0.7, 0.99].map(clipFor)).toEqual(["a", "b", "c", "c"]);
  });

  it("never repeats the member a cell played last while another member can play", () => {
    const { catalog, picks } = poolCatalog({
      "joy-2": ["a", "b"],
      "joy-3": ["solo"],
    });
    let state = createInitialAvatarPlannerState();
    const played: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const output = planTalking(
        state,
        catalog,
        [
          createReactionEvent({
            eventId: `planner-reaction-${index}`,
            emotionEventId: `emotion-sse-${index}`,
            emotional_intensity: index < 3 ? 2 : 3,
          }),
        ],
        0,
        { nowMs: 1_000 + index * 100 },
      );
      played.push(findAction(output.actions, "playReactionClip")!.clipId);
      state = output.state;
    }

    // Roll 0 always takes the first fresh member, so the pool alternates.
    expect(played).toEqual(["a", "b", "a", "solo"]);
    expect(picks.map((pick) => pick.previousRuntimeId ?? null)).toEqual([
      null,
      "a",
      "b",
      // Each cell remembers its own last pick.
      null,
    ]);
  });

  it("keeps one pick per emotion event while it waits for talking", () => {
    const { catalog, picks } = poolCatalog({ "joy-2": ["a", "b", "c"] });
    const event = createReactionEvent();
    const thinking = planTalking(
      createInitialAvatarPlannerState(),
      catalog,
      [event],
      0.9,
      { interactionPhase: "thinking", avatarState: "thinking" },
    );
    expect(thinking.state.pendingReactionClipEvents).toEqual([
      { ...event, reactionRuntimeId: "c" },
    ]);

    // The store re-sends the unpicked event every frame until it is consumed.
    const stillThinking = planTalking(thinking.state, catalog, [event], 0, {
      nowMs: 1_100,
      interactionPhase: "thinking",
      avatarState: "thinking",
    });
    const talking = planTalking(stillThinking.state, catalog, [event], 0, {
      nowMs: 1_200,
    });

    expect(findAction(talking.actions, "playReactionClip")?.clipId).toBe("c");
    expect(picks).toHaveLength(1);
  });

  it("plays nothing for an empty pool and does not fall back to another cell", () => {
    const { catalog } = poolCatalog({ "joy-3": ["strong"] });
    const event = createReactionEvent({ emotional_intensity: 2 });
    const output = planTalking(
      createInitialAvatarPlannerState(),
      catalog,
      [event],
      0,
    );

    expect(findAction(output.actions, "playReactionClip")).toBe(null);
    expect(output.consumedPlannerEventIds).toEqual([event.eventId]);
  });

  it("forgets what each cell played when the Anima changes", () => {
    const { catalog, picks } = poolCatalog({ "joy-2": ["a", "b"] });
    const first = planTalking(
      createInitialAvatarPlannerState(),
      catalog,
      [createReactionEvent()],
      0,
    );
    planTalking(
      first.state,
      catalog,
      [createReactionEvent({ eventId: "next", emotionEventId: "next-sse" })],
      0,
      { animaId: "anima:other", nowMs: 1_500 },
    );

    expect(picks.map((pick) => pick.previousRuntimeId ?? null)).toEqual([
      null,
      null,
    ]);
  });
  it("avoids only what a cell played, not a pick dropped before talking", () => {
    const { catalog, picks } = poolCatalog({ "joy-2": ["a", "b"] });
    // Roll 0.9 plays B.
    const played = planTalking(
      createInitialAvatarPlannerState(),
      catalog,
      [createReactionEvent()],
      0.9,
    );
    expect(findAction(played.actions, "playReactionClip")?.clipId).toBe("b");

    // The next event picks A while thinking, then its run ends before talking.
    const thinking = planTalking(
      played.state,
      catalog,
      [
        createReactionEvent({
          eventId: "planner-reaction-dropped",
          emotionEventId: "emotion-sse-dropped",
        }),
      ],
      0,
      { nowMs: 1_100, interactionPhase: "thinking", avatarState: "thinking" },
    );
    expect(thinking.state.pendingReactionClipEvents[0]?.reactionRuntimeId).toBe(
      "a",
    );
    const dropped = planTalking(thinking.state, catalog, [], 0, {
      nowMs: 1_200,
      activeRunId: "run-2",
    });
    expect(dropped.state.pendingReactionClipEvents).toEqual([]);

    // B is still what the cell played last, so the next event may pick A.
    const next = planTalking(
      dropped.state,
      catalog,
      [
        createReactionEvent({
          eventId: "planner-reaction-next",
          emotionEventId: "emotion-sse-next",
          runId: "run-2",
        }),
      ],
      0,
      { nowMs: 1_300, activeRunId: "run-2" },
    );
    expect(findAction(next.actions, "playReactionClip")?.clipId).toBe("a");
    expect(picks.map((pick) => pick.previousRuntimeId ?? null)).toEqual([
      null,
      "b",
      "b",
    ]);
  });

  it("lets motion draw its rolls first, then picks the Reaction with the next roll", () => {
    const { catalog, picks } = poolCatalog({ "joy-2": ["a", "b", "c"] });
    const runStarted = {
      type: "runStarted" as const,
      eventId: "run-started-1",
      runId: "run-1",
      // Long enough for a 40% thinking-pose chance.
      inputText: "x".repeat(90),
      createdAtMs: 1_000,
    };
    const thinkingInput = (
      pendingEvents: AvatarPlannerInput["pendingEvents"],
    ) =>
      createPlannerInput({
        motionCatalog: catalog,
        interactionPhase: "thinking",
        avatarState: "thinking",
        pendingEvents,
        randomRolls: [0.1, 0.9],
      });
    const motionOnly = planAvatar(
      createInitialAvatarPlannerState(),
      thinkingInput([runStarted]),
    );
    const withReaction = planAvatar(
      createInitialAvatarPlannerState(),
      thinkingInput([runStarted, createReactionEvent()]),
    );

    // Motion takes 0.1 either way, so its thinking pose is unchanged...
    expect(motionOnly.state.activePlannerPoseClip?.clipId).toBe(
      "thinking-head-scratch",
    );
    expect(withReaction.state.activePlannerPoseClip).toEqual(
      motionOnly.state.activePlannerPoseClip,
    );
    // ...and the Reaction pick takes the next roll, 0.9.
    expect(picks.map((pick) => pick.randomRoll)).toEqual([0.9]);
    expect(
      withReaction.state.pendingReactionClipEvents[0]?.reactionRuntimeId,
    ).toBe("c");
    expect(motionOnly.debug.randomRollsConsumed).toBe(1);
    expect(withReaction.debug.randomRollsConsumed).toBe(2);
  });

  it("uses live randomness only when no rolls are injected", () => {
    const { catalog, picks } = poolCatalog({ "joy-2": ["a", "b", "c"] });
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      planTalking(createInitialAvatarPlannerState(), catalog, [], 0, {
        pendingEvents: [createReactionEvent()],
        randomRolls: undefined,
      });
      // Injected rolls never fall back to live randomness, even when used up.
      planTalking(createInitialAvatarPlannerState(), catalog, [], 0, {
        pendingEvents: [createReactionEvent()],
        randomRolls: [],
      });
    } finally {
      random.mockRestore();
    }
    expect(picks.map((pick) => pick.randomRoll)).toEqual([0.5, 0]);
  });
});
