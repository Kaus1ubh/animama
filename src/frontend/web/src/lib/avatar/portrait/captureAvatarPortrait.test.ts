import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";

import {
  AvatarPortraitCaptureError,
  captureAvatarPortrait,
} from "./captureAvatarPortrait";

function createFixture(options?: {
  renderThrows?: boolean;
  head?: THREE.Vector3 | null;
}) {
  const scene = new THREE.Scene();
  const avatarScene = new THREE.Group();
  const unrelated = new THREE.Group();
  scene.add(avatarScene, unrelated);
  const renderTarget = { texture: {}, dispose: vi.fn() };
  const renderer = {
    autoClear: false,
    getRenderTarget: vi.fn(() => null),
    getViewport: vi.fn((target: THREE.Vector4) => target.set(1, 2, 3, 4)),
    getScissor: vi.fn((target: THREE.Vector4) => target.set(5, 6, 7, 8)),
    getScissorTest: vi.fn(() => true),
    getClearColor: vi.fn((target: THREE.Color) => target.set(0x123456)),
    getClearAlpha: vi.fn(() => 0.25),
    getPixelRatio: vi.fn(() => 2),
    setRenderTarget: vi.fn(),
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    setScissorTest: vi.fn(),
    setClearColor: vi.fn(),
    clear: vi.fn(),
    render: options?.renderThrows
      ? vi.fn(() => {
          throw new Error("render failed");
        })
      : vi.fn(),
    readRenderTargetPixels: vi.fn(
      (_target, _x, _y, _width, _height, pixels: Uint8Array) => {
        pixels.fill(255);
      },
    ),
  };
  const runWithPortraitCaptureState = vi.fn(
    (_expressionName: string | null, callback: () => Uint8Array) => callback(),
  );
  const avatar = {
    scene: avatarScene,
    faceLandmarks: null,
    faceTextureAnchors: null,
    getHeadPosition: () =>
      options && "head" in options
        ? (options.head ?? null)
        : new THREE.Vector3(0, 1.6, 0),
    getAvailableExpressions: () => ["sad", "Happy"],
    runWithPortraitCaptureState,
  } as unknown as Avatar;

  return {
    avatar,
    avatarScene,
    unrelated,
    scene,
    renderer,
    renderTarget,
    runWithPortraitCaptureState,
  };
}

