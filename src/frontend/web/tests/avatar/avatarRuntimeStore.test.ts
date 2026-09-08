import { beforeEach, describe, expect, it } from "vitest";

import { startPlannerGestureDebugRun } from "@/lib/avatar/planner/startPlannerGestureDebugRun";
import { useAvatarRuntimeStore } from "@/stores/avatar-runtime-store";

describe("avatar-runtime-store gesture events", () => {
  beforeEach(() => {
    useAvatarRuntimeStore.getState().resetForAnima("anima:test");
  });

  it("queues gestures only from explicit gesture requests", () => {
    const store = useAvatarRuntimeStore.getState();

    store.startRun("run-1", { inputText: "hello" });
    store.requestGesture({
      eventId: "gesture-event-1",
      runId: "run-1",
      gesture: "wave",
    });

    const gestureEvents = useAvatarRuntimeStore
      .getState()
      .plannerEvents.filter((event) => event.type === "gestureRequested");

    expect(gestureEvents).toHaveLength(1);
    expect(gestureEvents[0]).toMatchObject({
      runId: "run-1",
      animationHint: "wave",
      sourceEventId: "gesture-event-1",
      sourceEmotionEventId: null,
    });
  });

  it("emotion updates do not create gesture requests", () => {
    const store = useAvatarRuntimeStore.getState();

    store.startRun("run-1", { inputText: "hello" });
    store.applyEmotionUpdate({
      eventId: "emotion-event-1",
      runId: "run-1",
      emotions: [{ emotion: "joy", value: 12 }],
      emotionalTone: "joy",
      emotionalIntensity: 4,
    });

    const events = useAvatarRuntimeStore.getState().plannerEvents;
    const reactionEvent = events.find(
      (event) => event.type === "emotionReactionUpdated",
    );

    expect(events.some((event) => event.type === "gestureRequested")).toBe(
      false,
    );
    expect(events.some((event) => event.type === "emotionUpdated")).toBe(true);
    expect(reactionEvent).toMatchObject({
      emotionEventId: "emotion-event-1",
      runId: "run-1",
      emotional_tone: "joy",
      emotional_intensity: 3,
    });
  });

  it("tracks non-TTS response presentation without speech state", () => {
    const store = useAvatarRuntimeStore.getState();

    store.startRun("run-1", { inputText: "hello" });
    store.markNonTtsResponseStarted("run-1");

    const state = useAvatarRuntimeStore.getState();
    expect(state.activeRunId).toBe("run-1");
    expect(state.activeSpeechRunId).toBeNull();
    expect(state.interactionPhase).toBe("responding_no_tts");
  });

  it("finishes a non-TTS response only after planner presentation work drains", () => {
    const store = useAvatarRuntimeStore.getState();

    store.startRun("run-1", { inputText: "hello" });
    store.markNonTtsResponseStarted("run-1");
    store.requestNonTtsResponseCompletion("run-1");
    store.completeNonTtsResponseIfPlannerIdle({
      runId: "run-1",
      hasActivePresentationWork: true,
    });

    expect(useAvatarRuntimeStore.getState()).toMatchObject({
      activeRunId: "run-1",
      interactionPhase: "responding_no_tts",
      pendingNonTtsResponseCompletionRunId: "run-1",
    });

    store.completeNonTtsResponseIfPlannerIdle({
      runId: "run-1",
      hasActivePresentationWork: false,
    });

    expect(useAvatarRuntimeStore.getState()).toMatchObject({
      activeRunId: null,
      activeSpeechRunId: null,
      interactionPhase: "idle",
      pendingNonTtsResponseCompletionRunId: null,
    });
  });

  it("queues the debug Gesture through the chat run path without replacing a live run", () => {
    expect(startPlannerGestureDebugRun("right-thumbs-up", "debug-run-1")).toBe(
      "debug-run-1",
    );

    const state = useAvatarRuntimeStore.getState();
    expect(state).toMatchObject({
      activeRunId: "debug-run-1",
      interactionPhase: "responding_no_tts",
      pendingNonTtsResponseCompletionRunId: "debug-run-1",
    });
    expect(state.plannerEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "gestureRequested",
          runId: "debug-run-1",
          animationHint: "right-thumbs-up",
        }),
      ]),
    );

    expect(startPlannerGestureDebugRun("wave", "debug-run-2")).toBeNull();
    expect(useAvatarRuntimeStore.getState().activeRunId).toBe("debug-run-1");
  });
});
