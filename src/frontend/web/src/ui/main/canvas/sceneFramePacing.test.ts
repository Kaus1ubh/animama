import { describe, expect, it } from "vitest";

import {
  ACTIVE_SCENE_FPS,
  createSceneFrameDemand,
  IDLE_SCENE_FPS,
  nextSceneFrame,
  SCENE_INPUT_ACTIVE_MS,
  sceneTargetFps,
} from "./sceneFramePacing";

/** Frames rendered over `seconds` of a `hz` display paced at `fps`. */
function renderedFrames(hz: number, fps: number, seconds = 2): number {
  let last = Number.NEGATIVE_INFINITY;
  let rendered = 0;
  for (let frame = 0; frame < hz * seconds; frame++) {
    // Display timestamps jitter by a fraction of a millisecond.
    const now = (frame * 1000) / hz + (frame % 2 ? 0.3 : -0.3);
    const next = nextSceneFrame(now, last, fps);
    if (next === null) continue;
    last = next;
    rendered++;
  }
  return rendered / seconds;
}

describe("scene frame pacing", () => {
  it("renders at the target rate on 60, 120 and 144 Hz displays", () => {
    expect(renderedFrames(60, 60)).toBe(60);
    expect(renderedFrames(120, 60)).toBe(60);
    expect(renderedFrames(144, 60)).toBeCloseTo(60, 0);
    expect(renderedFrames(120, 30)).toBe(30);
    expect(renderedFrames(60, 30)).toBe(30);
  });

  it("restarts the schedule after a pause instead of catching up", () => {
    expect(nextSceneFrame(10_000, 0, 60)).toBe(10_000);
    expect(nextSceneFrame(10_008, 10_000, 60)).toBeNull();
  });

  it("drops to the idle rate only for an idle Avatar without recent input", () => {
    const demand = createSceneFrameDemand();
    expect(sceneTargetFps(demand, 10_000)).toBe(ACTIVE_SCENE_FPS);
    demand.avatarIdle = true;
    expect(sceneTargetFps(demand, 10_000)).toBe(IDLE_SCENE_FPS);
    demand.lastInputMs = 10_000;
    expect(sceneTargetFps(demand, 10_000 + SCENE_INPUT_ACTIVE_MS)).toBe(
      ACTIVE_SCENE_FPS,
    );
    expect(sceneTargetFps(demand, 10_001 + SCENE_INPUT_ACTIVE_MS)).toBe(
      IDLE_SCENE_FPS,
    );
  });
});
