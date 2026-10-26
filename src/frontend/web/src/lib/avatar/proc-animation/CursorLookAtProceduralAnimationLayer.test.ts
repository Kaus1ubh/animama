// @vitest-environment happy-dom
import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CursorLookAtProceduralAnimationLayer } from "./CursorLookAtProceduralAnimationLayer";

/** A VRM without bones or look-at: enough to construct the layer. */
const vrm = {
  humanoid: { getNormalizedBoneNode: () => null },
  scene: new THREE.Group(),
  lookAt: null,
} as unknown as VRM;

const observers: Array<{ fire(): void; disconnected: boolean }> = [];

class FakeResizeObserver {
  disconnected = false;
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    observers.push(this);
  }
  observe() {}
  disconnect() {
    this.disconnected = true;
  }
  fire() {
    this.callback();
  }
}

type ViewportProbe = { _getViewportRect(): DOMRect | null };

describe("cursor look-at viewport rect", () => {
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads layout once and again only after a resize", () => {
    const element = document.createElement("div");
    const read = vi
      .spyOn(element, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 800, 600));
    const layer = new CursorLookAtProceduralAnimationLayer(vrm, {
      viewportElement: element,
    });
    const probe = layer as unknown as ViewportProbe;

    for (let frame = 0; frame < 5; frame++) probe._getViewportRect();
    expect(read).toHaveBeenCalledTimes(1);

    observers[0].fire();
    probe._getViewportRect();
    expect(read).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new Event("resize"));
    probe._getViewportRect();
    expect(read).toHaveBeenCalledTimes(3);

    layer.dispose();
    expect(observers[0].disconnected).toBe(true);
  });

  it("reads layout every time without ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const element = document.createElement("div");
    const read = vi.spyOn(element, "getBoundingClientRect");
    const layer = new CursorLookAtProceduralAnimationLayer(vrm, {
      viewportElement: element,
    });
    const probe = layer as unknown as ViewportProbe;
    probe._getViewportRect();
    probe._getViewportRect();
    expect(read).toHaveBeenCalledTimes(2);
    layer.dispose();
  });
});
