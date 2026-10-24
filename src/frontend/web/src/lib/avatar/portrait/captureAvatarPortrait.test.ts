import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";

import { useEnhancedRenderingStore } from "@/lib/avatar/enhanced-rendering/enhancedRendering";
import { ENHANCED_SCENE_LIGHTS } from "@/ui/main/canvas/sceneCameraPresets";

import {
  AvatarPortraitCaptureError,
  captureAvatarPortrait,
  createStraightAlphaOutputPass,
  type PortraitRenderTargetRole,
} from "./captureAvatarPortrait";

function createFixture(options?: {
  renderThrows?: boolean;
  head?: THREE.Vector3 | null;
  floatColor?: boolean;
}) {
  const scene = new THREE.Scene();
  const avatarScene = new THREE.Group();
  const unrelated = new THREE.Group();
  scene.add(avatarScene, unrelated);
  const renderTargets = {
    scene: { texture: {}, dispose: vi.fn() },
    output: { texture: {}, dispose: vi.fn() },
  };
  const createRenderTarget = (_size: number, role: PortraitRenderTargetRole) =>
    renderTargets[role] as never;
  const renderer = {
    extensions: {
      has: vi.fn(
        (name: string) =>
          (options?.floatColor ?? true) && name === "EXT_color_buffer_float",
      ),
    },
    autoClear: false,
    toneMapping: THREE.NoToneMapping as THREE.ToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: THREE.LinearSRGBColorSpace as THREE.ColorSpace,
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
    renderTargets,
    createRenderTarget,
    runWithPortraitCaptureState,
  };
}

/** Every renderer and scene change a capture makes is undone. */
function expectStageRestored(fixture: ReturnType<typeof createFixture>) {
  const { renderer } = fixture;
  expect(fixture.scene.children).toEqual([
    fixture.avatarScene,
    fixture.unrelated,
  ]);
  expect(fixture.unrelated.visible).toBe(true);
  expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(null);
  expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
  expect(renderer.toneMappingExposure).toBe(1);
  expect(renderer.outputColorSpace).toBe(THREE.LinearSRGBColorSpace);
  expect(renderer.autoClear).toBe(false);
  expect(renderer.setScissorTest).toHaveBeenLastCalledWith(true);
  const [color, alpha] = renderer.setClearColor.mock.lastCall as [
    THREE.Color,
    number,
  ];
  expect(color.getHex()).toBe(0x123456);
  expect(alpha).toBe(0.25);
  expect(fixture.renderTargets.scene.dispose).toHaveBeenCalledOnce();
  expect(fixture.renderTargets.output.dispose).toHaveBeenCalledOnce();
}

describe("createStraightAlphaOutputPass", () => {
  it("divides colour by alpha before tone mapping", () => {
    const pass = createStraightAlphaOutputPass();
    const shader = pass.material.fragmentShader;
    const unpremultiply = shader.indexOf("gl_FragColor.rgb /= gl_FragColor.a");
    expect(unpremultiply).toBeGreaterThan(
      shader.indexOf("texture2D( tDiffuse"),
    );
    expect(unpremultiply).toBeLessThan(shader.indexOf("TONE_MAPPING"));
    pass.dispose();
  });
});

