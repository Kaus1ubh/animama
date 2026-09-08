import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  type WebGLRenderer,
} from "three";
import { describe, expect, it, vi } from "vitest";

import { observeFirstPosedFrame } from "./firstPosedFrame";

describe("first posed avatar frame", () => {
  it("releases preparation only after a real main-camera draw and preserves existing callbacks", () => {
    const scene = new Scene();
    const mesh = new Mesh(undefined, new MeshBasicMaterial());
    scene.add(mesh);
    const camera = new PerspectiveCamera();
    const existing = vi.fn();
    mesh.onAfterRender = existing;
    const released = vi.fn();
    let frame!: FrameRequestCallback;
    const schedule = vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    const gate = observeFirstPosedFrame(
      scene,
      camera,
      released,
      schedule,
      vi.fn(),
    );
    let target: object | null = null;
    const renderer = {
      getRenderTarget: () => target,
    } as unknown as WebGLRenderer;
    const draw = (withCamera = camera) =>
      mesh.onAfterRender(
        renderer,
        scene,
        withCamera,
        mesh.geometry,
        mesh.material,
        new Group(),
      );
    expect(gate.rendered).toBe(false);
    draw(new PerspectiveCamera());
    target = {};
    draw();
    expect(gate.rendered).toBe(false);
    target = null;
    draw();
    expect(gate.rendered).toBe(true);
    expect(released).not.toHaveBeenCalled();
    expect(mesh.onAfterRender).toBe(existing);
    draw();
    frame(0);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(released).toHaveBeenCalledTimes(1);
    expect(existing).toHaveBeenCalledTimes(4);
    gate.dispose();
  });

  it("does not release an old mount when switching away between draw and the next frame", () => {
    const scene = new Scene();
    const mesh = new Mesh(undefined, new MeshBasicMaterial());
    scene.add(mesh);
    const original = mesh.onAfterRender;
    const camera = new PerspectiveCamera();
    const released = vi.fn();
    const cancel = vi.fn();
    let nextFrame!: FrameRequestCallback;
    const gate = observeFirstPosedFrame(
      scene,
      camera,
      released,
      (callback) => {
        nextFrame = callback;
        return 7;
      },
      cancel,
    );
    mesh.onAfterRender(
      { getRenderTarget: () => null } as unknown as WebGLRenderer,
      scene,
      camera,
      mesh.geometry,
      mesh.material,
      new Group(),
    );
    gate.dispose();
    nextFrame(0);
    expect(mesh.onAfterRender).toBe(original);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(7);
    expect(released).not.toHaveBeenCalled();
  });

  it("fails clearly when there is no drawable model instead of waiting forever", () => {
    expect(() =>
      observeFirstPosedFrame(
        new Group(),
        new PerspectiveCamera(),
        vi.fn(),
        vi.fn(),
        vi.fn(),
      ),
    ).toThrow("no renderable meshes");
  });
});
