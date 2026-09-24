import { describe, expect, it, vi } from "vitest";

import type { AvatarVFXGuideSurface } from "@/lib/avatar/vfx/placement-guide-types";
import {
  drawAvatarEffectUvSurface,
  startAvatarEffectUvPreview,
  type UvPreviewFrameScheduler,
} from "./avatarEffectUvDrawing";

function createCanvas() {
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    setLineDash: vi.fn(),
    ellipse: vi.fn(),
    strokeText: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  return { canvas, context };
}

function createSurface(): AvatarVFXGuideSurface {
  return {
    key: "face:map",
    materialName: "Face",
    slot: "map",
    image: Object.freeze({}) as CanvasImageSource,
    width: 200,
    height: 100,
    guides: [
      {
        kind: "reference",
        label: "Mouth",
        shape: "polygon",
        points: [
          { x: 0.25, y: 0.25 },
          { x: 0.75, y: 0.25 },
          { x: 0.75, y: 0.5 },
          { x: 0.25, y: 0.5 },
        ],
        pivot: { x: 0.5, y: 0.375 },
      },
      {
        kind: "artwork",
        label: "Mouth artwork",
        shape: "polygon",
        points: [
          { x: 0.25, y: 0.5 },
          { x: 0.5, y: 0.25 },
          { x: 0.75, y: 0.5 },
          { x: 0.5, y: 0.75 },
        ],
      },
      {
        kind: "flatten",
        label: "Mouth coverage",
        shape: "ellipse",
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.9, y: 0.2 },
          { x: 0.9, y: 0.8 },
          { x: 0.1, y: 0.8 },
        ],
      },
    ],
  };
}

describe("Avatar Effect UV preview drawing", () => {
  it("preserves source aspect and uses the projected top-left coordinates without a second UV flip", () => {
    const { canvas, context } = createCanvas();
    const surface = createSurface();
    const before = structuredClone(surface.guides);
    drawAvatarEffectUvSurface(canvas, surface, false);

    expect([canvas.width, canvas.height]).toEqual([200, 100]);
    expect(context.drawImage).toHaveBeenCalledWith(
      surface.image,
      0,
      0,
      200,
      100,
    );
    expect(context.moveTo).toHaveBeenCalledWith(50, 25);
    expect(context.lineTo).toHaveBeenCalledWith(150, 25);
    expect(context.lineTo).toHaveBeenCalledWith(100, 75);
    expect(context.setLineDash).toHaveBeenCalledWith([4, 4]);
    expect(context.setLineDash).toHaveBeenCalledWith([]);
    expect(context.ellipse).not.toHaveBeenCalled();
    expect(surface.guides).toEqual(before);
  });

  it("only reveals flatten coverage on request and scales normalized bounds to the source aspect", () => {
    const { canvas, context } = createCanvas();
    drawAvatarEffectUvSurface(canvas, createSurface(), true);
    expect(context.ellipse).toHaveBeenCalledWith(
      100,
      50,
      80,
      30,
      0,
      0,
      Math.PI * 2,
    );
  });

  it("bounds large canvas allocation while retaining a non-square texture's aspect", () => {
    const { canvas, context } = createCanvas();
    const surface = { ...createSurface(), width: 4096, height: 2048 };
    drawAvatarEffectUvSurface(canvas, surface, false);
    expect([canvas.width, canvas.height]).toEqual([768, 384]);
    expect(context.drawImage).toHaveBeenCalledWith(
      surface.image,
      0,
      0,
      768,
      384,
    );
  });

  it("reads live surfaces at a bounded cadence, clears unavailable content, and cancels owned frames", () => {
    const { canvas, context } = createCanvas();
    let callback: FrameRequestCallback | undefined;
    let handle = 0;
    const scheduler: UvPreviewFrameScheduler = {
      request: vi.fn((next) => {
        callback = next;
        return ++handle;
      }),
      cancel: vi.fn(),
    };
    const readSurface =
      vi.fn<() => AvatarVFXGuideSurface | undefined>(createSurface);
    const stop = startAvatarEffectUvPreview(
      canvas,
      readSurface,
      false,
      scheduler,
    );
    callback?.(0);
    callback?.(16);
    callback?.(34);
    expect(readSurface).toHaveBeenCalledTimes(2);
    expect(context.drawImage).toHaveBeenCalledTimes(2);
    readSurface.mockReturnValue(undefined);
    callback?.(68);
    expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, 200, 100);
    expect(context.drawImage).toHaveBeenCalledTimes(2);
    stop();
    expect(scheduler.cancel).toHaveBeenCalledWith(handle);
    callback?.(102);
    expect(readSurface).toHaveBeenCalledTimes(3);
  });
});
