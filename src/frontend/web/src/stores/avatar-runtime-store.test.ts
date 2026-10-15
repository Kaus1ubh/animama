import { beforeEach, describe, expect, it } from "vitest";
import { useAvatarRuntimeStore } from "./avatar-runtime-store";

describe("Action run ownership", () => {
  beforeEach(() => useAvatarRuntimeStore.getState().resetForAnima("test"));

  it("keeps reaction planning active and clears pending work on cancellation", () => {
    const runtime = useAvatarRuntimeStore.getState();
    runtime.startRun("run");
    runtime.applyEmotionUpdate({
      runId: "run",
      eventId: "emotion",
      emotionalTone: "joy",
      emotionalIntensity: 2,
    });
    expect(
      useAvatarRuntimeStore
        .getState()
        .plannerEvents.some((event) => event.type === "emotionReactionUpdated"),
    ).toBe(true);
    runtime.abortRun("run");
    expect(useAvatarRuntimeStore.getState()).toMatchObject({
      activeRunId: null,
      interactionPhase: "idle",
      plannerEvents: [],
    });
  });

  it("carries Reaction intensities 0–4 to the planner, clamping larger values", () => {
    const runtime = useAvatarRuntimeStore.getState();
    runtime.startRun("run");
    const intensities = [0, 1, 4, 7].map((emotionalIntensity, index) => {
      runtime.applyEmotionUpdate({
        runId: "run",
        eventId: `emotion-${index}`,
        emotionalTone: "joy",
        emotionalIntensity,
      });
      const event = useAvatarRuntimeStore
        .getState()
        .plannerEvents.filter(
          (candidate) => candidate.type === "emotionReactionUpdated",
        )
        .at(-1);
      return event?.type === "emotionReactionUpdated"
        ? event.emotional_intensity
        : null;
    });
    // Intensity 0 still reaches the planner, which plays no Reaction for it.
    expect(intensities).toEqual([0, 1, 4, 4]);
  });

  it("waits for planner work to drain before completing a non-TTS response", () => {
    const runtime = useAvatarRuntimeStore.getState();
    runtime.startRun("run");
    runtime.markNonTtsResponseStarted("run");
    runtime.requestNonTtsResponseCompletion("run");
    runtime.completeNonTtsResponseIfPlannerIdle({
      runId: "run",
      hasActivePresentationWork: true,
    });
    expect(useAvatarRuntimeStore.getState().activeRunId).toBe("run");
    runtime.completeNonTtsResponseIfPlannerIdle({
      runId: "run",
      hasActivePresentationWork: false,
    });
    expect(useAvatarRuntimeStore.getState()).toMatchObject({
      activeRunId: null,
      interactionPhase: "idle",
      pendingNonTtsResponseCompletionRunId: null,
    });
  });
});