describe("captureAvatarPortrait", () => {
  afterEach(() => useEnhancedRenderingStore.setState({ enabled: true }));

  it("renders and restores all temporary renderer and scene state", async () => {
    const fixture = createFixture();
    const blob = await captureAvatarPortrait({
      avatar: fixture.avatar,
      renderer: fixture.renderer as unknown as THREE.WebGLRenderer,
      camera: new THREE.PerspectiveCamera(50, 2, 0.1, 100),
      scene: fixture.scene,
      size: 64,
      dependencies: {
        createRenderTarget: fixture.createRenderTarget,
        encodePixels: async (pixels, size) => {
          expect(size).toBe(64);
          // White read back, then the chat canvas grade (alpha unchanged).
          expect(Array.from(pixels.subarray(0, 4))).toEqual([
            245, 245, 245, 255,
          ]);
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
    expect(fixture.renderTargets.scene.dispose).toHaveBeenCalledOnce();
    expect(fixture.renderTargets.output.dispose).toHaveBeenCalledOnce();
    // The Avatar renders into the MSAA target, the output pass into the
    // read-back target.
    expect(fixture.renderer.setRenderTarget.mock.calls.slice(0, 2)).toEqual([
      [fixture.renderTargets.scene],
      [fixture.renderTargets.output],
    ]);
    expect(fixture.renderer.readRenderTargetPixels.mock.calls[0][0]).toBe(
      fixture.renderTargets.output,
    );
    expect(fixture.renderer.setRenderTarget).toHaveBeenLastCalledWith(null);
    expect(fixture.renderer.toneMapping).toBe(THREE.NoToneMapping);
    expect(fixture.renderer.outputColorSpace).toBe(THREE.LinearSRGBColorSpace);
    expect(fixture.renderer.toneMappingExposure).toBe(1);
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
        createRenderTarget: fixture.createRenderTarget,
        encodePixels: async () => new Blob([], { type: "image/webp" }),
      },
    });

    expect(fixture.runWithPortraitCaptureState).toHaveBeenCalledWith(
      null,
      expect.any(Function),
      { keepLiveExpressions: true },
    );
    // The Avatar render and the output pass.
    expect(fixture.renderer.render).toHaveBeenCalledTimes(2);
  });

  it("renders with the chat canvas's lights and tone mapping", async () => {
    const fixture = createFixture();
    const seen: { lights: THREE.Light[]; toneMapping: THREE.ToneMapping }[] =
      [];
    fixture.renderer.render.mockImplementationOnce((scene: THREE.Scene) => {
      const lights: THREE.Light[] = [];
      scene.traverse((object) => {
        if ((object as THREE.Light).isLight) lights.push(object as THREE.Light);
      });
      seen.push({ lights, toneMapping: fixture.renderer.toneMapping });
    });
    await captureAvatarPortrait({
      avatar: fixture.avatar,
      renderer: fixture.renderer as unknown as THREE.WebGLRenderer,
      camera: new THREE.PerspectiveCamera(50, 2, 0.1, 100),
      scene: fixture.scene,
      size: 64,
      dependencies: {
        createRenderTarget: fixture.createRenderTarget,
        encodePixels: async () => new Blob([], { type: "image/webp" }),
      },
    });

    expect(seen[0].toneMapping).toBe(THREE.NeutralToneMapping);
    expect(seen[0].lights).toHaveLength(
      1 + ENHANCED_SCENE_LIGHTS.directional.length,
    );
    expect(seen[0].lights[0].intensity).toBe(
      ENHANCED_SCENE_LIGHTS.ambientIntensity,
    );
  });

  it("uses the classic lights, ACES tone mapping and no grade when enhanced rendering is off", async () => {
    useEnhancedRenderingStore.setState({ enabled: false });
    const fixture = createFixture();
    let toneMapping: THREE.ToneMapping | null = null;
    fixture.renderer.render.mockImplementationOnce(() => {
      toneMapping = fixture.renderer.toneMapping;
    });
    let encoded: number[] = [];
    await captureAvatarPortrait({
      avatar: fixture.avatar,
      renderer: fixture.renderer as unknown as THREE.WebGLRenderer,
      camera: new THREE.PerspectiveCamera(50, 2, 0.1, 100),
      scene: fixture.scene,
      size: 64,
      dependencies: {
        createRenderTarget: fixture.createRenderTarget,
        encodePixels: async (pixels) => {
          encoded = Array.from(pixels.subarray(0, 4));
          return new Blob([], { type: "image/webp" });
        },
      },
    });

    expect(toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(encoded).toEqual([255, 255, 255, 255]);
    expect(fixture.renderer.toneMapping).toBe(THREE.NoToneMapping);
  });

  it.each([
    [true, THREE.HalfFloatType],
    [false, THREE.UnsignedByteType],
  ])(
    "renders the scene into a half-float target only when the GPU supports it (%s)",
    async (floatColor, type) => {
      const fixture = createFixture({ floatColor });
      await captureAvatarPortrait({
        avatar: fixture.avatar,
        renderer: fixture.renderer as unknown as THREE.WebGLRenderer,
        camera: new THREE.PerspectiveCamera(50, 2, 0.1, 100),
        scene: fixture.scene,
        size: 64,
        dependencies: {
          encodePixels: async () => new Blob([], { type: "image/webp" }),
        },
      });

      const [sceneTarget] = fixture.renderer.setRenderTarget.mock.calls[0] as [
        THREE.WebGLRenderTarget,
      ];
      expect(sceneTarget.texture.type).toBe(type);
      expect(sceneTarget.samples).toBe(4);
    },
  );

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
        createRenderTarget: fixture.createRenderTarget,
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
          createRenderTarget: fixture.createRenderTarget,
          encodePixels: async () => new Blob(),
        },
      }),
    ).rejects.toThrow("render failed");

    expectStageRestored(fixture);
  });

  it("restores the stage when cancelled after allocating GPU resources", async () => {
    const fixture = createFixture();
    const controller = new AbortController();
    fixture.runWithPortraitCaptureState.mockImplementationOnce(
      (_expression, callback) => {
        controller.abort();
        return callback();
      },
    );

    await expect(
      captureAvatarPortrait({
        avatar: fixture.avatar,
        renderer: fixture.renderer as unknown as THREE.WebGLRenderer,
        camera: new THREE.PerspectiveCamera(),
        scene: fixture.scene,
        size: 64,
        signal: controller.signal,
        dependencies: {
          createRenderTarget: fixture.createRenderTarget,
          encodePixels: async () => new Blob(),
        },
      }),
    ).rejects.toMatchObject({
      code: "aborted",
    } satisfies Partial<AvatarPortraitCaptureError>);
    expect(fixture.renderer.render).not.toHaveBeenCalled();
    expectStageRestored(fixture);
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
          createRenderTarget: fixture.createRenderTarget,
          encodePixels: async () => new Blob(),
        },
      }),
    ).rejects.toMatchObject({
      code: "head_bone_missing",
    } satisfies Partial<AvatarPortraitCaptureError>);
    expect(fixture.renderTargets.scene.dispose).toHaveBeenCalledOnce();
    expect(fixture.renderTargets.output.dispose).toHaveBeenCalledOnce();
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
          createRenderTarget: fixture.createRenderTarget,
        },
      }),
    ).rejects.toMatchObject({
      code: "aborted",
    } satisfies Partial<AvatarPortraitCaptureError>);
    expect(fixture.renderTargets.scene.dispose).not.toHaveBeenCalled();
  });
});