describe("captureAvatarPortrait", () => {
  it("renders and restores all temporary renderer and scene state", async () => {
    const fixture = createFixture();
    const blob = await captureAvatarPortrait({
      avatar: fixture.avatar,
      renderer: fixture.renderer as unknown as THREE.WebGLRenderer,
      camera: new THREE.PerspectiveCamera(50, 2, 0.1, 100),
      scene: fixture.scene,
      size: 64,
      dependencies: {
        createRenderTarget: () => fixture.renderTarget as never,
        encodePixels: async (pixels, size) => {
          expect(size).toBe(64);
          expect(pixels.every((value) => value === 255)).toBe(true);
          return new Blob([pixels.slice().buffer as ArrayBuffer], {
            type: "image/webp",
          });
        },
      },
    });

    expect(blob.type).toBe("image/webp");
    expect(fixture.runWithPortraitCaptureState).toHaveBeenCalledWith(
      "Happy",
      expect.any(Function),
      { keepLiveExpressions: false },
    );
    expect(fixture.unrelated.visible).toBe(true);
    expect(fixture.avatarScene.visible).toBe(true);
    expect(fixture.scene.children).toEqual([
      fixture.avatarScene,
      fixture.unrelated,
    ]);
    expect(fixture.renderTarget.dispose).toHaveBeenCalledOnce();
    expect(fixture.renderer.setRenderTarget).toHaveBeenLastCalledWith(null);
    expect(fixture.renderer.setViewport).toHaveBeenCalledWith(0, 0, 32, 32);
    expect(fixture.renderer.setClearColor).toHaveBeenCalledWith(0x000000, 0);
    expect(fixture.renderer.setScissorTest).toHaveBeenLastCalledWith(true);
    expect(fixture.renderer.autoClear).toBe(false);
  });

  it("keeps the live expression state when asked", async () => {
    const fixture = createFixture();
    await captureAvatarPortrait({
      avatar: fixture.avatar,
      renderer: fixture.renderer as unknown as THREE.WebGLRenderer,
      camera: new THREE.PerspectiveCamera(50, 2, 0.1, 100),
      scene: fixture.scene,
      size: 64,
      expression: "live",
      dependencies: {
        createRenderTarget: () => fixture.renderTarget as never,
        encodePixels: async () => new Blob([], { type: "image/webp" }),
      },
    });

    expect(fixture.runWithPortraitCaptureState).toHaveBeenCalledWith(
      null,
      expect.any(Function),
      { keepLiveExpressions: true },
    );
    expect(fixture.renderer.render).toHaveBeenCalledOnce();
  });

  const captureCamera = async (framing?: {
    framingScale?: number;
    framingDrop?: number;
  }) => {
    const fixture = createFixture();
    await captureAvatarPortrait({
      avatar: fixture.avatar,
      renderer: fixture.renderer as unknown as THREE.WebGLRenderer,
      camera: new THREE.PerspectiveCamera(50, 2, 0.1, 100),
      scene: fixture.scene,
      size: 64,
      ...framing,
      dependencies: {
        createRenderTarget: () => fixture.renderTarget as never,
        encodePixels: async () => new Blob([], { type: "image/webp" }),
      },
    });
    return fixture.renderer.render.mock.calls[0][1] as THREE.PerspectiveCamera;
  };

  it("widens the head framing by a scale, keeping its target", async () => {
    const cameraDistance = async (framingScale?: number) =>
      (await captureCamera({ framingScale })).position.distanceTo(
        new THREE.Vector3(0, 1.6, 0),
      );
    const head = await cameraDistance();
    expect(await cameraDistance(2)).toBeCloseTo(head * 2, 5);
  });

  it("lowers the view by a share of its height for a framing drop", async () => {
    const head = await captureCamera({ framingScale: 3 });
    const body = await captureCamera({ framingScale: 3, framingDrop: 0.25 });
    // The default front camera looks along -Z, so the head sits on the axis.
    const viewHeight = 2 * head.position.z * Math.tan((35 * Math.PI) / 360);

    expect(body.position.z).toBeCloseTo(head.position.z, 5);
    expect(body.position.y).toBeCloseTo(head.position.y - viewHeight / 4, 5);
    const headInView = new THREE.Vector3(0, head.position.y, 0).project(body);
    // Normalized device Y runs -1..1, so a quarter of the view is 0.5.
    expect(headInView.y).toBeCloseTo(0.5, 5);
  });

  it("rejects a framing drop outside 0 to 0.5", async () => {
    await expect(captureCamera({ framingDrop: 0.6 })).rejects.toMatchObject({
      code: "invalid_size",
    } satisfies Partial<AvatarPortraitCaptureError>);
  });

  it("restores and disposes resources after a render error", async () => {
    const fixture = createFixture({ renderThrows: true });

    await expect(
      captureAvatarPortrait({
        avatar: fixture.avatar,
        renderer: fixture.renderer as unknown as THREE.WebGLRenderer,
        camera: new THREE.PerspectiveCamera(),
        scene: fixture.scene,
        size: 64,
        dependencies: {
          createRenderTarget: () => fixture.renderTarget as never,
          encodePixels: async () => new Blob(),
        },
      }),
    ).rejects.toThrow("render failed");

    expect(fixture.unrelated.visible).toBe(true);
    expect(fixture.renderTarget.dispose).toHaveBeenCalledOnce();
  });

  it("returns a typed failure when the normalized head is unavailable", async () => {
    const fixture = createFixture({ head: null });

    await expect(
      captureAvatarPortrait({
        avatar: fixture.avatar,
        renderer: fixture.renderer as unknown as THREE.WebGLRenderer,
        camera: new THREE.PerspectiveCamera(),
        scene: fixture.scene,
        size: 64,
        dependencies: {
          createRenderTarget: () => fixture.renderTarget as never,
          encodePixels: async () => new Blob(),
        },
      }),
    ).rejects.toMatchObject({
      code: "head_bone_missing",
    } satisfies Partial<AvatarPortraitCaptureError>);
    expect(fixture.renderTarget.dispose).toHaveBeenCalledOnce();
  });

  it("aborts before allocating GPU resources", async () => {
    const fixture = createFixture();
    const controller = new AbortController();
    controller.abort();

    await expect(
      captureAvatarPortrait({
        avatar: fixture.avatar,
        renderer: fixture.renderer as unknown as THREE.WebGLRenderer,
        camera: new THREE.PerspectiveCamera(),
        scene: fixture.scene,
        signal: controller.signal,
        dependencies: {
          createRenderTarget: () => fixture.renderTarget as never,
        },
      }),
    ).rejects.toMatchObject({
      code: "aborted",
    } satisfies Partial<AvatarPortraitCaptureError>);
    expect(fixture.renderTarget.dispose).not.toHaveBeenCalled();
  });
});
