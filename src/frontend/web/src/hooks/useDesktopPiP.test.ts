// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { afterNextFrame } from "./useDesktopPiP";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

describe("afterNextFrame", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setVisibility("visible");
  });

  it("waits for a frame while the page is visible", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    const callback = vi.fn();

    afterNextFrame(callback);
    expect(callback).not.toHaveBeenCalled();

    frames[0](0);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("does not wait for a frame while the page is hidden", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => {
      throw new Error("hidden pages render no frames");
    });
    setVisibility("hidden");
    const callback = vi.fn();

    afterNextFrame(callback);
    vi.runAllTimers();

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
