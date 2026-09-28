import {
  evaluateManifestIdleEntries,
  selectManifestIdleCandidateFromEntries,
  type ManifestAnimation,
} from "@/lib/avatar/animationManifest";
import { describe, expect, it } from "vitest";
import { BUILT_IN_AVATAR_MOTION_CATALOG } from "@/lib/avatar/motion/AvatarMotionCatalog";
import {
  buildEmotionRuntimeState,
  createEmptyEmotionStateMap,
} from "@/lib/emotion";
import {
  DEFAULT_IDLE_STINT_QUIET_INTERVAL_SEC,
  createInitialAvatarPlannerState,
  hasBlockingNonTtsPresentationWork,
  planAvatar,
  type AvatarPlannerAction,
  type AvatarPlannerEmotionEvent,
  type AvatarPlannerGestureEvent,
  type AvatarPlannerInput,
  type AvatarPlannerPoseClip,
  type AvatarPlannerState,
} from "@/lib/avatar/planner/AvatarPlanner";

const GESTURE_HINT = "wave";

type PlannerActionOf<Type extends AvatarPlannerAction["type"]> = Extract<
  AvatarPlannerAction,
  { type: Type }
>;

function createEmotionalState(values: Partial<Record<string, number>> = {}) {
  const state = createEmptyEmotionStateMap();
  const entries =
    Object.keys(values).length > 0 ? values : ({ joy: 12 } as const);
  for (const [emotion, value] of Object.entries(entries)) {
    if (emotion in state) {
      state[emotion as keyof typeof state] = value;
    }
  }
  return buildEmotionRuntimeState(state);
}

function createNeutralEmotionalState() {
  const values = createEmptyEmotionStateMap();
  return buildEmotionRuntimeState(values);
}

