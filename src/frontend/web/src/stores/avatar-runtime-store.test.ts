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
