import { describe, expect, it } from "vitest";

import { canvasFrameCap, setCanvasFrameCap } from "./canvasFrameCap";

describe("canvas frame caps", () => {
  it("use the lowest cap of the Avatars on a canvas", () => {
    const canvas = {} as Element;
    const other = {} as Element;
    const first = {};
    const second = {};
    expect(canvasFrameCap(canvas)).toBeNull();
    expect(canvasFrameCap(null)).toBeNull();

    setCanvasFrameCap(canvas, first, 45);
    setCanvasFrameCap(canvas, second, 30);
    expect(canvasFrameCap(canvas)).toBe(30);
    expect(canvasFrameCap(other)).toBeNull();

    setCanvasFrameCap(canvas, second, null);
    expect(canvasFrameCap(canvas)).toBe(45);
    setCanvasFrameCap(canvas, first, null);
    expect(canvasFrameCap(canvas)).toBeNull();
  });
});
