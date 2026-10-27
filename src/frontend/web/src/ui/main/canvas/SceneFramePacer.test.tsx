// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setCanvasFrameCap } from "@/lib/avatar/canvasFrameCap";
import { SceneFramePacer } from "./SceneFramePacer";
import { createSceneFrameDemand } from "./sceneFramePacing";

const three = vi.hoisted(() => ({
  advance: vi.fn(),
  gl: { domElement: {} as Element },
}));

vi.mock("@react-three/fiber", () => ({
  useThree: (select: (state: typeof three) => unknown) => select(three),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("SceneFramePacer", () => {
  let container: HTMLDivElement;
  let root: Root;
  let frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  let displayFrame = 0;

  /** Run one more second of a 120 Hz display; returns the frames rendered. */
  function renderOneSecond(): number {
    const before = three.advance.mock.calls.length;
    for (let frame = 0; frame < 120; frame += 1) {
      displayFrame += 1;
      const pending = frames;
      frames = [];
      for (const callback of pending) callback((displayFrame * 1000) / 120);
    }
    return three.advance.mock.calls.length - before;
  }

  it("renders its canvas at the cap an Avatar set on it", () => {
    const owner = {};
    setCanvasFrameCap(three.gl.domElement, owner, 30);
    act(() => {
      root.render(<SceneFramePacer demand={createSceneFrameDemand()} />);
    });
    expect(renderOneSecond()).toBe(30);

    // Unloading the Avatar lifts the cap; the next full second is at 60.
    setCanvasFrameCap(three.gl.domElement, owner, null);
    renderOneSecond();
    expect(renderOneSecond()).toBe(60);
  });
});