function createPlannerInput(
  overrides: Partial<AvatarPlannerInput> = {},
): AvatarPlannerInput {
  return {
    nowMs: 1_000,
    animaId: "anima:test",
    activeRunId: "run-1",
    interactionPhase: "idle",
    avatarState: "idle",
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

function createGestureEvent(
  overrides: Partial<AvatarPlannerGestureEvent> = {},
): AvatarPlannerGestureEvent {
  return {
    type: "gestureRequested",
    eventId: "motion-gesture-1",
    requestId: "gesture-1",
    runId: "run-1",
    animationHint: GESTURE_HINT,
    sourceEventId: null,
    sourceEmotionEventId: null,
    createdAtMs: 1_001,
    ...overrides,
  };
}

function createEmotionEvent(
  overrides: Partial<AvatarPlannerEmotionEvent> = {},
): AvatarPlannerEmotionEvent {
  return {
    type: "emotionUpdated",
    eventId: "motion-emotion-1",
    emotionEventId: "emotion-1",
    runId: "run-1",
    animationHint: null,
    createdAtMs: 1_000,
    ...overrides,
  };
}

function createActiveThinkingPoseClip(
  overrides: Partial<AvatarPlannerPoseClip> = {},
): AvatarPlannerPoseClip {
  return {
    ownerId: "state:thinking",
    requestId: "thinking-pose-1",
    runId: "run-1",
    clipId: "thinkingLeanForward",
    source: "thinking",
    manifestGestureId: null,
    manifestGestureType: null,
    gestureResolutionSource: null,
    sourceMotionEventId: null,
    sourceEmotionEventId: null,
    status: "active",
    requestedAtMs: 1_000,
    eligibleAtMs: 1_000,
    startedAtMs: 1_200,
    expiresAtMs: null,
    priority: 10,
    enterPolicy: { mode: "fadeIn", durationSec: 0.4 },
    exitPolicy: { mode: "fadeOut", durationSec: 0.35 },
    ...overrides,
  };
}

function createActiveGesturePoseClip(
  overrides: Partial<AvatarPlannerPoseClip> = {},
): AvatarPlannerPoseClip {
  return {
    ownerId: "gesture:gesture-1:poseClip",
    requestId: "gesture-1",
    runId: "run-1",
    clipId: "double-thumbs-up",
    source: "gesture",
    manifestGestureId: "double-thumbs-up",
    manifestGestureType: "animaPoseClip",
    gestureResolutionSource: "manifest",
    sourceMotionEventId: "motion-gesture-1",
    sourceEmotionEventId: "emotion-1",
    status: "active",
    requestedAtMs: 1_000,
    eligibleAtMs: 1_000,
    startedAtMs: 1_000,
    expiresAtMs: 3_000,
    priority: 20,
    enterPolicy: { mode: "fadeIn", durationSec: 0.35 },
    exitPolicy: { mode: "fadeOut", durationSec: 0.35 },
    ...overrides,
  };
}

describe("AvatarPlanner", () => {
  it("consumes a pending gesture before phase queuing and never replays it when readiness changes", () => {
    let pending = true;
    const motionCatalog = Object.create(
      BUILT_IN_AVATAR_MOTION_CATALOG,
    ) as typeof BUILT_IN_AVATAR_MOTION_CATALOG;
    motionCatalog.isGesturePending = () => pending;
    const event = createGestureEvent();
    const waiting = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        motionCatalog,
        interactionPhase: "thinking",
        avatarState: "thinking",
        pendingEvents: [event],
      }),
    );
    expect(waiting.consumedPlannerEventIds).toContain(event.eventId);
    expect(waiting.state.pendingEvents).toEqual([]);
    expect(waiting.debug.ignoredEventReasons).toContain(
      `gestureRequested:${event.requestId}:resourcePending`,
    );
    pending = false;
    const ready = planAvatar(
      waiting.state,
      createPlannerInput({
        motionCatalog,
        pendingEvents: waiting.state.pendingEvents,
        nowMs: 2_000,
      }),
    );
    expect(findAction(ready.actions, "playVrmaGesture")).toBeNull();
    const fresh = planAvatar(
      ready.state,
      createPlannerInput({
        motionCatalog,
        pendingEvents: [
          createGestureEvent({ eventId: "fresh", requestId: "fresh" }),
        ],
        nowMs: 3_000,
      }),
    );
    expect(findAction(fresh.actions, "playVrmaGesture")).not.toBeNull();
  });

  it("consumes an explicit gesture request when a hinted gesture can start", () => {
    const gestureEvent = createGestureEvent({
      sourceEventId: "gesture-sse-1",
    });

    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        pendingEvents: [gestureEvent],
      }),
    );

    const gestureAction = findAction(output.actions, "playVrmaGesture");

    expect(gestureAction).not.toBeNull();
    expect(gestureAction?.clipUrl).toContain("/vrm/animations/wave.vrma");
    expect(output.consumedPlannerEventIds).toEqual([gestureEvent.eventId]);
    expect(output.state.activeGestureVrma?.gestureRequestId).toBe(
      gestureEvent.requestId,
    );
    expect(output.state.activeGestureVrma?.sourceMotionEventId).toBe(
      gestureEvent.eventId,
    );
    expect(output.state.activeGestureVrma?.sourceEmotionEventId).toBe(null);
    expect(output.state.activeGestureVrma?.manifestGestureId).toBe("wave");
    expect(output.state.activeGestureVrma?.gestureResolutionSource).toBe(
      "manifest",
    );
    expect(output.debug.talkingMotionSource).toBe("none");
    expect(output.state.pendingEvents).toEqual([]);
  });

  it("keeps phase-ineligible gesture events pending without consuming them", () => {
    const gestureEvent = createGestureEvent();

    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        interactionPhase: "thinking",
        avatarState: "thinking",
        pendingEvents: [gestureEvent],
      }),
    );

    expect(findAction(output.actions, "playVrmaGesture")).toBeNull();
    expect(output.consumedPlannerEventIds).toEqual([]);
    expect(output.state.pendingEvents).toEqual([gestureEvent]);
  });

  it("keeps a Gesture pending while a previous pose clip finishes its exit fade", () => {
    const gestureEvent = createGestureEvent({
      animationHint: "right-thumbs-up",
    });
    const fading = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        interactionPhase: "responding_no_tts",
        avatarState: "talking",
        manualPoseClipActive: true,
        pendingEvents: [gestureEvent],
      }),
    );

    expect(findAction(fading.actions, "playPoseClip")).toBeNull();
    expect(fading.consumedPlannerEventIds).toEqual([]);
    expect(fading.state.pendingEvents).toEqual([gestureEvent]);
    expect(fading.debug.ignoredEventReasons).not.toContain(
      `gestureRequested:${gestureEvent.requestId}:manualPoseClipActive`,
    );

    const started = planAvatar(
      fading.state,
      createPlannerInput({
        nowMs: 1_400,
        interactionPhase: "responding_no_tts",
        avatarState: "talking",
        manualPoseClipActive: false,
        pendingEvents: fading.state.pendingEvents,
      }),
    );

    expect(findAction(started.actions, "playPoseClip")).toMatchObject({
      clipId: "right-thumbs-up",
      runId: "run-1",
    });
    expect(started.consumedPlannerEventIds).toEqual([gestureEvent.eventId]);
    expect(started.state.pendingEvents).toEqual([]);
  });

  it("consumes stale gesture events for inactive runs", () => {
    const gestureEvent = createGestureEvent({
      runId: "old-run",
    });

    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        pendingEvents: [gestureEvent],
      }),
    );

    expect(findAction(output.actions, "playVrmaGesture")).toBeNull();
    expect(output.consumedPlannerEventIds).toEqual([gestureEvent.eventId]);
    expect(output.state.pendingEvents).toEqual([]);
    expect(output.debug.ignoredEventReasons).toContain(
      `gestureRequested:${gestureEvent.requestId}:activeRunMismatch`,
    );
  });

  it("plays a manifest AnimaPoseClip gesture during talking", () => {
    const gestureEvent = createGestureEvent({
      animationHint: "double-thumbs-up",
      sourceEventId: "gesture-sse-1",
    });

    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        interactionPhase: "talking",
        avatarState: "talking",
        pendingEvents: [gestureEvent],
        eligiblePlannerProceduralLayerIds: ["talkingHands"],
      }),
    );

    const poseAction = findAction(output.actions, "playPoseClip");
    const talkingHandsAction = output.actions.find(
      (action) =>
        action.type === "setProceduralPolicy" &&
        action.layerId === "talkingHands" &&
        action.enabled,
    );

    expect(poseAction).toMatchObject({
      clipId: "double-thumbs-up",
      runId: "run-1",
    });
    expect(output.state.activePlannerPoseClip).toMatchObject({
      source: "gesture",
      manifestGestureId: "double-thumbs-up",
      manifestGestureType: "animaPoseClip",
    });
    expect(talkingHandsAction).toBeUndefined();
    expect(output.debug.talkingMotionSource).toBe("manifestGesture");
    expect(output.debug.talkingHandsBypassed).toBe(true);
  });

  it("plays gestures during non-TTS response presentation without talkingHands", () => {
    const gestureEvent = createGestureEvent({
      animationHint: "double-thumbs-up",
      sourceEventId: "gesture-sse-1",
    });

    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        interactionPhase: "responding_no_tts",
        avatarState: "talking",
        pendingEvents: [gestureEvent],
        eligiblePlannerProceduralLayerIds: ["talkingHands"],
      }),
    );

    const poseAction = findAction(output.actions, "playPoseClip");
    const talkingHandsAction = output.actions.find(
      (action) =>
        action.type === "setProceduralPolicy" &&
        action.layerId === "talkingHands" &&
        action.enabled,
    );

    expect(poseAction).toMatchObject({
      clipId: "double-thumbs-up",
      runId: "run-1",
    });
    expect(output.state.activePlannerPoseClip).toMatchObject({
      source: "gesture",
      manifestGestureId: "double-thumbs-up",
    });
    expect(output.debug.baseState).toBe("talking");
    expect(output.debug.talkingMotionSource).toBe("none");
    expect(talkingHandsAction).toBeUndefined();
  });

  it("completes a looping Gesture pose clip at its bounded planner lifetime", () => {
    const gestureEvent = createGestureEvent({
      animationHint: "right-thumbs-up",
      sourceEventId: "gesture-sse-1",
    });
    const started = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        interactionPhase: "responding_no_tts",
        avatarState: "talking",
        pendingEvents: [gestureEvent],
      }),
    );
    const activeClip = started.state.activePlannerPoseClip;

    expect(activeClip).toMatchObject({
      clipId: "right-thumbs-up",
      source: "gesture",
    });
    expect(activeClip?.expiresAtMs).toBeGreaterThan(1_000);
    expect(hasBlockingNonTtsPresentationWork(started, "run-1")).toBe(true);

    const completed = planAvatar(
      started.state,
      createPlannerInput({
        nowMs: activeClip?.expiresAtMs ?? 4_000,
        interactionPhase: "responding_no_tts",
        avatarState: "talking",
        activePlannerPoseClip: activeClip,
        plannerPoseClipRuntimeActive: true,
      }),
    );

    expect(findAction(completed.actions, "stopPoseClip")).toMatchObject({
      clipId: "right-thumbs-up",
      reason: "gesturePoseClipCompleted",
    });
    expect(completed.state.activePlannerPoseClip).toBeNull();
    expect(completed.state.lastCancellationReason).toBe(
      "gesturePoseClipCompleted",
    );
    expect(hasBlockingNonTtsPresentationWork(completed, "run-1")).toBe(false);
  });

  it("does not enable talkingHands while talking before emotion arbitration resolves", () => {
    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        interactionPhase: "talking",
        avatarState: "talking",
        eligiblePlannerProceduralLayerIds: ["talkingHands"],
      }),
    );

    expect(findAction(output.actions, "setProceduralPolicy")).toBeNull();
    expect(output.debug.talkingMotionSource).toBe("pending");
    expect(output.state.talkingMotionArbitration).toMatchObject({
      runId: "run-1",
      status: "awaitingEmotionUpdate",
    });
  });

  it("enables talkingHands after a same-run emotion update without animation hint", () => {
    const emotionEvent = createEmotionEvent();

    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        interactionPhase: "talking",
        avatarState: "talking",
        pendingEvents: [emotionEvent],
        eligiblePlannerProceduralLayerIds: ["talkingHands"],
      }),
    );

    const talkingHandsAction = findAction(
      output.actions,
      "setProceduralPolicy",
    );

    expect(talkingHandsAction).toMatchObject({
      layerId: "talkingHands",
      enabled: true,
    });
    expect(output.state.talkingMotionArbitration).toMatchObject({
      runId: "run-1",
      status: "talkingHandsAllowed",
      sourceMotionEventId: emotionEvent.eventId,
    });
    expect(output.debug.talkingMotionSource).toBe("talkingHands");
  });

  it("does not enable talkingHands during non-TTS response presentation", () => {
    const emotionEvent = createEmotionEvent();

    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        interactionPhase: "responding_no_tts",
        avatarState: "talking",
        pendingEvents: [emotionEvent],
        eligiblePlannerProceduralLayerIds: ["talkingHands"],
      }),
    );

    const talkingHandsAction = output.actions.find(
      (action) =>
        action.type === "setProceduralPolicy" &&
        action.layerId === "talkingHands" &&
        action.enabled,
    );

    expect(output.debug.baseState).toBe("talking");
    expect(output.state.talkingMotionArbitration.status).toBe(
      "talkingHandsAllowed",
    );
    expect(output.debug.talkingMotionSource).toBe("none");
    expect(talkingHandsAction).toBeUndefined();
  });

  it("carries early no-hint emotion arbitration into the talking phase", () => {
    const emotionEvent = createEmotionEvent();
    const thinking = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        interactionPhase: "thinking",
        avatarState: "thinking",
        pendingEvents: [emotionEvent],
        eligiblePlannerProceduralLayerIds: ["talkingHands"],
      }),
    );

    const talking = planAvatar(
      thinking.state,
      createPlannerInput({
        nowMs: 2_000,
        interactionPhase: "talking",
        avatarState: "talking",
        eligiblePlannerProceduralLayerIds: ["talkingHands"],
      }),
    );

    const talkingHandsAction = findAction(
      talking.actions,
      "setProceduralPolicy",
    );

    expect(thinking.state.talkingMotionArbitration.status).toBe(
      "talkingHandsAllowed",
    );
    expect(talkingHandsAction).toMatchObject({
      layerId: "talkingHands",
      enabled: true,
    });
    expect(talking.debug.talkingMotionSource).toBe("talkingHands");
  });

  it("plays early primary gesture requests on talking entry without enabling talkingHands", () => {
    const gestureEvent = createGestureEvent({
      sourceEventId: "gesture-sse-1",
    });
    const thinking = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        interactionPhase: "thinking",
        avatarState: "thinking",
        pendingEvents: [gestureEvent],
        eligiblePlannerProceduralLayerIds: ["talkingHands"],
      }),
    );

    const talking = planAvatar(
      thinking.state,
      createPlannerInput({
        nowMs: 2_000,
        interactionPhase: "talking",
        avatarState: "talking",
        eligiblePlannerProceduralLayerIds: ["talkingHands"],
      }),
    );

    expect(thinking.state.pendingEvents).toEqual([gestureEvent]);
    expect(thinking.state.talkingMotionArbitration.status).toBe(
      "manifestAnimationRequested",
    );
    expect(findAction(talking.actions, "playVrmaGesture")).not.toBeNull();
    expect(
      talking.actions.find(
        (action) =>
          action.type === "setProceduralPolicy" &&
          action.layerId === "talkingHands" &&
          action.enabled,
      ),
    ).toBeUndefined();
    expect(talking.debug.talkingMotionSource).toBe("manifestGesture");
  });

  it("blocks talkingHands when a talking gesture id is invalid", () => {
    const gestureEvent = createGestureEvent({
      animationHint: "not-a-real-gesture",
      sourceEventId: "gesture-sse-1",
    });

    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        interactionPhase: "talking",
        avatarState: "talking",
        pendingEvents: [gestureEvent],
        eligiblePlannerProceduralLayerIds: ["talkingHands"],
      }),
    );

    const talkingHandsAction = findAction(
      output.actions,
      "setProceduralPolicy",
    );

    expect(findAction(output.actions, "playVrmaGesture")).toBeNull();
    expect(findAction(output.actions, "playPoseClip")).toBeNull();
    expect(talkingHandsAction).toBeNull();
    expect(output.debug.ignoredEventReasons).toContain(
      `gestureRequested:${gestureEvent.requestId}:noAnimationClip`,
    );
    expect(output.state.talkingMotionArbitration.status).toBe(
      "manifestAnimationRequested",
    );
    expect(output.debug.talkingMotionSource).toBe("none");
  });

  it("does not restore talkingHands after a same-run gesture pose clip completes", () => {
    const activePoseClip = createActiveGesturePoseClip();
    const previous: AvatarPlannerState = {
      ...createInitialAvatarPlannerState(),
      animaId: "anima:test",
      activeRunId: "run-1",
      interactionPhase: "talking",
      phaseEnteredAtMs: 1_000,
      activePlannerPoseClip: activePoseClip,
      talkingMotionArbitration: {
        runId: "run-1",
        status: "manifestAnimationRequested",
        sourceMotionEventId: "motion-emotion-1",
        sourceEmotionEventId: "emotion-1",
        animationHint: "double-thumbs-up",
      },
    };

    const output = planAvatar(
      previous,
      createPlannerInput({
        nowMs: 2_000,
        interactionPhase: "talking",
        avatarState: "talking",
        activePlannerPoseClip: activePoseClip,
        plannerPoseClipRuntimeActive: false,
        eligiblePlannerProceduralLayerIds: ["talkingHands"],
      }),
    );

    const talkingHandsAction = findAction(
      output.actions,
      "setProceduralPolicy",
    );

    expect(output.state.activePlannerPoseClip).toBeNull();
    expect(output.state.lastCancellationReason).toBe("poseClipCompleted");
    expect(talkingHandsAction).toBeNull();
    expect(output.debug.talkingMotionSource).toBe("none");
  });

  it("keeps idle quiet until the default idle stint interval elapses", () => {
    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput(),
    );

    expect(findAction(output.actions, "playVrmaLoop")).toBeNull();
    expect(output.state.activeBaseVrma).toBeNull();
    expect(output.debug.idleStint).toMatchObject({
      phase: "quiet",
      quietIntervalSec: DEFAULT_IDLE_STINT_QUIET_INTERVAL_SEC,
      nextEvalMs: DEFAULT_IDLE_STINT_QUIET_INTERVAL_SEC * 1000,
    });
  });

  it("honors an overridden idle stint quiet interval", () => {
    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        idleStintQuietIntervalSec: 10,
      }),
    );

    expect(output.debug.idleStint).toMatchObject({
      phase: "quiet",
      quietIntervalSec: 10,
      nextDueAtMs: 11_000,
      nextEvalMs: 10_000,
    });
  });

  it("starts an idle VRMA stint when the quiet interval is elapsed", () => {
    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        idleStintQuietIntervalSec: 0,
        randomRolls: [0, 0, 0, 0],
      }),
    );

    const playAction = findAction(output.actions, "playVrmaLoop");
    const selectedCandidate = output.debug.idleStint.selectedCandidate;

    expect(playAction).not.toBeNull();
    expect(selectedCandidate).not.toBeNull();
    expect(playAction?.plan.ownerId).toBe("state:idle:stint");
    expect(playAction?.transition.durationSec).toBeGreaterThan(0);
    expect(playAction?.plan.loopType).toBe(selectedCandidate?.loopType);
    expect(playAction?.plan.loopCount).toBe(selectedCandidate?.loopCount);
    expect(playAction?.plan.timeScale).toBeCloseTo(
      selectedCandidate?.timeScale ?? 1,
    );
    expect(playAction?.plan.effectiveDurationSec).toBeCloseTo(
      selectedCandidate?.effectiveDurationSec ?? 0,
    );
    expect(output.state.idleStint.phase).toBe("active");
    expect(playAction?.plan.clip?.file).toBe(selectedCandidate?.file);
  });

  it("returns to idle quiet after the active idle VRMA stint duration", () => {
    const started = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        idleStintQuietIntervalSec: 0,
        randomRolls: [0, 0, 0, 0],
      }),
    );
    const activePlan = started.state.activeBaseVrma;
    expect(activePlan?.expiresAtMs).not.toBeNull();

    const output = planAvatar(
      started.state,
      createPlannerInput({
        nowMs: activePlan?.expiresAtMs ?? 1_000,
        idleStintQuietIntervalSec: 0,
      }),
    );

    const stopAction = findAction(output.actions, "stopVrmaLoop");

    expect(stopAction).toMatchObject({
      clipName: activePlan?.clipName,
      reason: "idleStintCompleted",
    });
    expect(stopAction?.transition).toEqual({
      mode: "fadeOut",
      durationSec: activePlan?.crossFadeSec,
    });
    expect(output.state.activeBaseVrma).toBeNull();
    expect(output.state.idleStint.phase).toBe("quiet");
  });

  it("uses a short fade-out when an active thinking pose exits into talking", () => {
    const activePoseClip = createActiveThinkingPoseClip();
    const previous: AvatarPlannerState = {
      ...createInitialAvatarPlannerState(),
      animaId: "anima:test",
      activeRunId: "run-1",
      interactionPhase: "thinking",
      phaseEnteredAtMs: 1_000,
      activePlannerPoseClip: activePoseClip,
    };

    const output = planAvatar(
      previous,
      createPlannerInput({
        nowMs: 2_000,
        interactionPhase: "talking",
        avatarState: "talking",
      }),
    );

    const stopAction = findAction(output.actions, "stopPoseClip");

    expect(stopAction?.transition).toEqual({
      mode: "fadeOut",
      durationSec: 0.3,
    });
    expect(output.state.activePlannerPoseClip).toBeNull();
    expect(output.state.lastCancellationReason).toBe("phaseChanged:talking");
  });

  it("keeps user_typing on the idle base state while enabling listening procedural policy", () => {
    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        interactionPhase: "user_typing",
        avatarState: "idle",
        eligiblePlannerProceduralLayerIds: ["bounce", "headNod"],
        randomRolls: [0, 0, 0, 0],
      }),
    );

    const proceduralAction = findAction(output.actions, "setProceduralPolicy");

    expect(output.debug.baseState).toBe("idle");
    expect(output.state.activeBaseVrma).toBeNull();
    expect(output.state.idleStint.phase).toBe("quiet");
    expect(proceduralAction).toMatchObject({
      layerId: "bounce",
      enabled: true,
    });
    expect(output.state.proceduralStints).toEqual([
      expect.objectContaining({
        policy: "listening",
        layerId: "bounce",
        enabled: true,
      }),
    ]);
  });

  it("clears planner-owned user_typing procedural policy on idle exit", () => {
    const previous: AvatarPlannerState = {
      ...createInitialAvatarPlannerState(),
      animaId: "anima:test",
      interactionPhase: "user_typing",
      phaseEnteredAtMs: 1_000,
      proceduralStints: [
        {
          ownerId: "state:listening:procedural",
          policy: "listening",
          layerId: "bounce",
          startedAtMs: 1_000,
          enabled: true,
        },
      ],
    };

    const output = planAvatar(
      previous,
      createPlannerInput({
        nowMs: 2_000,
        activeRunId: null,
        interactionPhase: "idle",
        avatarState: "idle",
        activePlannerProceduralLayerIds: ["bounce"],
        eligiblePlannerProceduralLayerIds: ["bounce", "headNod"],
      }),
    );

    const proceduralAction = findAction(output.actions, "setProceduralPolicy");

    expect(proceduralAction).toMatchObject({
      layerId: "bounce",
      enabled: false,
    });
    expect(output.state.proceduralStints).toEqual([]);
  });

  it("does not clear manually owned procedural layers when user_typing ends", () => {
    const previous: AvatarPlannerState = {
      ...createInitialAvatarPlannerState(),
      animaId: "anima:test",
      interactionPhase: "user_typing",
      phaseEnteredAtMs: 1_000,
      proceduralStints: [
        {
          ownerId: "state:listening:procedural",
          policy: "listening",
          layerId: "bounce",
          startedAtMs: 1_000,
          enabled: true,
        },
      ],
    };

    const output = planAvatar(
      previous,
      createPlannerInput({
        nowMs: 2_000,
        activeRunId: null,
        interactionPhase: "idle",
        avatarState: "idle",
        activePlannerProceduralLayerIds: [],
        manualProceduralLayerIds: ["bounce"],
        eligiblePlannerProceduralLayerIds: ["bounce", "headNod"],
      }),
    );

    expect(findAction(output.actions, "setProceduralPolicy")).toBeNull();
    expect(output.state.proceduralStints).toEqual([]);
  });

  it("enables emotion posture when a supported dominant group reaches level one", () => {
    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        emotionalState: createEmotionalState({ sadness: 18 }),
        eligiblePlannerProceduralLayerIds: ["emotionPosture"],
      }),
    );

    const proceduralAction = findAction(output.actions, "setProceduralPolicy");

    expect(proceduralAction).toMatchObject({
      layerId: "emotionPosture",
      enabled: true,
    });
    expect(output.state.proceduralStints).toEqual([
      expect.objectContaining({
        policy: "emotionPosture",
        layerId: "emotionPosture",
        enabled: true,
      }),
    ]);
  });

  it("does not enable emotion posture for neutral or level-zero emotion state", () => {
    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        emotionalState: createNeutralEmotionalState(),
        eligiblePlannerProceduralLayerIds: ["emotionPosture"],
      }),
    );

    expect(findAction(output.actions, "setProceduralPolicy")).toBeNull();
    expect(output.state.proceduralStints).toEqual([]);
  });

  it("does not enable emotion posture for unsupported dominant groups", () => {
    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        emotionalState: createEmotionalState({ joy: 22 }),
        eligiblePlannerProceduralLayerIds: ["emotionPosture"],
      }),
    );

    expect(findAction(output.actions, "setProceduralPolicy")).toBeNull();
    expect(output.state.proceduralStints).toEqual([]);
  });

  it("does not enable emotion posture when the planner gate is disabled", () => {
    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        emotionalState: createEmotionalState({ sadness: 18 }),
        eligiblePlannerProceduralLayerIds: ["emotionPosture"],
        emotionPostureConfig: {
          plannerEnabled: false,
          presetEnabledByGroup: { gloom: true },
        },
      }),
    );

    expect(findAction(output.actions, "setProceduralPolicy")).toBeNull();
    expect(output.state.proceduralStints).toEqual([]);
  });

  it("does not enable emotion posture when the dominant preset is disabled", () => {
    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        emotionalState: createEmotionalState({ sadness: 18 }),
        eligiblePlannerProceduralLayerIds: ["emotionPosture"],
        emotionPostureConfig: {
          plannerEnabled: true,
          presetEnabledByGroup: { gloom: false },
        },
      }),
    );

    expect(findAction(output.actions, "setProceduralPolicy")).toBeNull();
    expect(output.state.proceduralStints).toEqual([]);
  });

  it("runs emotion posture alongside talking procedural policy", () => {
    const emotionEvent = createEmotionEvent();
    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        interactionPhase: "talking",
        avatarState: "talking",
        emotionalState: createEmotionalState({ sadness: 22 }),
        pendingEvents: [emotionEvent],
        eligiblePlannerProceduralLayerIds: ["emotionPosture", "talkingHands"],
      }),
    );

    const proceduralActions = output.actions.filter(
      (action) => action.type === "setProceduralPolicy",
    );

    expect(proceduralActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layerId: "emotionPosture",
          enabled: true,
        }),
        expect.objectContaining({
          layerId: "talkingHands",
          enabled: true,
        }),
      ]),
    );
    expect(output.state.proceduralStints.map((stint) => stint.policy)).toEqual([
      "emotionPosture",
      "talking",
    ]);
  });

  it("does not take over emotion posture when the layer is manually owned", () => {
    const output = planAvatar(
      createInitialAvatarPlannerState(),
      createPlannerInput({
        emotionalState: createEmotionalState({ sadness: 18 }),
        manualProceduralLayerIds: ["emotionPosture"],
        eligiblePlannerProceduralLayerIds: ["emotionPosture"],
      }),
    );

    expect(findAction(output.actions, "setProceduralPolicy")).toBeNull();
    expect(output.state.proceduralStints).toEqual([]);
  });
});

