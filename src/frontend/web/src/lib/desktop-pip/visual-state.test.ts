import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyDesktopPipPlannerEventsConsumed,
  applyDesktopPipVisualState,
  captureDesktopPipVisualState,
  watchDesktopPipPlannerEventConsumption,
} from "./visual-state";
import type { AvatarPlannerEvent } from "@/lib/avatar";
import { useAvatarRuntimeStore } from "@/stores/avatar-runtime-store";
import {
  useSceneVFXStore,
  type SceneVFXActiveByKind,
} from "@/stores/scene-vfx-store";
import { DEFAULT_AVATAR_TRANSFORM } from "@/ui/main/canvas/transform-state";

/** A Reaction's scene background, as PiP's own Avatar applies it. */
const reactionBackground = {
  background_layers: { entry: { id: "scene-b-excitement" } },
} as unknown as SceneVFXActiveByKind;

describe("PiP visual state", () => {
  afterEach(() => {
    useSceneVFXStore.getState().replaceActiveByKind({});
  });

  it("keeps the scene effects PiP's Avatar plays when a snapshot arrives", () => {
    // The main window's scene is suspended during PiP, so its store is empty.
    const snapshot = captureDesktopPipVisualState({
      avatarTransform: DEFAULT_AVATAR_TRANSFORM,
      backgroundMode: "scene",
      cameraPreset: "portrait",
    });
    useSceneVFXStore.getState().replaceActiveByKind(reactionBackground);

    applyDesktopPipVisualState(snapshot);

    expect(useSceneVFXStore.getState().activeByKind).toBe(reactionBackground);
  });
});

function gestureEvent(eventId: string): AvatarPlannerEvent {
  return {
    type: "gestureRequested",
    eventId,
    requestId: `request:${eventId}`,
    runId: "run-1",
    animationHint: "wave",
    sourceEventId: null,
    sourceEmotionEventId: null,
    createdAtMs: 1_000,
  };
}

/** The owner's snapshot while its queue holds `events`. */
function snapshotWith(events: AvatarPlannerEvent[]) {
  useAvatarRuntimeStore.setState({ plannerEvents: events });
  return captureDesktopPipVisualState({
    avatarTransform: DEFAULT_AVATAR_TRANSFORM,
    backgroundMode: "scene",
    cameraPreset: "portrait",
  });
}

function plannerEventIds() {
  return useAvatarRuntimeStore
    .getState()
    .plannerEvents.map((event) => event.eventId);
}

describe("PiP planner event consumption", () => {
  const stopWatching: Array<() => void> = [];

  afterEach(() => {
    for (const stop of stopWatching.splice(0)) stop();
    useAvatarRuntimeStore.setState({ plannerEvents: [] });
  });

  it("reports the events PiP's Avatar consumes", () => {
    const gesture = gestureEvent("motion-gesture-report");
    const snapshot = snapshotWith([gesture]);
    useAvatarRuntimeStore.setState({ plannerEvents: [] });
    const onConsumed = vi.fn();
    stopWatching.push(watchDesktopPipPlannerEventConsumption(onConsumed));

    applyDesktopPipVisualState(snapshot);
    expect(onConsumed).not.toHaveBeenCalled();

    useAvatarRuntimeStore.getState().consumePlannerEvents([gesture.eventId]);
    expect(onConsumed).toHaveBeenCalledExactlyOnceWith([gesture.eventId]);
  });

  it("does not report events a snapshot removes", () => {
    const gesture = gestureEvent("motion-gesture-replaced");
    const emptySnapshot = snapshotWith([]);
    useAvatarRuntimeStore.setState({ plannerEvents: [gesture] });
    const onConsumed = vi.fn();
    stopWatching.push(watchDesktopPipPlannerEventConsumption(onConsumed));

    // The owner already dropped the event, for example when its run finished.
    applyDesktopPipVisualState(emptySnapshot);

    expect(plannerEventIds()).toEqual([]);
    expect(onConsumed).not.toHaveBeenCalled();
  });

  it("does not replay a Gesture the owner sends again before it hears of the consumption", () => {
    // The owner's scene is suspended during PiP, so its queue keeps the
    // request until PiP's report arrives; every snapshot until then holds it.
    const gesture = gestureEvent("motion-gesture-replay");
    const snapshot = snapshotWith([gesture]);
    useAvatarRuntimeStore.setState({ plannerEvents: [] });
    stopWatching.push(watchDesktopPipPlannerEventConsumption(() => {}));
    applyDesktopPipVisualState(snapshot);
    useAvatarRuntimeStore.getState().consumePlannerEvents([gesture.eventId]);

    applyDesktopPipVisualState(snapshot);

    expect(plannerEventIds()).toEqual([]);
  });

  it("still delivers events PiP has not consumed", () => {
    const first = gestureEvent("motion-gesture-first");
    const second = gestureEvent("motion-gesture-second");
    stopWatching.push(watchDesktopPipPlannerEventConsumption(() => {}));
    applyDesktopPipVisualState(snapshotWith([first]));
    useAvatarRuntimeStore.getState().consumePlannerEvents([first.eventId]);

    applyDesktopPipVisualState(snapshotWith([first, second]));

    expect(plannerEventIds()).toEqual([second.eventId]);
  });

  it("removes the events PiP consumed from the owner's queue", () => {
    const consumed = gestureEvent("motion-gesture-owner-consumed");
    const pending = gestureEvent("motion-gesture-owner-pending");
    useAvatarRuntimeStore.setState({ plannerEvents: [consumed, pending] });

    applyDesktopPipPlannerEventsConsumed({
      kind: "planner-events-consumed",
      eventIds: [consumed.eventId],
    });

    expect(plannerEventIds()).toEqual([pending.eventId]);
  });

  it("ignores a malformed consumption report", () => {
    const pending = gestureEvent("motion-gesture-malformed");
    useAvatarRuntimeStore.setState({ plannerEvents: [pending] });

    applyDesktopPipPlannerEventsConsumed({ eventIds: [pending.eventId] });
    applyDesktopPipPlannerEventsConsumed({
      kind: "planner-events-consumed",
      eventIds: [42],
    });

    expect(plannerEventIds()).toEqual([pending.eventId]);
  });
});