describe("Gesture based finite idle scheduling", () => {
  function catalog(type: "vrma" | "animaPoseClip") {
    const entry: ManifestAnimation = {
      id: "idle:test",
      name: "Idle",
      file: "idle:test",
      type,
      animation_type: "idle",
      emotions: {},
      duration: 0.5,
      time_scale: 2,
      loop_type: "repeat",
      loop_count: 2,
      idle_playback: true,
    };
    return Object.assign(Object.create(BUILT_IN_AVATAR_MOTION_CATALOG), {
      evaluateIdleAnimations: (emotion: AvatarPlannerInput["emotionalState"]) =>
        evaluateManifestIdleEntries([entry], emotion),
      selectIdleAnimation: (
        args: Parameters<typeof selectManifestIdleCandidateFromEntries>[0],
      ) =>
        selectManifestIdleCandidateFromEntries({ ...args, entries: [entry] }),
    });
  }
  it.each(["vrma", "animaPoseClip"] as const)(
    "admits finite %s after quiet while the user is typing",
    (type) => {
      const motionCatalog = catalog(type);
      const input = createPlannerInput({
        motionCatalog,
        activeRunId: null,
        interactionPhase: "user_typing",
      });
      const first = planAvatar(createInitialAvatarPlannerState(), input);
      const due = planAvatar(first.state, { ...input, nowMs: 181_000 });
      expect(due.state.idleStint.phase).toBe("active");
      if (type === "animaPoseClip")
        expect(findAction(due.actions, "playPoseClip")?.poseClip.source).toBe(
          "idle",
        );
      else expect(due.state.activeBaseVrma?.clip?.id).toBe("idle:test");
    },
  );

  it.each(["vrma", "animaPoseClip"] as const)(
    "continues active finite %s when the user begins typing",
    (type) => {
      const motionCatalog = catalog(type);
      const input = createPlannerInput({ motionCatalog, activeRunId: null });
      const first = planAvatar(createInitialAvatarPlannerState(), input);
      const due = planAvatar(first.state, { ...input, nowMs: 181_000 });
      const state = {
        ...due.state,
        activePlannerPoseClip: due.state.activePlannerPoseClip
          ? {
              ...due.state.activePlannerPoseClip,
              status: "active" as const,
              startedAtMs: 181_000,
              expiresAtMs: 181_500,
            }
          : null,
      };
      const typing = planAvatar(state, {
        ...input,
        nowMs: 181_250,
        interactionPhase: "user_typing",
        plannerPoseClipRuntimeActive: true,
      });
      expect(typing.state.idleStint.phase).toBe("active");
      expect(findAction(typing.actions, "stopPoseClip")).toBeNull();
      expect(findAction(typing.actions, "stopVrmaLoop")).toBeNull();
      if (type === "animaPoseClip")
        expect(typing.state.activePlannerPoseClip?.ownerId).toBe(
          state.activePlannerPoseClip?.ownerId,
        );
      else
        expect(typing.state.activeBaseVrma?.key).toBe(
          state.activeBaseVrma?.key,
        );
    },
  );

  it.each(["vrma", "animaPoseClip"] as const)(
    "starts a finite %s only after quiet and waits for real player readiness",
    (type) => {
      const motionCatalog = catalog(type);
      const first = planAvatar(
        createInitialAvatarPlannerState(),
        createPlannerInput({ motionCatalog, activeRunId: null }),
      );
      const due = planAvatar(
        first.state,
        createPlannerInput({
          motionCatalog,
          activeRunId: null,
          nowMs: 181_000,
        }),
      );
      expect(due.state.idleStint.phase).toBe("active");
      if (type === "animaPoseClip") {
        expect(findAction(due.actions, "playPoseClip")?.poseClip).toMatchObject(
          {
            source: "idle",
            status: "pending",
            startedAtMs: null,
            expiresAtMs: null,
          },
        );
        const loading = planAvatar(
          due.state,
          createPlannerInput({
            motionCatalog,
            activeRunId: null,
            nowMs: 190_000,
            plannerPoseClipRuntimeActive: false,
          }),
        );
        expect(loading.state.activePlannerPoseClip?.source).toBe("idle");
        const interrupted = planAvatar(
          loading.state,
          createPlannerInput({
            motionCatalog,
            nowMs: 190_001,
            interactionPhase: "thinking",
          }),
        );
        expect(interrupted.state.activePlannerPoseClip).toBeNull();
        expect(findAction(interrupted.actions, "stopPoseClip")).not.toBeNull();
      } else {
        expect(due.state.activeBaseVrma?.expiresAtMs).toBeNull();
        const loading = planAvatar(
          due.state,
          createPlannerInput({
            motionCatalog,
            activeRunId: null,
            nowMs: 190_000,
          }),
        );
        expect(loading.state.activeBaseVrma?.key).toBe(
          due.state.activeBaseVrma?.key,
        );
      }
    },
  );
});
